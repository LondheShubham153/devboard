# 09 — Deploy with Helm

ArgoCD renders the chart itself and syncs it into a **separate** namespace
(`devboard-helm`) so it runs alongside the raw version for comparison.

```bash
kubectl apply -f gitops/argocd/devboard-helm.yaml
kubectl -n devboard-helm get pods -w
```

Get this deployment's URL (Helm prefixes resource names with the release name):
```bash
ADDR=$(kubectl -n devboard-helm get gateway -o jsonpath='{.items[0].status.addresses[0].value}')
curl -s -o /dev/null -w "%{http_code}\n" "http://$ADDR/"
curl -s "http://$ADDR/api/projects"
```

## Raw vs Helm

| | Raw (step 5) | Helm (step 7) |
|---|---|---|
| Namespace | `devboard` | `devboard-helm` |
| Source | plain YAML | templated chart |
| Change a value | edit each file | edit `values.yaml` / `--set` |
| Own NLB | yes | yes |

Same app, same GitOps flow — Helm just adds templating and reuse.

> Running both = two NLBs. To keep only one, delete the other app, e.g.
> `kubectl delete -f gitops/argocd/devboard-raw.yaml`.

Next: [10-ai-feature.md](10-ai-feature.md)
