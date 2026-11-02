terraform {
  # Partial config on purpose: bucket names are globally unique, so the rest
  # comes from backend.hcl at init time. See gitops/02-terraform-bootstrap.md.
  backend "s3" {}
}
