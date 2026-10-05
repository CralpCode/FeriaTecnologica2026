// Temporary MAX30102 diagnostic. No BLE, WiFi, microphone or app telemetry.
// Same sensor initialization; only the failure message avoids prescribing a new VIN.
#include <Arduino.h>
#include <Wire.h>
#include "MAX30105Buffered.h"
#include "spo2_safe.h"
#include "spo2_signal.h"

static const char* VERSION = "2026-10-04-max30102-only";
MAX30105Buffered particleSensor;
bool sensor_hw_found = false;
int active_i2c_sda = -1, active_i2c_scl = -1;
static bool capturing = false;
static uint32_t started_ms, last_sample_ms, acquired, errors, gaps, software_drops;
static uint8_t max_batch, average_count;
static uint16_t window_count;
static uint32_t red_sum, ir_sum, red_window[100], ir_window[100];

void i2c_bus_recovery(int sda, int scl) {
  Wire.end();
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, OUTPUT);
  digitalWrite(scl, HIGH);
  delayMicroseconds(10);

  // 9 pulsos de reloj para liberar cualquier esclavo trabado en el bus
  for (int i = 0; i < 9; i++) {
    digitalWrite(scl, LOW);
    delayMicroseconds(5);
    digitalWrite(scl, HIGH);
    delayMicroseconds(5);
  }
  // Generar condicion STOP
  pinMode(sda, OUTPUT);
  digitalWrite(sda, LOW);
  delayMicroseconds(5);
  digitalWrite(scl, HIGH);
  delayMicroseconds(5);
  digitalWrite(sda, HIGH);
  delayMicroseconds(5);

  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
}

void setup_max30102() {
  struct I2CPinConfig {
    int sda;
    int scl;
    const char* label;
  };

  // Rutas de sondeo segun conexionado fisico de la placa (NodeMCU-32S y DevKit)
  I2CPinConfig pin_options[] = {
    {21, 22, "Estandar ESP32 (P21=SDA, P22=SCL)"},
    {23, 22, "NodeMCU-32S Contiguo (P23=SDA, P22=SCL)"},
    {22, 23, "NodeMCU-32S Invertido (P22=SDA, P23=SCL)"},
    {22, 21, "Estandar Invertido (P22=SDA, P21=SCL)"}
  };

  sensor_hw_found = false;

  // Desacoplar I2C y realizar ciclo de recuperacion de bus
  i2c_bus_recovery(21, 22);
  i2c_bus_recovery(23, 22);

  pinMode(21, INPUT_PULLUP);
  pinMode(22, INPUT_PULLUP);
  pinMode(23, INPUT_PULLUP);
  delay(10);
  Serial.printf("[DIAGNOSTICO ELECTRICO] Nivel logico: P21=%d | P22=%d | P23=%d (1=Alto/Libre, 0=Bajo/Aterrizado)\r\n",
                digitalRead(21), digitalRead(22), digitalRead(23));

  for (size_t i = 0; i < sizeof(pin_options) / sizeof(pin_options[0]); i++) {
    int sda = pin_options[i].sda;
    int scl = pin_options[i].scl;

    Wire.end();
    delay(10);
    Wire.begin(sda, scl, 100000);
    Wire.setTimeOut(30);
    delay(20);

    Wire.beginTransmission(0x57);
    byte i2c_err = Wire.endTransmission();
    Serial.printf("[DEBUG I2C] Sondeando %s -> Codigo I2C: %d (0=ACK, 2=NACK, 5=Timeout)\r\n",
                  pin_options[i].label, i2c_err);

    if (i2c_err == 0) {
      // Iniciar libreria SparkFun
      particleSensor.begin(Wire, I2C_SPEED_STANDARD);
      // SparkFun begin() internamente llama Wire.begin() sin parametros (resetea a 21/22).
      // Re-aplicamos de inmediato los pines configurados por el usuario:
      Wire.begin(sda, scl, 100000);

      particleSensor.setup(0x35, 4, 2, 400, 411, 4096);
      particleSensor.setPulseAmplitudeRed(0x35);
      particleSensor.setPulseAmplitudeIR(0x35);
      particleSensor.setPulseAmplitudeGreen(0);
      particleSensor.clearFIFO();
      sensor_hw_found = true;
      active_i2c_sda = sda;
      active_i2c_scl = scl;
      Serial.printf("[OK] U1 Sensor MAX30102 DETECTADO Y CONFIGURADO [%s | SDA: IO%d, SCL: IO%d].\r\n",
                    pin_options[i].label, sda, scl);
      return;
    }
  }

  // Liberar el bus I2C al finalizar para no retener ningun pin en LOW
  Wire.end();
  sensor_hw_found = false;
  Serial.println(F("[WARN] Sensor MAX30102 no detectado en I2C en ninguna combinacion de pines."));
  Serial.println(F("========================================================================="));
  Serial.println(F("  >>> DIAGNOSTICO DE CONEXION FISICA (NodeMCU ESP-32S):               <<<"));
  Serial.println(F("  1. Revisar VIN conservando la alimentacion actual del montaje.      <<<"));
  Serial.println(F("  2. CABLE GND: Asegurate de conectar GND (pin 7 del sensor).         <<<"));
  Serial.println(F("  3. CABLES I2C: Conectar SCL a P22 y SDA a P21 (o P23).              <<<"));
  Serial.println(F("========================================================================="));
}

static void reset_window() {
  window_count = average_count = 0;
  red_sum = ir_sum = 0;
}

static void print_info() {
  Serial.printf("[MODULE INFO] firmware:%s found:%d sda:%d scl:%d i2c:100000 adc:400 fifo_average:4 fifo_hz:100 algorithm_hz:25 ble:off wifi:off mic:off\r\n",
                VERSION, sensor_hw_found, active_i2c_sda, active_i2c_scl);
  Serial.print("[MODULE REG]");
  for (uint8_t address : {uint8_t(0x08), uint8_t(0x09), uint8_t(0x0A), uint8_t(0x0C), uint8_t(0x0D), uint8_t(0xFF)}) {
    Wire.beginTransmission(0x57);
    Wire.write(address);
    bool ok = Wire.endTransmission() == 0;
    uint8_t value = 0;
    if (ok) {
      ok = Wire.requestFrom(uint8_t(0x57), uint8_t(1)) == 1 && Wire.available() == 1;
      if (ok) value = Wire.read();
    }
    while (Wire.available()) Wire.read();
    Serial.printf(" %02X:%02X:%s", address, value, ok ? "ok" : "error");
  }
  Serial.println();
}

static void start_capture() {
  if (!sensor_hw_found) {
    Serial.println("[MODULE ERROR] sensor_not_found");
    return;
  }
  while (particleSensor.available()) particleSensor.nextSample();
  particleSensor.clearFIFO();
  reset_window();
  acquired = errors = gaps = software_drops = 0;
  max_batch = 0;
  started_ms = last_sample_ms = millis();
  capturing = true;
  Serial.println("[MODULE START] duration_ms:30000 raw_format:sequence,red,ir");
}

static void report_window() {
  int32_t spo2 = -999, pulse = -999;
  int8_t spo2_valid = 0, pulse_valid = 0;
  spiroscan_oxygen_saturation(ir_window, 100, red_window, &spo2, &spo2_valid, &pulse, &pulse_valid);
  float ratio_ref = spiroscan_reference_ratio();
  SpO2Signal quality = spiroscan_analyze_spo2(ir_window, red_window, 100);
  Serial.printf("[RESUMEN] candidato_SpO2:%ld indice_valido:%d R_ref:%.3f R_ciclos:%.3f pulso_ciclos:%.1f calidad:%d motivo:%s\r\n",
      (long)spo2, spo2_valid, ratio_ref, quality.ratio, quality.pulse_bpm, quality.quality_valid, quality.status);
  Serial.printf("[MODULE WINDOW] {\"elapsed_ms\":%lu,\"count\":100,\"rate_hz\":25,\"candidate\":%ld,\"candidate_valid\":%d,\"pulse_ref\":%ld,\"pulse_valid\":%d,\"ratio_ref\":%.3f,\"ratio_rms\":%.3f,\"cycles\":%u,\"pulse_cycles\":%.1f,\"quality\":%d,\"reason\":\"%s\",\"ir\":[",
      (unsigned long)(millis() - started_ms), (long)spo2, spo2_valid, (long)pulse, pulse_valid,
      ratio_ref, quality.ratio, quality.cycles, quality.pulse_bpm, quality.quality_valid, quality.status);
  for (unsigned i = 0; i < 100; ++i) Serial.printf("%s%lu", i ? "," : "", (unsigned long)ir_window[i]);
  Serial.print("],\"red\":[");
  for (unsigned i = 0; i < 100; ++i) Serial.printf("%s%lu", i ? "," : "", (unsigned long)red_window[i]);
  Serial.println("]}");
  reset_window();
}

void setup() {
  Serial.setTxBufferSize(1024);
  Serial.begin(115200);
  Serial.setTimeout(20);
  delay(300);
  setup_max30102();
  print_info();
  Serial.println("[MODULE READY] Commands: INFO, START (30s), STOP. Candidates are diagnostic, not calibrated measurements.");
}

void loop() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase();
    if (command == "INFO") print_info();
    else if (command == "START") start_capture();
    else if (command == "STOP") {
      capturing = false;
      reset_window();
      Serial.println("[MODULE STOP]");
    }
  }
  if (!capturing) { delay(2); return; }
  uint32_t now = millis();
  if (now - started_ms >= 30000) {
    capturing = false;
    Serial.printf("[MODULE END] elapsed_ms:%lu samples:%lu i2c_errors:%lu sample_gaps:%lu software_drops:%lu max_batch:%u\r\n",
        (unsigned long)(now - started_ms), (unsigned long)acquired, (unsigned long)errors,
        (unsigned long)gaps, (unsigned long)software_drops, max_batch);
    return;
  }
  uint16_t fetched = particleSensor.check();
  if (fetched > 31) {
    ++errors;
    reset_window();
    particleSensor.clearFIFO();
    delay(2);
    return;
  }
  uint8_t retained = particleSensor.available();
  if (retained > max_batch) max_batch = retained;
  if (fetched > retained) {
    software_drops += fetched - retained;
    reset_window();
  }
  if (retained && now - last_sample_ms > 250) { ++gaps; reset_window(); }
  while (particleSensor.available()) {
    uint32_t red = particleSensor.getFIFORed(), ir = particleSensor.getFIFOIR();
    particleSensor.nextSample();
    last_sample_ms = millis();
    ++acquired;
    Serial.printf("[RAW] %lu,%lu,%lu\r\n", (unsigned long)acquired, (unsigned long)red, (unsigned long)ir);
    red_sum += red;
    ir_sum += ir;
    if (++average_count == 4) {
      red_window[window_count] = red_sum / 4;
      ir_window[window_count] = ir_sum / 4;
      ++window_count;
      average_count = 0;
      red_sum = ir_sum = 0;
      if (window_count == 100) report_window();
    }
  }
  delay(1);
}
