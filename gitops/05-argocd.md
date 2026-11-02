# 05 — ArgoCD

ArgoCD is the GitOps engine: point it at a repo + path and it keeps the cluster
matching Git.

**It is already running.** `terraform/argocd.tf` installs it — the one workload
Terraform owns, because something has to deploy the thing that deploys
everything else. Chapter 03 put it there.

```bash
helm list -n argocd        # argocd, chart argo-cd-10.3.0, deployed
kubectl -n argocd get pods
```

> ⚠️ Do **not** run `helm install argocd` on top of it. Helm refuses with
> *"cannot re-use a name that is still in use."*

Terraform passes the same `server.insecure: true` that
`gitops/argocd/install-values.yaml` sets, so the port-forward below works over
plain HTTP. Add TLS for real use.

**Prefer to install it by hand?** Set `enable_argocd = false` in
`terraform/terraform.tfvars` *before* `terraform apply` in chapter 03, then:

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm install argocd argo/argo-cd -n argocd --create-namespace \
  -f gitops/argocd/install-values.yaml
kubectl -n argocd rollout status deploy/argocd-server
```

## Log in

```bash
# initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d ; echo

# UI
kubectl -n argocd port-forward svc/argocd-server 8080:80
```
Open http://localhost:8080 → user `admin` + that password.

We register apps by `kubectl apply`-ing `Application` manifests (that's GitOps),
not by clicking in the UI. That's the next step.

Next: [06-secrets-with-secrets-manager.md](06-secrets-with-secrets-manager.md)
