// ESP32 + MAX30102. Un solo archivo, sin librerias externas.
// SDA=21, SCL=22, I2C=100 kHz. Monitor serial=115200.
// Lecturas brutas: ROJO e IR; no son porcentajes de oxigeno ni BPM.
#include <Arduino.h>
#include <Wire.h>

const uint8_t SENSOR = 0x57;
bool listo = false;
uint32_t ultimaSalida = 0, ultimaMuestra = 0, ultimoAviso = 0;

bool escribir(uint8_t registro, uint8_t valor) {
  Wire.beginTransmission(SENSOR);
  Wire.write(registro);
  Wire.write(valor);
  return Wire.endTransmission() == 0;
}

bool leer(uint8_t registro, uint8_t* datos, uint8_t cantidad) {
  Wire.beginTransmission(SENSOR);
  Wire.write(registro);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(SENSOR, cantidad) != cantidad || Wire.available() != cantidad) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < cantidad; i++) datos[i] = Wire.read();
  return true;
}

bool limpiarFIFO() {
  return escribir(0x04, 0) && escribir(0x05, 0) && escribir(0x06, 0);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("PRUEBA SIMPLE MAX30102 - 115200 BAUDIOS");
  Wire.begin(21, 22, 100000);
  Wire.setTimeOut(30);

  uint8_t id = 0;
  if (!leer(0xFF, &id, 1) || id != 0x15) {
    Serial.println("ERROR: no se reconoce el sensor en 0x57. Revisar conexiones.");
    return;
  }
  if (!escribir(0x09, 0x40)) return;  // Reset del sensor.
  uint32_t inicio = millis();
  uint8_t modo = 0x40;
  while (modo & 0x40) {
    if (!leer(0x09, &modo, 1) || millis() - inicio > 1000) {
      Serial.println("ERROR: reset del sensor.");
      return;
    }
    delay(1);
  }
  // Mismos ajustes opticos de la prueba anterior:
  // promedio 4, ADC 4096, 400 Hz, 411 us, LED rojo/IR 0x35.
  listo = escribir(0x08, 0x5F) && escribir(0x0A, 0x2F)
       && escribir(0x0C, 0x35) && escribir(0x0D, 0x35)
       && limpiarFIFO() && escribir(0x09, 0x03);
  Serial.println(listo ? "LISTO. Coloca y retira el dedo para comparar ROJO e IR."
                       : "ERROR: configuracion I2C.");
  ultimaMuestra = millis();
}

void loop() {
  if (!listo) { delay(100); return; }
  uint8_t punteros[3], datos[6];
  if (!leer(0x04, punteros, 3)) {
    if (millis() - ultimoAviso >= 1000) {
      Serial.println("ERROR I2C: no se pudo leer el FIFO.");
      ultimoAviso = millis();
    }
    delay(10);
    return;
  }
  if (punteros[1] != 0) {
    Serial.println("AVISO: FIFO desbordado; reiniciando muestras.");
    listo = limpiarFIFO();
    return;
  }
  uint8_t cantidad = (punteros[0] - punteros[2]) & 0x1F;
  for (uint8_t i = 0; i < cantidad; i++) {
    if (!leer(0x07, datos, 6)) {
      Serial.println("ERROR I2C: muestra incompleta, descartada.");
      listo = limpiarFIFO();
      return;
    }
    uint32_t rojo = (((uint32_t)datos[0] << 16) | ((uint32_t)datos[1] << 8) | datos[2]) & 0x3FFFF;
    uint32_t ir = (((uint32_t)datos[3] << 16) | ((uint32_t)datos[4] << 8) | datos[5]) & 0x3FFFF;
    ultimaMuestra = millis();
    if (millis() - ultimaSalida >= 100) {
      Serial.printf("ROJO:%lu\tIR:%lu\n", (unsigned long)rojo, (unsigned long)ir);
      ultimaSalida = millis();
    }
  }
  if (millis() - ultimaMuestra > 2000 && millis() - ultimoAviso >= 1000) {
    Serial.println("AVISO: el sensor no entrega muestras nuevas.");
    ultimoAviso = millis();
  }
  delay(2);
}
