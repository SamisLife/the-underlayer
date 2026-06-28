// =====================================================================
//  SPECTER75 — BLE scanner + TFT UI + WiFi + HTTP POST to backend
//
//  Wiring
//  TFT ST7789 (SPI):           Modulino Knob (I2C):
//    VCC (Green)  → 3.3V                 3V3  → 3.3V
//    GND (Brown)  → GND                  GND  → GND
//    SCL (Yellow)  → GPIO 18 (SPI SCK)    SDA  → GPIO 21
//    SDA (Green)  → GPIO 23 (SPI MOSI)   SCL  → GPIO 22
//    CS (White)   → GPIO 5
//    DC (Purple)   → GPIO 15
//    RST (Blue)  → GPIO 4
//
//  Libraries:
//    Adafruit ST7789 · Adafruit GFX · Modulino / Arduino_Modulino
//    NimBLE-Arduino (install via Library Manager — replaces ESP32 BLE Arduino)
//
//  Partition scheme: Tools → Partition Scheme z Huge APP (3MB No OTA)
// =====================================================================

#include <Wire.h>
#include <SPI.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Modulino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <NimBLEDevice.h>
#include <NimBLEScan.h>
#include <NimBLEAdvertisedDevice.h>

// ── WiFi credentials ─────────────────────────────────────────────────
const char* WIFI_SSID = "WIFI_SSID";
const char* WIFI_PASS = "WIFI_PASS";

// ── Backend endpoint (unified Underlayer server, app.main) ───────────
const char* BACKEND_HOST = "IP_ADDRESS";   // ← set to your laptop's LAN IP
const int   BACKEND_PORT = 8000;           // relay + SSH engine now share one port

// ── Timing constants ──────────────────────────────────────────────────
const unsigned long WIFI_TIMEOUT_MS    = 15000;
const unsigned long WIFI_SUCCESS_DELAY =  1500;
const unsigned long WIFI_FAIL_DELAY    =  2500;
const unsigned long POST_RESULT_DELAY  =  2500;

// ── Pin definitions ───────────────────────────────────────────────────
#define I2C_SDA  21
#define I2C_SCL  22
#define SPI_SCK  18
#define SPI_MOSI 23
#define SPI_MISO 19
#define TFT_CS    5
#define TFT_DC   15
#define TFT_RST   4

Adafruit_ST7789 tft(TFT_CS, TFT_DC, TFT_RST);
ModulinoKnob    knob;

// ── Range selector ────────────────────────────────────────────────────
const int rangeValues[] = {5, 10, 25, 50, 100};
const int RANGE_COUNT   = sizeof(rangeValues) / sizeof(rangeValues[0]);
int rangeIndex = 2;
volatile int currentMinRssi = -110;

// ── Backend POST state (hoisted; full block below with other post globals) ──
bool postStarted = false;
bool postDone    = false;

// ── BLE scanner ───────────────────────────────────────────────────────
const int SCAN_SECS = 3;
const int MAX_FOUND = 40;

struct FoundDevice {
  char name[32];
  char mac[18];
  int  rssi;
  bool recognized;  // backend matched this device against hosts.json
  bool sshCapable;  // backend confirmed can_ssh=true for this device
};

FoundDevice      foundDevices[MAX_FOUND];
volatile int     foundCount  = 0;
volatile bool    scanRunning = false;
volatile bool    scanDone    = false;
NimBLEScan*      pBLEScan    = nullptr;

// NimBLE 2.x: NimBLEScanCallbacks replaces NimBLEAdvertisedDeviceCallbacks.
// onScanEnd() absorbs the old standalone scan-complete function pointer.
class ScanCallback : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* dev) override {
    if (dev->getRSSI() < currentMinRssi) return;
    if (foundCount >= MAX_FOUND) return;

    // Build uppercased MAC on the stack — no heap allocation for the dedup
    // check, which fires for every advertisement (hundreds in crowded spaces).
    const char* rawMac = dev->getAddress().toString().c_str();
    char macUpper[18];
    int j = 0;
    for (int i = 0; rawMac[i] && j < 17; i++)
      macUpper[j++] = toupper((unsigned char)rawMac[i]);
    macUpper[j] = '\0';

    for (int i = 0; i < foundCount; i++) {
      if (strcasecmp(foundDevices[i].mac, macUpper) == 0) return;
    }

    FoundDevice& fd = foundDevices[foundCount];
    strncpy(fd.mac, macUpper, sizeof(fd.mac));
    fd.mac[sizeof(fd.mac) - 1] = '\0';

    // Name / manufacturer lookup — String is acceptable here because we only
    // reach this branch when we are actually storing the device (< MAX_FOUND).
    String nm = dev->getName().c_str();
    if (nm.length() == 0 && dev->haveManufacturerData()) {
      // Identify by manufacturer company ID when name is not advertised
      std::string mfr = dev->getManufacturerData();
      if (mfr.length() >= 2) {
        uint16_t company = (uint8_t)mfr[0] | ((uint16_t)(uint8_t)mfr[1] << 8);
        if      (company == 0x004C) nm = "(Apple)";
        else if (company == 0x0006) nm = "(Microsoft)";
        else if (company == 0x00E0) nm = "(Google)";
      }
    }
    if (nm.length() == 0) nm = "(unknown)";
    nm.toCharArray(fd.name, sizeof(fd.name));

    fd.rssi       = dev->getRSSI();
    fd.recognized = false;
    fd.sshCapable = false;
    foundCount++;
  }

  void onScanEnd(const NimBLEScanResults& /*results*/, int /*reason*/) override {
    scanRunning = false;
    scanDone    = true;
  }
};

ScanCallback scanCB;

void initBLEScan() {
  NimBLEDevice::init("SPECTER");
  pBLEScan = NimBLEDevice::getScan();
  // wantDuplicates=true: every advertisement fires our callback; NimBLE does no
  // internal dedup (which would require heap), so our onResult() dedup runs.
  pBLEScan->setScanCallbacks(&scanCB, /*wantDuplicates=*/true);
  // CRITICAL: store zero results internally — callback only, no internal map growth.
  pBLEScan->setMaxResults(0);
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);
}

void startBLEScan() {
  if (rangeValues[rangeIndex] == 5) currentMinRssi = -60;
  else if (rangeValues[rangeIndex] == 10) currentMinRssi = -70;
  else if (rangeValues[rangeIndex] == 25) currentMinRssi = -80;
  else if (rangeValues[rangeIndex] == 50) currentMinRssi = -90;
  else currentMinRssi = -110;

  // Re-init BLE if it was deinited after a previous scan to free heap.
  if (pBLEScan == nullptr) initBLEScan();

  foundCount   = 0;
  scanDone     = false;
  scanRunning  = true;
  postStarted  = false;   // reset POST state for each new scan cycle
  postDone     = false;
  pBLEScan->clearResults();
  pBLEScan->start(SCAN_SECS * 1000, /*isContinue=*/false); // NimBLE 2.x uses ms, not s
}

// ── WiFi state ────────────────────────────────────────────────────────
bool          wifiDone      = false;
bool          wifiConnected = false;
unsigned long wifiStartMs   = 0;
unsigned long wifiResultMs  = 0;

void startWifiConnect() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiDone = true; wifiConnected = true; wifiResultMs = millis();
    return;
  }
  wifiDone = false; wifiConnected = false;
  wifiStartMs = millis();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

WebServer server(80);

void handleApiScan(); // Forward declaration

// ── Backend POST ──────────────────────────────────────────────────────
// postStarted / postDone declared above (before BLE scanner) to satisfy
// the forward reference in startBLEScan().
bool postSuccess    = false;
int  postRecognized = 0;
int  postSshQueued  = 0;
unsigned long postResultMs = 0;

String escapeName(const char* s) {
  String out;
  out.reserve(strlen(s) + 5);
  for (int i = 0; s[i]; i++) {
    char c = s[i];
    if      (c == '"')  out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else                out += c;
  }
  return out;
}

String buildScanPayload() {
  String j;
  j.reserve(4096);
  j = "{\"scanner_id\":\"underlayer-01\",\"devices\":[";
  for (int i = 0; i < (int)foundCount; i++) {
    if (i > 0) j += ",";
    j += "{\"name\":\"" + escapeName(foundDevices[i].name) + "\",";
    j += "\"mac\":\"" + String(foundDevices[i].mac) + "\",";
    j += "\"rssi\":" + String(foundDevices[i].rssi) + "}";
  }
  j += "]}";
  return j;
}

int extractJsonInt(const String& json, const char* key) {
  String k = "\"" + String(key) + "\":";
  int idx = json.indexOf(k);
  return (idx >= 0) ? json.substring(idx + k.length()).toInt() : 0;
}

// Reads recognized/ssh_capable per device from the backend response.
// Response devices[] order matches the order we sent — index-aligned.
void parsePerDeviceRecognition(const String& resp) {
  int start = resp.indexOf("\"devices\":[");
  if (start < 0) return;
  int pos = start + 11;
  int devIdx = 0;
  while (devIdx < (int)foundCount) {
    int o = resp.indexOf('{', pos);
    if (o < 0) break;
    int e = resp.indexOf('}', o);
    if (e < 0) break;
    String obj = resp.substring(o, e + 1);
    foundDevices[devIdx].recognized = obj.indexOf("\"recognized\":true")  >= 0;
    foundDevices[devIdx].sshCapable = obj.indexOf("\"ssh_capable\":true") >= 0;
    pos = e + 1;
    devIdx++;
  }
}

void doBackendPost() {
  postDone       = true;
  postSuccess    = false;
  postRecognized = 0;
  postSshQueued  = 0;

  if (!wifiConnected) return;
  if (foundCount == 0) { postSuccess = true; return; }

  HTTPClient http;
  String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/bluetooth/scan";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  String payload = buildScanPayload();
  int code = http.POST(payload);

  if (code == 200) {
    postSuccess = true;
    String resp = http.getString();
    postRecognized = extractJsonInt(resp, "recognized");
    postSshQueued  = extractJsonInt(resp, "ssh_queued");
    parsePerDeviceRecognition(resp);
    Serial.printf("POST ok — recognized=%d  ssh_queued=%d\n", postRecognized, postSshQueued);
  } else {
    Serial.printf("POST failed — HTTP %d\n", code);
  }

  http.end();
}

// ── Screen states ─────────────────────────────────────────────────────
enum ScreenState {
  SCREEN_WIFI,
  SCREEN_TARGETS,
  SCREEN_RANGE,
  SCREEN_SCAN_READY,
  SCREEN_SCANNING,
  SCREEN_WIFI_SCAN,   // async WiFi scan in progress (after BLE completes)
  SCREEN_POSTING,
  SCREEN_RESULTS
};

ScreenState screen = SCREEN_WIFI;

// ── Target selector ───────────────────────────────────────────────────
const char* targetLabels[] = {
  "All devices",
  "Security cameras",
  "Computers",
  "Phones",
  "Wearables",
  "IoT sensors",
  "Access points",
  "Next"
};
const int TARGET_COUNT    = 7;
const int TARGET_NEXT_ROW = 7;
bool targetSelected[TARGET_COUNT] = {true, true, true, true, true, true, true};

// ── UI state ──────────────────────────────────────────────────────────
int  selectedRow  = 0;
int  scanAction   = 0;
int  resultOffset = 0;

int           lastPosition  = 0;
bool          lastPressed   = false;
unsigned long scanStartedMs = 0;
unsigned long lastDrawMs    = 0;

// ── Colour palette ────────────────────────────────────────────────────
const uint16_t C_BG      = 0x0841;
const uint16_t C_PANEL   = 0x18E3;
const uint16_t C_PANEL_2 = 0x2124;
const uint16_t C_TEXT    = ST77XX_WHITE;
const uint16_t C_MUTED   = 0x9CD3;
const uint16_t C_ACCENT  = ST77XX_CYAN;
const uint16_t C_GREEN   = 0x07E0;
const uint16_t C_AMBER   = 0xFDC0;
const uint16_t C_RED     = 0xF800;

// ── Display helpers ───────────────────────────────────────────────────
int screenW() { return tft.width();  }
int screenH() { return tft.height(); }

void setText(uint16_t color, uint8_t size = 1) {
  tft.setTextColor(color);
  tft.setTextSize(size);
}

void printCentered(const String& text, int y, uint8_t size = 1,
                   uint16_t color = C_TEXT) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  tft.setCursor((screenW() - w) / 2, y);
  tft.setTextColor(color);
  tft.print(text);
}

void drawFrame(const char* title, const char* subtitle) {
  tft.fillScreen(C_BG);
  tft.fillRect(0, 0, screenW(), 34, ST77XX_BLACK);
  tft.drawFastHLine(0, 34, screenW(), C_ACCENT);
  setText(C_ACCENT, 2);
  tft.setCursor(12, 8);
  tft.print("UNDERLAYER");
  setText(C_MUTED, 1);
  tft.setCursor(218, 9);
  tft.print(title);
  tft.setCursor(218, 20);
  tft.print(subtitle);
  tft.fillCircle(300, 17, 5, wifiConnected ? C_GREEN : C_AMBER);
}

void drawFooter(const char* left, const char* right) {
  tft.drawFastHLine(0, 220, screenW(), C_PANEL_2);
  setText(C_MUTED, 1);
  tft.setCursor(12, 228);
  tft.print(left);
  tft.setCursor(226, 228);
  tft.print(right);
}

void drawCheckBox(int x, int y, bool checked, bool active) {
  uint16_t color = active ? C_ACCENT : C_MUTED;
  tft.drawRect(x, y, 16, 16, color);
  if (checked) tft.fillRect(x + 4, y + 4, 8, 8, active ? C_ACCENT : C_GREEN);
}

// ── Target screen ─────────────────────────────────────────────────────
void drawTargetRow(int y, int row, bool active) {
  bool isNext = (row == TARGET_NEXT_ROW);
  if (active) {
    tft.fillRoundRect(14, y - 4, 292, 28, 5, C_PANEL_2);
    tft.drawRoundRect(14, y - 4, 292, 28, 5, C_ACCENT);
  }
  if (isNext) {
    setText(active ? C_ACCENT : C_TEXT, 2);
    tft.setCursor(38, y);
    tft.print("Continue to range");
    tft.fillTriangle(286, y + 5, 276, y, 276, y + 10, active ? C_ACCENT : C_MUTED);
    return;
  }
  drawCheckBox(28, y, targetSelected[row], active);
  setText(active ? C_TEXT : C_MUTED, 2);
  tft.setCursor(56, y);
  tft.print(targetLabels[row]);
}

int selectedTargetCount() {
  int count = 0;
  for (int i = 1; i < TARGET_COUNT; i++) if (targetSelected[i]) count++;
  return count;
}

String targetSummary() {
  if (targetSelected[0]) return "All devices";
  int count = selectedTargetCount();
  if (count == 0) return "None";
  if (count == 1) {
    for (int i = 1; i < TARGET_COUNT; i++)
      if (targetSelected[i]) return String(targetLabels[i]);
  }
  return String(count) + " categories";
}

void drawTargetsScreen() {
  drawFrame("TARGETS", "choose profile");
  int first = selectedRow - 2;
  if (first < 0) first = 0;
  if (first > TARGET_NEXT_ROW - 4) first = TARGET_NEXT_ROW - 4;
  for (int i = 0; i < 5; i++) {
    int row = first + i;
    drawTargetRow(54 + i * 34, row, row == selectedRow);
  }
  drawFooter("ROTATE: move", "CLICK: select");
}

// ── Range screen ──────────────────────────────────────────────────────
void drawRangeScreen() {
  drawFrame("RANGE", "meters");
  tft.fillRoundRect(16, 52, 132, 142, 8, C_PANEL);
  tft.drawRoundRect(16, 52, 132, 142, 8, C_PANEL_2);
  setText(C_ACCENT, 5);
  tft.setCursor(34, 84);
  tft.print(rangeValues[rangeIndex]);
  setText(C_TEXT, 3);
  tft.setCursor(94, 108);
  tft.print("m");
  tft.fillRoundRect(174, 52, 146, 142, 8, C_PANEL);
  setText(C_MUTED, 1);
  tft.setCursor(190, 70);
  tft.print("TARGET PROFILE");
  setText(C_TEXT, 2);
  tft.setCursor(190, 92);
  tft.print(targetSummary());
  setText(C_MUTED, 1);
  tft.setCursor(190, 142);
  tft.print("SCAN ENVELOPE");
  int barX = 190, barY = 162, barW = 92;
  tft.drawRect(barX, barY, barW, 10, C_MUTED);
  int fillW = map(rangeIndex, 0, RANGE_COUNT - 1, 8, barW - 2);
  tft.fillRect(barX + 1, barY + 1, fillW, 8, C_ACCENT);
  drawFooter("ROTATE: adjust", "CLICK: plan");
}

// ── Scan-ready screen ─────────────────────────────────────────────────
void drawButton(int x, int y, int w, const char* label, bool active) {
  uint16_t fill = active ? C_ACCENT : C_PANEL;
  uint16_t text = active ? ST77XX_BLACK : C_TEXT;
  tft.fillRoundRect(x, y, w, 44, 7, fill);
  tft.drawRoundRect(x, y, w, 44, 7, active ? C_TEXT : C_PANEL_2);
  int16_t x1, y1; uint16_t tw, th;
  tft.setTextSize(2);
  tft.getTextBounds(label, 0, 0, &x1, &y1, &tw, &th);
  tft.setCursor(x + (w - tw) / 2, y + 14);
  tft.setTextColor(text);
  tft.print(label);
}

void drawScanReadyScreen() {
  drawFrame("PLAN", "ready");
  tft.fillRoundRect(16, 52, 178, 142, 8, C_PANEL);
  setText(C_MUTED, 1);
  tft.setCursor(32, 70);
  tft.print("TARGETS");
  setText(C_TEXT, 2);
  tft.setCursor(32, 90);
  tft.print(targetSummary());
  setText(C_MUTED, 1);
  tft.setCursor(32, 132);
  tft.print("RANGE");
  setText(C_ACCENT, 3);
  tft.setCursor(32, 150);
  tft.print(rangeValues[rangeIndex]);
  tft.print("m");
  drawButton(214, 64, 92, "SCAN", scanAction == 0);
  drawButton(214, 128, 92, "BACK", scanAction == 1);
  drawFooter("ROTATE: option", "CLICK: confirm");
}

// ── Scanning screen ───────────────────────────────────────────────────
void drawScanningScreen() {
  unsigned long elapsed = millis() - scanStartedMs;
  int progress = min(100, (int)(elapsed * 100UL / (SCAN_SECS * 1000UL)));
  int dots     = (elapsed / 400) % 4;

  char sub[12];
  snprintf(sub, sizeof(sub), "%d found", (int)foundCount);
  drawFrame("ACTIVE", sub);

  String label = "SCANNING";
  for (int i = 0; i < dots; i++) label += '.';
  printCentered(label, 60, 3, C_ACCENT);

  setText(C_TEXT, 2);
  tft.setCursor(42, 106);
  tft.print("Found: ");
  tft.print((int)foundCount);
  tft.print((int)foundCount == 1 ? " device" : " devices");

  setText(C_MUTED, 1);
  tft.setCursor(42, 134);
  tft.print("Profile: ");
  tft.print(targetSummary());
  tft.setCursor(42, 148);
  tft.print("Range: ");
  tft.print(rangeValues[rangeIndex]);
  tft.print("m");

  tft.drawRoundRect(42, 168, 236, 18, 5, C_MUTED);
  int barFill = map(progress, 0, 100, 0, 230);
  if (barFill > 0)
    tft.fillRoundRect(45, 171, barFill, 12, 4, C_ACCENT);

  drawFooter("BLE  5s", "CLICK: stop");
}

// ── WiFi screen ───────────────────────────────────────────────────────
void drawWifiScreen() {
  unsigned long elapsed = millis() - wifiStartMs;
  int dots = (elapsed / 400) % 4;

  const char* sub = !wifiDone ? "connecting" : (wifiConnected ? "connected" : "failed");
  drawFrame("WIFI", sub);

  setText(C_MUTED, 1);
  tft.setCursor(20, 50);
  tft.print("NETWORK");
  setText(C_TEXT, 2);
  tft.setCursor(20, 64);
  String ssid = String(WIFI_SSID);
  if (ssid.length() > 18) ssid = ssid.substring(0, 17) + "~";
  tft.print(ssid);

  setText(C_MUTED, 1);
  tft.setCursor(20, 100);
  tft.print("STATUS");

  if (!wifiDone) {
    String s = "Connecting";
    for (int i = 0; i < dots; i++) s += '.';
    setText(C_AMBER, 2);
    tft.setCursor(20, 114);
    tft.print(s);

    int prog = min(100, (int)(elapsed * 100UL / WIFI_TIMEOUT_MS));
    tft.drawRoundRect(20, 166, 238, 14, 4, C_MUTED);
    if (prog > 0)
      tft.fillRoundRect(22, 168, map(prog, 0, 100, 0, 234), 10, 3, C_AMBER);

    setText(C_MUTED, 1);
    tft.setCursor(20, 188);
    int secs = max(0, (int)((WIFI_TIMEOUT_MS - elapsed) / 1000));
    tft.print("Timeout in ");
    tft.print(secs);
    tft.print("s");

  } else if (wifiConnected) {
    setText(C_GREEN, 2);
    tft.setCursor(20, 114);
    tft.print("Connected!");

    setText(C_MUTED, 1);
    tft.setCursor(20, 146);
    tft.print("IP ADDRESS");
    setText(C_TEXT, 2);
    tft.setCursor(20, 160);
    tft.print(WiFi.localIP().toString());

    setText(C_MUTED, 1);
    tft.setCursor(20, 194);
    tft.print("Posting scan to backend...");

  } else {
    setText(C_RED, 2);
    tft.setCursor(20, 114);
    wl_status_t st = WiFi.status();
    if      (st == WL_NO_SSID_AVAIL)  tft.print("Network not found");
    else if (st == WL_CONNECT_FAILED) tft.print("Wrong password");
    else                              tft.print("Timed out");

    setText(C_MUTED, 1);
    tft.setCursor(20, 150);
    tft.print("Scanning without backend");

    setText(C_AMBER, 1);
    tft.setCursor(20, 194);
    tft.print("Opening results...");
  }

  drawFooter("CLICK: skip", "");
}

// ── WiFi-scan overlay (shown between BLE done and HTTP POST) ──────────
void drawWifiScanScreen() {
  char sub[12];
  snprintf(sub, sizeof(sub), "%d found", (int)foundCount);
  drawFrame("WIFI SCAN", sub);
  printCentered("Scanning WiFi...", 110, 2, C_AMBER);
  drawFooter("", "CLICK: skip");
}

// ── Posting screen ────────────────────────────────────────────────────
void drawPostingScreen() {
  const char* sub = postDone ? (postSuccess ? "sent" : "error") : "sending";
  drawFrame("BACKEND", sub);

  setText(C_MUTED, 1);
  tft.setCursor(20, 46);
  tft.print("ENDPOINT");
  setText(C_TEXT, 1);
  tft.setCursor(20, 58);
  tft.print(String(BACKEND_HOST) + ":" + BACKEND_PORT);

  if (!postDone) {
    printCentered("Sending to backend", 84, 2, C_AMBER);
    setText(C_TEXT, 2);
    tft.setCursor(60, 130);
    tft.print(String((int)foundCount));
    setText(C_MUTED, 2);
    tft.print((int)foundCount == 1 ? " device" : " devices");

  } else if (postSuccess) {
    printCentered("Delivered!", 80, 2, C_GREEN);

    setText(C_MUTED, 1);
    tft.setCursor(44, 120);
    tft.print("RECOGNIZED");
    setText(C_TEXT, 3);
    tft.setCursor(44, 134);
    tft.print(postRecognized);

    setText(C_MUTED, 1);
    tft.setCursor(172, 120);
    tft.print("SSH QUEUED");
    setText(C_ACCENT, 3);
    tft.setCursor(172, 134);
    tft.print(postSshQueued);

    setText(C_MUTED, 1);
    tft.setCursor(20, 190);
    tft.print("Opening results...");

  } else {
    printCentered("Failed", 80, 2, C_RED);
    setText(C_MUTED, 1);
    tft.setCursor(20, 128);
    if (!wifiConnected) {
      tft.print("No WiFi connection");
    } else {
      tft.print("Backend unreachable");
      tft.setCursor(20, 146);
      tft.print(String(BACKEND_HOST) + ":" + BACKEND_PORT);
    }
    setText(C_AMBER, 1);
    tft.setCursor(20, 190);
    tft.print("Showing results anyway...");
  }

  drawFooter("CLICK: skip", "");
}

// ── Results screen ────────────────────────────────────────────────────
const int RESULT_ROWS = 5;

void drawResultsScreen() {
  char sub[12];
  snprintf(sub, sizeof(sub), "%d found", (int)foundCount);
  drawFrame("RESULTS", sub);

  if (foundCount == 0) {
    printCentered("No devices found", 110, 2, C_MUTED);
    drawFooter("", "CLICK: scan again");
    return;
  }

  const int rowH = 32, yBase = 46;
  for (int i = 0; i < RESULT_ROWS; i++) {
    int idx = resultOffset + i;
    if (idx >= (int)foundCount) break;

    FoundDevice& fd = foundDevices[idx];
    int y = yBase + i * rowH;
    tft.fillRoundRect(10, y, 300, rowH - 3, 4, C_PANEL);

    // 4px left strip: green=SSH, cyan=recognised host, none=unknown
    if      (fd.sshCapable) tft.fillRect(10, y, 4, rowH - 3, C_GREEN);
    else if (fd.recognized) tft.fillRect(10, y, 4, rowH - 3, C_ACCENT);

    uint16_t rssiColor = (fd.rssi > -60) ? C_GREEN
                       : (fd.rssi > -75) ? C_AMBER
                       :                   C_RED;

    // Device name (shift right 2px to clear strip)
    setText(C_TEXT, 1);
    tft.setCursor(18, y + 4);
    String nm = String(fd.name);
    if (nm.length() > 22) nm = nm.substring(0, 21) + "~";
    tft.print(nm);

    // Recognition tag top-right
    if (fd.sshCapable) {
      setText(C_GREEN, 1);
      tft.setCursor(262, y + 4);
      tft.print("SSH");
    } else if (fd.recognized) {
      setText(C_ACCENT, 1);
      tft.setCursor(252, y + 4);
      tft.print("HOST");
    }

    // MAC suffix + RSSI on second line
    setText(C_MUTED, 1);
    tft.setCursor(18, y + 16);
    tft.print(String(fd.mac).substring(9));

    setText(rssiColor, 1);
    tft.setCursor(256, y + 16);
    tft.print(fd.rssi);
  }

  char scrollBuf[20] = "";
  if ((int)foundCount > RESULT_ROWS)
    snprintf(scrollBuf, sizeof(scrollBuf), "%d/%d", resultOffset + 1, (int)foundCount);
  drawFooter(scrollBuf, "CLICK: rescan");
}

// ── Input handlers ────────────────────────────────────────────────────
void toggleTarget(int row) {
  if (row == 0) {
    bool next = !targetSelected[0];
    for (int i = 0; i < TARGET_COUNT; i++) targetSelected[i] = next;
    return;
  }
  targetSelected[row] = !targetSelected[row];
  bool allOn = true;
  for (int i = 1; i < TARGET_COUNT; i++)
    if (!targetSelected[i]) { allOn = false; break; }
  targetSelected[0] = allOn;
}

void handleRotation(int direction) {
  if (screen == SCREEN_TARGETS) {
    selectedRow += direction;
    if (selectedRow < 0)               selectedRow = TARGET_NEXT_ROW;
    if (selectedRow > TARGET_NEXT_ROW) selectedRow = 0;
  } else if (screen == SCREEN_RANGE) {
    rangeIndex = constrain(rangeIndex + direction, 0, RANGE_COUNT - 1);
  } else if (screen == SCREEN_SCAN_READY) {
    scanAction = 1 - scanAction;
  } else if (screen == SCREEN_RESULTS) {
    int maxOff = max(0, (int)foundCount - RESULT_ROWS);
    resultOffset = constrain(resultOffset + direction, 0, maxOff);
  }
}

void handleClick() {
  if (screen == SCREEN_TARGETS) {
    if (selectedRow == TARGET_NEXT_ROW) screen = SCREEN_RANGE;
    else toggleTarget(selectedRow);

  } else if (screen == SCREEN_RANGE) {
    scanAction = 0;
    screen = SCREEN_SCAN_READY;

  } else if (screen == SCREEN_SCAN_READY) {
    if (scanAction == 0) {
      scanStartedMs = millis();
      screen        = SCREEN_SCANNING;
      startBLEScan();
    } else {
      screen = SCREEN_RANGE;
    }

  } else if (screen == SCREEN_SCANNING) {
    // Abort: show whatever was found, skip WiFi and POST
    if (scanRunning) { pBLEScan->stop(); scanRunning = false; }
    screen       = SCREEN_RESULTS;
    resultOffset = 0;

  } else if (screen == SCREEN_WIFI) {
    // Skip: stop connecting, go straight to results (no POST)
    if (!wifiDone) { WiFi.disconnect(); wifiDone = true; wifiConnected = false; }
    screen       = SCREEN_RESULTS;
    resultOffset = 0;

  } else if (screen == SCREEN_POSTING) {
    // Skip waiting for result display
    screen       = SCREEN_RESULTS;
    resultOffset = 0;

  } else if (screen == SCREEN_RESULTS) {
    scanStartedMs = millis();
    resultOffset  = 0;
    screen        = SCREEN_SCANNING;
    startBLEScan();
  }
}

// ── Render dispatch ───────────────────────────────────────────────────
void drawCurrentScreen() {
  switch (screen) {
    case SCREEN_TARGETS:    drawTargetsScreen();   break;
    case SCREEN_RANGE:      drawRangeScreen();     break;
    case SCREEN_SCAN_READY: drawScanReadyScreen(); break;
    case SCREEN_SCANNING:   drawScanningScreen();  break;
    case SCREEN_WIFI_SCAN:  drawWifiScanScreen();  break;
    case SCREEN_WIFI:       drawWifiScreen();      break;
    case SCREEN_POSTING:    drawPostingScreen();   break;
    case SCREEN_RESULTS:    drawResultsScreen();   break;
  }
}

// ── Debug helpers ─────────────────────────────────────────────────────
void scanI2CBus() {
  Serial.println("Scanning I2C bus...");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  I2C device at 0x%02X\n", addr);
      found++;
    }
  }
  if (found == 0) Serial.println("  None found.");
}

void startWiFiScan() {
  Serial.println("Starting async WiFi scan...");
  // Async scan: returns immediately, does not block the loop or trip the WDT.
  WiFi.scanNetworks(/*async=*/true, /*show_hidden=*/true);
}

// Returns true when the scan has results ready; false while still running.
bool collectWiFiScanResults() {
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return false;
  if (n < 0) {
    Serial.println("WiFi scan error or no results.");
    return true;
  }
  for (int i = 0; i < n; ++i) {
    if (WiFi.RSSI(i) < currentMinRssi) continue;
    if (foundCount >= MAX_FOUND) break;
    FoundDevice& fd = foundDevices[foundCount];
    String ssid = WiFi.SSID(i);
    uint8_t* bssid = WiFi.BSSID(i);
    if (ssid.length() == 0) ssid = "(hidden)";
    ssid.toCharArray(fd.name, sizeof(fd.name));
    snprintf(fd.mac, sizeof(fd.mac), "%02X:%02X:%02X:%02X:%02X:%02X",
             bssid[0], bssid[1], bssid[2], bssid[3], bssid[4], bssid[5]);
    fd.rssi = WiFi.RSSI(i);
    fd.recognized = false;
    fd.sshCapable = false;
    foundCount++;
  }
  WiFi.scanDelete();
  Serial.printf("WiFi scan found %d networks. Total devices: %d\n", n, foundCount);
  return true;
}

// ── setup ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  Wire.begin(I2C_SDA, I2C_SCL);
  scanI2CBus();

  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, TFT_CS);
  pinMode(TFT_CS, OUTPUT);
  digitalWrite(TFT_CS, HIGH);

  tft.init(240, 320);
  tft.setRotation(3);
  tft.setTextWrap(false);
  tft.fillScreen(C_BG);

  Modulino.begin();
  knob.begin();
  knob.set(0);
  lastPosition = knob.get();
  lastPressed  = knob.isPressed();

  // BLE init — mirrored in initBLEScan() which is called on subsequent scans
  // after BLEDevice::deinit() frees the Bluedroid heap.
  initBLEScan();

  Serial.println("UNDERLAYER ready. Connecting to WiFi...");
  
  server.on("/api/scan", HTTP_POST, handleApiScan);
  
  startWifiConnect();
  screen = SCREEN_WIFI;
  drawCurrentScreen();
}

void handleApiScan() {
  Serial.println("Received API scan trigger!");
  
  scanAction = 0;
  scanStartedMs = millis();
  screen = SCREEN_SCANNING;
  drawCurrentScreen();
  startBLEScan();

  // Block until BLE scan is done, keeping the UI animated.
  while (scanRunning) {
    if (millis() - lastDrawMs >= 200) {
      drawCurrentScreen();
      lastDrawMs = millis();
    }
    delay(10);
  }

  // BLE done — deinit to free Bluedroid heap before WiFi + HTTP.
  pBLEScan->clearResults();
  NimBLEDevice::deinit(true);
  pBLEScan = nullptr;

  // Block on async WiFi scan.
  startWiFiScan();
  while (!collectWiFiScanResults()) { delay(50); }
  scanDone = false; // consume flag so loop() doesn't double-trigger

  // Post to backend synchronously before responding
  drawCurrentScreen(); // Show scanning UI a bit longer
  doBackendPost();

  // Return success
  String resp = "{\"status\":\"complete\",\"devices_found\":" + String(foundCount) + "}";
  server.send(200, "application/json", resp);

  // Skip POSTING screen since we already did it
  postStarted = false;
  postDone = true;
  screen = SCREEN_RESULTS;
  resultOffset = 0;
  drawCurrentScreen();
}

// ── loop ──────────────────────────────────────────────────────────────
void loop() {
  int  position  = knob.get();
  bool pressed   = knob.isPressed();
  int  delta     = position - lastPosition;
  bool needsDraw = false;

  if (delta != 0) {
    int direction = (delta > 0) ? 1 : -1;
    for (int i = 0; i < abs(delta); i++) handleRotation(direction);
    lastPosition = position;
    needsDraw    = true;
  }

  if (pressed != lastPressed) {
    if (!pressed) { handleClick(); needsDraw = true; }
    lastPressed = pressed;
  }

  // ── SCANNING ─────────────────────────────────────────────────────
  if (screen == SCREEN_SCANNING) {
    // NOTE: Do NOT call pBLEScan->stop() + clearResults() here from the main
    // task. stop() is asynchronous — the BLE FreeRTOS task on Core 0 may still
    // be in onResult() when clearResults() runs, causing heap corruption.
    // The onResult() guard (foundCount >= MAX_FOUND) is sufficient; let the
    // 3-second timer expire naturally so scanCompleteCallback() fires from
    // the BLE task itself, guaranteeing the stack is quiesced before we
    // call clearResults().

    if (scanDone) {
      scanDone = false;
      pBLEScan->clearResults(); // safe: BLE task has fully stopped by this point

      // Deinit BLE to reclaim ~100 KB of Bluedroid heap before WiFi + HTTP.
      // pBLEScan is set to nullptr so startBLEScan() will re-init next time.
      NimBLEDevice::deinit(true);
      pBLEScan = nullptr;

      // Kick off an async WiFi scan; loop() will poll it in SCREEN_WIFI_SCAN.
      startWiFiScan();
      screen    = SCREEN_WIFI_SCAN;
      needsDraw = true;
    } else if (millis() - lastDrawMs >= 200) {
      needsDraw = true;            // keep animation alive
    }
  }

  // ── WIFI SCAN (async, post-BLE) ───────────────────────────────────
  if (screen == SCREEN_WIFI_SCAN) {
    if (collectWiFiScanResults()) {
      screen    = SCREEN_POSTING;
      needsDraw = true;
    } else if (millis() - lastDrawMs >= 300) {
      needsDraw = true; // keep "scanning wifi..." animation alive
    }
  }

  // ── WIFI ──────────────────────────────────────────────────────────
  if (screen == SCREEN_WIFI) {
    if (!wifiDone) {
      wl_status_t st = WiFi.status();
      if (st == WL_CONNECTED) {
        wifiConnected = true;  wifiDone = true;  wifiResultMs = millis();
        
        // Register IP with Backend
        HTTPClient http;
        http.begin(String("http://") + BACKEND_HOST + ":8000/api/scanner/register");
        http.addHeader("Content-Type", "application/json");
        http.POST("{\"ip\":\"" + WiFi.localIP().toString() + "\"}");
        http.end();

        server.begin(); // Start web server
        needsDraw = true;
      } else if (st == WL_NO_SSID_AVAIL || st == WL_CONNECT_FAILED) {
        wifiConnected = false; wifiDone = true;  wifiResultMs = millis();
        needsDraw = true;
      } else if (millis() - wifiStartMs >= WIFI_TIMEOUT_MS) {
        wifiConnected = false; wifiDone = true;  wifiResultMs = millis();
        needsDraw = true;
      } else if (millis() - lastDrawMs >= 300) {
        needsDraw = true;
      }
    } else {
      unsigned long waitMs = wifiConnected ? WIFI_SUCCESS_DELAY : WIFI_FAIL_DELAY;
      if (millis() - wifiResultMs >= waitMs) {
        // Always go to TARGETS after WiFi (connected or failed)
        screen = SCREEN_TARGETS;
        needsDraw = true;
      } else if (millis() - lastDrawMs >= 300) {
        needsDraw = true;
      }
    }
  }

  // ── POSTING ───────────────────────────────────────────────────────
  if (screen == SCREEN_POSTING) {
    if (!postStarted) {
      postStarted = true;
      needsDraw   = true;
    } else if (!postDone) {
      doBackendPost();
      postResultMs = millis();
      needsDraw    = true;
    } else if (millis() - postResultMs >= POST_RESULT_DELAY) {
      screen       = SCREEN_RESULTS;
      resultOffset = 0;
      needsDraw    = true;
    } else if (millis() - lastDrawMs >= 300) {
      needsDraw = true;
    }
  }

  if (needsDraw) {
    drawCurrentScreen();
    lastDrawMs = millis();
  }

  if (wifiConnected) {
    server.handleClient();
  }

  delay(20);
}
