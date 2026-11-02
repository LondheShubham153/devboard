# 01 — Prerequisites

## Tools

| Tool | Purpose |
|------|---------|
| `awscli` | talk to AWS |
| `terraform` | build the cluster (**≥ 1.11** — see below) |
| `kubectl` | talk to the cluster |
| `helm` | render the chart, install Envoy Gateway |
| `jq` | assemble the Secrets Manager payload in chapter 06 |

`eksctl` is no longer needed — chapter 03 replaces it with Terraform.

> **Terraform must be 1.11 or newer.** Two things in this project need it:
> S3-native state locking (`use_lockfile`, chapter 02) and write-only
> arguments (`secret_string_wo`, chapter 06). Check with `terraform version`.

macOS:
```bash
brew install awscli terraform kubernetes-cli helm jq
```

Linux (amd64):
```bash
# terraform
curl -sLO "https://releases.hashicorp.com/terraform/1.15.8/terraform_1.15.8_linux_amd64.zip"
unzip -q terraform_*.zip && sudo mv terraform /usr/local/bin

# awscli v2
curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install

# kubectl
curl -sLO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl

# helm
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# jq
sudo apt-get install -y jq
```

> On ARM (Graviton EC2, ARM laptops), swap `amd64` → `arm64` in the terraform
> and kubectl URLs and use `awscli-exe-linux-aarch64.zip`. The Helm script
> auto-detects the architecture.

## Configure AWS

You need an IAM user or role that can create EKS, VPCs, IAM roles, S3 buckets
and Secrets Manager secrets. `AdministratorAccess` is simplest for learning.

```bash
aws configure                 # region: us-west-2
aws sts get-caller-identity   # must succeed
```

## Changing the region — the five-place checklist

All docs use **us-west-2**. eksctl hid this in two places; Terraform plus a
secret store spreads it across five. If you change it, change all of them:

| # | Where | What |
| --- | --- | --- |
| 1 | `aws configure` | your CLI default |
| 2 | `terraform/terraform.tfvars` | `region` — the cluster and every AWS resource |
| 3 | `terraform/bootstrap` | `terraform apply -var=region=<your-region>` |
| 4 | `gitops/external-secrets/cluster-secret-store.yaml` | `spec.provider.aws.region` — ESO looks the secret up here |
| 5 | `terraform/backend.hcl` | `region` of the state bucket |

Number 4 is the one people miss. A mismatch there produces
`ResourceNotFoundException` on a secret you can plainly see in the console —
because ESO is looking in a different region.

## Fork this repo

ArgoCD deploys from a Git URL, and by default that URL is the upstream repo,
which you cannot push to. Fork it, then update `repoURL` in every file under
`gitops/argocd/`. Each one carries a comment saying so.

If you skip this, everything will appear to work until your first CI push
mysteriously fails to deploy.

## Cost

This is not a free-tier project. Budget roughly **$11/day** while it runs —
see the table in [README.md](README.md), and do
[15-cleanup.md](15-cleanup.md) when you are done.

Next: [02-terraform-bootstrap.md](02-terraform-bootstrap.md)
