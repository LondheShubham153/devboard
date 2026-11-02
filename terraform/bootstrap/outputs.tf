output "bucket_name" {
  description = "Name of the S3 bucket holding the main config's state"
  value       = aws_s3_bucket.state.id
}

output "backend_hcl" {
  description = "Ready-to-use backend config. Write it straight to ../backend.hcl: terraform output -raw backend_hcl > ../backend.hcl"

  value = <<-EOT
    bucket = "${aws_s3_bucket.state.id}"
    key    = "devboard/mega-project/terraform.tfstate"
    region = "${var.region}"

    encrypt = true

    # S3-native state locking, GA since Terraform 1.11. Replaced the DynamoDB lock table.
    use_lockfile = true
  EOT
}
