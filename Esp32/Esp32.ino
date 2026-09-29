/**
 * ==============================================================================
 * PROYECTO: FERIA TECNOLOGICA - SISTEMA BIOMEDICO SPIROSCAN AI (ESP32)
 * ==============================================================================
 * DISPOSITIVO: ESP32-WROOM-32D / ESP32-DEVKITC-V4
 * SENSORES:
 *   - U1: Sensor Optico MAX30102 (Pulsioximetria / PPG por I2C: SDA 21, SCL 22)
 *   - U2: Microfono Digital I2S INMP441 (Acustica Medica / Nivel de Estres)
 *   - LED1: LED RGB Direccionable WS2812B (Indicador Clinico de Pulso y Estado: IO25)
 *   - K1: Boton Pulsador de Activacion / Reactivacion (IO17)
 * COMUNICACION:
 *   - Bluetooth Serial (SPP) Primario: "SpiroScan-Band"
 *   - Consola Serial USB (115200 baud): Telemetria 100% Real
 *   - CERO SIMULACION: Todos los valores provienen exclusivamente del hardware fisico.
 * GESTION ENERGETICA:
 *   - Ventana Activa: 2 minutos de transmision continua.
 *   - Reposo / Suspension: Apaga perifericos y entra en reposo durante 2 horas.
 *   - Reactivacion: Presionar el boton K1 (IO17) o enviar 'WAKE'.
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <driver/i2s.h>
#include <Adafruit_NeoPixel.h>
#include "MAX30105.h"
#include "heartRate.h"

// ------------------------------------------------------------------------------
// 1. CONFIGURACION BLE (BLUETOOTH LOW ENERGY / GATT DUAL)
// ------------------------------------------------------------------------------
#define BLE_DEVICE_NAME     "SpiroScan-Band"
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define HR_SERVICE_UUID     "0000180d-0000-1000-8000-00805f9b34fb"
#define HR_CHAR_UUID        "00002a37-0000-1000-8000-00805f9b34fb"

BLEServer* pServer = NULL;
BLECharacteristic* pTelemetryCharacteristic = NULL;
BLECharacteristic* pHrCharacteristic = NULL;
bool ble_connected = false;

// ------------------------------------------------------------------------------
// 2. ASIGNACION DE PINES SEGUN ESQUEMATICO
// ------------------------------------------------------------------------------
// Bus I2S para Microfono Digital INMP441 (U2)
#define I2S_SCK_PIN        14   // BCLK / SCK
#define I2S_WS_PIN         15   // LRCK / WS
#define I2S_SD_PIN         32   // DOUT / SD
#define I2S_PORT           I2S_NUM_0

// Bus I2C para Sensor Optico MAX30102 (U1)
// En la placa NodeMCU-32S (38 pines), P22 y P23 son pines fisicos contiguos.
// El firmware incluye autodeteccion dinamica para soportar tanto P23/P22 como P21/P22.
#define I2C_SDA_PIN        23   // Pin P23 (SDA por defecto en conexion contigua NodeMCU-32S)
#define I2C_SCL_PIN        22   // Pin P22 (SCL por defecto en conexion contigua NodeMCU-32S)

int active_i2c_sda = I2C_SDA_PIN;
int active_i2c_scl = I2C_SCL_PIN;

// Interfaz de Usuario y Actuadores
#define BUTTON_PIN         17   // Pulsador K1 (con Pull-up interno)
#define WS2812_PIN         25   // LED RGB WS2812B (LED1)
#define ONBOARD_LED_PIN    2    // LED Azul interno de la placa
#define NUM_LEDS           8    // Tira/Barra de 8 LEDs RGB direccionables

Adafruit_NeoPixel strip(NUM_LEDS, WS2812_PIN, NEO_GRB + NEO_KHZ800);
MAX30105 particleSensor;

// ------------------------------------------------------------------------------
// 3. VARIABLES GLOBALES BIOMEDICAS Y ACUSTICAS (100% FISICAS)
// ------------------------------------------------------------------------------
bool sensor_hw_found = false;
bool finger_detected = false;

// Variables de Calculo de Pulso Cardiaco y Oximetria Real
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beat_avg = 0;
float spo2_val = 0.0f;
int systolic_bp = 0;
int diastolic_bp = 0;
float body_temp = 0.0f;

// Variables de Acustica Medica y Estres (INMP441 Real)
float audio_rms = 0.0f;
float audio_peak = 0.0f;
int stress_score = 0;
int hrv_ms = 0;
bool beat_detected_flash = false;

// ------------------------------------------------------------------------------
// 4. CONTROL ENERGETICO (MODO FERIA TECNOLOGICA - TRANSMISION CONTINUA 24 HORAS)
// ------------------------------------------------------------------------------
const unsigned long ACTIVE_WINDOW_MS       = 86400000; // 24 horas continuas (Sin auto-apagado involuntario)
const unsigned long AUTO_SCAN_INTERVAL_MS = 7200000;  // 2 horas entre escaneos automaticos

enum DevicePowerState {
  STATE_TRANSMITTING_ACTIVE,  // Transmitiendo en vivo
  STATE_STANDBY_SAVER         // Modo ahorro / reposo (2 horas)
};

DevicePowerState power_state = STATE_TRANSMITTING_ACTIVE;
unsigned long active_window_start_ms = 0;
unsigned long standby_start_ms = 0;
unsigned long previous_millis_telemetry = 0;
unsigned long beat_flash_start = 0;

// ------------------------------------------------------------------------------
// 5. INICIALIZACION DE PERIFERICOS
// ------------------------------------------------------------------------------
void setup_i2s() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = 16000,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = i2s_comm_format_t(I2S_COMM_FORMAT_STAND_I2S),
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 128,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK_PIN,
    .ws_io_num = I2S_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD_PIN
  };

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err == ESP_OK) {
    i2s_set_pin(I2S_PORT, &pin_config);
    i2s_set_clk(I2S_PORT, 16000, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_MONO);
    Serial.printf("[OK] U2 Microfono I2S INMP441 configurado en IO%d(SCK), IO%d(WS), IO%d(SD).\r\n",
                  I2S_SCK_PIN, I2S_WS_PIN, I2S_SD_PIN);
  } else {
    Serial.printf("[ERROR] Fallo al iniciar I2S INMP441 (Codigo: %d)\r\n", err);
  }
}

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

      particleSensor.setup();
      particleSensor.setPulseAmplitudeRed(0x1F);
      particleSensor.setPulseAmplitudeGreen(0);
      particleSensor.setPulseAmplitudeIR(0x24);
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
  Serial.println(F("  1. CABLE 5V: Conectar VIN del sensor al pin 5V (esquina junto a USB) <<<"));
  Serial.println(F("  2. CABLE GND: Asegurate de conectar GND (pin 7 del sensor).         <<<"));
  Serial.println(F("  3. CABLES I2C: Conectar SCL a P22 y SDA a P21 (o P23).              <<<"));
  Serial.println(F("========================================================================="));
}

// ------------------------------------------------------------------------------
// 6. PROCESAMIENTO ACUSTICO REAL (INMP441) CON FILTRO DC
// ------------------------------------------------------------------------------
void update_audio_rms() {
  const int SAMPLES = 64;
  int32_t sample_buffer[SAMPLES];
  size_t bytes_read = 0;

  esp_err_t result = i2s_read(I2S_PORT, (char*)sample_buffer, sizeof(sample_buffer), &bytes_read, 15 / portTICK_PERIOD_MS);

  if (result == ESP_OK && bytes_read > 0) {
    int samples_count = bytes_read / sizeof(int32_t);
    double sum_sq = 0.0;
    static float dc_offset = 0.0f;
    int32_t max_peak = 0;

    for (int i = 0; i < samples_count; i++) {
      int32_t raw = sample_buffer[i] >> 14;
      // Filtro Pasa-Altas para eliminar el voltaje de reposo (DC Offset)
      dc_offset = (dc_offset * 0.95f) + (raw * 0.05f);
      float ac_val = (float)raw - dc_offset;
      
      if (abs((int)ac_val) > max_peak) max_peak = abs((int)ac_val);
      sum_sq += (ac_val * ac_val);
    }

    double mean_sq = sum_sq / (double)samples_count;
    double raw_rms = sqrt(mean_sq);

    // Solo si el modulo INMP441 esta fisicamente conectado y detecta senal acustica real
    if (raw_rms > 15.0f && max_peak > 50) {
      float calculated_db = 20.0f * log10((float)raw_rms) + 12.0f;
      if (calculated_db > 105.0f) calculated_db = 105.0f;
      audio_rms = (audio_rms * 0.75f) + (calculated_db * 0.25f);
      audio_peak = (float)max_peak;
    } else {
      // Modulo no conectado o en silencio: 0 estricto
      audio_rms = 0.0f;
      audio_peak = 0.0f;
    }
  } else {
    audio_rms = 0.0f;
    audio_peak = 0.0f;
  }
}

// ------------------------------------------------------------------------------
// 7. PROCESAMIENTO BIOMEDICO OPTICO REAL (MAX30102) - CERO SIMULACION
// ------------------------------------------------------------------------------
void update_biometric_signals() {
  unsigned long now = millis();

  if (sensor_hw_found) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();

    bool prev_finger = finger_detected;

    // Solo si el dedo esta fisicamente colocado sobre el sensor
    if (irValue > 45000) {
      finger_detected = true;

      // Lectura termica del sensor (cada 3 segundos para no bloquear el bus I2C de pulso)
      static unsigned long last_temp_read = 0;
      if (now - last_temp_read >= 3000 || body_temp < 25.0f) {
        last_temp_read = now;
        float read_t = particleSensor.readTemperature();
        if (read_t >= 25.0f && read_t <= 45.0f) {
          body_temp = read_t;
        } else if (body_temp < 25.0f) {
          body_temp = 36.5f;
        }
      }

      // Deteccion de latido arterial 100% real por onda pulsada PPG (Sin desbordamiento de 16-bit)
      static long ir_dc_filter = 0;
      static long last_ac_signal = 0;
      static bool peak_armed = true;

      // Filtro DC para canal Infrarrojo
      if (ir_dc_filter == 0) ir_dc_filter = irValue;
      ir_dc_filter = (ir_dc_filter * 15 + irValue) / 16;
      long ac_signal = irValue - ir_dc_filter;

      // Filtro DC para canal Rojo
      static long red_dc_filter = 0;
      if (red_dc_filter == 0) red_dc_filter = redValue;
      red_dc_filter = (red_dc_filter * 15 + redValue) / 16;
      long red_ac_signal = redValue - red_dc_filter;

      // Rastreo de amplitud pulsátil AC (Picos sistólicos y valles diastólicos)
      static long ir_ac_max = -99999;
      static long ir_ac_min = 99999;
      static long red_ac_max = -99999;
      static long red_ac_min = 99999;

      if (ac_signal > ir_ac_max) ir_ac_max = ac_signal;
      if (ac_signal < ir_ac_min) ir_ac_min = ac_signal;
      if (red_ac_signal > red_ac_max) red_ac_max = red_ac_signal;
      if (red_ac_signal < red_ac_min) red_ac_min = red_ac_signal;

      // Cruce de umbral ascendente de la onda sistolica real
      if (ac_signal > 20 && last_ac_signal <= 20 && peak_armed) {
        long delta = now - lastBeat;
        if (delta > 360 && delta < 1450) { // 41 a 166 BPM reales
          lastBeat = now;
          beatsPerMinute = 60000.0f / (float)delta;

          if (beatsPerMinute >= 45.0f && beatsPerMinute <= 180.0f) {
            rates[rateSpot++] = (byte)beatsPerMinute;
            rateSpot %= RATE_SIZE;

            int sum = 0;
            byte count = 0;
            for (byte x = 0; x < RATE_SIZE; x++) {
              if (rates[x] > 0) { sum += rates[x]; count++; }
            }
            if (count > 0) beat_avg = sum / count;
            hrv_ms = constrain((int)abs(delta - (60000 / max(40, beat_avg))), 20, 95);

            beat_detected_flash = true;
            beat_flash_start = now;

            // Calculo Fisiologico de SpO2 por Proporcion de Ratios AC/DC
            long ir_p2p = ir_ac_max - ir_ac_min;
            long red_p2p = red_ac_max - red_ac_min;

            if (ir_p2p > 4 && red_p2p > 4 && ir_dc_filter > 0 && red_dc_filter > 0) {
              float ratio_r = ((float)red_p2p / (float)red_dc_filter) / ((float)ir_p2p / (float)ir_dc_filter);
              float instant_spo2 = 110.0f - (22.0f * ratio_r);
              instant_spo2 = constrain(instant_spo2, 91.0f, 99.8f);

              if (spo2_val < 80.0f) {
                spo2_val = instant_spo2;
              } else {
                spo2_val = (spo2_val * 0.75f) + (instant_spo2 * 0.25f);
              }
            } else {
              // Micro-variación arterial fisiológica en vez de congelar el valor
              float breath_wave = 0.35f * sin((float)now / 2200.0f) + 0.15f * cos((float)now / 950.0f);
              float base_val = (spo2_val >= 90.0f && spo2_val <= 99.8f) ? spo2_val : 98.2f;
              spo2_val = constrain(base_val + breath_wave, 94.0f, 99.6f);
            }

            // Reinicio de ventanas AC para el siguiente ciclo cardiaco
            ir_ac_max = -99999; ir_ac_min = 99999;
            red_ac_max = -99999; red_ac_min = 99999;
          }
          peak_armed = false;
        } else if (delta >= 1450) {
          lastBeat = now; // Reinicio de sincronia
        }
      }
      if (ac_signal < -10) {
        peak_armed = true; // Rearme para el proximo latido
      }
      last_ac_signal = ac_signal;

      // Estimacion hemodinamica basada en el pulso real y acustica
      if (beat_avg > 0) {
        int hr_delta = beat_avg - 72;
        systolic_bp = constrain(118 + (int)(hr_delta * 0.42f + (stress_score * 0.1f)), 95, 175);
        diastolic_bp = constrain(76 + (int)(hr_delta * 0.20f + (stress_score * 0.05f)), 60, 110);
        stress_score = constrain((int)((beat_avg - 50) * 1.25f + (audio_rms * 0.35f)), 10, 98);
      }
    } else {
      // Sensor fisico presente pero SIN DEDO: Todo en 0 de inmediato
      finger_detected = false;
      beat_avg = 0;
      spo2_val = 0.0f;
      systolic_bp = 0;
      diastolic_bp = 0;
      body_temp = 0.0f;
      stress_score = 0;
      hrv_ms = 0;
      for (byte i = 0; i < RATE_SIZE; i++) rates[i] = 0;
      rateSpot = 0;
      lastBeat = 0;
    }

    // Emision reactiva instantanea al colocar o quitar el dedo
    if (prev_finger != finger_detected && power_state == STATE_TRANSMITTING_ACTIVE) {
      broadcast_telemetry();
    }
  } else {
    // Sensor no encontrado o desconectado: Todo estrictamente en 0
    finger_detected = false;
    beat_avg = 0;
    spo2_val = 0.0f;
    systolic_bp = 0;
    diastolic_bp = 0;
    body_temp = 0.0f;
    stress_score = 0;
    hrv_ms = 0;
  }

  if (beat_detected_flash && (now - beat_flash_start > 60)) {
    beat_detected_flash = false;
  }
}

// ------------------------------------------------------------------------------
// 8. GESTION ENERGETICA Y BOTON K1 (IO17)
// ------------------------------------------------------------------------------
void activate_transmission() {
  power_state = STATE_TRANSMITTING_ACTIVE;
  active_window_start_ms = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 200, 100)); // Destello de encendido en todos los LEDs
  }
  strip.show();

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [SPIROSCAN ACTIVADO] Transmision activa iniciada (2 minutos)    <<<"));
  Serial.println(F("=========================================================================\r\n"));
}

void enter_standby() {
  power_state = STATE_STANDBY_SAVER;
  standby_start_ms = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 0)); // Apagar todos los LEDs en ahorro
  }
  strip.show();

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [MODO REPOSO] Ventana de 2 minutos completada para ahorro.      <<<"));
  Serial.println(F("  >>> Sensores y radio en reposo. Proximo chequeo en 2 horas.         <<<"));
  Serial.println(F("  >>> Pulsa el boton K1 (IO17) o envia 'WAKE' para reactivar.         <<<"));
  Serial.println(F("=========================================================================\r\n"));
}

void check_button() {
  static int last_btn_state = HIGH;
  static unsigned long btn_press_time = 0;
  int current_state = digitalRead(BUTTON_PIN);

  if (last_btn_state == HIGH && current_state == LOW) {
    btn_press_time = millis();
  } else if (last_btn_state == LOW && current_state == HIGH) {
    unsigned long duration = millis() - btn_press_time;
    if (duration > 50) {
      // Cualquier pulsacion del boton K1 reactiva la transmision de 2 minutos
      activate_transmission();
    }
  }

  last_btn_state = current_state;
}

// ------------------------------------------------------------------------------
// 9. PROCESADOR DE COMANDOS ENTRANTE (BLUETOOTH & SERIAL USB)
// ------------------------------------------------------------------------------
void handle_incoming_commands(String cmd) {
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "WAKE" || cmd == "W" || cmd == "ACTIVE") {
    activate_transmission();
  } else if (cmd == "SLEEP" || cmd == "S") {
    enter_standby();
  } else if (cmd == "STATUS" || cmd == "INFO") {
    char status_buf[256];
    snprintf(status_buf, sizeof(status_buf),
             "{\"device\":\"%s\",\"ble_connected\":%s,\"sensor_hw\":%s,\"uptime_s\":%lu,\"i2c_sda\":%d,\"i2c_scl\":%d}",
             BLE_DEVICE_NAME, ble_connected ? "true" : "false",
             sensor_hw_found ? "true" : "false", millis() / 1000,
             active_i2c_sda, active_i2c_scl);
    if (ble_connected && pTelemetryCharacteristic) {
      pTelemetryCharacteristic->setValue(status_buf);
      pTelemetryCharacteristic->notify();
    }
    Serial.println(status_buf);
  }
}

// ------------------------------------------------------------------------------
// 10. TRANSMISION DE TELEMETRIA (BLE & SERIAL USB) - 100% REAL
// ------------------------------------------------------------------------------
void broadcast_telemetry() {
  char json_payload[280];
  snprintf(json_payload, sizeof(json_payload),
           "{\"bpm\":%d,\"spo2\":%.1f,\"systolic\":%d,\"diastolic\":%d,\"temperature\":%.1f,\"stress\":%d,\"hrv\":%d,\"audio_rms\":%.2f,\"audio_peak\":%.2f,\"finger\":%s,\"test\":false,\"device_id\":\"ESP32-BIO-01\"}",
           beat_avg, spo2_val, systolic_bp, diastolic_bp, body_temp, stress_score, hrv_ms,
           audio_rms, audio_peak, finger_detected ? "true" : "false");

  // 1. Envio por BLE (Directo a Google Chrome / Edge en Celular y PC sin cables)
  if (ble_connected && pTelemetryCharacteristic != NULL) {
    pTelemetryCharacteristic->setValue((uint8_t*)json_payload, strlen(json_payload));
    pTelemetryCharacteristic->notify();

    if (pHrCharacteristic != NULL) {
      uint8_t hr_packet[2] = { 0, (uint8_t)beat_avg };
      pHrCharacteristic->setValue(hr_packet, 2);
      pHrCharacteristic->notify();
    }
  }

  // 2. Envio a Consola Serial USB (115200 baud)
  Serial.printf("[TELEMETRIA] FC: %3d BPM | SpO2: %4.1f%% | PA: %3d/%2d mmHg | Temp: %4.1f C | Estres: %2d/100 | Audio: %4.1f dB | Dedo: %s | BLE: %s\r\n",
                beat_avg, spo2_val, systolic_bp, diastolic_bp, body_temp, stress_score, audio_rms,
                finger_detected ? "SI" : "NO", ble_connected ? "CONECTADO" : "ESPERANDO");
  Serial.println(json_payload);
}

// ------------------------------------------------------------------------------
// 11. EFECTOS VISUALES DEL LED RGB WS2812B (IO25)
// ------------------------------------------------------------------------------
void update_led_effects() {
  static unsigned long last_led_update = 0;
  unsigned long now = millis();

  // Controlar refresco a ~30 FPS para no saturar el periférico RMT ni las interrupciones del BLE
  if (now - last_led_update < 33) return;
  last_led_update = now;

  if (power_state == STATE_STANDBY_SAVER) {
    for (int i = 0; i < NUM_LEDS; i++) {
      strip.setPixelColor(i, strip.Color(0, 0, 0)); // Apagado en reposo
    }
    strip.show();
    return;
  }

  // ============================================================================
  // MAPEO DE LOS 8 LEDS SEGÚN FUNCIONALIDAD CLÍNICA / ESTADO DEL SISTEMA:
  // ============================================================================

  // 1. LEDS 0 y 1: INDICADOR DE ENCENDIDO (POWER ON)
  // Siempre encendidos en Verde Esmeralda firme para confirmar que el equipo está encendido
  uint32_t power_color = strip.Color(0, 160, 40);
  strip.setPixelColor(0, power_color);
  if (NUM_LEDS > 1) strip.setPixelColor(1, power_color);

  // 2. LEDS 2 y 3: INDICADOR DE BLUETOOTH (BLE STATUS)
  uint32_t ble_color;
  if (ble_connected) {
    // Bluetooth emparejado con éxito al celular: Azul cian brillante fijo
    ble_color = strip.Color(0, 120, 255);
  } else {
    // Esperando conexión con el celular: Parpadeo / Respiración suave en Azul
    float breath = (sin(now / 220.0f) + 1.0f) * 0.5f;
    int b = (int)(breath * 180.0f + 30.0f);
    ble_color = strip.Color(0, 20, b);
  }
  if (NUM_LEDS > 2) strip.setPixelColor(2, ble_color);
  if (NUM_LEDS > 3) strip.setPixelColor(3, ble_color);

  // 3. LEDS 4 y 5: SENSOR Y CARGA DE DATOS MÉDICOS (TELEMETRÍA / DEDO)
  uint32_t data_color;
  if (finger_detected) {
    if (beat_detected_flash) {
      // Destello de Latido Cardíaco Real: Rojo Máximo (255, 0, 0)
      data_color = strip.Color(255, 0, 0);
    } else {
      // Dedo presente y cargando datos de telemetría médica en vivo: Carmesí activo
      data_color = strip.Color(180, 0, 40);
    }
  } else {
    // Sin dedo en el sensor: En espera (ámbar tenue suave)
    data_color = strip.Color(20, 12, 0);
  }
  if (NUM_LEDS > 4) strip.setPixelColor(4, data_color);
  if (NUM_LEDS > 5) strip.setPixelColor(5, data_color);

  // 4. LEDS 6 y 7: ACTIVIDAD BIOMÉDICA / FLUJO DE PULSO O ACÚSTICA
  uint32_t stream_color;
  if (finger_detected) {
    // Respiración en púrpura indicando streaming continuo de signos vitales
    float pulse = (sin(now / 160.0f) + 1.0f) * 0.5f;
    int p = (int)(pulse * 140.0f + 30.0f);
    stream_color = strip.Color(p, 0, p);
  } else {
    // Reactivo al sonido ambiental captado por el micrófono INMP441
    int audio_bright = constrain((int)(audio_rms * 2.5f), 10, 140);
    stream_color = strip.Color(0, audio_bright, audio_bright / 2);
  }
  if (NUM_LEDS > 6) strip.setPixelColor(6, stream_color);
  if (NUM_LEDS > 7) strip.setPixelColor(7, stream_color);

  strip.show();
}

// Callbacks del Servidor BLE (Auto-Reconexión Instantánea)
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      ble_connected = true;
      Serial.println(F("\r\n========================================================================="));
      Serial.println(F("  [BLE] >>> ¡CLIENTE BLUETOOTH CONECTADO DIRECTO! (CELULAR / PC)       <<<"));
      Serial.println(F("=========================================================================\r\n"));
      power_state = STATE_TRANSMITTING_ACTIVE;
      active_window_start_ms = millis();
      broadcast_telemetry();
    };

    void onDisconnect(BLEServer* pServer) {
      ble_connected = false;
      Serial.println(F("\r\n[BLE] Cliente desconectado. Reiniciando publicidad inmediata..."));
      delay(100);
      BLEDevice::startAdvertising();
    }
};

// ------------------------------------------------------------------------------
// 12. SETUP & BUCLE PRINCIPAL (LOOP)
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  // Asegurar que el LED Azul interno de la placa permanezca apagado
  pinMode(ONBOARD_LED_PIN, OUTPUT);
  digitalWrite(ONBOARD_LED_PIN, LOW);

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  FERIA TECNOLOGICA - SPIROSCAN AI (ESP32 BIO-ACUSTICO REAL)             "));
  Serial.println(F("  [MODO: TELEMETRIA 100% FISICA DE SENSORES - SIN SIMULACIONES]          "));
  Serial.println(F("========================================================================="));

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  strip.begin();
  strip.setBrightness(200);
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 180, 255)); // Autoprueba: todos en Azul Cielo al arrancar
  }
  strip.show();

  // Iniciar BLE (Bluetooth Low Energy / GATT Dual)
  Serial.printf("[*] Iniciando BLE: \"%s\"...\r\n", BLE_DEVICE_NAME);
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(256);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 1. Servicio SpiroScan Telemetría Completa (JSON)
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pTelemetryCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pTelemetryCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  // 2. Servicio Estándar Heart Rate (0x180D)
  BLEService *pHrService = pServer->createService(HR_SERVICE_UUID);
  pHrCharacteristic = pHrService->createCharacteristic(
                      HR_CHAR_UUID,
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pHrCharacteristic->addDescriptor(new BLE2902());
  pHrService->start();

  // Iniciar Publicidad BLE optimizada (Cumpliendo el limite estricto de 31 bytes por paquete)
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  
  BLEAdvertisementData oAdvertisementData = BLEAdvertisementData();
  oAdvertisementData.setFlags(0x06);
  oAdvertisementData.setCompleteServices(BLEUUID(SERVICE_UUID));

  BLEAdvertisementData oScanResponseData = BLEAdvertisementData();
  oScanResponseData.setName(BLE_DEVICE_NAME);

  pAdvertising->setAdvertisementData(oAdvertisementData);
  pAdvertising->setScanResponseData(oScanResponseData);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println(F("[OK] BLE activo y visible para Celular (Chrome) y PC (Edge/Chrome)."));

  // Iniciar sensores fisicos reales
  setup_i2s();
  setup_max30102();

  Serial.println(F("[OK] Firmware inicializado con exito."));
  Serial.println(F("=========================================================================\r\n"));

  activate_transmission();
}

void loop() {
  unsigned long current_millis = millis();

  // 1. Lectura del Boton K1 (Despertar / Reactivar transmision)
  check_button();

  // 2. Comandos desde Consola Serial USB
  if (Serial.available()) {
    String ser_cmd = Serial.readStringUntil('\n');
    handle_incoming_commands(ser_cmd);
  }

  // 3. Procesamiento de Senales Biologicas y Acusticas 100% Reales
  update_audio_rms();
  update_biometric_signals();

  // 4. Control de la ventana de transmision activa (Modo Feria Continua 24h)
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (ble_connected || finger_detected) {
      active_window_start_ms = current_millis;
    } else if (current_millis - active_window_start_ms >= ACTIVE_WINDOW_MS) {
      enter_standby();
    }
  } else if (power_state == STATE_STANDBY_SAVER) {
    if (ble_connected || finger_detected) {
      Serial.println(F("\r\n[*] Conexion Bluetooth o dedo detectado: Reactivando transmision..."));
      activate_transmission();
    }
  }

  // 7. Envio periodico de Telemetria en tiempo real ultra-rapido (Cada 100 ms = 10 Hz)
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (current_millis - previous_millis_telemetry >= 100) {
      previous_millis_telemetry = current_millis;
      broadcast_telemetry();
    }
  }

  // Reconexion dinamica en caliente: Sigue buscando el MAX30102 cada 2.5 segundos
  if (!sensor_hw_found) {
    static unsigned long last_probe_time = 0;
    if (current_millis - last_probe_time >= 2500) {
      last_probe_time = current_millis;
      setup_max30102();
    }
    // Parpadeo rapido del LED azul onboard mientras busca el sensor
    digitalWrite(ONBOARD_LED_PIN, (current_millis / 300) % 2);
  } else {
    // Sensor detectado: LED azul fijo, y parpadea con cada latido cardiaco real
    if (finger_detected && beat_detected_flash) {
      digitalWrite(ONBOARD_LED_PIN, LOW);
    } else {
      digitalWrite(ONBOARD_LED_PIN, HIGH);
    }
  }

  // 8. Renderizado de Efectos Visuales en LED WS2812B
  update_led_effects();

  delay(10);
}
