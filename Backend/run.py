#!/usr/bin/env python3
"""The Underlayer backend — cross-platform task runner.

Works on Windows, macOS, and Linux with only Python (already required) — no make,
no shell differences.

Usage:
  python run.py setup            create a venv and install dependencies
  python run.py run              run the server on 0.0.0.0:8000
  python run.py dev              run with autoreload
  python run.py health           check a running server
  python run.py clean            remove venv, caches, and logs
  python run.py run --port 9000  override the port
"""

import argparse
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / "venv"


def venv_python() -> str:
    """The venv's Python if the venv exists, else the current interpreter."""
    win = VENV / "Scripts" / "python.exe"
    nix = VENV / "bin" / "python"
    if win.exists():
        return str(win)
    if nix.exists():
        return str(nix)
    return sys.executable


def setup() -> None:
    print(f"Creating virtual environment at {VENV} ...")
    subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
    py = venv_python()
    subprocess.check_call([py, "-m", "pip", "install", "--upgrade", "pip"])
    subprocess.check_call([py, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])
    print("Setup complete. Run: python run.py run")


def serve(port: int, reload: bool) -> None:
    cmd = [venv_python(), "-m", "uvicorn", "app.main:app",
           "--host", "0.0.0.0", "--port", str(port), "--app-dir", str(ROOT)]
    if reload:
        cmd.append("--reload")
    subprocess.call(cmd)


def health(port: int) -> None:
    url = f"http://localhost:{port}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            print(resp.read().decode())
    except Exception as e:
        print(f"Server not reachable on port {port}: {e}")


def clean() -> None:
    shutil.rmtree(VENV, ignore_errors=True)
    shutil.rmtree(ROOT / "logs", ignore_errors=True)
    for pycache in ROOT.rglob("__pycache__"):
        shutil.rmtree(pycache, ignore_errors=True)
    print("Cleaned.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="The Underlayer backend task runner.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "task",
        nargs="?",
        default="help",
        choices=["help", "setup", "run", "dev", "health", "clean"],
        help="task to run (default: help)",
    )
    parser.add_argument("--port", type=int, default=8000, help="server port (default: 8000)")
    args = parser.parse_args()

    if args.task == "help":
        parser.print_help()
    elif args.task == "setup":
        setup()
    elif args.task == "run":
        serve(args.port, reload=False)
    elif args.task == "dev":
        serve(args.port, reload=True)
    elif args.task == "health":
        health(args.port)
    elif args.task == "clean":
        clean()


if __name__ == "__main__":
    main()
