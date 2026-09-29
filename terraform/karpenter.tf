# ---------------------------------------------------------------------------
# Karpenter — Node Autoscaling for DevBoard Production
#
# Decision: Karpenter over Cluster Autoscaler
# - Karpenter provisions nodes in ~60s vs ~5min for Cluster Autoscaler
# - Karpenter directly interacts with EC2 Fleet API (no ASG dependency)
# - Karpenter supports bin-packing, consolidation, and drift detection
# - Karpenter is the AWS-recommended solution for EKS node autoscaling
#
# Architecture:
#   HPA detects pod CPU/memory pressure
#     → Requests more replicas
#     → Pods go Pending (insufficient node capacity)
#     → Karpenter detects Pending pods
#     → Provisions right-sized EC2 instances
#     → Pods are scheduled on new nodes
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Karpenter Controller — IRSA + Helm
# ---------------------------------------------------------------------------
module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "~> 20.0"

  cluster_name = module.eks.cluster_name

  # Create IAM role for service account (IRSA)
  enable_irsa            = true
  irsa_oidc_provider_arn = module.eks.oidc_provider_arn

  # Create the node IAM role that Karpenter-provisioned nodes will use
  create_node_iam_role = true
  node_iam_role_additional_policies = {
    AmazonSSMManagedInstanceCore = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  }

  tags = {
    Name = "${var.project_name}-karpenter"
  }
}

resource "helm_release" "karpenter" {
  name       = "karpenter"
  namespace  = "kube-system"
  repository = "oci://public.ecr.aws/karpenter"
  chart      = "karpenter"
  version    = "1.1.1"

  set {
    name  = "settings.clusterName"
    value = module.eks.cluster_name
  }

  set {
    name  = "settings.clusterEndpoint"
    value = module.eks.cluster_endpoint
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.karpenter.iam_role_arn
  }

  set {
    name  = "replicas"
    value = "2"
  }

  depends_on = [module.eks]
}

# ---------------------------------------------------------------------------
# Karpenter NodePool
# Defines the constraints for nodes that Karpenter can provision.
# ---------------------------------------------------------------------------
resource "kubectl_manifest" "karpenter_node_pool" {
  yaml_body = <<-YAML
    apiVersion: karpenter.sh/v1
    kind: NodePool
    metadata:
      name: default
    spec:
      template:
        metadata:
          labels:
            managed-by: karpenter
            project: devboard
        spec:
          nodeClassRef:
            group: karpenter.k8s.aws
            kind: EC2NodeClass
            name: default
          requirements:
            - key: kubernetes.io/arch
              operator: In
              values: ["amd64"]
            - key: karpenter.sh/capacity-type
              operator: In
              values: ["on-demand"]
            - key: node.kubernetes.io/instance-type
              operator: In
              values: ["t3.medium", "t3.large", "t3a.medium", "t3a.large"]
      limits:
        cpu: "20"
        memory: 40Gi
      disruption:
        consolidationPolicy: WhenEmptyOrUnderutilized
        consolidateAfter: 60s
  YAML

  depends_on = [helm_release.karpenter]
}

# ---------------------------------------------------------------------------
# Karpenter EC2NodeClass
# Defines the EC2-specific configuration for provisioned nodes.
# ---------------------------------------------------------------------------
resource "kubectl_manifest" "karpenter_node_class" {
  yaml_body = <<-YAML
    apiVersion: karpenter.k8s.aws/v1
    kind: EC2NodeClass
    metadata:
      name: default
    spec:
      role: "${module.karpenter.node_iam_role_name}"
      amiSelectorTerms:
        - alias: al2023@latest
      subnetSelectorTerms:
        - tags:
            karpenter.sh/discovery: "${module.eks.cluster_name}"
      securityGroupSelectorTerms:
        - tags:
            karpenter.sh/discovery: "${module.eks.cluster_name}"
      blockDeviceMappings:
        - deviceName: /dev/xvda
          ebs:
            volumeSize: 50Gi
            volumeType: gp3
            encrypted: true
      tags:
        Project: devboard
        Environment: ${var.environment}
        ManagedBy: karpenter
  YAML

  depends_on = [helm_release.karpenter]
}

