# 12 — Four ways to instrument

The stack from chapter 11 is a receiver. Something has to *produce* the
telemetry. DevBoard does it four different ways, on purpose, because the
comparison is the whole lesson.

| | Envoy Gateway | ai-service (Python) | backend (Go) |
| --- | --- | --- | --- |
| **App code** | **0 lines** | **0 lines** | ~60 + a ctx on every query |
| **Mechanism** | a CRD field | `opentelemetry-instrument` monkey-patches at startup | explicit SDK wiring |
| **You change** | `EnvoyProxy` CR | Dockerfile CMD + env vars | `tracing.go`, `main.go`, `go.mod` |
| **Fails how** | GatewayClass `Accepted=False` — loud | emits nothing, silently — quiet | compile error — loudest |
| **Debugging it** | `kubectl get gatewayclass` | *"why are there no spans?"* | it's your code; read it |

None of these is simply better. That is the point.

## 1. Envoy Gateway — free telemetry at the edge

[`envoyproxy-telemetry.yaml`](observability/manifests/envoyproxy-telemetry.yaml)
is the entire change:

```yaml
spec:
  telemetry:
    tracing:
      samplingRate: 100
      provider:
        type: OpenTelemetry
        backendRefs:
          - name: otel-collector-gateway
            namespace: observability
            port: 4317
```

Envoy already knew how to make spans. We only told it where to send them.

This is the cheapest observability you will ever buy, and it has a property the
other two don't: it covers **every request that enters the cluster**, including
requests to services nobody has instrumented. If you do one thing, do this.

Two details:

- `samplingRate: 100` traces everything. Correct for a teaching cluster where
  you want the trace you just generated to actually be there. In production you
  sample — ideally tail-sample in the Collector, keeping 100% of errors and slow
  requests and 1% of the boring ones.
- The `ReferenceGrant` in the same file is not optional. Gateway API denies
  cross-namespace references by default; a namespace must opt *in* to being
  referenced. Without it the `backendRefs` above is silently refused, and you
  get no traces with no error pointing at the cause.

## 2. ai-service — zero code, Python

Open [`ai-service/app/main.py`](../ai-service/app/main.py). Search it for
"otel", "telemetry", "trace". **There is nothing.** Now look at the Dockerfile:

```dockerfile
CMD ["opentelemetry-instrument", \
     "gunicorn", "--bind", "0.0.0.0:3005", ...]
```

That one word is the whole integration. `opentelemetry-instrument` reads the
`OTEL_*` environment variables, finds every instrumentation package installed
that matches a library you import, patches them, then execs your real command.
Flask and httpx are wrapped *before* `app/main.py` is ever imported.

So the change set is: two lines in `requirements.txt` (the distro and the
exporter), a hashed lock file, one word in the CMD, and a block of env vars in
the Deployment.

`opentelemetry-bootstrap` scans the installed packages and picks the matching
instrumentation for each one (Flask, httpx, requests, urllib3 ...). Nobody
maintains a list by hand: edit `requirements.txt`, run `ai-service/lock.sh`, and
bootstrap's output is folded into `requirements.lock` with hashes. The image
installs only from that lock (`--require-hashes --only-binary :all:`), so builds
are reproducible and a swapped package fails the hash check. The Dockerfile also
re-runs `opentelemetry-bootstrap -a requirements` and fails the build if it
wants a package the lock lacks, so the lock cannot silently go stale. CI uses
`requirements-dev.lock` (the same set plus pytest, ruff and pip-audit). Probe
and scrape noise is dropped with `OTEL_PYTHON_EXCLUDED_URLS=health,metrics`.

Two choices in there worth explaining:

- **`OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf`**, not gRPC. It avoids pulling
  `grpcio` (a ~40 MB C-extension wheel) into the image, and OTLP/HTTP is
  curl-able — which makes "is anything arriving?" a much shorter conversation.
- **`OTEL_LOGS_EXPORTER: otlp`** ships log records over OTLP, so each one
  carries `trace_id` and `span_id` as *real fields*. Loki 3.x stores those as
  structured metadata, and Grafana links log → trace with no regex at all. Hold
  that thought for the Go section.

### The trap: gunicorn is pre-fork

Even with `--workers 1`, gunicorn's master process forks a worker. The
`BatchSpanProcessor`'s background export thread does **not** survive `fork()`.

Modern `opentelemetry-python` registers `os.register_at_fork` handlers that
recreate it, so this normally just works. But if you ever see **zero spans from
a Python service and no error anywhere**, this is the first thing to check —
and the fix is a `gunicorn.conf.py` with a `post_fork` hook.

Meet it deliberately now rather than accidentally at 2am:

```bash
# Verify the instrumentation actually loads, outside Kubernetes:
cd ai-service
python -m venv .venv && .venv/bin/pip install -r requirements.txt
OTEL_TRACES_EXPORTER=console OTEL_SERVICE_NAME=ai-service \
  .venv/bin/opentelemetry-instrument .venv/bin/python -c \
  "from app.main import app; app.test_client().get('/health')"
```

You should see a JSON span named `GET /health` printed to your terminal, with
`"service.name": "ai-service"`. No OTel code, a real span.

## 3. frontend — the browser starts the trace

[`frontend/src/telemetry.js`](../frontend/src/telemetry.js) registers the OTel
Web SDK with two instrumentations: document load and `fetch`. `api/client.js` is
not touched. Every `/api` call carries a `traceparent`, so the trace starts at
the user's click and continues through Envoy, the backend and Postgres.

- It is **off unless built with `VITE_OTEL_ENABLED=true`** (the CI image build
  sets it). Vite bakes env vars in at build time, so this is a build arg, not a
  Deployment env var.
- Spans go to the relative URL `/otlp/v1/traces`. The Gateway routes that exact
  path (POST only) to a dedicated Collector receiver on `:4319`, through its own
  HTTPRoute (Envoy Gateway v1.2.1 cannot attach a rate limit to a single rule), so there is no
  CORS and the browser never sees the Collector address. This needs the
  `ReferenceGrant` in [`otlp-ingest.yaml`](observability/manifests/otlp-ingest.yaml).
- That endpoint is public and unauthenticated, so it is treated as hostile
  input: a separate pipeline, a 1 MiB body cap, a per-instance rate limit, and a
  `resource/browser` processor that **forces** `service.name=devboard-frontend`.
  A browser cannot pose as `backend`.
- Sampling is `parentbased` ratio, 1.0 here. In production lower it
  (`VITE_OTEL_SAMPLE_RATIO`) and tail-sample in the Collector.

## 4. backend — manual, Go

Go compiles to a static binary. (Zero-code Go exists, through eBPF: OpenTelemetry
Go auto-instrumentation or the OTel Operator. It needs a privileged sidecar and
sees fewer details, so this repo keeps the explicit SDK.) There is no import hook, no runtime patching,
no `opentelemetry-instrument` equivalent. You wire the SDK yourself:
[`backend/tracing.go`](../backend/tracing.go), about 60 lines.

Read it, then note the three things that are easy to get wrong:

**The propagator is the load-bearing part.**

```go
otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
    propagation.TraceContext{},
    propagation.Baggage{},
))
```

W3C `traceparent` is the wire format Envoy sends and the Python service
forwards. Without this, the backend **ignores the incoming header and starts a
brand new trace on every request** — the waterfall breaks in half and the
backend's spans float off as their own root traces. The symptom is lots of
small, valid-looking traces, which does not look like an error at all.

**Telemetry must never take the app down.** If the Collector is missing,
`initTracing` logs once and returns a no-op. An observability stack that can
cause an outage is worse than no observability stack.

**Every query needs a context.** In `main.go`:

```go
rows, err := db.QueryContext(c.Request.Context(), ...)
```

`otelsql` wraps the driver so each query becomes a child span carrying the SQL
statement — that is how "the API is slow" becomes "this one SELECT is slow".
But a span with no parent context floats free of its trace. Passing
`c.Request.Context()` into eight call sites is not ceremony. **This is why Go
APIs take a `context.Context` as their first argument.**

### The cost, stated plainly

Compare the trace-correlated logs:

```python
# ai-service — an environment variable
OTEL_PYTHON_LOG_CORRELATION: "true"
```

```go
// backend — a code change, in fail()
sc := trace.SpanFromContext(c.Request.Context()).SpanContext()
log.Printf("[backend] ERROR trace_id=%s: %v", sc.TraceID(), err)
```

And in Grafana, two different Loki `derivedFields` rules: one matches a
structured `trace_id` label, the other has to regex `trace_id=(\w+)` back out
of a text log line. Both work. Only one is pleasant.

Adding `otelgin` also forced `go.mod` from Go 1.22 to **1.25** and gin from
1.10 to **1.12**. That is a real, non-obvious cost of instrumenting a Go
service, and it is worth knowing before you promise it in a sprint.

## The one string they all agree on

```bash
curl -v "http://$ADDR/api/projects" 2>&1 | grep -i traceparent
```

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ^  ^                                ^                ^
             │  └ trace ID (32 hex)              └ span ID (16)   └ sampled
             └ version
```

Envoy generates it. Python's auto-instrumentation reads it and passes it on.
Go's propagator reads it. Three languages, three completely different
integration mechanisms, and they agree on this one header. **That is the entire
trick of distributed tracing.**

## Metrics: a deliberate lie, left in place

`ai-service` has a hand-rolled Prometheus counter, and it is **wrong on
purpose**. In `main.py`:

```python
ai_requests_total.labels("ask", "200").inc()
return _sse(stream_chat(messages))
```

It increments *before* the stream runs. It can never observe a model failure.
It reports `200` forever — including during the outage in chapter 11.

We did not fix it. Open the **DevBoard AI — RED** dashboard and look at the
"two counters" panel: the app's own metric next to the span-derived one. One
says everything is fine. The other tells the truth.

> **Exercise.** Fix the counter. Move the `.inc()` so it observes the actual
> outcome, and switch from the custom `CollectorRegistry` to the default one so
> you also get process and GC collectors for free. Then explain why the
> span-derived metric needed no change.

---

Next: [13-debug-with-traces.md](13-debug-with-traces.md) — use all of this to
find real bugs.
