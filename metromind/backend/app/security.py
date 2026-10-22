"""Admin authorization, anonymous client ids and a simple per-IP rate limiter."""

import hmac
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .config import get_settings

_CLIENT_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")


def require_admin(authorization: str | None = Header(None)) -> None:
    token = get_settings().admin_token
    if not token:
        raise HTTPException(503, detail={"code": "admin_disabled",
                                         "message": "Admin actions are disabled: set METROMIND_ADMIN_TOKEN."})
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Admin bearer token required."})
    if not hmac.compare_digest(authorization[7:].strip().encode(), token.encode()):
        raise HTTPException(403, detail={"code": "forbidden", "message": "Invalid admin token."})


def client_id(x_client_id: str | None = Header(None)) -> str:
    if not x_client_id or not _CLIENT_RE.match(x_client_id):
        raise HTTPException(400, detail={"code": "client_id_required",
                                         "message": "Send an X-Client-Id header (8-64 letters, digits or dashes)."})
    return x_client_id


def optional_client_id(x_client_id: str | None = Header(None)) -> str | None:
    return x_client_id if x_client_id and _CLIENT_RE.match(x_client_id) else None


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding one-minute window per client IP. In-memory: suitable for a single process; put a
    shared limiter (e.g. at the reverse proxy) in front of multi-replica deployments."""

    def __init__(self, app, per_minute: int):
        super().__init__(app)
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    async def dispatch(self, request: Request, call_next):
        if self.per_minute <= 0 or not request.url.path.startswith("/api/") or request.url.path in (
                "/api/health", "/api/ready"):
            return await call_next(request)
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with self.lock:
            q = self.hits[ip]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                retry = int(60 - (now - q[0])) + 1
                return JSONResponse({"error": {"code": "rate_limited", "message": "Too many requests.",
                                               "details": {"retry_after_s": retry}}}, status_code=429,
                                    headers={"Retry-After": str(retry)})
            q.append(now)
        return await call_next(request)
