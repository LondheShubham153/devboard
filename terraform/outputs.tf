# ---------------------------------------------------------------------------
# Terraform Outputs — DevBoard Production
# ---------------------------------------------------------------------------

# ── VPC ──────────────────────────────────────────────────────────────────────
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (worker nodes, RDS)"
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet IDs (ALB)"
  value       = module.vpc.public_subnets
}

# ── EKS ──────────────────────────────────────────────────────────────────────
output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_oidc_issuer_url" {
  description = "OIDC issuer URL for IRSA"
  value       = module.eks.cluster_oidc_issuer_url
}

output "eks_node_security_group_id" {
  description = "Security group ID for EKS worker nodes"
  value       = module.eks.node_security_group_id
}

# ── ECR ──────────────────────────────────────────────────────────────────────
output "ecr_backend_repository_url" {
  description = "ECR repository URL for the backend image"
  value       = aws_ecr_repository.repos["${var.project_name}-backend"].repository_url
}

output "ecr_frontend_repository_url" {
  description = "ECR repository URL for the frontend image"
  value       = aws_ecr_repository.repos["${var.project_name}-frontend"].repository_url
}

# ── RDS ──────────────────────────────────────────────────────────────────────
output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = module.db.db_instance_endpoint
}

output "rds_hostname" {
  description = "RDS PostgreSQL hostname"
  value       = module.db.db_instance_address
}

output "rds_port" {
  description = "RDS PostgreSQL port"
  value       = module.db.db_instance_port
}

output "rds_database_name" {
  description = "RDS database name"
  value       = module.db.db_instance_name
}

# ── Connection String (for K8s Secret) ───────────────────────────────────────
output "postgres_url" {
  description = "PostgreSQL connection string for the backend (use in K8s Secret)"
  value       = "postgres://${var.db_username}:${var.db_password}@${module.db.db_instance_address}:${module.db.db_instance_port}/${var.db_name}?sslmode=require"
  sensitive   = true
}

# ── Convenience ──────────────────────────────────────────────────────────────
output "configure_kubectl" {
  description = "Command to configure kubectl for this cluster"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}

output "ecr_login" {
  description = "Command to authenticate Docker to ECR"
  value       = "aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

# Data source for account ID
data "aws_caller_identity" "current" {}
