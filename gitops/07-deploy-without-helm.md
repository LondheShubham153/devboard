# 07 — Deploy without Helm

ArgoCD applies the raw manifests in [`../k8s/`](../k8s/) as-is, into the
`devboard` namespace, and self-heals any drift.

```bash
kubectl apply -f gitops/argocd/devboard-raw.yaml
```

Watch it sync (UI, or):
```bash
kubectl -n devboard get pods -w
kubectl -n devboard get pvc            # Bound on gp2
```

You'll see postgres, backend, frontend — plus an **ai-service** pod and some
RBAC examples (a ServiceAccount + Role + RoleBinding). The ai-service runs now
but its `/api/ai` endpoints only work once Ollama is set up in
[10-ai-feature.md](10-ai-feature.md).

## Get the URL

```bash
ADDR=$(kubectl -n devboard get gateway devboard-gateway -o jsonpath='{.status.addresses[0].value}')
echo "$ADDR"                                    # NLB hostname (ready in ~2-3 min)
curl -s -o /dev/null -w "%{http_code}\n" "http://$ADDR/"   # 200
curl -s "http://$ADDR/api/projects"             # JSON, 2 projects
```
Open `http://$ADDR/` in a browser.

## GitOps in action (optional)

```bash
kubectl -n devboard delete pod -l app=devboard-frontend   # comes back
# scale the frontend by hand → ArgoCD self-heals it back to Git
```

Next: [08-package-with-helm.md](08-package-with-helm.md)
