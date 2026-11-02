"""Trivial tests that need no model or backend — enough for CI to do real work."""

from app import main as ai_main
from app.main import TaskFetchError, _format_tasks_for_prompt, app


def test_index_is_not_a_404():
    """A bare /api/ai rewrites to / at the Gateway. It used to 404, which reads
    as "the service is down" rather than "you missed the path"."""
    client = app.test_client()
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.get_json()["service"] == "ai-service"


def test_missing_task_context_is_a_503_not_a_confident_lie(monkeypatch):
    """Fail closed.

    This used to return 200 and stream a summary of "(no tasks)" — the model
    inventing a project it had been told nothing about. A wrong answer that
    looks right is worse than an error, so an unreachable backend must surface
    as a real status code. It can be a real one here precisely because no
    streaming has started yet.
    """
    def boom(_project_id):
        raise TaskFetchError("backend unreachable: simulated")

    monkeypatch.setattr(ai_main, "_fetch_tasks", boom)
    client = app.test_client()

    for path, payload in (
        ("/summarise", {"project_id": 1}),
        ("/ask", {"project_id": 1, "question": "what is blocked?"}),
    ):
        resp = client.post(path, json=payload)
        assert resp.status_code == 503, path
        assert "unreachable" in resp.get_json()["error"]


def test_health():
    client = app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-service"


def test_summarise_requires_project_id():
    client = app.test_client()
    resp = client.post("/summarise", json={})
    assert resp.status_code == 400


def test_format_tasks_empty():
    assert _format_tasks_for_prompt([]) == "(no tasks)"


def test_format_tasks_lines():
    out = _format_tasks_for_prompt([{"id": 1, "status": "todo", "priority": "high", "title": "X"}])
    assert "#1" in out and "todo/high" in out and "X" in out
