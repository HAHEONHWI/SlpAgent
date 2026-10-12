import hashlib
import threading
import time
from collections import defaultdict, deque
from starlette.responses import JSONResponse


class WindowLimiter:
    def __init__(self, limit: int, window_seconds: int, max_keys: int = 10000):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> tuple[bool, int]:
        now = time.monotonic() if now is None else now
        cutoff = now - self.window_seconds
        with self.lock:
            hits = self.hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.limit:
                return False, max(1, int(hits[0] + self.window_seconds - now + 0.999))
            hits.append(now)
            if len(self.hits) > self.max_keys:
                for old_key in list(self.hits):
                    old_hits = self.hits[old_key]
                    while old_hits and old_hits[0] <= cutoff:
                        old_hits.popleft()
                    if not old_hits:
                        del self.hits[old_key]
                    if len(self.hits) <= self.max_keys:
                        break
                while len(self.hits) > self.max_keys:
                    self.hits.pop(next(iter(self.hits)))
            return True, 0


class RateLimitMiddleware:
    def __init__(self, app, limit: int, window_seconds: int):
        self.app = app
        self.limiter = WindowLimiter(limit, window_seconds)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") == "/healthz" or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        authorization = headers.get(b"authorization", b"")
        token = authorization[7:] if authorization.lower().startswith(b"bearer ") else b""
        token_hash = hashlib.sha256(token).hexdigest() if token else "anonymous"
        client = scope.get("client")
        address = client[0] if client else "unknown"
        allowed, retry_after = self.limiter.check(f"{address}:{token_hash}")
        if not allowed:
            response = JSONResponse({"detail": "rate limit exceeded"}, status_code=429,
                                    headers={"Retry-After": str(retry_after)})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
