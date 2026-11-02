variable "region" {
  description = "AWS region for the cluster. Changing this is a five-place edit — see gitops/01-prerequisites.md."
  type        = string
  default     = "us-west-2"
}

variable "cluster_name" {
  description = "EKS cluster name. Also used as the VPC name and as a prefix for IAM roles."
  type        = string
  default     = "devboard"
}

variable "kubernetes_version" {
  description = "EKS control plane version. Pinned rather than floating so every learner gets the same cluster."
  type        = string
  default     = "1.34"
}

variable "node_instance_type" {
  description = "Worker node instance type. t3.large (2 vCPU / 8 GiB) is the floor once Ollama and the observability stack are running; t3.medium cannot fit them."
  type        = string
  default     = "t3.large"
}

variable "node_desired_size" {
  description = "Nodes to run. 3 fits both DevBoard stacks plus Ollama plus observability. Drop to 2 to save ~$61/month, but then run only one DevBoard stack."
  type        = number
  default     = 3
}

variable "node_min_size" {
  description = "Minimum nodes"
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum nodes"
  type        = number
  default     = 4
}

variable "node_disk_size" {
  description = "Root volume per node, GiB. 30 rather than 20: Ollama's ~1.3 GB model plus three app images plus the ArgoCD/ESO/Envoy control planes get close to disk-pressure eviction on 20."
  type        = number
  default     = 30
}

variable "postgres_secret_name" {
  description = "Secrets Manager secret holding the Postgres credentials. The ExternalSecret in k8s/ and the Helm chart must reference the same name."
  type        = string
  default     = "devboard/postgres"
}

variable "intern_iam_principal_arn" {
  description = <<-EOT
    Optional IAM role/user ARN to map into the cluster as the "devboard-interns"
    group, which k8s/intern-role-binding.yml grants read-mostly access. Leave
    null to skip — the RBAC chapter still works without a second IAM identity,
    you just can't prove it end to end.
  EOT
  type        = string
  default     = null
}

variable "enable_argocd" {
  description = "Install ArgoCD via Helm from Terraform. Set false if you would rather install it by hand (the flow in gitops/05-argocd.md)."
  type        = bool
  default     = true
}

variable "argocd_chart_version" {
  description = "argo-cd Helm chart version. Pinned so a cluster built today matches one built next month."
  type        = string
  default     = "10.3.0"
}
