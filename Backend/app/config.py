"""Centralized configuration and filesystem paths.

All environment-driven settings live here so the rest of the package never calls
os.getenv directly. Loaded once at import time.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── Paths ─────────────────────────────────────────────────────────────────────
# config.py lives at Backend/app/config.py, so parents[1] is the Backend/ root.
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"
SCAN_DIR = LOG_DIR / "scans"
REPORTS_DIR = LOG_DIR / "reports"

LOG_DIR.mkdir(exist_ok=True)
SCAN_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)

# ── Storage ───────────────────────────────────────────────────────────────────
# MongoDB is optional. If MONGO_URI is unset, the app uses an in-memory store
# (data lives until restart) so it runs with zero external dependencies.
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "underlayer")

# ── AI inference (Google Gemini) ──────────────────────────────────────────────
# Optional: without a key, /api/learn falls back to the offline knowledge base.
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# ── Server ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8000"))

# ── SSH connection defaults ───────────────────────────────────────────────────
SSH_PORT = int(os.getenv("SSH_PORT", "22"))
SSH_TIMEOUT = int(os.getenv("SSH_TIMEOUT", "10"))
CMD_TIMEOUT = int(os.getenv("CMD_TIMEOUT", "15"))

ENGINE_VERSION = "1.0.0"
