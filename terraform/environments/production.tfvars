# =============================================================================
# Production Environment Configuration — DevBoard
#
# Replace ALL placeholder values before running:
#   terraform plan -var-file=environments/production.tfvars
# =============================================================================

# ── General ──────────────────────────────────────────────────────────────────
aws_region   = "us-east-1"        # Change to your preferred region
environment  = "production"
project_name = "devboard"

# ── VPC ──────────────────────────────────────────────────────────────────────
vpc_cidr             = "10.0.0.0/16"
availability_zones   = ["us-east-1a", "us-east-1b"]
private_subnet_cidrs = ["10.0.1.0/24", "10.0.2.0/24"]
public_subnet_cidrs  = ["10.0.101.0/24", "10.0.102.0/24"]

# ── EKS ──────────────────────────────────────────────────────────────────────
eks_cluster_version     = "1.31"
eks_node_instance_types = ["t3.medium"]
eks_node_min_size       = 2
eks_node_max_size       = 6
eks_node_desired_size   = 2

# ── RDS ──────────────────────────────────────────────────────────────────────
db_instance_class    = "db.t4g.micro"   # Upgrade to db.t4g.small+ for production load
db_engine_version    = "17.2"
db_name              = "devboard"
db_username          = "devboard"       # CHANGE for production
db_password          = "CHANGE_ME"      # Use TF_VAR_db_password env var instead
db_allocated_storage = 20               # Increase based on data growth projections

# ── Domain & TLS ─────────────────────────────────────────────────────────────
domain_name         = ""   # e.g., "devboard.example.com"
acm_certificate_arn = ""   # e.g., "arn:aws:acm:us-east-1:123456789012:certificate/abc-123"

