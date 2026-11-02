# Pod Identity, not IRSA: no SA annotation, and associations may name namespaces that don't exist.
module "ebs_csi_pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.0"

  name                      = "${var.cluster_name}-ebs-csi"
  attach_aws_ebs_csi_policy = true

  associations = {
    this = {
      cluster_name    = module.eks.cluster_name
      namespace       = "kube-system"
      service_account = "ebs-csi-controller-sa"
    }
  }

  tags = local.tags
}

module "external_secrets_pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.0"

  name                           = "${var.cluster_name}-external-secrets"
  attach_external_secrets_policy = true

  external_secrets_create_permission = false

  external_secrets_ssm_parameter_arns = []

  external_secrets_secrets_manager_arns = [
    "arn:aws:secretsmanager:${var.region}:${local.account_id}:secret:devboard/*",
  ]

  associations = {
    this = {
      cluster_name = module.eks.cluster_name
      namespace    = "external-secrets"
      # Must match the ServiceAccount the ESO chart creates.
      service_account = "external-secrets"
    }
  }

  tags = local.tags
}
