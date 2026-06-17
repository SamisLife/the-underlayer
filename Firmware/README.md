# Firmware — SPECTER

The ESP32 sketch that powers the SPECTER handheld scanner. It runs a Bluetooth Low Energy sweep, displays results on a 240x320 TFT screen, and POSTs the device list to `ssh_engine` over WiFi.

Source file: `Firmware.ino`

---

## Hardware

| Component | Part | Notes |
|---|---|---|
| Microcontroller | ESP32 Dev Module | Any standard 30-pin ESP32 board works |
| Display | Adafruit ST7789 (240x320) | SPI interface |
| Input | Modulino Knob | I2C rotary encoder from Arduino |

---

## Wiring

### TFT Display (SPI)

| TFT Pin | Color (ribbon) | ESP32 GPIO |
|---|---|---|
| VCC | Green | 3.3V |
| GND | Brown | GND |
| SCL (clock) | Yellow | GPIO 18 (SPI SCK) |
| SDA (data) | Green | GPIO 23 (SPI MOSI) |
| CS | White | GPIO 5 |
| DC | Purple | GPIO 15 |
| RST | Blue | GPIO 4 |

### Modulino Knob (I2C)

| Knob Pin | ESP32 GPIO |
|---|---|
| 3V3 | 3.3V |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

---

## Arduino IDE Setup

### 1. Install the ESP32 board package

In Arduino IDE: `File > Preferences > Additional Board Manager URLs`, add:

```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

Then open `Tools > Board > Board Manager`, search for **esp32** (by Espressif Systems), and install it.

### 2. Select the correct board and partition scheme

- `Tools > Board > ESP32 Arduino > ESP32 Dev Module`
- `Tools > Partition Scheme > Huge APP (3MB No OTA/1MB SPIFFS)`

The sketch uses NimBLE for BLE and includes several large libraries. Without the Huge APP partition scheme, the firmware will not fit and the upload will fail.

### 3. Install libraries

Open `Tools > Manage Libraries` and install each of these:

| Library | Author | Notes |
|---|---|---|
| `Adafruit ST7789` | Adafruit | TFT driver |
| `Adafruit GFX Library` | Adafruit | Graphics primitives — required by ST7789 |
| `Arduino_Modulino` | Arduino | Modulino Knob I2C support |
| `NimBLE-Arduino` | h2zero | Lighter BLE stack for ESP32 |

The `WiFi`, `HTTPClient`, and `WebServer` libraries come bundled with the ESP32 board package — no separate install needed.

---

## Configuration

Open `Firmware.ino` and update the three constants near the top before flashing:

```cpp
// WiFi network the SPECTER should join
const char* WIFI_SSID = "your-network-name";
const char* WIFI_PASS = "your-network-password";

// LAN IP of the machine running ssh_engine (port 8001)
const char* BACKEND_HOST = "192.168.1.100";
```

`BACKEND_HOST` must be the local IP of the laptop running `ssh_engine.py`. SPECTER always calls port 8001, which is not tunneled — both devices must be on the same WiFi network.

---

## Flashing

1. Connect the ESP32 via USB.
2. Select the correct port: `Tools > Port > COMx` (Windows) or `/dev/tty.usbserial-...` (macOS/Linux).
3. Click **Upload** (or `Ctrl+U`).
4. Hold the ESP32's BOOT button during the first few seconds of upload if the chip does not enter download mode automatically.

Upload speed: 921600 baud works on most boards. Drop to 460800 if you get frequent upload failures.

---

## UI Flow

SPECTER boots into a simple state machine displayed on the TFT:

```
[WiFi] → [Target Selection] → [Range Selection] → [Scan Ready] → [Scanning] → [Posting] → [Results]
```

| Screen | What it does |
|---|---|
| WiFi | Connects to the configured network. Shows countdown timer. Press knob to skip and scan offline. |
| Target Selection | Choose device categories to focus on: All, Cameras, Computers, Phones, Wearables, IoT, Access Points. |
| Range | Set the RSSI-based distance threshold: 5, 10, 25, 50, or 100 meters. |
| Scan Ready | Review your settings. Rotate knob between SCAN and BACK. |
| Scanning | 3-second BLE sweep. Shows live count of found devices and a progress bar. Press knob to stop early. |
| Posting | Sends the device list to `ssh_engine`. Shows recognized count and SSH queue count from the response. |
| Results | Scrollable list of found devices. Green strip = SSH-capable, cyan strip = recognized host. RSSI shown per device in color. Press knob to scan again. |

---

## What SPECTER Sends

SPECTER POSTs a JSON payload to `http://<BACKEND_HOST>:8001/api/bluetooth/scan`:

```json
{
  "scanner_id": "specter-01",
  "devices": [
    { "name": "my-laptop",   "mac": "AA:BB:CC:DD:EE:FF", "rssi": -54 },
    { "name": "(Apple)",     "mac": "11:22:33:44:55:66", "rssi": -72 },
    { "name": "(unknown)",   "mac": "77:88:99:AA:BB:CC", "rssi": -81 }
  ]
}
```

Devices with no advertised name are identified by Bluetooth manufacturer company ID when possible: `0x004C` maps to `(Apple)`, `0x0006` to `(Microsoft)`, `0x00E0` to `(Google)`.

The response tells SPECTER which devices were recognized (matched against `hosts.json`) and which are queued for SSH scanning. The results screen uses this to apply color-coded status strips.

![SPECTER full workflow demo](../Images/hardware_full_demo.gif)

---

## Web Server (Triggered Scans)

Once WiFi connects, SPECTER also starts a lightweight HTTP server on port 80. This allows the relay backend to trigger a scan remotely:

```
POST http://<specter-ip>/api/scan
```

The relay registers SPECTER's IP when it connects (`GET /api/scanner/register`) and can use it to request a fresh sweep without requiring the user to press the knob.

---

## Troubleshooting

**TFT shows nothing / is white or black:**
Check SPI wiring, especially the DC and CS pins. Confirm `tft.init(240, 320)` matches your display's actual resolution.

**Knob does not respond:**
Run the I2C scanner printed to Serial on boot — it lists found addresses. The Modulino Knob should appear at `0x76`. If missing, check SDA/SCL wiring and that 3.3V is connected, not 5V.

**WiFi times out:**
SPECTER allows 15 seconds to connect. If it consistently times out, verify the SSID and password are correct in the sketch and that the ESP32 is within range.

**POST fails / backend unreachable:**
Confirm `BACKEND_HOST` is the correct LAN IP of the machine running `ssh_engine`. If the laptop's IP changed (DHCP), update the constant and reflash. A fixed LAN IP on the laptop avoids this entirely.

**Sketch too large / won't upload:**
Confirm partition scheme is set to `Huge APP (3MB No OTA)`. This is required — the default partition will not fit the sketch.
