# 11 — Observability: deploy the stack

## Start with the incident

Earlier in this project's life, the AI assistant stopped working. Here is what
the operator saw:

```
$ kubectl get pods -n devboard
NAME                                          READY   STATUS    RESTARTS   AGE
devboard-ai-service-deployment-7d4f8b-x2n9p   1/1     Running   0          4h
devboard-backend-deployment-6c9d7f-k4m2q      1/1     Running   0          4h
devboard-frontend-deployment-58b6c4-p8w3r     1/1     Running   0          4h
postgres-statefulset-0                        1/1     Running   0          4h
```

Everything Running. Everything Ready. Health checks green. The service's own
metric reported that **100% of requests returned 200**. And the feature was
completely broken.

Here is the actual failure chain:

```
gitops/ollama/pvc.yaml named no storageClassName
  → EKS marks no StorageClass default → PVC ollama-models stays Pending
    → the Ollama pod never schedules, so its Service has no endpoints
      → ai-service's httpx POST to Ollama gets a connection error
        → _sse() catches it and emits data: {"error": ...}
          → but ai_requests_total already recorded status="200"
            → and /health is a static JSON response that never touches Ollama
              → so the pod stays Ready and the Gateway keeps sending traffic
```

Every single link in that chain hid the one below it. No log line said "the
model server is down". No metric moved. Nothing was wrong *locally*, because
locally there was no Ollama and no EKS.

That is what this chapter is for. Not dashboards for their own sake — the
ability to answer a question you already have.

## Three signals

| | Answers | Shape |
| --- | --- | --- |
| **Logs** | *what* happened | discrete events, high detail, hard to aggregate |
| **Metrics** | *how much*, over time | cheap numbers, aggregate beautifully, no per-request detail |
| **Traces** | *where* the time went | one request's full causal path across services |

The interesting part is not any one of them. It is being able to move between
them: see a latency spike (metric), jump to a slow request (trace), read that
request's logs (logs), all in three clicks. Chapter 13 does exactly that.

## What we're deploying

```
                          ┌──────────── namespace: observability ─────────────┐
Envoy Gateway ──OTLP──────┤                                                   │
   ├─▶ ai-service ──OTLP──┤   ┌─────────────────────────────────┐             │
   │      └──▶ backend ───┤   │  otel-collector-gateway         │             │
   │            └─▶ postgres  │  receivers → processors → exporters           │
   └─▶ frontend           │   └──┬──────────┬───────────┬───────┘             │
                          │      │          │           │                     │
every node:               │   Tempo      Loki       Prometheus                │
otel-collector-agent ─────┤  (traces)   (logs)      (metrics)                 │
(reads /var/log/pods)     │      └──────────┴───────────┘                      │
                          │                 │                                  │
                          │              Grafana                               │
                          └────────────────────────────────────────────────────┘
```

**Why two Collectors?** They have different jobs:

- The **agent** is a DaemonSet. It is the only thing that can read
  `/var/log/pods` on its own node's disk — which is how you collect logs from
  processes that know nothing about OpenTelemetry (Postgres, Envoy, Ollama,
  ArgoCD). It forwards; it knows nothing about Tempo or Loki.
- The **gateway** is a Deployment. It is the single place that knows where data
  actually goes, and the single place to do cluster-wide work. Change a backend
  and you edit one file, not one file per node.

## Deploy it

You already applied the app-of-apps in chapter 06, so the observability
Applications are on their way. Watch them:

```bash
kubectl -n argocd get applications -w
```

They come up in **sync waves** — Prometheus/Tempo/Loki first (wave 1), then
both Collectors (wave 2, because their exporters point at the first three),
then Grafana (wave 3, its datasources reference those Services), then the
CRD-dependent config (wave 4).

```bash
kubectl -n observability get pods
```

## Two sources, and why

Open any of `gitops/argocd/platform/observability-*.yaml` and you'll see
`spec.sources` with **two** entries rather than the usual one:

```yaml
  sources:
    - repoURL: https://grafana-community.github.io/helm-charts
      chart: loki
      targetRevision: "18.7.5"
      helm:
        valueFiles:
          - $values/gitops/observability/loki-values.yaml

    - repoURL: https://github.com/LondheShubham153/devboard.git
      targetRevision: mega-project
      ref: values
```

Source 1 is the upstream chart, straight from its Helm repo. Source 2 is *this*
repo contributing nothing but a values file — note it has no `path`, only a
`ref: values`, and `$values` resolves to it.

That is how you keep someone else's chart and your own configuration in two
separate places without vendoring the chart or inlining a wall of YAML inside
the Application. When the chart releases a new version you bump one string.

The second entry is a list item, so if you ever edit these files by hand, keep
the `-` that starts it. Merge the two entries by accident and the Application
picks up the fork's `repoURL` as its chart repo, which fails in a way that does
not obviously point back at the edit.

> ⚠️ The `observability-config` Application attaches an `EnvoyProxy` resource
> to the **GatewayClass**, which affects every Gateway of class `envoy` — both
> DevBoard stacks. If you get it wrong, you lose both public URLs. Know the
> rollback before you need it:
>
> ```bash
> kubectl get gatewayclass envoy -o yaml        # look for Accepted=True
> kubectl patch gatewayclass envoy --type=json \
>   -p '[{"op":"remove","path":"/spec/parametersRef"}]'
> ```

## Read the Collector config — this is the chapter

Open [`collector-gateway-values.yaml`](observability/collector-gateway-values.yaml)
and read the `config:` block top to bottom. It is written out longhand rather
than using the chart's presets precisely so you can.

```
receivers    how data gets IN        (OTLP, Prometheus scrape, filelog...)
processors   what happens in the MIDDLE (batch, enrich, drop, limit)
connectors   one pipeline's OUTPUT feeding another pipeline's INPUT
exporters    where data goes OUT      (Tempo, Loki, Prometheus, stdout)
service.pipelines   which of the above are actually wired together
```

**The one rule that explains 90% of "why is my config not working":**

> Declaring a component does nothing. Only listing it in a `service.pipelines`
> entry turns it on. You can define ten exporters and ship to none of them.

Three things in there worth understanding:

1. **`memory_limiter` is always the first processor.** If the Collector is
   about to run out of memory it starts refusing data rather than dying. A
   Collector that crashes loses everything it was holding, which is strictly
   worse than one that drops the newest batch.

2. **`k8s_attributes` is why you can tell the two stacks apart.** It looks the
   sender's IP up against the API server and tags every span with its
   namespace, pod, and deployment. Without it, `ai-service` in `devboard` and
   `ai-service` in `devboard-helm` are the same thing in Tempo.

3. **`spanmetrics` is a *connector*** — an exporter on the traces pipeline and
   a receiver on the metrics pipeline. It turns spans into RED metrics (Rate,
   Errors, Duration) with no metrics code in any application. It is also what
   draws Grafana's service graph.

### Prove the pipeline is real

Add `debug` to the traces exporters in that file, commit, let ArgoCD sync, then:

```bash
kubectl -n observability logs deploy/otel-collector-gateway -f
```

Generate some traffic and watch raw spans scroll past. *Now* the diagram is
real. (Then take `debug` back out — it is noisy and it costs CPU.)

## Open Grafana

```bash
kubectl -n observability port-forward svc/observability-grafana 3000:80
```

http://localhost:3000 — `admin` / `devboard`.

> That password is in `grafana-values.yaml` in cleartext, which after chapter
> 06 should now bother you. Moving it into Secrets Manager and referencing it
> with `admin.existingSecret` is a good exercise.

Go to **Connections → Data sources**. Three are already there, provisioned from
Git. Open Tempo and scroll to its JSON settings — `tracesToLogsV2`,
`tracesToMetrics`, `serviceMap`. Those blocks, not the URLs, are what make the
next two chapters possible.

## Verify

```bash
# Prometheus found our targets (the port NAME on each Service is what matches)
kubectl -n observability port-forward svc/prometheus-operated 9090:9090
# → http://localhost:9090/targets — look for devboard-ai-service, devboard-backend

# Alerting rules loaded
kubectl -n observability get prometheusrule devboard

# Loki is receiving
kubectl -n observability logs deploy/otel-collector-gateway | grep -i loki
```

---

Next: [12-instrumentation.md](12-instrumentation.md) — how the data gets
produced in the first place.
