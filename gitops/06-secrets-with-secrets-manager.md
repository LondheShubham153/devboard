# 06 — Secrets, properly

Here is what used to be committed to this repository, in `k8s/secrets.yml`:

```yaml
data:
  POSTGRES_PASSWORD:  ZGV2Ym9hcmQ=
  POSTGRES_DB:  ZGV2Ym9hcmQ= # this decodes to devboard
```

Base64 is an **encoding**, not encryption. That was a plaintext password in a
public Git repository, with a comment explaining how to read it. The Helm chart
was no better: `values.yaml` carried `password: devboard` in the clear.

This chapter moves the credential to AWS Secrets Manager, where Git holds only
a *pointer*.

## Why External Secrets Operator

There are several ways to get a secret from AWS into Kubernetes. We use
[External Secrets Operator](https://external-secrets.io) for one decisive
reason: **it materialises a real Kubernetes Secret**, with the same name the
manifests already used. Look at the diff for this chapter — not one Deployment
or StatefulSet changed its `secretKeyRef`.

| Option | What the app manifests need | Verdict |
| --- | --- | --- |
| **External Secrets Operator** | Nothing | ✅ chosen |
| Secrets Store CSI Driver | A `csi` volume + mount on every pod. Worse: its synced Secret only exists *while* a pod mounts it, which makes Postgres and the backend mutually ordering-dependent on first boot. | ✗ |
| Sealed Secrets / SOPS | Encrypts secrets *in Git*, which contradicts "AWS is the source of truth". A legitimate philosophy — just a different one. | ✗ here |

## The IAM, and why there are no keys anywhere

Terraform already created the role and its association in
[`pod-identity.tf`](../terraform/pod-identity.tf). Two things about it:

**It is scoped.** The policy allows `GetSecretValue` on
`arn:aws:secretsmanager:...:secret:devboard/*` and nothing else. An operator
with `secretsmanager:*` on `"*"` can read every secret in the account; if it is
ever compromised, so is production.

**It uses EKS Pod Identity, not IRSA.** The difference is worth knowing:

- **IRSA** annotates the ServiceAccount with a role ARN, and the IAM trust
  policy references *this cluster's* OIDC provider URL. Destroy and rebuild the
  cluster and every role's trust policy is stale.
- **Pod Identity** creates an *association* object mapping a namespace +
  ServiceAccount to a role. The trust policy just names the static
  `pods.eks.amazonaws.com` principal, so it survives cluster rebuilds, and the
  ServiceAccount needs no annotation at all.

Note the association in Terraform references a namespace that does not exist
yet. AWS doesn't validate it — which is exactly what lets Terraform own the IAM
while ArgoCD owns the workload.

## Install the operator

```bash
kubectl apply -f gitops/argocd/platform.yaml
```

One file. That is the **app-of-apps** pattern: an ArgoCD Application whose job
is to create *other* Applications. It brings up External Secrets, the whole
observability stack, and Ollama, in sync-wave order. From here on, adding
platform infrastructure means committing a file to
`gitops/argocd/platform/` — never running `kubectl` again.

```bash
kubectl -n argocd get applications
kubectl -n external-secrets rollout status deploy/external-secrets
```

Two details in [`external-secrets.yaml`](argocd/platform/external-secrets.yaml)
that will each cost you an afternoon if you get them wrong:

- The Application's source is a **Helm chart repository**, not a path in this
  Git repo. ArgoCD reconciles upstream charts the same way it reconciles your
  manifests — the desired version is still declared in Git, so it is still
  GitOps.
- `ServerSideApply=true`. ESO's CRDs are larger than the 262144-byte limit on
  the annotation that client-side apply writes, and without this you get
  `metadata.annotations: Too long` and a failed sync.

## Set the actual secret

Terraform created the secret's **name**; it did not create its **value**. That
is deliberate, and it is the most important idea in this chapter:

> `terraform.tfstate` is a plaintext JSON document. Every argument you pass to
> every resource is written into it verbatim. `sensitive = true` hides a value
> from CLI output — it does nothing to the file.

So the container is infrastructure (code) and the value is a credential (set
out of band, once):

```bash
PGPASS=$(openssl rand -hex 32)

aws secretsmanager put-secret-value \
  --secret-id devboard/postgres \
  --region us-west-2 \
  --secret-string "$(jq -nc --arg p "$PGPASS" \
      '{username:"devboard", password:$p, dbname:"devboard"}')"
```

**Why hex and not base64?** The password gets interpolated into a
`postgres://user:PASSWORD@host/db` connection string. Base64's `/` and `+` are
not URL-safe and would need escaping. Hex always is. This is a real bug people
hit.

**Why is `host` not in the secret?** Because it isn't a credential — it's
topology, and it differs between the `devboard` and `devboard-helm` namespaces.
The `ExternalSecret` template assembles the DSN and supplies the host itself.

### Now look at the receipt

```bash
terraform state pull | jq '.resources[] | select(.type=="aws_secretsmanager_secret") | .instances[0].attributes | {arn, name, tags}'
```

ARN, name, tags. **No password.** Now imagine you had used
`aws_secretsmanager_secret_version` with `secret_string` — it would be sitting
in that output, and in the S3 bucket, forever, in every historical version.

[`secrets.tf`](../terraform/secrets.tf) ships the automated variant commented
out, using a Terraform 1.11 **write-only argument** (`secret_string_wo`) that
is sent to the API and never persisted. The lesson is not "never automate
secrets" — it is "never put secrets in state".

## Watch it sync

```bash
kubectl -n devboard get externalsecret devboard-secrets
kubectl -n devboard get secret devboard-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d; echo
```

That should print the password you generated. It came from AWS; it is nowhere
in Git.

> **First boot looks broken, briefly.** If the app syncs before ESO produces
> the Secret, pods sit in `CreateContainerConfigError` with
> `secret "devboard-secrets" not found`. This is self-healing — kubelet
> retries, ESO catches up, pods start. That is why this chapter comes before
> chapter 07.

## Rotation — the honest version

The demo everyone gives is "change it in AWS, watch the Secret change". That
demo teaches something false. Here is the whole thing.

```bash
# 1. What does the cluster think the password is right now?
kubectl -n devboard get secret devboard-secrets \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d; echo

# 2. Rotate it in AWS — the source of truth.
NEW=$(openssl rand -hex 32)
aws secretsmanager put-secret-value --secret-id devboard/postgres \
  --secret-string "$(jq -nc --arg p "$NEW" '{username:"devboard",password:$p,dbname:"devboard"}')"

# 3. Don't wait an hour for refreshInterval — kick ESO.
kubectl -n devboard annotate externalsecret devboard-secrets \
  force-sync="$(date +%s)" --overwrite

# 4. The Kubernetes Secret now matches AWS.
kubectl -n devboard get secret devboard-secrets \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d; echo

# 5. ...and the app still works. Why?
curl "http://$ADDR/api/projects"
```

Two reasons it still works, and both are the point:

- **Env vars are frozen at container start.** Injecting a Secret via
  `env.valueFrom.secretKeyRef` copies the value *once*. Only Secrets mounted as
  *volumes* update in place. Rotating a secret consumed as an env var is a
  **no-op until the pod restarts.**
- **Postgres reads `POSTGRES_PASSWORD` only at `initdb`.** The database on that
  EBS volume still has the old password. Had you only restarted the backend,
  you would have broken it.

So finish the dance:

```bash
# 6. Rotate the credential in the system that actually holds it.
kubectl -n devboard exec -it postgres-statefulset-0 -- \
  psql -U devboard -d devboard -c "ALTER USER devboard WITH PASSWORD '$NEW';"

# 7. Now restart the consumer so it picks up the new env var.
kubectl -n devboard rollout restart deploy/devboard-backend-deployment

# 8. Verify.
curl "http://$ADDR/api/projects"
```

Between steps 6 and 7 the app was **broken**. That gap is precisely why real
rotation uses Secrets Manager's `AWSCURRENT`/`AWSPREVIOUS` version stages: you
stage the new credential, make both valid for a window, roll consumers, then
retire the old one. It is also why [Reloader](https://github.com/stakater/Reloader)
exists — it watches Secret checksums and does step 7 for you.

And it is the strongest argument for managed RDS, where this whole chapter
collapses into one `aws secretsmanager rotate-secret` call.

> ⚠️ **Cost trap.** If you set `refreshInterval: 10s` to make a demo snappy and
> forget to change it back, two ExternalSecrets at 6 calls/minute is ~520,000
> `GetSecretValue` calls a month. Secrets Manager charges $0.40 per secret plus
> $0.05 per 10,000 calls. Use the `force-sync` annotation instead.

---

Next: [07-deploy-without-helm.md](07-deploy-without-helm.md)
