from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING, Final

from starlette.types import ASGIApp, Receive, Scope, Send

if TYPE_CHECKING:
    from google.cloud.firestore_v1.base_document import DocumentSnapshot


class RequestReads:
    """Mutable snapshot maps owned by one HTTP request; writes discard both maps."""

    def __init__(self) -> None:
        self.documents: dict[tuple[int, str, str, str], DocumentSnapshot] = {}
        self.collections: dict[tuple[int, str, str], tuple[DocumentSnapshot, ...]] = {}
        self.active = True


request_reads: Final[ContextVar[RequestReads | None]] = ContextVar("firestore_request_reads", default=None)


def current_request_reads() -> RequestReads | None:
    reads = request_reads.get()
    return reads if reads is not None and reads.active else None


def clear_request_reads() -> None:
    reads = request_reads.get()
    if reads is not None:
        reads.documents.clear()
        reads.collections.clear()


class FirestoreReadCacheMiddleware:
    """Deduplicate reads inside a request, never across users or later requests."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        reads = RequestReads()
        token = request_reads.set(reads)
        try:
            await self.app(scope, receive, send)
        finally:
            reads.active = False
            clear_request_reads()
            request_reads.reset(token)
