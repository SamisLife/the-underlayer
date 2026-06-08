// OLED GND -> ESP32 GND
// OLED VCC -> ESP32 3.3V
// OLED SDA -> D21 / GPIO21
// OLED SCL -> D22 / GPIO22

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define OLED_ADDR 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);  // SDA, SCL for ESP32

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED not found");
    while (true) {
      delay(100);
    }
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("OLED OK");
  display.println("SDA: GPIO21");
  display.println("SCL: GPIO22");
  display.display();
}

void loop() {
  // OLED-only wiring test.
}
