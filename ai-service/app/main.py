"""ai-service — context-aware AI over Server-Sent Events.

Flow per request:
  1. Pull the project's tasks from the backend (task context).
  2. Build a prompt that grounds the model in the current project state.
  3. Stream the model's answer back to the caller as SSE.

This is the one place a synchronous service-to-service call is correct — the AI
cannot answer without the task context, so we pay that cost in the request path.

No auth: this DevBoard has no login, so the service is open within the cluster
(the Gateway only exposes it under /api/ai).
"""

import json
import logging
import os

import httpx
from flask import Flask, Response, jsonify, request, stream_with_context
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, generate_latest

from .model import MODEL_NAME, check_model_runner, stream_chat

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ai-service] %(levelname)s %(message)s",
)
log = logging.getLogger("ai-service")

app = Flask(__name__)

# The Go backend exposes GET /tasks?project_id=N -> {"tasks": [...]}.
TASK_SERVICE_URL = os.environ.get("TASK_SERVICE_URL", "http://backend:8080").rstrip("/")

registry = CollectorRegistry()
ai_requests_total = Counter(
    "ai_service_requests_total",
    "AI requests handled",
    ["endpoint", "status"],
    registry=registry,
)


class TaskFetchError(RuntimeError):
    """The backend could not give us task context."""


def _fetch_tasks(project_id: str) -> list[dict]:
    """Fetch task context, or raise.

    This used to fail OPEN: on any error it returned [], the prompt below
    rendered "(no tasks)", and the model cheerfully invented a summary of a
    project it had been told nothing about. Confidently wrong output is worse
    than an error — it is indistinguishable from a working system.

    Fail closed instead. The caller turns this into a real 503, which is
    possible precisely because we have not started streaming yet.
    """
    url = f"{TASK_SERVICE_URL}/tasks?project_id={project_id}"
    try:
        # 5s, not 10. This is a same-namespace call to a Go service that
        # answers a single indexed SELECT; if it takes five seconds it is
        # already broken, and waiting longer just delays the diagnosis.
        with httpx.Client(timeout=5.0) as client:
            r = client.get(url)
    except Exception as err:  # noqa: BLE001
        raise TaskFetchError(f"backend unreachable: {err}") from err
    if r.status_code != 200:
        raise TaskFetchError(f"backend returned HTTP {r.status_code}")
    return (r.json() or {}).get("tasks", [])


def _format_tasks_for_prompt(tasks: list[dict]) -> str:
    if not tasks:
        return "(no tasks)"
    lines = []
    for t in tasks:
        lines.append(
            f"- #{t.get('id')} [{t.get('status')}/{t.get('priority')}] {t.get('title')}"
        )
    return "\n".join(lines)


def _sse(generator):
    """Frame a generator of strings as Server-Sent Events. Each yielded chunk
    becomes one `data: {...}` line; we close with `data: [DONE]`."""
    def stream():
        try:
            for chunk in generator:
                payload = json.dumps({"text": chunk})
                yield f"data: {payload}\n\n"
        except Exception as err:  # noqa: BLE001
            log.exception("stream error: %s", err)
            yield f"data: {json.dumps({'error': str(err)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # ask proxies not to buffer the stream
            "Connection": "keep-alive",
        },
    )


# --- routes ---------------------------------------------------------------

@app.get("/")
def index():
    """Reachable at /api/ai — the Gateway rewrites the prefix away.

    Without this, a bare /api/ai rewrites to / and 404s, which reads as
    "the AI service is down" rather than "you missed the path".
    """
    return jsonify({
        "service": "ai-service",
        "model": MODEL_NAME,
        "endpoints": ["/health", "/model/check", "POST /summarise", "POST /ask"],
    })


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "ai-service", "model": MODEL_NAME})


@app.get("/metrics")
def metrics():
    return generate_latest(registry), 200, {"Content-Type": CONTENT_TYPE_LATEST}


@app.get("/model/check")
def model_check():
    return jsonify(check_model_runner())


@app.post("/summarise")
def summarise():
    body = request.get_json(silent=True) or {}
    project_id = body.get("project_id")
    if not project_id:
        ai_requests_total.labels("summarise", "400").inc()
        return jsonify({"error": "project_id is required"}), 400

    # A REAL status code, because nothing has been streamed yet. Compare with
    # model.py, where an upstream failure happens mid-stream and the status
    # line was already flushed as 200 — there the error has to travel in-band.
    try:
        tasks = _fetch_tasks(project_id)
    except TaskFetchError as err:
        log.error("task context unavailable: %s", err)
        ai_requests_total.labels("summarise", "503").inc()
        return jsonify({"error": str(err)}), 503

    prompt = (
        "You are an engineering manager assistant. Summarise the current state of "
        "this project in 4-6 sentences. Call out blockers, in-progress work, and "
        "anything overdue. Be specific — reference task IDs when useful.\n\n"
        f"Tasks:\n{_format_tasks_for_prompt(tasks)}"
    )
    messages = [
        {"role": "system", "content": "You are a concise, accurate engineering assistant."},
        {"role": "user", "content": prompt},
    ]
    ai_requests_total.labels("summarise", "200").inc()
    return _sse(stream_chat(messages))


@app.post("/ask")
def ask():
    body = request.get_json(silent=True) or {}
    project_id = body.get("project_id")
    question = (body.get("question") or "").strip()
    if not project_id or not question:
        ai_requests_total.labels("ask", "400").inc()
        return jsonify({"error": "project_id and question are required"}), 400

    try:
        tasks = _fetch_tasks(project_id)
    except TaskFetchError as err:
        log.error("task context unavailable: %s", err)
        ai_requests_total.labels("ask", "503").inc()
        return jsonify({"error": str(err)}), 503

    prompt = (
        "You are answering questions about an engineering project. Use only "
        "the task list below as context. If the answer isn't in the tasks, "
        "say so plainly.\n\n"
        f"Tasks:\n{_format_tasks_for_prompt(tasks)}\n\n"
        f"Question: {question}"
    )
    messages = [
        {"role": "system", "content": "You are a concise, accurate engineering assistant."},
        {"role": "user", "content": prompt},
    ]
    ai_requests_total.labels("ask", "200").inc()
    return _sse(stream_chat(messages))


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "3005")))
