"""Job queue. Production: Cloud Tasks (one dispatch at a time, deduplicated task names, OIDC-authenticated
callbacks), called via its REST API with the existing google-auth library. Development: an in-process timer."""
import base64
import json
import threading
from datetime import datetime, timedelta, timezone


class CloudTasksQueue:
    def __init__(self, queue: str, service_url: str, invoker: str):
        self.queue, self.url, self.invoker = queue, service_url.rstrip("/"), invoker

    def enqueue(self, org_id: str, job_id: str, step: int, delay: float = 0.0) -> None:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        when = (datetime.now(timezone.utc) + timedelta(seconds=max(0.0, delay))).isoformat().replace("+00:00", "Z")
        task = {"name": f"{self.queue}/tasks/{job_id}-{step}",  # same name twice -> rejected: no duplicate processing
                "scheduleTime": when,
                "httpRequest": {"httpMethod": "POST", "url": f"{self.url}/internal/stt/step",
                                "headers": {"Content-Type": "application/json"},
                                "body": base64.b64encode(json.dumps({"org_id": org_id, "job_id": job_id, "step": step}).encode()).decode(),
                                "oidcToken": {"serviceAccountEmail": self.invoker, "audience": self.url}}}
        r = AuthorizedSession(creds).post(f"https://cloudtasks.googleapis.com/v2/{self.queue}/tasks", json={"task": task}, timeout=30)
        if r.status_code == 409:
            return  # this exact step is already queued
        r.raise_for_status()


class InlineQueue:
    """Development only: runs steps in a background thread after the delay (single worker, in order)."""
    _lock = threading.Lock()

    def __init__(self, runner):
        self.runner = runner

    def enqueue(self, org_id: str, job_id: str, step: int, delay: float = 0.0) -> None:
        def run():
            with self._lock:
                self.runner(org_id, job_id, step)
        threading.Timer(min(delay, 3600), run).start()


class RecordingQueue:
    """Tests: remembers enqueued steps so a test can run them one by one."""
    def __init__(self):
        self.items: list[tuple[str, str, int, float]] = []

    def enqueue(self, org_id: str, job_id: str, step: int, delay: float = 0.0) -> None:
        self.items.append((org_id, job_id, step, delay))
