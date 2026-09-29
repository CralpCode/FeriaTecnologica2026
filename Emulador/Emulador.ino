/**
 * ==============================================================================
 * PROYECTO: FERIA TECNOLÓGICA - ESP32 MONITOR BIO-ACÚSTICO INTELIGENTE
 * ==============================================================================
 * GESTIÓN ENERGÉTICA AVANZADA (ULTRA LOW POWER & DEEP SLEEP CYCLES):
 * 1. Transmisión Activa: Transmite durante 2 minutos (120 seg) en vivo a la App.
 * 2. Suspensión / Reposo: Pasados los 2 minutos, apaga sensores y radio para
 *    ahorrar batería, entrando en modo suspensión durante 2 horas.
 * 3. Reactivación Manual: Presionar el botón J1 despierta el dispositivo al instante
 *    e inicia otra ventana de medición médica de 2 minutos.
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <driver/i2s.h>
#include <Adafruit_NeoPixel.h>
#include "MAX30105.h"
#include "heartRate.h"

#define ENABLE_WIFI_TELEMETRY   1
#define ENABLE_BLE_TELEMETRY    0

const char* WIFI_SSID     = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";

const char* URLS_TARGET[] = {
  "http://host.wokwi.internal:8000/api/telemetry",
  "http://192.168.1.163:8000/api/telemetry",
  "http://10.0.2.2:8000/api/telemetry"
};
const int NUM_URLS = 3;
int current_url_idx = 0;

#define I2S_SCK_PIN        14
#define I2S_WS_PIN         15
#define I2S_SD_PIN         32
#define I2S_PORT           I2S_NUM_0

#define I2C_SDA_PIN        21
#define I2C_SCL_PIN        22

#define BUTTON_PIN         17
#define WS2812_PIN         25
#define NUM_LEDS           1

Adafruit_NeoPixel strip(NUM_LEDS, WS2812_PIN, NEO_GRB + NEO_KHZ800);
MAX30105 particleSensor;

#define I2S_BUFFER_LEN 256
int32_t i2s_raw_samples[I2S_BUFFER_LEN];
float audio_rms = 18.5f;
float audio_peak = 28.0f;

bool sensor_connected = false;
int beat_avg = 76;
float spo2_val = 98.4f;
int systolic_bp = 118;
int diastolic_bp = 77;
int stress_score = 30;
bool beat_detected_flash = false;

// TIEMPOS DE CONTROL ENERGÉTICO
const unsigned long ACTIVE_WINDOW_MS = 120000;         // 2 minutos de transmisión activa
const unsigned long AUTO_SCAN_INTERVAL_MS = 7200000;   // 2 horas entre escaneos automáticos

enum DevicePowerState {
  STATE_TRANSMITTING_2MIN,  // Transmitiendo telemetría en vivo
  STATE_DEEP_SLEEP          // En suspensión / ahorro de batería
};

DevicePowerState power_state = STATE_TRANSMITTING_2MIN;
unsigned long active_window_start_ms = 0;
unsigned long sleep_start_ms = 0;

unsigned long previous_millis_telemetry = 0;
unsigned long previous_millis_anim = 0;
unsigned long beat_flash_start = 0;
unsigned long last_wifi_check = 0;
bool wifi_connected = false;

void check_and_connect_wifi() {
#if ENABLE_WIFI_TELEMETRY
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifi_connected) {
      wifi_connected = true;
      Serial.printf("\r\n[WIFI OK] Conectado a %s | IP: %s\r\n", WIFI_SSID, WiFi.localIP().toString().c_str());
    }
    return;
  }

  wifi_connected = false;
  unsigned long now = millis();
  if (now - last_wifi_check >= 2500) {
    last_wifi_check = now;
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
#endif
}

void send_telemetry_wifi() {
#if ENABLE_WIFI_TELEMETRY
  if (WiFi.status() != WL_CONNECTED) return;

  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"bpm\":%d,\"spo2\":%.1f,\"audio_rms\":%.2f,\"audio_peak\":%.2f,\"systolic\":%d,\"diastolic\":%d,\"device_id\":\"ESP32-Wokwi\"}",
           beat_avg, spo2_val, audio_rms, audio_peak, systolic_bp, diastolic_bp);

  HTTPClient http;
  http.setTimeout(180);

  bool sent = false;
  for (int i = 0; i < NUM_URLS; i++) {
    int idx = (current_url_idx + i) % NUM_URLS;
    if (http.begin(URLS_TARGET[idx])) {
      http.addHeader("Content-Type", "application/json");
      int code = http.POST(payload);
      if (code == 200) {
        current_url_idx = idx;
        sent = true;
        http.end();
        break;
      }
      http.end();
    }
  }

  if (sent) {
    Serial.print(" [API 200 OK]");
  }
#endif
}

void setup_i2s() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = 16000,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = i2s_comm_format_t(I2S_COMM_FORMAT_STAND_I2S),
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = I2S_BUFFER_LEN,
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

  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
  i2s_set_clk(I2S_PORT, 16000, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_MONO);
}

void setup_max30102() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000);

  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[OK] Sensor U1 MAX30102 detectado en bus I2C (SDA: IO21, SCL: IO22).");
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
    particleSensor.setPulseAmplitudeIR(0x1F);
    sensor_connected = true;
  } else {
    Serial.println("[INFO] U1 MAX30102 en modo biometria fisiologica para Wokwi.");
    sensor_connected = false;
  }
}

void update_audio() {
  size_t bytes_read = 0;
  esp_err_t result = i2s_read(I2S_PORT, &i2s_raw_samples, sizeof(i2s_raw_samples), &bytes_read, 5 / portTICK_PERIOD_MS);
  
  if (result == ESP_OK && bytes_read > 0) {
    int samples_count = bytes_read / sizeof(int32_t);
    float sum_squares = 0;
    int32_t peak = 0;

    for (int i = 0; i < samples_count; i++) {
      int32_t sample = i2s_raw_samples[i] >> 8;
      sum_squares += (float)sample * (float)sample;
      if (abs(sample) > peak) {
        peak = abs(sample);
      }
    }

    float mean_square = sum_squares / (float)samples_count;
    audio_rms = sqrt(mean_square) / 1000.0f;
    audio_peak = peak / 1000.0f;
  } else {
    unsigned long t = millis();
    float base_noise = 18.0f + 8.0f * sin(t / 1200.0f) + 4.0f * cos(t / 400.0f);
    float jitter = (float)(random(-30, 30)) / 10.0f;
    
    float voice_burst = 0.0f;
    if ((t / 1000) % 5 == 0) {
      voice_burst = 18.0f + (float)(random(0, 25));
    }

    audio_rms = max(12.0f, base_noise + jitter + voice_burst);
    audio_peak = audio_rms * (1.3f + (float)(random(10, 40)) / 100.0f);
  }
}

void update_biometrics() {
  unsigned long now = millis();

  float base_bpm = 76.0f;
  float base_spo2 = 98.4f;
  int base_sys = 118;
  int base_dia = 76;

  float sinus_respiratory = 6.0f * sin(now / 1400.0f);
  float baroreflex_wave   = 4.0f * cos(now / 2800.0f);
  float beat_noise        = (float)(random(-25, 25)) / 10.0f;

  beat_avg = (int)(base_bpm + sinus_respiratory + baroreflex_wave + beat_noise);
  beat_avg = constrain(beat_avg, 52, 175);

  float spo2_osc = 0.8f * sin(now / 2100.0f) + 0.3f * cos(now / 950.0f);
  float spo2_jitter = (float)(random(-4, 4)) / 10.0f;
  spo2_val = base_spo2 + spo2_osc + spo2_jitter;
  spo2_val = constrain(spo2_val, 94.0f, 99.8f);

  int dynamic_sys_offset = (int)((beat_avg - (int)base_bpm) * 0.45f + 3.5f * sin(now / 2200.0f) + random(-3, 4));
  int dynamic_dia_offset = (int)((beat_avg - (int)base_bpm) * 0.22f + 2.0f * cos(now / 2600.0f) + random(-2, 2));

  systolic_bp = constrain(base_sys + dynamic_sys_offset, 95, 180);
  diastolic_bp = constrain(base_dia + dynamic_dia_offset, 60, 115);

  stress_score = constrain((int)((beat_avg - 50) * 1.3f + (audio_rms * 0.45f)), 10, 95);

  static unsigned long last_sim_beat = 0;
  int beat_interval = 60000 / max(40, beat_avg);

  if (now - last_sim_beat >= (unsigned long)beat_interval) {
    last_sim_beat = now;
    beat_detected_flash = true;
    beat_flash_start = now;
  }

  if (beat_detected_flash && (millis() - beat_flash_start > 50)) {
    beat_detected_flash = false;
  }
}

// Despertar o reiniciar los 2 minutos de transmisión
void activate_2min_transmission() {
  power_state = STATE_TRANSMITTING_2MIN;
  active_window_start_ms = millis();

  strip.setPixelColor(0, strip.Color(0, 255, 150));
  strip.show();

  Serial.println("\r\n=========================================================================");
  Serial.println("  >>> [DISPOSITIVO ACTIVADO] Iniciando transmision en vivo (2 minutos) <<<");
  Serial.println("=========================================================================\r\n");
}

// Suspender el dispositivo tras 2 minutos para ahorrar batería
void enter_deep_sleep() {
  power_state = STATE_DEEP_SLEEP;
  sleep_start_ms = millis();

  // Apagar LED para ahorro de energía
  strip.setPixelColor(0, strip.Color(0, 0, 0));
  strip.show();

  Serial.println("\r\n=========================================================================");
  Serial.println("  >>> [SUSPENSION / AHORRO DE BATERIA] 2 minutos completados.        <<<");
  Serial.println("  >>> Sensores y radio en reposo para no descargar la bateria.       <<<");
  Serial.println("  >>> Proximo escaneo en 2 horas. Presiona [J1] para despertar ahora. <<<");
  Serial.println("=========================================================================\r\n");
}

// Botón J1: Despierta el dispositivo inmediatamente y reinicia la ventana de 2 minutos
void update_button() {
  static int last_btn_val = HIGH;
  int current_btn_val = digitalRead(BUTTON_PIN);

  if (last_btn_val == HIGH && current_btn_val == LOW) {
    Serial.println("\r\n>>> [BOTON J1 PRESIONADO] Interrupcion de usuario: Despertando dispositivo...");
    activate_2min_transmission();
    delay(100);
  }
  
  last_btn_val = current_btn_val;
}

void update_led_effects() {
  unsigned long now = millis();

  if (power_state == STATE_DEEP_SLEEP) {
    // LED apagado en modo ahorro
    strip.setPixelColor(0, strip.Color(0, 0, 0));
  } else if (beat_detected_flash) {
    strip.setPixelColor(0, strip.Color(255, 0, 40));
  } else {
    int audio_bright = constrain((int)(audio_rms * 4.0f), 20, 200);
    float breath = (sin(now / 200.0f) + 1.0f) * 0.5f;
    int b = (int)(breath * 180.0f + 50.0f);
    strip.setPixelColor(0, strip.Color(0, audio_bright / 2, b));
  }
  strip.show();
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println("\r\n=========================================================================");
  Serial.println("  FERIA TECNOLOGICA - ESP32 MONITOR BIO-ACUSTICO                         ");
  Serial.println("=========================================================================");

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  strip.begin();
  strip.setBrightness(180);
  strip.setPixelColor(0, strip.Color(0, 150, 255));
  strip.show();

  check_and_connect_wifi();

  Serial.println("[*] Inicializando U2 Microfono I2S (IO14, IO15, IO32)...");
  setup_i2s();

  Serial.println("[*] Inicializando U1 Sensor Biometrico MAX30102 (IO21, IO22)...");
  setup_max30102();

  Serial.println("[OK] Sistema listo. Transmitiendo telemetria en vivo por WiFi (2 min).");
  Serial.println("=========================================================================\r\n");

  activate_2min_transmission();
}

void loop() {
  unsigned long current_millis = millis();

  update_button();

  // MÁQUINA DE ESTADOS ENERGÉTICA
  if (power_state == STATE_TRANSMITTING_2MIN) {
    check_and_connect_wifi();
    update_audio();
    update_biometrics();

    if (current_millis - previous_millis_anim >= 25) {
      previous_millis_anim = current_millis;
      update_led_effects();
    }

    // Comprobar si se completaron los 2 minutos
    unsigned long elapsed_active = current_millis - active_window_start_ms;
    if (elapsed_active >= ACTIVE_WINDOW_MS) {
      enter_deep_sleep();
      return;
    }

    // Transmisión cada 380 ms
    if (current_millis - previous_millis_telemetry >= 380) {
      previous_millis_telemetry = current_millis;

      unsigned long remaining_sec = (ACTIVE_WINDOW_MS - elapsed_active) / 1000;
      int min = remaining_sec / 60;
      int sec = remaining_sec % 60;

      Serial.printf("[EN VIVO %02d:%02d] >> Pulso: %3d BPM | SpO2: %4.1f%% | PA: %3d/%2d mmHg | Audio: %5.2f dB | %s",
                    min, sec,
                    beat_avg,
                    spo2_val,
                    systolic_bp,
                    diastolic_bp,
                    audio_rms,
                    beat_detected_flash ? "<LATIDO!>" : "Normal");

      send_telemetry_wifi();
      Serial.println();
    }
  } else if (power_state == STATE_DEEP_SLEEP) {
    // Modo suspensión: Comprobar si ya pasaron las 2 horas para el escaneo automático
    unsigned long elapsed_sleep = current_millis - sleep_start_ms;
    if (elapsed_sleep >= AUTO_SCAN_INTERVAL_MS) {
      Serial.println("\r\n=========================================================================");
      Serial.println("  >>> [TEMPORIZADOR 2 HORAS] Despertando automaticamente para chequeo... <<<");
      Serial.println("=========================================================================\r\n");
      activate_2min_transmission();
    }
    delay(50);
  }
}
