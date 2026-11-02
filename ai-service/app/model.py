"""LLM client — talks to any OpenAI-compatible /v1 endpoint.

Default target is Ollama running inside the cluster (shared infra). Ollama
exposes an OpenAI-compatible API at /v1/chat/completions and /v1/models, so the
same code works against Ollama, Docker Model Runner, or a hosted provider — you
only change MODEL_API_BASE / MODEL_NAME (and add an API key header if the
provider needs one).

Free & self-hosted here: no API key required.
"""

import json
import logging
import os
from typing import Iterable

import httpx

log = logging.getLogger("ai-service.model")

# Shared Ollama service (see gitops/ollama/). Cross-namespace FQDN so any
# stack's ai-service can reach the one shared model server.
MODEL_API_BASE = os.environ.get(
    "MODEL_API_BASE", "http://ollama.ollama.svc.cluster.local:11434/v1"
).rstrip("/")
MODEL_NAME = os.environ.get("MODEL_NAME", "llama3.2:1b")

# Optional: set MODEL_API_KEY to talk to a hosted OpenAI-compatible provider
# (Groq, Gemini, etc.). Left empty for self-hosted Ollama.
MODEL_API_KEY = os.environ.get("MODEL_API_KEY", "")


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {MODEL_API_KEY}"} if MODEL_API_KEY else {}


def check_model_runner() -> dict:
    """Probe used by /model/check — reports whether the model is loadable."""
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{MODEL_API_BASE}/models", headers=_auth_headers())
        if r.status_code != 200:
            return {
                "model_runner_reachable": False,
                "model_ready": False,
                "reason": f"unexpected status {r.status_code}",
                "model_api_base": MODEL_API_BASE,
                "model_name": MODEL_NAME,
            }
        models = (r.json() or {}).get("data", [])
        short = MODEL_NAME.split(":")[0]
        ready = any(short in (m.get("id") or "") for m in models)
        return {
            "model_runner_reachable": True,
            "model_ready": ready,
            "model_api_base": MODEL_API_BASE,
            "model_name": MODEL_NAME,
            "available_models": [m.get("id") for m in models],
        }
    except Exception as err:  # noqa: BLE001
        return {
            "model_runner_reachable": False,
            "model_ready": False,
            "reason": str(err),
            "model_api_base": MODEL_API_BASE,
            "model_name": MODEL_NAME,
        }


def stream_chat(messages: list[dict]) -> Iterable[str]:
    """Stream OpenAI-style chat completions. Yields decoded text chunks."""
    payload = {
        "model": MODEL_NAME,
        "stream": True,
        "messages": messages,
        "temperature": 0.4,
    }

    with httpx.Client(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
        with client.stream(
            "POST",
            f"{MODEL_API_BASE}/chat/completions",
            json=payload,
            headers=_auth_headers(),
        ) as r:
            if r.status_code != 200:
                try:
                    snippet = r.read().decode("utf-8", errors="replace")[:512]
                except Exception:
                    snippet = "<could not read body>"
                log.error("upstream model error %s: %s", r.status_code, snippet)
                # Raise, don't yield.
                #
                # This used to yield the string "[model-error status=404]" as
                # ordinary stream text, with HTTP 200 — so a dead model server
                # was indistinguishable from a bad answer. Nothing could tell
                # them apart: not the user, not the logs, not the metrics.
                #
                # Raising hands control to _sse()'s except block, which emits a
                # real `data: {"error": ...}` frame (already rendered by
                # useAIStream.js), logs a traceback, and — once tracing is on —
                # marks the span ERROR so it shows up in the RED dashboard.
                raise RuntimeError(
                    f"model server returned HTTP {r.status_code}: {snippet}"
                )
            for raw in r.iter_lines():
                if not raw:
                    continue
                if raw.startswith("data: "):
                    data = raw[6:]
                    if data == "[DONE]":
                        return
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = obj.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    chunk = delta.get("content")
                    if chunk:
                        yield chunk
