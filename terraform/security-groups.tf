# ---------------------------------------------------------------------------
# Security Groups — DevBoard Production
#
# The EKS module manages cluster and node security groups automatically.
# This file creates additional security groups for RDS and any custom rules.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# RDS Security Group
# Only allows PostgreSQL traffic (port 5432) from EKS worker nodes.
# ---------------------------------------------------------------------------
resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-rds-"
  description = "Security group for DevBoard RDS PostgreSQL — allows traffic only from EKS nodes"
  vpc_id      = module.vpc.vpc_id

  tags = {
    Name = "${var.project_name}-rds-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "rds_ingress_from_eks" {
  description              = "Allow PostgreSQL from EKS worker nodes"
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = module.eks.node_security_group_id
}

resource "aws_security_group_rule" "rds_egress" {
  description       = "Allow outbound traffic only within VPC"
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.rds.id
  cidr_blocks       = [var.vpc_cidr]
}

