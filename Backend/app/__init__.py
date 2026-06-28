"""The Underlayer backend — a single FastAPI application that unifies the relay
(CVE lookup, AI analysis, WebSocket streaming) and the SSH engine
(BLE intake, SSH recon, remediation) into one process.

Run with:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
