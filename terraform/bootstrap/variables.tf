variable "region" {
  description = "AWS region for the state bucket. Keep this the same as the cluster's region (var.region in ../variables.tf)."
  type        = string
  default     = "us-west-2"
}

variable "bucket_name" {
  description = "Override the state bucket name. Leave null to derive devboard-tfstate-<account-id>-<region>, which is unique per account without being hardcoded in the repo."
  type        = string
  default     = null
}

variable "force_destroy" {
  description = "Allow `terraform destroy` to delete the bucket even when it still contains state files. True is right for a teaching account; never set it in production."
  type        = bool
  default     = true
}
