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

# ── AI inference (Google Gemini) ──────────────────────────────────────────────
# Optional: without a key, /api/learn falls back to the offline knowledge base and
# /api/analyze falls back to the offline rule-based analyzer.
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Model — flash-lite is the fastest tier. Override via GEMINI_MODEL (e.g. gemini-2.5-flash).
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")

# Artificial delay (seconds) for the offline analyze fallback, so the AR "analyzing"
# animation has time to play. Set to 0 to disable.
OFFLINE_ANALYZE_DELAY = float(os.getenv("OFFLINE_ANALYZE_DELAY", "3.5"))

# ── Server ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8000"))

# ── SSH connection defaults ───────────────────────────────────────────────────
SSH_PORT = int(os.getenv("SSH_PORT", "22"))
SSH_TIMEOUT = int(os.getenv("SSH_TIMEOUT", "10"))
CMD_TIMEOUT = int(os.getenv("CMD_TIMEOUT", "15"))

ENGINE_VERSION = "1.0.0"
