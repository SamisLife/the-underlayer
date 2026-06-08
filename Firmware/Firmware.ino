// =====================================================================
//  SPECTER TFT menu prototype
//
//  Purpose:
//    - Drive a 2.0" ST7789 TFT display over SPI
//    - Drive the Arduino Modulino Knob over I2C
//    - Prototype the scanner UI before implementing real scan logic
//
//  Recommended ESP32 wiring
//
//  TFT ST7789, SPI:
//    TFT VCC -> ESP32 3.3V
//    TFT GND -> ESP32 GND
//    TFT SCL -> ESP32 GPIO18  // SPI SCK / clock
//    TFT SDA -> ESP32 GPIO23  // SPI MOSI / data to screen
//    TFT CS  -> ESP32 GPIO5
//    TFT DC  -> ESP32 GPIO15
//    TFT RST -> ESP32 GPIO4
//
//  Modulino Knob, I2C:
//    Knob 3V3 -> ESP32 3.3V
//    Knob GND -> ESP32 GND
//    Knob SDA -> ESP32 GPIO21
//    Knob SCL -> ESP32 GPIO22
//
//  Notes:
//    - The TFT pin names SDA/SCL are SPI names on this display, not I2C.
//    - The knob and TFT share power/ground, but not data pins.
//
//  Arduino IDE libraries needed:
//    - Adafruit ST7789
//    - Adafruit GFX Library
//    - Modulino / Arduino_Modulino
// =====================================================================

#include <Wire.h>
#include <SPI.h>
#include <Modulino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>

// ----- I2C bus for Modulino Knob -------------------------------------
#define I2C_SDA 21
#define I2C_SCL 22

// ----- SPI bus for TFT ------------------------------------------------
#define SPI_SCK  18
#define SPI_MOSI 23
#define SPI_MISO 19  // not connected to this TFT, kept for ESP32 SPI setup

#define TFT_CS   5
#define TFT_DC   15
#define TFT_RST  4

Adafruit_ST7789 tft(TFT_CS, TFT_DC, TFT_RST);
ModulinoKnob knob;

enum ScreenState {
  SCREEN_TARGETS,
  SCREEN_RANGE,
  SCREEN_SCAN_READY,
  SCREEN_SCANNING
};

ScreenState screen = SCREEN_TARGETS;

const char *targetLabels[] = {
  "All devices",
  "Security cameras",
  "Computers",
  "Phones",
  "Wearables",
  "IoT sensors",
  "Access points",
  "Next"
};

const int TARGET_COUNT = 7;
const int TARGET_NEXT_ROW = 7;
bool targetSelected[TARGET_COUNT] = {true, true, true, true, true, true, true};

const int rangeValues[] = {5, 10, 25, 50, 100};
const int RANGE_COUNT = sizeof(rangeValues) / sizeof(rangeValues[0]);

int selectedRow = 0;
int rangeIndex = 2;
int scanAction = 0;  // 0 = scan, 1 = back

int lastPosition = 0;
bool lastPressed = false;
unsigned long scanStartedMs = 0;
unsigned long lastDrawMs = 0;
int lastScanProgress = -1;

// ----- visual style ---------------------------------------------------
const uint16_t C_BG       = 0x0841;  // deep blue-black
const uint16_t C_PANEL    = 0x18E3;
const uint16_t C_PANEL_2  = 0x2124;
const uint16_t C_TEXT     = ST77XX_WHITE;
const uint16_t C_MUTED    = 0x9CD3;
const uint16_t C_ACCENT   = ST77XX_CYAN;
const uint16_t C_GREEN    = 0x07E0;
const uint16_t C_AMBER    = 0xFDC0;
const uint16_t C_RED      = 0xF800;

int screenW() {
  return tft.width();
}

int screenH() {
  return tft.height();
}

void setText(uint16_t color, uint8_t size = 1) {
  tft.setTextColor(color);
  tft.setTextSize(size);
}

void printCentered(const String &text, int y, uint8_t size = 1, uint16_t color = C_TEXT) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  tft.setCursor((screenW() - w) / 2, y);
  tft.setTextColor(color);
  tft.print(text);
}

void drawFrame(const char *title, const char *subtitle) {
  tft.fillScreen(C_BG);

  tft.fillRect(0, 0, screenW(), 34, ST77XX_BLACK);
  tft.drawFastHLine(0, 34, screenW(), C_ACCENT);

  setText(C_ACCENT, 2);
  tft.setCursor(12, 8);
  tft.print("SPECTER");

  setText(C_MUTED, 1);
  tft.setCursor(218, 9);
  tft.print(title);
  tft.setCursor(218, 20);
  tft.print(subtitle);

  tft.fillCircle(300, 17, 5, C_GREEN);
}

void drawFooter(const char *left, const char *right) {
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
  if (checked) {
    tft.fillRect(x + 4, y + 4, 8, 8, active ? C_ACCENT : C_GREEN);
  }
}

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
  for (int i = 1; i < TARGET_COUNT; i++) {
    if (targetSelected[i]) count++;
  }
  return count;
}

String targetSummary() {
  if (targetSelected[0]) return "All devices";

  int count = selectedTargetCount();
  if (count == 0) return "None";
  if (count == 1) {
    for (int i = 1; i < TARGET_COUNT; i++) {
      if (targetSelected[i]) return String(targetLabels[i]);
    }
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

  int barX = 190;
  int barY = 162;
  int barW = 92;
  tft.drawRect(barX, barY, barW, 10, C_MUTED);
  int fillW = map(rangeIndex, 0, RANGE_COUNT - 1, 8, barW - 2);
  tft.fillRect(barX + 1, barY + 1, fillW, 8, C_ACCENT);

  drawFooter("ROTATE: adjust", "CLICK: plan");
}

void drawButton(int x, int y, int w, const char *label, bool active) {
  uint16_t fill = active ? C_ACCENT : C_PANEL;
  uint16_t text = active ? ST77XX_BLACK : C_TEXT;
  tft.fillRoundRect(x, y, w, 44, 7, fill);
  tft.drawRoundRect(x, y, w, 44, 7, active ? C_TEXT : C_PANEL_2);

  int16_t x1, y1;
  uint16_t tw, th;
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

void drawScanningScreen() {
  unsigned long elapsed = millis() - scanStartedMs;
  int progress = min(100, (int)(elapsed / 40));

  drawFrame("ACTIVE", "ui demo");

  printCentered("SCANNING", 70, 4, C_ACCENT);

  setText(C_MUTED, 1);
  tft.setCursor(42, 122);
  tft.print("Profile: ");
  tft.print(targetSummary());

  tft.setCursor(42, 140);
  tft.print("Range: ");
  tft.print(rangeValues[rangeIndex]);
  tft.print("m");

  tft.drawRoundRect(42, 170, 236, 18, 5, C_MUTED);
  tft.fillRoundRect(45, 173, map(progress, 0, 100, 0, 230), 12, 4, C_ACCENT);

  drawFooter("MOCK SCAN ONLY", "CLICK: home");
}

void toggleTarget(int row) {
  if (row == 0) {
    bool nextState = !targetSelected[0];
    for (int i = 0; i < TARGET_COUNT; i++) {
      targetSelected[i] = nextState;
    }
    return;
  }

  targetSelected[row] = !targetSelected[row];

  bool allIndividuals = true;
  for (int i = 1; i < TARGET_COUNT; i++) {
    if (!targetSelected[i]) {
      allIndividuals = false;
      break;
    }
  }
  targetSelected[0] = allIndividuals;
}

void handleRotation(int direction) {
  if (screen == SCREEN_TARGETS) {
    selectedRow += direction;
    if (selectedRow < 0) selectedRow = TARGET_NEXT_ROW;
    if (selectedRow > TARGET_NEXT_ROW) selectedRow = 0;
  } else if (screen == SCREEN_RANGE) {
    rangeIndex += direction;
    if (rangeIndex < 0) rangeIndex = 0;
    if (rangeIndex >= RANGE_COUNT) rangeIndex = RANGE_COUNT - 1;
  } else if (screen == SCREEN_SCAN_READY) {
    scanAction = 1 - scanAction;
  }
}

void handleClick() {
  if (screen == SCREEN_TARGETS) {
    if (selectedRow == TARGET_NEXT_ROW) {
      screen = SCREEN_RANGE;
    } else {
      toggleTarget(selectedRow);
    }
  } else if (screen == SCREEN_RANGE) {
    scanAction = 0;
    screen = SCREEN_SCAN_READY;
  } else if (screen == SCREEN_SCAN_READY) {
    if (scanAction == 0) {
      scanStartedMs = millis();
      lastScanProgress = -1;
      screen = SCREEN_SCANNING;
    } else {
      screen = SCREEN_RANGE;
    }
  } else if (screen == SCREEN_SCANNING) {
    selectedRow = 0;
    screen = SCREEN_TARGETS;
  }
}

void drawCurrentScreen() {
  if (screen == SCREEN_TARGETS) {
    drawTargetsScreen();
  } else if (screen == SCREEN_RANGE) {
    drawRangeScreen();
  } else if (screen == SCREEN_SCAN_READY) {
    drawScanReadyScreen();
  } else {
    drawScanningScreen();
  }
}

void scanI2CBus() {
  Serial.println("Scanning I2C bus...");

  int found = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("  Found I2C device at 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      found++;
    }
  }

  if (found == 0) {
    Serial.println("  No I2C devices found.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  Wire.begin(I2C_SDA, I2C_SCL);
  scanI2CBus();

  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, TFT_CS);
  pinMode(TFT_CS, OUTPUT);
  digitalWrite(TFT_CS, HIGH);

  tft.init(240, 320);
  tft.setRotation(1);
  tft.setTextWrap(false);
  tft.fillScreen(C_BG);

  Modulino.begin();
  knob.begin();
  knob.set(0);
  lastPosition = knob.get();
  lastPressed = knob.isPressed();

  Serial.println("SPECTER TFT menu UI ready.");
  drawCurrentScreen();
}

void loop() {
  int position = knob.get();
  bool pressed = knob.isPressed();
  int delta = position - lastPosition;
  bool needsDraw = false;

  if (delta != 0) {
    int direction = (delta > 0) ? 1 : -1;
    int steps = abs(delta);

    for (int i = 0; i < steps; i++) {
      handleRotation(direction);
    }

    lastPosition = position;
    needsDraw = true;
  }

  if (pressed != lastPressed) {
    if (!pressed) {
      handleClick();
      needsDraw = true;
    }
    lastPressed = pressed;
  }

  if (screen == SCREEN_SCANNING && millis() - lastDrawMs > 100) {
    int progress = min(100, (int)((millis() - scanStartedMs) / 40));
    if (progress != lastScanProgress) {
      lastScanProgress = progress;
      needsDraw = true;
    }
  }

  if (needsDraw) {
    drawCurrentScreen();
    lastDrawMs = millis();
  }

  delay(20);
}
