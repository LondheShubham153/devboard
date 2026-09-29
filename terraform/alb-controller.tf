# ---------------------------------------------------------------------------
# AWS Load Balancer Controller — DevBoard Production
#
# Manages ALB/NLB resources in response to Kubernetes Ingress and Service
# objects. Uses IRSA for IAM authentication.
#
# The IRSA role is defined in iam.tf (module.load_balancer_controller_irsa_role)
# This file only contains the Helm release.
#
# Architecture:
#   K8s Ingress → ALB Controller → AWS ALB → Target Groups → Pods (IP mode)
# ---------------------------------------------------------------------------

resource "helm_release" "alb_controller" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = "1.10.0"

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }

  set {
    name  = "region"
    value = var.aws_region
  }

  set {
    name  = "vpcId"
    value = module.vpc.vpc_id
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.load_balancer_controller_irsa_role.iam_role_arn
  }

  set {
    name  = "replicaCount"
    value = "2"
  }

  depends_on = [module.eks]
}

