# The Underlayer Frontend

This folder contains the Snap Spectacles Lens. The main project is:

```text
Frontend/snap-spectacles/snap-spectacles.esproj
```

The Lens renders nearby devices as holographic models, lets the user place them into the scene, opens a triple-monitor security panel, and routes scan/analyze/learn/approve actions through the backend or Demo Mode.

## Clone Requirement

The Lens project uses Git LFS for binary assets under `Assets/` and `Packages/`. Clone with Git LFS before opening the project:

```bash
git lfs install
git clone <your-repo-url>
cd the_underlayer
git lfs pull
```

Avoid "Download ZIP" for the Lens project; it can omit required model, material, audio, and package assets.

## Opening The Project

1. Install Lens Studio with Spectacles support.
2. Open `Frontend/snap-spectacles/snap-spectacles.esproj`.
3. Open the main scene.
4. Press Preview for Demo Mode, or connect Spectacles for device testing.

## Backend URL Setup

Do not edit TypeScript constants for the backend URL. The current Lens uses an Inspector input.

1. Select the `DeviceListPanel` object in the Scene hierarchy.
2. Find the `DeviceListPanel` script component in the Inspector.
3. Set `Websocket Url`:

```text
ws://<backend-lan-ip>:8000/ws/devices
```

The Lens derives the HTTP base URL from the same field:

```text
ws://192.168.1.50:8000/ws/devices -> http://192.168.1.50:8000
wss://example.trycloudflare.com/ws/devices -> https://example.trycloudflare.com
```

Use a LAN IP when the backend and Spectacles are on the same Wi-Fi. Use a secure tunnel only when the headset cannot reach the laptop directly.

## Demo Mode

`DEMO MODE` is the no-hardware path. It is intentionally enabled by default in code through `DemoState`.

In Demo Mode:

- device data comes from `MockDeviceDataSource`;
- scan/analyze/approve flows preserve the real UI timing;
- notebook explanations call the live backend `/api/learn` when configured;
- if Gemini is not configured, the backend still answers known ports and threat metrics from the offline knowledge base.

This makes the Lens presentable in Lens Studio even without Spectacles, SPECTER, or a live lab network.

## Live Mode

Turn Demo Mode off when the backend and SPECTER are running.

1. Start the backend on port `8000`.
2. Flash and power SPECTER on the same network.
3. Wait for SPECTER to register its IP through `/api/scanner/register`.
4. Tap `SCAN` in the Lens.
5. Tap `DEVICES`, pick a device, place it, then analyze it.

If SPECTER is not registered, `/api/scan/trigger` returns an error and the Lens keeps the demo-safe path available.

## Key Scripts

```text
snap-spectacles/Assets/Scripts/
  MainMenuController.ts          main HUD, SCAN/DEVICES flow, Demo Mode toggle
  DeviceListPanel.ts             device list, backend configuration, polling, placement entry
  DeviceDetailPanel.ts           triple-monitor diagnostics, notebook, fix approval UI
  DevicePlacer.ts                spatial placement helper
  Data/DeviceTypes.ts            shared Lens data contract and DemoState
  Net/HttpClient.ts              modern internetModule.fetch wrapper
  Services/DeviceDataSourceProvider.ts
                                  single live-vs-demo routing point
  Services/LiveDeviceDataSource.ts
                                  backend REST integration
  Services/MockDeviceDataSource.ts
                                  no-hardware demo behavior
  State/DeviceStore.ts           local device state and typed events
  UI/Theme.ts                    colors, type sizes, severity/priority helpers
  UI/UiBuilders.ts               procedural text, cards, buttons, visual helpers
  Util/NativeLogger.ts           tagged Lens logging
```

## Inspector Inputs

`DeviceListPanel` keeps only the values that are useful to change per scene:

- `Camera Root`
- `Websocket Url`
- HUD font
- device prefabs: phone, laptop, router, indicator, triple monitor
- SFX: list open, button click, placement, open device, analyze
- indicator material
- shell terminal prefab
- notebook prefab

Layout calibration values are now baked into code constants so the Inspector stays clean during judging.

`MainMenuController` keeps:

- `Camera Root`
- `Device List Panel`
- ESP32 prefab
- click/scanning audio
- Demo Mode toggle prefab

The old unused world-scanner script/input was removed.

## Project Structure

```text
Frontend/
  README.md
  Spectacles-Sample/             Snap reference projects for best practices
  snap-spectacles/
    snap-spectacles.esproj
    .gitattributes               Lens Studio Git LFS rules
    Assets/
      Scripts/                   Lens TypeScript source
      Materials/                 hologram and UI materials
      Audio/                     UI feedback sounds
      Prefabs/                   device/UI prefabs
```

## Testing Checklist

- In Preview, keep `DEMO MODE` on and confirm the device list opens.
- Select a demo device and place its model in the scene.
- Tap `ANALYZE` and verify the Action Items plus `FIX` buttons appear.
- Tap a port or threat panel and confirm the notebook shows specific backend/offline learning text.
- Turn Demo Mode off only when the backend URL points to a running backend.
- On device, use a LAN IP for the backend and verify `SCAN` reaches SPECTER.

## Design Notes

The Lens is intentionally not a flat dashboard. The visual language is holographic and spatial: devices are anchored in the world, analysis appears as an in-scene diagnostic surface, and learning happens as a physical notebook.
