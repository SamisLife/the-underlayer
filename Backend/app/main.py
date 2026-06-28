"""Application entry point.

Builds the single FastAPI app that serves both the relay and the SSH engine, sets
up unified logging, and exposes the merged health/root endpoints.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000
  or:  python -m app.main
"""

import logging
import logging.handlers

from fastapi import FastAPI

from .config import ENGINE_VERSION, LOG_DIR, PORT
from .db import db
from .routers import relay, scanner
from .ssh.classify import COMMANDS, HOSTS

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
app = FastAPI(title="The Underlayer", version=ENGINE_VERSION)

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
    """Unified health check — Mongo connectivity plus loaded SSH host/command counts."""
    try:
        await db.command("ping")
        mongo_status = "connected"
        status = "healthy"
    except Exception as e:
        mongo_status = f"error: {e}"
        status = "error"

    return {
        "status": status,
        "mongodb": mongo_status,
        "registered_hosts": len(HOSTS),
        "ssh_commands_loaded": len(COMMANDS),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=True)
