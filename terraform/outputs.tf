output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes version running on the control plane"
  value       = module.eks.cluster_version
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN, for anything still using IRSA rather than Pod Identity"
  value       = module.eks.oidc_provider_arn
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "Private subnet IDs — worker nodes live here"
  value       = module.vpc.private_subnets
}

output "public_subnets" {
  description = "Public subnet IDs — the Envoy Gateway NLB lands here"
  value       = module.vpc.public_subnets
}

output "postgres_secret_name" {
  description = "Secrets Manager secret name the ExternalSecret must reference"
  value       = aws_secretsmanager_secret.postgres.name
}

output "postgres_secret_arn" {
  description = "Secrets Manager secret ARN. Note this is the CONTAINER — the password is not in Terraform state; see secrets.tf."
  value       = aws_secretsmanager_secret.postgres.arn
}

output "external_secrets_role_arn" {
  description = "IAM role External Secrets Operator assumes via its Pod Identity association"
  value       = module.external_secrets_pod_identity.iam_role_arn
}

output "configure_kubectl" {
  description = "Point kubectl at the new cluster"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

output "argocd_initial_password" {
  description = "Read ArgoCD's generated admin password"
  value       = "kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
}

output "set_postgres_secret" {
  description = "Set the Postgres credential in Secrets Manager. Hex, not base64 — the value goes into a postgres:// DSN and base64's / and + would need URL-encoding."

  value = <<-EOT
    PGPASS=$(openssl rand -hex 32)
    aws secretsmanager put-secret-value \
      --secret-id ${aws_secretsmanager_secret.postgres.name} \
      --region ${var.region} \
      --secret-string "$(jq -nc --arg p "$PGPASS" \
          '{username:"devboard", password:$p, dbname:"devboard"}')"
  EOT
}
