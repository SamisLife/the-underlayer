"""Application entry point.

Builds the single FastAPI app that serves both the relay and the SSH engine, sets
up unified logging, and exposes the merged health/root endpoints.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000
  or:  python -m app.main
"""

import asyncio
import logging
import logging.handlers
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import bridge
from .config import ENGINE_VERSION, LOG_DIR, PORT
from .routers import relay, scanner
from .ssh.classify import COMMANDS, HOSTS
from .store import store

# ── Logging (console + rotating file) ─────────────────────────────────────────
_fmt = logging.Formatter("%(asctime)s  %(levelname)-8s  %(name)s  %(message)s", datefmt="%H:%M:%S")
_console = logging.StreamHandler()
_console.setFormatter(_fmt)
_file = logging.handlers.RotatingFileHandler(
    LOG_DIR / "underlayer.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
)
_file.setFormatter(_fmt)
logging.basicConfig(level=logging.INFO, handlers=[_console, _file])

log = logging.getLogger("underlayer")

# ── App ───────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Capture the running loop so worker threads (SSH scans) can call async
    # ingest in-process via app.bridge.run_blocking.
    bridge.set_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="The Underlayer", version=ENGINE_VERSION, lifespan=lifespan)

app.include_router(relay.router)
app.include_router(scanner.router)


@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "The Underlayer",
        "version": ENGINE_VERSION,
    }


@app.get("/api/health")
async def health():
    """Health check — storage mode plus loaded SSH host/command counts."""
    return {
        "status": "healthy",
        "storage": store.name,
        "registered_hosts": len(HOSTS),
        "ssh_commands_loaded": len(COMMANDS),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=True)
