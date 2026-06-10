# The Underlayer — Firmware (Specter)

ESP32 chest-mounted scanner. Scans for BLE devices nearby, matches them against known hosts, then POSTs the result to `ssh_engine.py` on the laptop which performs the actual SSH scan.

## Hardware

| Component | Connection |
|-----------|------------|
| ESP32 (Arduino Nano ESP32 or similar) | — |
| TFT display ST7789 (SPI) | SCK→18, MOSI→23, CS→5, DC→15, RST→4 |
| Modulino Knob (I2C) | SDA→21, SCL→22 |

## Arduino IDE Setup

1. **Board:** Install the `esp32` board package (Espressif) via Board Manager
2. **Partition scheme:** Tools → Partition Scheme → **Huge APP (3MB No OTA)**
   *(required — the BLE + TFT libraries won't fit otherwise)*
3. **Libraries** (install via Library Manager):
   - `Adafruit ST7789`
   - `Adafruit GFX Library`
   - `Modulino` (Arduino_Modulino)
   - `ESP32 BLE Arduino` (included with the esp32 board package)

## Configuration

Open `Firmware.ino` and edit the top section:

```cpp
// WiFi
const char* WIFI_SSID = "your_network";
const char* WIFI_PASS = "your_password";

// Backend — set to the laptop's LAN IP running ssh_engine.py
const char* BACKEND_HOST = "10.0.0.x";
const int   BACKEND_PORT = 8001;
```

> `BACKEND_PORT 8001` is the port `ssh_engine.py` listens on (separate from the FastAPI server on 8000).

## How It Works

1. On boot, connects to WiFi and displays status on the TFT
2. Continuously BLE-scans for `SCAN_SECS` seconds
3. Collects nearby device names + MAC addresses
4. POSTs the list to `http://<BACKEND_HOST>:<BACKEND_PORT>/api/bluetooth/scan`
5. `ssh_engine.py` matches BLE names against `data/hosts.json`, SSH-scans matched hosts, then relays results to the FastAPI server

## Flash

Connect ESP32 via USB, select the correct COM port in Arduino IDE, and click **Upload**.
