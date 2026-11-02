# 13 — Debugging with traces

Everything so far was setup. This is the chapter where it pays.

```bash
ADDR=$(kubectl -n devboard get gateway devboard-gateway -o jsonpath='{.status.addresses[0].value}')
kubectl -n observability port-forward svc/observability-grafana 3000:80 &
```

## The happy path first

Open `http://$ADDR/ai`, pick a project, ask something like *"what's blocked?"*,
and watch it stream.

Now: Grafana → **Explore** → **Tempo** → Search → `service.name = ai-service` →
newest trace.

This is real output from the cluster, not an idealised diagram:

```
devboard-gateway.devboard  ingress ─────────────────────────────── 2103.6ms
  devboard-gateway.devboard  router httproute/devboard/devboard-route/rule/1 egress ── 2103.4ms
    ai-service               POST /ask ─────────────────────────── 2101.5ms
      ai-service               GET  (httpx → backend) ─ 5.1ms
        backend                  GET /tasks ─ 1.8ms
          backend                  sql.conn.reset_session ─ 0.0ms
          backend                  sql.conn.query ─ 1.5ms
          backend                  sql.rows ─ 0.2ms
      ai-service               POST (httpx → ollama) ───────────────  871.2ms
```

**9 spans, 3 services, one root.**

**"Where did the 2.1 seconds go?"** One glance answers it. Not "the API is
slow" — *the model server took 871ms, and Postgres took 1.5.* You now know
exactly which component to optimise and, more usefully, which three to leave
alone.

Two details worth noticing:

- The Postgres spans are named `sql.conn.query` / `sql.rows`, not the SQL text.
  That is `otelsql` reporting driver operations; to see statements you enable
  `otelsql.WithSQLCommenter` or span attributes. Useful to know before you go
  hunting for a query you cannot find.
- The gateway's own span is ~2ms longer than the ai-service span it wraps.
  That difference is Envoy's proxying overhead — and it is the *healthy*
  version of the shape you will see in Failure 1 below, where the child ends
  up longer than the parent.

Note what produced each span: Envoy's came from a CRD field, ai-service's and
the httpx ones came from an environment variable, and the backend and Postgres
ones came from `tracing.go`. Three mechanisms, one waterfall.

### The three-click correlation drill

This is the payoff for all the `jsonData` in `grafana-values.yaml`.

1. Click the **Ollama span** → **Logs for this span**. `tracesToLogsV2` filters
   Loki to this trace ID, in this pod, in this time window. You are reading the
   log lines for *this exact request* — not "logs from around then".
2. Click a log line → **View trace**. `derivedFields` finds the trace ID in the
   line and links back. Round trip complete.
3. Click the **ai-service span** → **Request rate / p95**. `tracesToMetrics`
   takes you to the RED metrics for this operation, derived by the spanmetrics
   connector.
4. Tempo → **Service Graph** tab. There is your architecture, as a live graph.
   **Nobody drew it.** It was discovered from traffic, which means — unlike
   every wiki diagram you have ever met — it cannot be out of date.

---

Now break things on purpose.

## Failure 1 — the invisible timeout

This is the bug that motivated the whole route-timeout comment in
`k8s/httproute.yml`. It was originally found by guessing.

**Break it.** In Git, delete the `timeouts:` block from the `/api/ai/ask` rule
in `k8s/httproute.yml`. Commit. ArgoCD syncs. Ask a question in the UI.

**Symptom.** The answer just… stops. Mid-sentence. No error in the browser.

**Now try to diagnose it the old way:**

```bash
kubectl -n devboard logs deploy/devboard-ai-service-deployment --tail=50
```

Nothing wrong. The service happily kept generating into a socket that closed.
The app's own metric recorded a `200`. Every pod is Ready.

**Now look in Tempo.** Find the trace. Two things are impossible:

- the Envoy span is **exactly 15.000s** and marked error
- the ai-service span is **longer than its own parent**

A child outliving its parent cannot happen in a healthy system. That shape is
the fingerprint of an upstream timeout — the proxy gave up and tore down the
connection while the backend was still working. Envoy's default route timeout
is ~15s; CPU inference takes longer.

Restore the `timeouts:` block and commit. Watch ArgoCD heal it.

## Failure 2 — the outage from chapter 11

**Break it.** Remove `storageClassName: gp3` from `gitops/ollama/pvc.yaml`,
commit, then force the volume to be re-created:

```bash
kubectl -n ollama delete pvc ollama-models
kubectl -n ollama rollout restart deploy/ollama
```

**What happens now that you have telemetry:**

- Within 5 minutes, the **`AIModelStorageUnbound`** alert fires. Its annotation
  names the cause and the fix.
- The **Ollama health** dashboard's "PVC Pending" panel goes red.
- The trace shows the ai-service span with ERROR status and a failed httpx
  span — and because `model.py` now raises instead of streaming
  `[model-error status=502]` as text, the span is genuinely marked failed.
- Loki has the exception, carrying the trace ID.

Compare that with chapter 11's opening: same bug, same green pods, and this
time it took **under a minute** to find. The observability stack detects the
exact bug that motivated building it.

Restore the line and commit.

## Failure 3 — confidently wrong

**Break it.**

```bash
kubectl -n devboard scale deploy/devboard-backend-deployment --replicas=0
```

Ask the AI to summarise a project.

**Before** the fix in chapter 10, `_fetch_tasks` failed *open*: any error
returned `[]`, the prompt rendered `(no tasks)`, and the model cheerfully
invented a plausible summary of a project it had been told nothing about. HTTP
200. No error anywhere. A confident, fluent, completely fabricated answer.

**After**, you get a clean `503` with a real message, an error span, and a log
line carrying the trace ID.

If you can, run it both ways — `git stash` the fix and try again. The contrast
is the entire argument for failing closed:

> A wrong answer that looks right is worse than an error. An error is
> actionable; a hallucination is not even detectable.

Note also *why* a real status code was possible here: the failure happens
**before** the stream starts. Once SSE headers are flushed the status line is
already `200` and cannot be taken back — which is exactly why `model.py`'s
mid-stream failure has to travel in-band as a `data: {"error": ...}` frame, and
why span status matters so much for streaming endpoints.

```bash
kubectl -n devboard scale deploy/devboard-backend-deployment --replicas=1
```

## What is still invisible

Be honest about the gap. `frontend/src/hooks/useAIStream.js` is a plain
`fetch()` — it sends no `traceparent`. So **the root span is Envoy's**, and
everything before it is missing: DNS, TLS, the NLB, and the user's own network.

From India to `us-west-2` that is 250–400ms of round trip — often larger than
every backend span combined. Your trace says 8.42s; your user experienced ~8.8s.

This is a normal production posture, not a defect. Tracing from the edge is
what most teams run. But know where your measurement starts, and don't tell
anyone your p95 is the number Tempo shows you.

## Exercises

1. **Find the gap.** Trace a `/api/projects` request (not `/api/ai`). There is
   an unexplained few-millisecond hole between the Envoy span and the backend
   span. What is in it? (Hint: `frontend/vite.preview.config.js`.) How would
   you close it — and is it worth closing?
2. **Make Ollama slow.** Drop its CPU limit to `200m`, commit, ask a question.
   Which span grows? What does the throttling panel show?
3. **Break the propagator.** Comment out `otel.SetTextMapPropagator` in
   `backend/tracing.go` and redeploy. The backend still produces spans — so
   what exactly is wrong, and how would you notice in a real incident?

---

Next: [14-cicd.md](14-cicd.md)
