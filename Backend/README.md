# The Underlayer — Backend

FastAPI relay server. Receives SSH scan data, stores it in MongoDB, and streams it to AR clients over WebSocket.

## Setup

**1. Create a virtual environment and install dependencies**
```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**2. Copy the example env file and fill in your values**
```bash
cp .env.example .env
```
> SSH credentials go in `data/hosts.json`, **not** in `.env`.

**3. Configure target hosts in `data/hosts.json`**
```json
[
  {
    "bt_name": "raspberrypi",
    "display_name": "Raspberry Pi",
    "hostname": "192.168.1.101",
    "ssh_port": 22,
    "ssh_user": "pi",
    "ssh_password": null,
    "can_ssh": true,
    "coordinates": { "x": 3.0, "y": 0.5, "z": 1.5 }
  }
]
```
- `bt_name` — Bluetooth device name the ESP32 will advertise; used to match BLE scans to hosts
- `ssh_password` — leave `null` if using SSH key auth
- `coordinates` — room-space position in meters (used for future AR anchoring)

## Running

```bash
# Start the API server (accessible on your local network)
uvicorn app:app --host 0.0.0.0 --port 8000

# In a separate terminal — run a one-shot SSH scan of all hosts in hosts.json
python ssh_engine.py
```

## Endpoints

### `ssh_engine.py` — port 8001

Receives BLE scans from the ESP32, matches them against `hosts.json`, SSH-scans matched hosts, then forwards results to `app.py`.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | Status + current relay URL |
| `GET`  | `/api/health` | Health check, shows relay connectivity |
| `POST` | `/api/bluetooth/scan` | **Called by ESP32** — receives BLE device list, triggers SSH scan, relays result |
| `POST` | `/api/debug/scan-host` | Directly trigger an SSH scan on a specific host (bypass BLE matching) |

### `app.py` — port 8000

Stores scan results and streams them to AR clients.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | Status |
| `GET`  | `/api/health` | Health check, verifies MongoDB connection |
| `POST` | `/api/scan` | **Called by ssh_engine** — ingest a completed scan, save to MongoDB, broadcast to WebSocket clients |
| `GET`  | `/api/devices/ar` | All devices as AR-ready summaries (polled by the Snap Lens) |
| `GET`  | `/api/devices` | All devices with full scan data |
| `GET`  | `/api/devices/{hostname}` | Single device by hostname |
| `POST` | `/api/analyze/{hostname}` | Run AI analysis on a device via DigitalOcean AI |
| `POST` | `/api/approve-action` | Approve or reject a remediation action |
| `WS`   | `/ws/devices` | WebSocket — sends `initial_devices` on connect, `device_updated` after each scan |

## How They Bridge

`ssh_engine.py` calls `app.py`'s `/api/scan` endpoint after every successful SSH scan. The target URL is controlled by the `RELAY_URL` variable in `.env` (defaults to `http://localhost:8000`). Both servers run independently — if `app.py` is down, `ssh_engine` logs the relay failure and continues scanning.

```
ESP32
  └─► POST /api/bluetooth/scan  (ssh_engine :8001)
          └─► SSH into host, collect data
          └─► POST /api/scan  (app.py :8000)
                  └─► MongoDB  (device_scans + devices)
                  └─► WebSocket broadcast  → Snap Lens
```
