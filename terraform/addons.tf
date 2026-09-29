# ---------------------------------------------------------------------------
# EKS Addons — DevBoard Production
#
# Core EKS addons managed via the EKS module + Metrics Server via Helm.
# These are deployed automatically with the cluster.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Core EKS Add-ons (managed through the EKS module in eks.tf)
#
# The following add-ons are configured in the module.eks cluster_addons block:
#   - vpc-cni          — VPC networking for pods
#   - coredns          — DNS resolution inside the cluster
#   - kube-proxy       — Kubernetes network proxy
#   - aws-ebs-csi-driver — EBS volume provisioning (required for PVCs)
#
# To add or update add-ons, modify the cluster_addons block in eks.tf.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Metrics Server
# Required for HPA to function. Provides CPU/memory metrics to the API server.
# EKS does not include Metrics Server by default — deploy via Helm.
# ---------------------------------------------------------------------------
resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  namespace  = "kube-system"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  version    = "3.12.2"

  set {
    name  = "args[0]"
    value = "--kubelet-preferred-address-types=InternalIP"
  }

  set {
    name  = "replicas"
    value = "2"
  }

  set {
    name  = "podDisruptionBudget.enabled"
    value = "true"
  }

  set {
    name  = "podDisruptionBudget.minAvailable"
    value = "1"
  }

  depends_on = [module.eks]
}

