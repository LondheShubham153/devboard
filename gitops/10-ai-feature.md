# 10 — AI Assistant (self-hosted, free)

Adds an AI Assistant that summarises a project and answers questions about its
tasks, streaming the reply token-by-token. It runs entirely in-cluster — no API
key, no per-token cost.

```
frontend  ── /api/ai ─▶  ai-service ──(OpenAI API)─▶  Ollama (llama3.2:1b, CPU)
                              └─ pulls task context from the backend
```

- **ai-service/** — Flask service; endpoints `POST /api/ai/summarise`, `POST /api/ai/ask`.
- **gitops/ollama/** — a shared, in-cluster model server (deployed once, used by
  both stacks). Runs `llama3.2:1b`.
- **frontend** — an AI Assistant page at `/ai`.

## Trade-off

A frontier model needs a GPU (not free). On CPU t3.medium nodes we run a small
model (`llama3.2:1b`): real and free, but modest quality and slower — the first
request also waits for Ollama to pull ~1.3 GB. See "Make it better" below.

## Deploy

**Ollama is already running.** You applied `gitops/argocd/platform.yaml` back in
chapter 06, and Ollama is one of its children — so ArgoCD deployed it for you.

That was not always true. It used to be a manual `kubectl apply -f
gitops/argocd/ollama.yaml` in this chapter, and skipping that one line produced
a symptom *identical* to the missing `storageClassName` on its PVC: an
ai-service that reports perfectly healthy while every request fails. Two
completely different causes, one indistinguishable failure. Making it part of
the app-of-apps removed one of them.

```bash
kubectl -n ollama get pvc ollama-models                         # MUST be Bound
kubectl -n ollama rollout status deploy/ollama --timeout=600s   # first pull takes a few min
kubectl -n ollama exec deploy/ollama -- ollama list             # llama3.2:1b

# force an immediate resync (optional)
kubectl -n argocd annotate app devboard-raw devboard-helm \
  argocd.argoproj.io/refresh=hard --overwrite
```

## Try it

```bash
ADDR=$(kubectl -n devboard get gateway devboard-gateway -o jsonpath='{.status.addresses[0].value}')

curl -N http://$ADDR/api/ai/summarise \
  -H 'content-type: application/json' -d '{"project_id":"1"}'

curl -N http://$ADDR/api/ai/ask \
  -H 'content-type: application/json' \
  -d '{"project_id":"1","question":"What is blocked and why?"}'
```
Or open `http://$ADDR/ai` in the browser.

Health: `curl http://$ADDR/api/ai/health` → `{"status":"ok","service":"ai-service","model":"llama3.2:1b"}`

## Make it better

- **Bigger model:** set `OLLAMA_MODEL` in `gitops/ollama/deployment.yaml` (e.g.
  `llama3.2:3b`, `gemma2:2b`) and `MODEL_NAME` (raw env / Helm `ai.modelName`).
  Bigger models need more RAM — use a larger node instance type.
- **Free hosted API instead of Ollama:** set `MODEL_API_BASE` to the provider's
  OpenAI-compatible URL, `MODEL_NAME` to their model, and `MODEL_API_KEY` to your
  key (e.g. Groq: `https://api.groq.com/openai/v1`, `llama-3.3-70b-versatile`).
  Put the key in a Secret — never commit it (this repo is public).

Next: [11-observability.md](11-observability.md)
