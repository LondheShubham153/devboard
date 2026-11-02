module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = var.cluster_name
  cidr = local.vpc_cidr
  azs  = local.azs

  public_subnets  = local.public_subnets
  private_subnets = local.private_subnets
  intra_subnets   = local.intra_subnets

  enable_nat_gateway = true

  # One NAT (~$33/mo), not three. Lose that AZ and all egress dies. Do not copy this to production.
  single_nat_gateway = true

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Load balancer controllers scan for these tags; without them a Gateway silently gets no address.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }

  tags = local.tags
}
