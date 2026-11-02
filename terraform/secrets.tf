resource "aws_secretsmanager_secret" "postgres" {
  name        = var.postgres_secret_name
  description = "DevBoard in-cluster Postgres credentials. Value set out of band; see gitops/06-secrets-with-secrets-manager.md."

  # 0 = delete now. The 30-day default blocks recreating this secret for a month after destroy.
  recovery_window_in_days = 0

  tags = local.tags
}
