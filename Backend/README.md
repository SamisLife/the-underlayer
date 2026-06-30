# The Underlayer Backend

The backend is a single FastAPI service on port `8000`. It receives SPECTER scans, matches devices to known lab hosts, runs SSH inventory collection, enriches packages with OSV vulnerabilities, produces Gemini or offline analysis, and serves the Lens APIs used by the Spectacles experience.

No database is required. Device state is held in memory and refreshed by re-scanning, which keeps setup small and predictable for demos.

## Setup

```bash
cd Backend
python run.py setup
python run.py run
```

Health check:

```bash
python run.py health
```

Development server with reload:

```bash
python run.py dev
```

Clean generated files:

```bash
python run.py clean
```

## Optional Environment

Create `Backend/.env` only when you need to override defaults.

```bash
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
OFFLINE_ANALYZE_DELAY=3.5
PORT=8000
SSH_PORT=22
SSH_TIMEOUT=10
CMD_TIMEOUT=15
```

`GOOGLE_API_KEY` is optional. Without it:

- `/api/analyze/{hostname}` uses the deterministic offline analyzer.
- `/api/learn` uses the offline knowledge base for common ports and threat metrics.

## Known Hosts

SPECTER reports BLE/Wi-Fi names and MAC addresses. The backend maps those observations to lab devices through `Backend/data/hosts.json`.

Use `Backend/data/hosts.example.json` as the public-safe shape and keep your real `hosts.json` local:

```json
[
  {
    "bt_name": "Linux-Laptop-135",
    "bt_mac": "",
    "display_name": "Linux Laptop",
    "can_ssh": true,
    "hostname": "192.168.1.50",
    "device_type": "laptop",
    "ssh_port": 22,
    "ssh_user": "ubuntu",
    "ssh_password": "replace-me"
  }
]
```

For SSH-capable hosts, the backend runs the commands defined in `Backend/data/ssh_commands.json` and turns the results into a normalized scan document.

## Data Flow

```text
SPECTER POST /api/bluetooth/scan
  -> classify each BLE/Wi-Fi observation against hosts.json
  -> immediately publish lightweight device stubs
  -> queue SSH scans for known SSH-capable devices
  -> collect OS, ports, services, users, packages, Docker, and update state
  -> query OSV for affected packages
  -> expose AR summaries to the Lens
```

When the Lens asks for analysis:

```text
POST /api/analyze/{hostname}
  -> refresh OSV matches
  -> try Gemini if GOOGLE_API_KEY exists
  -> otherwise run offline analysis
  -> attach problems and fix commands to the AR summary
```

## Main Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health, storage mode, loaded host/command counts |
| `DELETE` | `/api/devices` | Clear current in-memory device state |
| `POST` | `/api/bluetooth/scan` | SPECTER intake: BLE/Wi-Fi observations |
| `POST` | `/api/scan/trigger` | Ask the registered SPECTER device to scan now |
| `POST` | `/api/scanner/register` | SPECTER announces its local IP after Wi-Fi connects |
| `POST` | `/api/scan` | Ingest a completed scan document |
| `GET` | `/api/devices` | Full stored device records |
| `GET` | `/api/devices/ar` | Lens-friendly device summaries |
| `GET` | `/api/devices/{hostname}` | One full device record |
| `POST` | `/api/analyze/{hostname}` | Generate risk summary, problems, and fix commands |
| `POST` | `/api/approve-action` | Record approval/rejection; execute over SSH only when approved |
| `POST` | `/api/learn` | Explain a port, metric, or risk in plain language |
| `POST` | `/api/debug/scan-host` | Developer path: scan one SSH host directly |
| `POST` | `/api/ssh/run-command` | Internal/debug command execution path |
| `WS` | `/ws/devices` | WebSocket feed for clients that want live events |

## Direct SSH Development Flow

Use this when SPECTER is not available but you want to test the backend and Lens with a real host:

```bash
curl -X POST http://localhost:8000/api/debug/scan-host \
  -H "Content-Type: application/json" \
  -d '{"hostname":"192.168.1.50","username":"ubuntu","password":"replace-me","forward_to_relay":true}'
```

Then open the Lens and press `DEVICES`; the forwarded scan should appear through `/api/devices/ar`.

## Module Map

```text
app/main.py              FastAPI app, logging, health, router mounting
app/routers/relay.py     Lens-facing APIs, analysis, approval, SPECTER trigger
app/routers/scanner.py   SPECTER intake and direct SSH scan endpoints
app/store.py             in-memory device/action store
app/ai.py                Gemini calls and response shaping
app/offline_analysis.py  no-key remediation generator
app/knowledge.py         no-key notebook explanations
app/osv.py               OSV vulnerability lookup and caching
app/summary.py           raw scan -> AR summary
app/ssh/                 host matching, SSH collection, parsers, commands
```

## Security Limitations

This backend is for controlled demo networks:

- SSH credentials live in `Backend/data/hosts.json`; keep real values out of public commits.
- The SSH scanner accepts unknown host keys for demo speed.
- Approved remediation commands may use `sudo -S`, which is convenient but not production-grade secret handling.
- The store is intentionally in-memory. Restarting the backend clears device state.
- Only scan and remediate machines you own or have permission to test.
