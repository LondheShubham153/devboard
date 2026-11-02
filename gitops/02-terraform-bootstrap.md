# 02 — Terraform state, and the chicken-and-egg

Before Terraform can build anything, it needs somewhere to keep its **state** —
the JSON file mapping "the resources I declared" to "the resources that exist
in AWS". Lose it and Terraform forgets it ever built your cluster.

## Why not just leave it on your laptop

Local state works right up until any of these happen:

- A second person runs `apply` and Terraform has no idea what you already built.
- Two `apply`s run at once and race, corrupting the file.
- Your laptop dies.

The fix is remote state in S3 with locking. Which raises the obvious problem:

> The config that stores its state in a bucket cannot create that bucket.
> It can't initialise until the bucket already exists.

Every team hits this. The honest answer is a **tiny separate config with local
state**, run once, that creates exactly one bucket. Its state file is
disposable — if you lose it, `terraform import` takes thirty seconds. The
lesson is that you solve the chicken-and-egg by *accepting* one small local
state file, not by pretending it isn't there.

## Run the bootstrap

```bash
cd terraform/bootstrap
terraform init
terraform apply
```

Read [`terraform/bootstrap/main.tf`](../terraform/bootstrap/main.tf) while it
runs. It is one bucket plus five things that are always worth turning on:

| Setting | Why |
| --- | --- |
| **Versioning** | Your undo button after a bad `destroy`. Also what makes S3-native locking behave predictably. |
| **SSE-S3 (AES256)** | Free. SSE-KMS is the production answer but costs $1/month per key plus per-request charges — and `terraform plan` makes a lot of requests. |
| **Public access block** | All four settings. A public state file hands over your whole infrastructure. |
| **BucketOwnerEnforced** | Disables ACLs entirely, so access is decided by IAM and the bucket policy alone. One mechanism instead of two. |
| **Lifecycle rule** | Expires noncurrent versions after 90 days, so state history doesn't grow forever on your bill. |
| **TLS-only bucket policy** | Terraform always uses HTTPS anyway — this is the difference between *assuming* TLS and *enforcing* it. |

The bucket name defaults to `devboard-tfstate-<account-id>-<region>`. S3 names
are globally unique across every AWS account on earth, so it cannot be
hardcoded in a repo people fork; deriving it from your account ID gives
everyone a unique name without a manual step.

## Point the main config at it

```bash
terraform output -raw backend_hcl > ../backend.hcl
cat ../backend.hcl
```

```hcl
bucket = "devboard-tfstate-123456789012-us-west-2"
key    = "devboard/mega-project/terraform.tfstate"
region = "us-west-2"

encrypt      = true
use_lockfile = true
```

`backend.hcl` is **gitignored** — it names your personal bucket.
[`terraform/backend.tf`](../terraform/backend.tf) is deliberately empty:

```hcl
terraform {
  backend "s3" {}
}
```

That is a **partial backend configuration**. Terraform accepts the rest at init
time, which is how a shared repo supports per-person state locations.

### `use_lockfile` — what replaced the DynamoDB table

If you have followed a Terraform tutorial written before 2025, it told you to
create a DynamoDB table for state locking. You no longer need one.

Terraform 1.11 made **S3-native locking** generally available: it writes a
`<key>.tflock` object next to the state and uses S3 conditional writes to make
the check-and-set atomic. One less resource, one less bill, one less thing to
forget to create.

## Initialise

```bash
cd ..                                    # into terraform/
terraform init -backend-config=backend.hcl
```

You should see `Successfully configured the backend "s3"`.

## Verify

```bash
aws s3 ls | grep devboard-tfstate
aws s3api get-bucket-versioning --bucket "$(terraform -chdir=bootstrap output -raw bucket_name)"
```

The second command must print `"Status": "Enabled"`. If it doesn't, stop and
fix it — versioning is what makes everything after this recoverable.

---

Next: [03-provision-eks.md](03-provision-eks.md) — build the cluster.
