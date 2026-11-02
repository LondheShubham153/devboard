# 08 — Package with Helm

Raw manifests hard-code every value across many files. Helm packages the same app
as a chart with one [`values.yaml`](../helm/devboard/values.yaml) you tune per
environment. Chart: [`../helm/devboard/`](../helm/devboard/).

```
helm/devboard/
  Chart.yaml
  values.yaml            images, replicas, resources, gateway, ai, observability
  files/                 Postgres init SQL
  templates/
    _helpers.tpl
    configmap.yaml  externalsecret.yaml
    postgres-*.yaml  backend-*.yaml  frontend-*.yaml  frontend-hpa.yaml
    ai-service-deployment.yaml  ai-service-service.yaml
    gateway.yaml  httproute.yaml  NOTES.txt
```

Three things worth knowing:
- The backend reads one `POSTGRES_URL`, and `externalsecret.yaml` assembles it
  from the JSON secret in AWS Secrets Manager. There used to be a `secret.yaml`
  here that built it from cleartext values in `values.yaml` — chapter 06
  explains why it's gone.
- `backend.serviceName` must stay `backend` — the frontend image proxies to
  `http://backend:8080`.
- The `observability.enabled` and `externalSecrets.enabled` toggles have no
  equivalent in `k8s/`. That is the most concrete answer to "why bother with
  Helm?" in this whole project: the same manifests, conditionally.

Render it locally (what ArgoCD does under the hood):
```bash
helm lint helm/devboard
helm template devboard helm/devboard | less
helm template devboard helm/devboard --set frontend.replicas=3 | grep replicas
```

Next: [09-deploy-with-helm.md](09-deploy-with-helm.md)
