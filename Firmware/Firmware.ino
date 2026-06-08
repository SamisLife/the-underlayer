// =====================================================================
//  SPECTER OLED menu prototype
//
//  Purpose:
//    - Verify OLED + Arduino Modulino Knob interaction
//    - Prototype the scanner UI before implementing real scan logic
//
//  OLED wiring:
//    OLED GND -> ESP32 GND
//    OLED VCC -> ESP32 3.3V
//    OLED SDA -> ESP32 GPIO 21 / D21
//    OLED SCL -> ESP32 GPIO 22 / D22
//
//  Modulino Knob:
//    Connect via Qwiic/STEMMA QT if possible, or wire:
//    GND -> ESP32 GND
//    3V3 -> ESP32 3.3V
//    SDA -> ESP32 GPIO 21 / D21
//    SCL -> ESP32 GPIO 22 / D22
//
//  Arduino IDE libraries needed:
//    - Adafruit SSD1306
//    - Adafruit GFX Library
//    - Modulino / Arduino_Modulino
// =====================================================================

#include <Wire.h>
#include <Modulino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define I2C_SDA 21
#define I2C_SCL 22

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define OLED_ADDR 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
ModulinoKnob knob;

enum ScreenState {
  SCREEN_TARGETS,
  SCREEN_RANGE,
  SCREEN_SCAN_READY,
  SCREEN_SCANNING
};

ScreenState screen = SCREEN_TARGETS;

const char *targetLabels[] = {
  "All",
  "Cameras",
  "Computers",
  "Phones",
  "Wearables",
  "Sensors",
  "Access pts",
  "Next >"
};

const int TARGET_COUNT = 7;
const int TARGET_NEXT_ROW = 7;
bool targetSelected[TARGET_COUNT] = {true, true, true, true, true, true, true};

const int rangeValues[] = {5, 10, 25, 50, 100};
const int RANGE_COUNT = sizeof(rangeValues) / sizeof(rangeValues[0]);
int rangeIndex = 2;

int selectedRow = 0;
int scanAction = 0;  // 0 = start, 1 = back
int lastPosition = 0;
bool lastPressed = false;
unsigned long scanStartedMs = 0;
unsigned long lastDrawMs = 0;

void printCentered(const String &text, int y) {
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  display.setCursor((SCREEN_WIDTH - w) / 2, y);
  display.print(text);
}

void drawHeader(const String &title) {
  display.fillRect(0, 0, SCREEN_WIDTH, 8, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  printCentered(title, 0);
  display.setTextColor(SSD1306_WHITE);
}

void drawRow(int y, const String &label, bool selected, bool checked) {
  if (selected) {
    display.fillRect(0, y - 1, SCREEN_WIDTH, 7, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
  } else {
    display.setTextColor(SSD1306_WHITE);
  }

  display.drawRect(3, y, 5, 5, selected ? SSD1306_BLACK : SSD1306_WHITE);
  if (checked) {
    display.fillRect(5, y + 2, 2, 2, selected ? SSD1306_BLACK : SSD1306_WHITE);
  }

  display.setCursor(13, y);
  display.print(label);

  if (selected) {
    display.setCursor(120, y);
    display.print(">");
  }

  display.setTextColor(SSD1306_WHITE);
}

bool targetIsChecked(int row) {
  if (row < 0 || row >= TARGET_COUNT) return false;
  return targetSelected[row];
}

int selectedTargetCount() {
  int count = 0;
  for (int i = 1; i < TARGET_COUNT; i++) {
    if (targetSelected[i]) count++;
  }
  return count;
}

String targetSummary() {
  if (targetSelected[0]) return "All";

  int count = selectedTargetCount();
  if (count == 0) return "None";
  if (count == 1) {
    for (int i = 1; i < TARGET_COUNT; i++) {
      if (targetSelected[i]) return String(targetLabels[i]);
    }
  }

  return String(count) + " types";
}

void drawTargetsScreen() {
  display.clearDisplay();
  drawHeader("TARGET PROFILE");

  int first = selectedRow - 1;
  if (first < 0) first = 0;
  if (first > TARGET_NEXT_ROW - 2) first = TARGET_NEXT_ROW - 2;

  for (int i = 0; i < 3; i++) {
    int row = first + i;
    bool isNext = (row == TARGET_NEXT_ROW);
    drawRow(10 + i * 8, targetLabels[row], row == selectedRow,
            isNext ? false : targetIsChecked(row));
  }

  display.display();
}

void drawRangeScreen() {
  display.clearDisplay();
  drawHeader("SCAN RANGE");

  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(5, 12);
  display.print(rangeValues[rangeIndex]);
  display.print("m");

  display.setTextSize(1);
  display.setCursor(70, 11);
  display.print("Targets");
  display.setCursor(70, 21);
  display.print(targetSummary());

  int barX = 5;
  int barY = 28;
  int barW = 60;
  display.drawRect(barX, barY, barW, 4, SSD1306_WHITE);
  int fillW = map(rangeIndex, 0, RANGE_COUNT - 1, 6, barW - 2);
  display.fillRect(barX + 1, barY + 1, fillW, 2, SSD1306_WHITE);

  display.display();
}

void drawButton(int x, int y, int w, const String &label, bool selected) {
  if (selected) {
    display.fillRect(x, y, w, 9, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
  } else {
    display.drawRect(x, y, w, 9, SSD1306_WHITE);
    display.setTextColor(SSD1306_WHITE);
  }

  int16_t x1, y1;
  uint16_t tw, th;
  display.getTextBounds(label, 0, 0, &x1, &y1, &tw, &th);
  display.setCursor(x + (w - tw) / 2, y + 2);
  display.print(label);
  display.setTextColor(SSD1306_WHITE);
}

void drawScanReadyScreen() {
  display.clearDisplay();
  drawHeader("SCAN PLAN");

  display.setCursor(0, 11);
  display.print("Tgt ");
  display.print(targetSummary());

  display.setCursor(0, 20);
  display.print("Rng ");
  display.print(rangeValues[rangeIndex]);
  display.print("m");

  drawButton(76, 12, 44, "SCAN", scanAction == 0);
  drawButton(76, 23, 44, "BACK", scanAction == 1);

  display.display();
}

void drawScanningScreen() {
  unsigned long elapsed = millis() - scanStartedMs;
  int progress = min(100, (int)(elapsed / 30));

  display.clearDisplay();
  drawHeader("SCANNING");

  display.setCursor(0, 12);
  display.print("Tgt ");
  display.print(targetSummary());

  display.setCursor(0, 21);
  display.print("Rng ");
  display.print(rangeValues[rangeIndex]);
  display.print("m / UI");

  display.drawRect(0, 29, SCREEN_WIDTH, 3, SSD1306_WHITE);
  display.fillRect(1, 30, map(progress, 0, 100, 0, SCREEN_WIDTH - 2), 1, SSD1306_WHITE);

  display.display();
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
      screen = SCREEN_SCANNING;
    } else {
      screen = SCREEN_RANGE;
    }
  } else if (screen == SCREEN_SCANNING) {
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

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED not found at 0x3C. Check SDA/SCL, power, and address.");
    while (true) {
      delay(100);
    }
  }

  display.setTextWrap(false);

  Modulino.begin();
  knob.begin();
  knob.set(0);
  lastPosition = knob.get();
  lastPressed = knob.isPressed();

  Serial.println("SPECTER menu UI ready.");
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
    needsDraw = true;
  }

  if (needsDraw || millis() - lastDrawMs > 750) {
    drawCurrentScreen();
    lastDrawMs = millis();
  }

  delay(20);
}
