# terraform/bootstrap

Creates the S3 bucket that holds the *main* config's Terraform state.

## Why this exists

`../backend.tf` tells Terraform to keep state in S3. But something has to
create that bucket first, and it cannot be the config whose state lives there —
that config can't initialise until the bucket exists.

Every team hits this. The three honest answers:

| Approach | Trade-off |
| --- | --- |
| **A tiny config with local state** (this one) | One small `terraform.tfstate` on your laptop, tracking exactly one bucket. Disposable — if you lose it, `terraform import` takes thirty seconds. |
| `aws s3api create-bucket` in a doc | Less Terraform to read, but the bucket ends up unmanaged by IaC, and nobody remembers to turn on versioning. |
| Pretend the problem away and use local state everywhere | Works until the second person on the team runs `apply`. |

We take the first. The lesson is that the chicken-and-egg is solved by
*accepting* one small local state file, not by pretending it isn't there.

## Run it

```bash
cd terraform/bootstrap
terraform init
terraform apply

# Write the backend config for the main layer
terraform output -raw backend_hcl > ../backend.hcl

cd ..
terraform init -backend-config=backend.hcl
```

The bucket name defaults to `devboard-tfstate-<account-id>-<region>`. S3 bucket
names are globally unique across every AWS account, so it cannot be hardcoded
in a repo people fork — deriving it from your account ID gives everyone a name
that is unique without being a manual step.

## What it turns on, and why

- **Versioning** — your undo button after a bad `destroy`, and what makes
  S3-native locking behave predictably.
- **SSE-S3 (AES256)** — free. SSE-KMS is the production answer but costs
  $1/month per key plus per-request charges, and `terraform plan` makes a lot
  of requests.
- **Public access block**, all four settings.
- **BucketOwnerEnforced** — disables ACLs entirely, so access is decided by IAM
  and the bucket policy alone. One mechanism instead of two.
- **Lifecycle rule** — expires noncurrent versions after 90 days, so five years
  of state history doesn't accumulate on your bill.
- **TLS-only bucket policy** — Terraform always uses HTTPS, so this costs
  nothing; it is the difference between assuming TLS and enforcing it.

## Teardown

Run this **last**, after `terraform destroy` in `../`:

```bash
cd terraform/bootstrap
terraform destroy
```

`force_destroy = true` lets it delete a bucket that still contains state files.
That is right for a teaching account and wrong everywhere else.
