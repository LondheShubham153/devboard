# 15 — Clean up

**Order matters, and Terraform will not save you.**

The AWS **NLBs** were created by Envoy from your Gateways, and the **EBS
volumes** were created by the CSI driver from your PVCs. Terraform did not
create either, so `terraform destroy` does not know they exist — it will happily
delete the cluster and leave you paying for orphaned load balancers and disks
that now have no controller to clean them up.

So: tear down inside the cluster first, then the cluster, then the state bucket.

## 1. Stop ArgoCD managing anything

```bash
kubectl delete -f gitops/argocd/platform.yaml
kubectl delete -f gitops/argocd/devboard-raw.yaml \
               -f gitops/argocd/devboard-helm.yaml
```

Deleting the app-of-apps removes its children too. Wait for them to go:

```bash
kubectl -n argocd get applications      # should be empty
```

## 2. Delete the namespaces

This is the step that actually frees the AWS resources — removing the Gateways
makes Envoy delete the NLBs, and removing the PVCs makes the CSI driver delete
the EBS volumes.

```bash
kubectl delete namespace devboard devboard-helm ollama observability \
                         external-secrets cert-manager --ignore-not-found
```

`observability` matters here: Prometheus, Tempo and Loki each hold a 10 GiB
PVC. That is 30 GiB of EBS that will keep billing if you skip this.

## 3. Confirm, before deleting the cluster

```bash
kubectl -n envoy-gateway-system get svc   # no LoadBalancer services left
kubectl get gateway -A                     # empty
kubectl get pvc -A                         # empty
```

Do not continue until all three are clean. Once the cluster is gone, nothing is
left to release these.

## 4. Remove the remaining platform pieces

```bash
helm uninstall eg -n envoy-gateway-system
```

ArgoCD itself is managed by Terraform now, so leave it — step 5 removes it.

## 5. Destroy the infrastructure

```bash
cd terraform
terraform destroy      # ~15 min
```

Two things in the config exist specifically to make this work:

- `aws_secretsmanager_secret.recovery_window_in_days = 0` — the default is a
  30-day recovery window, which means after a destroy you cannot recreate a
  secret with the same name **for a month**. You would be blocked from
  rebuilding until then.
- `kubernetes_storage_class_v1.gp3` is deleted before the cluster, which is
  correct. If your credentials have expired and this hangs, escape with
  `terraform state rm kubernetes_storage_class_v1.gp3`.

## 6. Destroy the state bucket, last

```bash
cd bootstrap
terraform destroy
```

`force_destroy = true` lets it delete a bucket that still holds state files.

## Verify nothing is still billing

```bash
aws eks list-clusters --region us-west-2
aws ec2 describe-volumes --region us-west-2 \
  --filters Name=status,Values=available --query 'Volumes[].VolumeId'
aws elbv2 describe-load-balancers --region us-west-2 --query 'LoadBalancers[].LoadBalancerName'
aws secretsmanager list-secrets --region us-west-2 --query 'SecretList[].Name'
```

All four should be empty of `devboard` resources. The `available` volume filter
is the important one — that means "an EBS volume attached to nothing", which is
exactly what an orphan looks like.

## Prove it worked

Run `terraform apply` and `terraform destroy` **a second time**. If the second
apply succeeds, `recovery_window_in_days = 0` did its job. If it fails with
*"a secret with this name is already scheduled for deletion"*, it didn't — and
you now know why that one line is in the config.
