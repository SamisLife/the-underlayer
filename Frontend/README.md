# Frontend — Snap Spectacles Lens

The AR client for The Underlayer, built in Lens Studio using TypeScript. It connects to the relay backend over WebSocket and renders discovered devices as holographic cards anchored in 3D world space on Snap Spectacles.

The Lens Studio project lives at `snap-spectacles/snap.esproj`.

---

## Requirements

| Tool | Version | Notes |
|---|---|---|
| [Lens Studio](https://ar.snap.com/lens-studio) | 5.x | Download from Snap's AR developer portal |
| Snap Spectacles (dev kit) | Any generation | Optional — the Lens Studio simulator works for most testing |
| Node.js | 18+ | Only needed if you edit TypeScript outside Lens Studio |

---

## Opening the Project

1. Launch Lens Studio.
2. `File > Open Project` and select `snap-spectacles/snap.esproj`.
3. Lens Studio will compile the TypeScript and populate the scene. This takes 10–20 seconds on first open.

Do not open or edit files inside `snap-spectacles/Cache/` — that directory is entirely auto-generated and will be overwritten on the next build.

---

## Configuring the Backend URL

The lens connects to the relay server (`app.py`, port 8000) over WebSocket. You need to set the correct URL before deploying.

Open `snap-spectacles/Assets/Scripts/DeviceListPanel.ts` and find the WebSocket URL near the top of the file. Update it to match your setup:

**Same-network (recommended for demos):**
```typescript
const WS_URL = "ws://192.168.1.100:8000/ws/devices";
//                   ^^^^^^^^^^^^^^^^ your laptop's LAN IP
```

**Cloudflared tunnel (cross-network):**
```typescript
const WS_URL = "wss://gentle-thunder-4521.trycloudflare.com/ws/devices";
```

The lens also calls `POST /api/analyze/{hostname}` and `POST /api/approve-action` directly over HTTP. Find the base URL constant in the same file and update it to match:

```typescript
const API_BASE = "http://192.168.1.100:8000";
// or: const API_BASE = "https://gentle-thunder-4521.trycloudflare.com";
```

After any TypeScript change, Lens Studio recompiles automatically. Watch the console at the bottom of the screen for errors.

---

## Running in the Simulator

Lens Studio includes a built-in simulator that lets you preview the lens without a physical device.

1. Make sure the backend is running (`uvicorn app:app --host 0.0.0.0 --port 8000`).
2. Press the **Play** button in Lens Studio. The simulator opens in the preview panel.
3. The lens connects to `WS_URL` immediately. If devices are already in the database (from a previous scan), they appear within a few seconds via the `initial_devices` message.
4. Trigger a fresh scan by POSTing to `ssh_engine` directly:
   ```bash
   curl -X POST http://localhost:8001/api/bluetooth/scan \
     -H "Content-Type: application/json" \
     -d '{"scanner_id": "dev", "devices": [{"name": "my-laptop", "mac": "AA:BB:CC:DD:EE:FF", "rssi": -60}]}'
   ```
   The simulator will receive the `device_updated` WebSocket event and render the card.

---

## Testing Without Hardware (Mock Data)

The project includes a `MockDevices.ts` file under `Assets/Scripts/` with a pre-built device set that approximates a real scan (a Kali Linux laptop with several hundred CVEs, a router, and an IoT sensor). To use it without a running backend, swap the WebSocket initialization in `DeviceListPanel.ts` to call `loadMockDevices()` instead. This is useful for UI layout work and testing card interactions.

---

## Pushing to Snap Spectacles

1. Pair your Spectacles with Lens Studio (follow the Snap AR developer setup guide for your device).
2. In Lens Studio, open `Lens > Send to Device`.
3. The lens deploys over USB or WiFi depending on your device settings.
4. On the Spectacles, navigate to your Lenses library and launch The Underlayer.

Make sure the Spectacles are on a network that can reach the backend (same WiFi, or the cloudflared tunnel URL is set).

---

## Project Structure

```
snap-spectacles/
├── snap.esproj                 # Lens Studio project file
├── Assets/
│   └── Scripts/
│       ├── DeviceListPanel.ts  # Main controller — WebSocket, 3D device grid
│       ├── DeviceDetailPanel.ts # Expanded analysis view per device
│       ├── DevicePlacer.ts     # Spatial positioning using RSSI distance
│       ├── DeviceTypes.ts      # Shared TypeScript types (Device, ThreatLevel, ...)
│       ├── MockDevices.ts      # Offline test data
│       └── WorldScannerEffect.ts # Visual effects during scan
└── Cache/                      # Auto-generated — do not edit
```

---

## Key TypeScript Types

```typescript
type ThreatLevel = "critical" | "high" | "medium" | "low" | "unknown";

interface DeviceSummary {
  hostname: string;
  deviceType: string;
  ip: string;
  os: string;
  openPorts: number[];
  findings: string[];
  cveCount: number;
  vulnerabilityMatches: VulnerabilityMatch[];
}

interface Device {
  deviceId: string;
  hostname: string;
  bt_name: string;
  ar_summary: DeviceSummary;
}
```

---

## WebSocket Events

The relay sends two event types over `/ws/devices`:

**`initial_devices`** — sent immediately on connect, contains all devices currently in the database:
```json
{
  "event": "initial_devices",
  "devices": [ ... ]
}
```

**`device_updated`** — sent after each completed scan, contains the updated device:
```json
{
  "event": "device_updated",
  "device": { ... }
}
```

The lens handles both in `DeviceListPanel.ts`. New devices are added to the holographic grid; existing devices update their card in place.

---

## Coordinate System

Lens Studio uses a right-handed coordinate system with units in centimeters:
- `+X` is right
- `+Y` is up
- `-Z` is forward (into the scene, away from the camera)

Device cards are placed in a grid starting at `PANEL_DISTANCE = -140 cm` from the camera. Grid columns are spaced 22 cm apart. Threat-level coloring uses Lens Studio material tints applied at runtime.

---

## Troubleshooting

**Lens connects but no devices appear:**
Check that the backend is running and that at least one scan has completed. Call `GET http://localhost:8000/api/devices` to confirm devices are in the database.

**WebSocket connection refused:**
Confirm the IP and port in `DeviceListPanel.ts` match the machine running `app.py`. If using a tunnel, make sure you are using `wss://` not `ws://`.

**TypeScript compile errors in Lens Studio:**
Open the console panel (`View > Console`). Lens Studio shows the exact file and line. The most common cause is a type mismatch in the `ar_summary` shape — check that `DeviceTypes.ts` matches the response from `/api/devices/ar`.

**Analysis panel is blank after tapping ANALYZE:**
The `/api/analyze/{hostname}` call may have failed. Check the backend terminal for the AI response or error. DigitalOcean AI has a per-minute rate limit; if you hit it, the system falls back to Gemini.
