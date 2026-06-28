"""Thread → event-loop bridge.

Some work runs in FastAPI's worker thread pool (synchronous routes and background
tasks, e.g. the blocking SSH scan). When that code needs to invoke an async
coroutine — such as the async scan-ingest pipeline — it cannot await it
directly. run_blocking submits the coroutine to the main event loop and waits for
the result, so the two halves of the merged app talk in-process instead of over HTTP.

Must NOT be called from the event loop thread itself (that would deadlock); async
handlers should use fastapi.concurrency.run_in_threadpool to go the other direction.
"""

import asyncio
from typing import Any, Awaitable, Optional

_loop: Optional[asyncio.AbstractEventLoop] = None


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Record the running event loop. Called once from the app's lifespan startup."""
    global _loop
    _loop = loop


def run_blocking(coro: Awaitable[Any]) -> Any:
    """Run an async coroutine on the main loop from a worker thread and block for its result."""
    if _loop is None:
        raise RuntimeError("Event loop not initialized — is the app started?")
    return asyncio.run_coroutine_threadsafe(coro, _loop).result()
