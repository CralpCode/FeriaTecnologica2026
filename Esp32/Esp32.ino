/**
 * ==============================================================================
 * PROYECTO: FERIA TECNOLOGICA - SISTEMA BIOMEDICO SPIROSCAN AI (ESP32)
 * ==============================================================================
 * DISPOSITIVO: ESP32-WROOM-32D / ESP32-DEVKITC-V4
 * SENSORES:
 *   - U1: Sensor Optico MAX30102 (Pulsioximetria / PPG por I2C: SDA 21, SCL 22)
 *   - U2: Microfono Digital I2S INMP441 (Acustica Medica / audio digital)
 *   - LED1: LED RGB Direccionable WS2812B (Indicador Clinico de Pulso y Estado: IO25)
 *   - K1: Boton Pulsador de Activacion / Reactivacion (IO17)
 * COMUNICACION:
 *   - BLE "SpiroScan-Band": telemetria de pulso y SpO2 hacia la app
 *   - WiFi: telemetria (1 Hz) y audio de 15 s hacia el servidor en la Mac, que se
 *     encuentra solo por mDNS (ver auscultacion.h)
 *   - Consola Serial USB (115200 baud): Telemetria 100% Real
 *   - CERO SIMULACION: Todos los valores provienen exclusivamente del hardware fisico.
 * GESTION ENERGETICA:
 *   - Ventana Activa: 24 horas de transmision continua.
 *   - Reposo / Suspension: Apaga perifericos y entra en reposo durante 2 horas.
 *   - Reactivacion: Presionar el boton K1 (IO17) o enviar 'WAKE'.
 * AUSCULTACION:
 *   - Mantener K1 presionado 1 s (o enviar 'REC') graba 15 s y los envia a la CNN.
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
#include "ppg_quality.h"

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

#include "auscultacion.h"

// ------------------------------------------------------------------------------
// 3. VARIABLES GLOBALES BIOMEDICAS Y ACUSTICAS (100% FISICAS)
// ------------------------------------------------------------------------------
bool sensor_hw_found = false;
bool finger_detected = false;

// A fresh PPG pulse estimate is available only after basic acquisition checks.
// SpO2 requires calibration/validation of this assembled optical system.
PpgQuality ppg_quality;
uint32_t ppg_sample_clock_ms = 0;
unsigned long ppg_last_poll_ms = 0;
int beat_avg = 0;
bool heart_rate_valid = false;
float audio_rms = 0.0f;  // dBFS, not calibrated dB SPL
float audio_peak = 0.0f; // digital amplitude
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
    // 8 x 256 muestras = 128 ms de margen: evita perder audio mientras el loop atiende BLE/I2C
    .dma_buf_count = 8,
    .dma_buf_len = 256,
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
      bool sensor_identified = particleSensor.begin(Wire, I2C_SPEED_STANDARD);
      // SparkFun begin() internamente llama Wire.begin() sin parametros (resetea a 21/22).
      // Re-aplicamos de inmediato los pines configurados por el usuario:
      Wire.begin(sda, scl, 100000);

      // begin() must identify the part; an I2C ACK alone is insufficient.
      if (!sensor_identified || particleSensor.readPartID() != 0x15) continue;
      // MAX30102 has red + IR (no green): 100 samples/s without FIFO averaging.
      particleSensor.setup(0x1F, 1, 2, 100, 411, 4096);
      particleSensor.setPulseAmplitudeRed(0x1F);
      particleSensor.setPulseAmplitudeGreen(0);
      particleSensor.setPulseAmplitudeIR(0x24);
      sensor_hw_found = true;
      ppg_quality.invalidate("acquiring");
      ppg_last_poll_ms = millis();
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
  Serial.println(F("  1. VIN: revisar tension admitida por tu placa MAX30102 antes de conectar <<<"));
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
      // Digital full scale for the shifted I2S samples, not sound pressure in dB SPL.
      float calculated_db = 20.0f * log10((float)raw_rms / 131072.0f);
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
  bool prev_finger = finger_detected;
  if (!sensor_hw_found) {
    ppg_quality.invalidate("sensor_unavailable");
  } else {
    // A gap longer than the library's four-sample FIFO can erase samples.
    // Discard that segment; never interpret the interrupted timing as pulse.
    if (now - ppg_last_poll_ms > 30) {
      particleSensor.clearFIFO();
      while (particleSensor.available()) particleSensor.nextSample();
      ppg_quality.invalidate("stale");
    }
    ppg_last_poll_ms = now;
    uint16_t acquired = particleSensor.check();
    if (acquired >= STORAGE_SIZE) {
      while (particleSensor.available()) particleSensor.nextSample();
      particleSensor.clearFIFO();
      ppg_quality.invalidate("poor");
    } else {
      while (particleSensor.available()) {
        uint32_t ir = particleSensor.getFIFOIR();
        uint32_t red = particleSensor.getFIFORed();
        particleSensor.nextSample();
        ppg_sample_clock_ms += 10; // configured 100 samples/s
        bool usable = ppg_quality.sample(ir, red, now);
        // SparkFun's detector operates on actual FIFO samples, including settling.
        bool beat = checkForBeat((int32_t)ir);
        if (usable && beat) {
          ppg_quality.beat(ppg_sample_clock_ms, now);
          beat_detected_flash = true;
          beat_flash_start = now;
        }
      }
    }
    // Recheck the physical device after missing samples, allowing hot reconnection.
    if (ppg_quality.age(now) > 1000 && now > 1000) {
      Wire.beginTransmission(0x57);
      if (Wire.endTransmission() != 0) {
        sensor_hw_found = false;
        ppg_quality.invalidate("sensor_unavailable");
      }
    }
  }
  finger_detected = sensor_hw_found && ppg_quality.contact(now);
  heart_rate_valid = sensor_hw_found && ppg_quality.valid(now);
  beat_avg = heart_rate_valid ? ppg_quality.bpm(now) : 0;
  if (prev_finger != finger_detected && power_state == STATE_TRANSMITTING_ACTIVE) {
    broadcast_telemetry();
  }
  if (beat_detected_flash && (now - beat_flash_start > 60)) beat_detected_flash = false;
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
  Serial.println(F("  >>> [SPIROSCAN ACTIVADO] Transmision activa iniciada (24 horas)    <<<"));
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
  Serial.println(F("  >>> [MODO REPOSO] Ventana de 24 horas completada para ahorro.      <<<"));
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
    if (duration >= 1000) {
      // Pulsacion larga: grabar 15 s de auscultacion y enviarlos a la CNN
      ausc_start();
    } else if (duration > 50) {
      // Pulsacion corta: reactiva la transmision
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

  if (cmd == "REC" || cmd == "GRABAR") {
    ausc_start();
  } else if (cmd == "WAKE" || cmd == "W" || cmd == "ACTIVE") {
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
  unsigned long now = millis();
  heart_rate_valid = sensor_hw_found && ppg_quality.valid(now);
  beat_avg = heart_rate_valid ? ppg_quality.bpm(now) : 0;
  finger_detected = sensor_hw_found && ppg_quality.contact(now);
  // Zero is a legacy missing-value sentinel, never an observed oxygen saturation.
  // No manufactured SpO2/HRV/stress/pressure/temperature values are emitted.
  char json_payload[512];
  int written = snprintf(json_payload, sizeof(json_payload),
           "{\"bpm\":%d,\"spo2\":0,\"audio_rms\":%.2f,\"audio_peak\":%.2f,\"finger\":%s,"
           "\"test\":false,\"source\":\"real\",\"heartRateValid\":%s,\"bloodOxygenValid\":false,"
           "\"spo2Calibrated\":false,\"signalQuality\":\"%s\",\"sampleAgeMs\":%lu,"
           "\"audioUnit\":\"dBFS\",\"device_id\":\"" DEVICE_ID "\"}",
           beat_avg, audio_rms, audio_peak, finger_detected ? "true" : "false",
           heart_rate_valid ? "true" : "false",
           sensor_hw_found ? ppg_quality.quality(now) : "sensor_unavailable",
           (unsigned long)ppg_quality.age(now));
  if (written < 0 || written >= (int)sizeof(json_payload)) {
    Serial.println(F("[ERROR] Telemetria demasiado grande; paquete descartado."));
    return;
  }

  if (ble_connected && pTelemetryCharacteristic != NULL) {
    // Never send truncated JSON to clients with a small negotiated ATT MTU.
    if (pServer->getPeerMTU(pServer->getConnId()) >= strlen(json_payload) + 3) {
      pTelemetryCharacteristic->setValue((uint8_t*)json_payload, strlen(json_payload));
      pTelemetryCharacteristic->notify();
    }
    if (pHrCharacteristic != NULL) {
      // Heart Rate Measurement: contact supported, contact detected only when valid.
      uint8_t hr_packet[2] = { (uint8_t)(heart_rate_valid ? 0x06 : 0x04), (uint8_t)beat_avg };
      pHrCharacteristic->setValue(hr_packet, 2);
      pHrCharacteristic->notify();
    }
  }
  Serial.printf("[TELEMETRIA] FC: %d BPM | valida: %s | SpO2: no calibrada | senal: %s | Audio: %.1f dBFS\r\n",
                beat_avg, heart_rate_valid ? "SI" : "NO",
                sensor_hw_found ? ppg_quality.quality(now) : "sensor_unavailable", audio_rms);
  Serial.println(json_payload);
  ausc_send_telemetry(json_payload);
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

  // El modo auscultacion tiene prioridad sobre los LEDs mientras graba o muestra el resultado
  if (ausc_update_leds(NUM_LEDS)) return;

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
    int audio_bright = audio_rms < 0 ? constrain((int)((audio_rms + 90) * 2), 0, 140) : 0;
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
  Serial.setTxBufferSize(1024);
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
  BLEDevice::setMTU(512);

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

  // WiFi para el modo auscultacion (no bloquea: conecta en segundo plano)
  ausc_wifi_begin();

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

  // 2a. Mantener WiFi y localizar el servidor por mDNS
  ausc_net_maintain();

  // 2b. Modo auscultacion: mientras graba, el I2S es exclusivo de la captura
  if (ausc_busy()) {
    // Acquisition pauses for audio; old pulse values must immediately become invalid.
    ppg_quality.invalidate("stale");
    if (current_millis - previous_millis_telemetry >= 1000) {
      previous_millis_telemetry = current_millis;
      broadcast_telemetry();
    }
    ausc_capture_step();
    update_led_effects();
    return;
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

  // 7. Telemetria a 1 Hz: evita bloquear UART y perder muestras PPG
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (current_millis - previous_millis_telemetry >= 1000) {
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
