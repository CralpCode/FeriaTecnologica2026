// ==============================================================================
// MODO AUSCULTACION: graba 15 s del INMP441 y los envia por WiFi al backend (Mac),
// que arma el WAV y lo clasifica con la CNN.
//
// Protocolo (ver Backend/audio_service.py):
//   POST /api/audio/start   {"device_id","sample_rate"}  -> {"recording_id"}
//   POST /api/audio/chunk?recording_id=...   PCM int16 LE mono (0.5 s por bloque)
//   POST /api/audio/finish?recording_id=...  -> {"result": "normal" | "anormal" | "calidad_insuficiente"}
//
// La captura corre en el loop (nucleo 1) y el envio HTTP en una tarea del nucleo 0,
// con un anillo de bufers: asi el I2S nunca se queda esperando a la red.
//
// Servidor:
//   - SERVER_URL vacio  -> busca la Mac en el MISMO WiFi por mDNS (servicio _spiroscan._tcp).
//   - SERVER_URL "https://...trycloudflare.com" -> envia por internet desde CUALQUIER red.
// La telemetria de pulso/SpO2 (1 vez por segundo) se envia desde una tarea aparte, para que
// la conexion https (mas lenta) nunca frene la lectura de los sensores.
// ==============================================================================
#pragma once

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ESPmDNS.h>
#include <driver/i2s.h>
#include <Adafruit_NeoPixel.h>

#if __has_include("spiroscan_config.h")
#include "spiroscan_config.h"
#else
#include "spiroscan_config.example.h"
#warning "Usando spiroscan_config.example.h: crea spiroscan_config.h con el nombre y la clave del WiFi"
#endif

#ifndef SERVER_URL
#define SERVER_URL ""
#endif

#define AUSC_SAMPLE_RATE   16000
#define AUSC_DURATION_S    15
#define AUSC_CHUNK_SAMPLES 8000           // 0.5 s por bloque (16 KB)
#define AUSC_NUM_BUFFERS   3
#define AUSC_GAIN_SHIFT    14             // 32 bit I2S -> int16 con ganancia x4 (sonidos cardiacos son debiles)

extern Adafruit_NeoPixel strip;

enum AuscState { AUSC_IDLE, AUSC_RECORDING, AUSC_PROCESSING, AUSC_SHOW_RESULT };
volatile AuscState ausc_state = AUSC_IDLE;

static int16_t* ausc_buffers[AUSC_NUM_BUFFERS] = {nullptr};
static QueueHandle_t ausc_full_queue = nullptr;   // indices de bufers llenos para enviar
static QueueHandle_t ausc_free_queue = nullptr;   // indices de bufers libres
static TaskHandle_t ausc_task = nullptr;
static String ausc_recording_id = "";
static volatile bool ausc_upload_error = false;
static volatile bool ausc_capture_done = false;
static int ausc_fill_index = -1;
static int ausc_fill_pos = 0;
static uint32_t ausc_samples_total = 0;
static float ausc_dc = 0.0f;
static unsigned long ausc_result_until = 0;
static uint32_t ausc_result_color = 0;

static String ausc_server_base = "";   // p. ej. "http://192.168.0.24:8000" (mDNS) o el link https
static bool ausc_mdns_started = false;
static volatile int ausc_http_failures = 0;

// Ultima telemetria pendiente de enviar (la escribe el loop, la lee la tarea de envio)
static char ausc_telem_json[512];
static unsigned long ausc_telem_queued_ms = 0;
static volatile bool ausc_telem_pending = false;
static portMUX_TYPE ausc_telem_mux = portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t ausc_telem_task = nullptr;

static bool ausc_is_https() {
  return ausc_server_base.startsWith("https://");
}

// Abre la peticion con el cliente adecuado: TLS para https (link del tunel), normal para http (red local).
// Nota: setInsecure() no verifica el certificado del servidor; suficiente para el prototipo.
static void ausc_http_begin(HTTPClient& http, WiFiClientSecure& tls, WiFiClient& plain, const String& url) {
  if (url.startsWith("https://")) {
    tls.setInsecure();
    http.begin(tls, url);
    http.setConnectTimeout(8000);
    http.setTimeout(10000);
  } else {
    http.begin(plain, url);
    http.setConnectTimeout(1500);
    http.setTimeout(3000);
  }
}

// ------------------------------------------------------------------------------
// WiFi
// ------------------------------------------------------------------------------
void ausc_wifi_begin() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // menor latencia de envio
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[*] WiFi: conectando a \"%s\"...\r\n", WIFI_SSID);
}

bool ausc_wifi_ready() {
  return WiFi.status() == WL_CONNECTED;
}

bool ausc_server_known() {
  return ausc_server_base.length() > 0;
}

const String& ausc_server() {
  return ausc_server_base;
}

// Busca el servidor: primero SERVER_URL (si se forzo), luego el servicio mDNS de la Mac.
static void ausc_discover_server() {
  if (strlen(SERVER_URL) > 0) {
    ausc_server_base = SERVER_URL;
    return;
  }
  if (!ausc_mdns_started) {
    ausc_mdns_started = MDNS.begin(DEVICE_ID);
  }
  int n = MDNS.queryService("spiroscan", "tcp");
  if (n > 0) {
    ausc_server_base = String("http://") + MDNS.IP(0).toString() + ":" + String(MDNS.port(0));
    ausc_http_failures = 0;
    Serial.printf("[OK] Servidor SpiroScan encontrado: %s\r\n", ausc_server_base.c_str());
  } else {
    Serial.println(F("[*] Buscando el servidor SpiroScan en la red (mDNS)..."));
  }
}

static void ausc_note_http_result(bool ok) {
  if (ok) {
    ausc_http_failures = 0;
  } else if (++ausc_http_failures >= 5 && strlen(SERVER_URL) == 0) {
    Serial.println(F("[!] El servidor no responde: se volvera a buscar por mDNS"));
    ausc_server_base = "";
    ausc_http_failures = 0;
  }
}

// Llamar en cada vuelta del loop: mantiene WiFi y servidor localizados.
void ausc_net_maintain() {
  static unsigned long last_try = 0;
  static wl_status_t last_status = WL_IDLE_STATUS;
  wl_status_t st = WiFi.status();
  if (st != last_status) {
    last_status = st;
    if (st == WL_CONNECTED) {
      Serial.printf("[OK] WiFi conectado. IP del ESP32: %s\r\n", WiFi.localIP().toString().c_str());
    }
  }
  if (st != WL_CONNECTED || ausc_server_known()) return;
  if (millis() - last_try < 8000) return;
  last_try = millis();
  ausc_discover_server();
}

bool ausc_busy();

// Tarea (nucleo 0) que envia la telemetria pendiente 1 vez por segundo. Mantiene la conexion
// abierta entre envios (importante con https: el saludo TLS es lo mas lento).
static void ausc_telemetry_task(void*) {
  WiFiClientSecure tls;
  WiFiClient plain;
  HTTPClient http;
  http.setReuse(true);
  bool open = false;
  char json[sizeof(ausc_telem_json)];
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(1000));
    if (ausc_busy()) {
      // Durante la grabacion se libera la conexion: la memoria y la red son para el audio.
      if (open) { http.end(); tls.stop(); plain.stop(); open = false; }
      continue;
    }
    if (!ausc_wifi_ready() || !ausc_server_known() || !ausc_telem_pending) continue;
    portENTER_CRITICAL(&ausc_telem_mux);
    memcpy(json, ausc_telem_json, sizeof(json));
    bool expired = millis() - ausc_telem_queued_ms > 2000;
    ausc_telem_pending = false;
    portEXIT_CRITICAL(&ausc_telem_mux);
    if (expired) continue;

    String url = ausc_server() + "/api/telemetry";
    ausc_http_begin(http, tls, plain, url);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST((uint8_t*)json, strlen(json));
    http.getString();  // vaciar la respuesta para poder reutilizar la conexion
    open = true;
    if (code != 200) {
      Serial.printf("[NET] Telemetria no enviada (HTTP %d)\r\n", code);
      http.end(); tls.stop(); plain.stop(); open = false;
    }
    ausc_note_http_result(code == 200);
  }
}

// Guarda la ultima telemetria; la tarea de envio la manda (no bloquea el loop).
void ausc_send_telemetry(const char* json) {
  if (!ausc_telem_task) {
    xTaskCreatePinnedToCore(ausc_telemetry_task, "ausc_telem", 16384, nullptr, 1, &ausc_telem_task, 0);
  }
  portENTER_CRITICAL(&ausc_telem_mux);
  strncpy(ausc_telem_json, json, sizeof(ausc_telem_json) - 1);
  ausc_telem_json[sizeof(ausc_telem_json) - 1] = '\0';
  ausc_telem_queued_ms = millis();
  ausc_telem_pending = true;
  portEXIT_CRITICAL(&ausc_telem_mux);
}

static String ausc_json_field(const String& body, const char* key) {
  String k = String("\"") + key + "\":\"";
  int i = body.indexOf(k);
  if (i < 0) return "";
  i += k.length();
  int j = body.indexOf('"', i);
  return j > i ? body.substring(i, j) : "";
}

// ------------------------------------------------------------------------------
// Tarea de envio (nucleo 0)
// ------------------------------------------------------------------------------
static void ausc_upload_task(void*) {
  WiFiClientSecure tls;
  WiFiClient plain;
  HTTPClient http;
  http.setReuse(true);
  String url = ausc_server() + "/api/audio/chunk?recording_id=" + ausc_recording_id;
  int idx;
  while (true) {
    if (xQueueReceive(ausc_full_queue, &idx, pdMS_TO_TICKS(200)) == pdTRUE) {
      if (idx < 0) break;  // marcador de fin
      if (!ausc_upload_error) {
        ausc_http_begin(http, tls, plain, url);
        http.addHeader("Content-Type", "application/octet-stream");
        int code = http.POST((uint8_t*)ausc_buffers[idx], AUSC_CHUNK_SAMPLES * sizeof(int16_t));
        http.getString();  // vaciar la respuesta para reutilizar la conexion
        if (code != 200) {
          Serial.printf("[AUSC] Error enviando bloque: HTTP %d\r\n", code);
          ausc_upload_error = true;
        }
      }
      xQueueSend(ausc_free_queue, &idx, 0);
    }
  }
  http.end();
  ausc_task = nullptr;
  vTaskDelete(nullptr);
}

// ------------------------------------------------------------------------------
// Inicio / fin de grabacion
// ------------------------------------------------------------------------------
bool ausc_start() {
  if (ausc_state == AUSC_RECORDING || ausc_state == AUSC_PROCESSING) return false;
  if (!ausc_wifi_ready() || !ausc_server_known()) {
    Serial.println(ausc_wifi_ready()
                   ? F("[AUSC] Servidor no encontrado: revisa SERVER_URL o que la Mac este en la misma red")
                   : F("[AUSC] Sin WiFi: no se puede grabar. Revisa spiroscan_config.h"));
    ausc_result_color = strip.Color(255, 120, 0);
    ausc_result_until = millis() + 3000;
    ausc_state = AUSC_SHOW_RESULT;
    return false;
  }

  for (int i = 0; i < AUSC_NUM_BUFFERS; i++) {
    if (!ausc_buffers[i]) ausc_buffers[i] = (int16_t*)malloc(AUSC_CHUNK_SAMPLES * sizeof(int16_t));
    if (!ausc_buffers[i]) {
      Serial.println(F("[AUSC] Memoria insuficiente para los bufers de audio"));
      return false;
    }
  }
  if (!ausc_full_queue) ausc_full_queue = xQueueCreate(AUSC_NUM_BUFFERS + 1, sizeof(int));
  if (!ausc_free_queue) ausc_free_queue = xQueueCreate(AUSC_NUM_BUFFERS, sizeof(int));
  xQueueReset(ausc_full_queue);
  xQueueReset(ausc_free_queue);
  for (int i = 0; i < AUSC_NUM_BUFFERS; i++) xQueueSend(ausc_free_queue, &i, 0);

  Serial.printf("[AUSC] Memoria libre antes de grabar: %u bytes\r\n", (unsigned)ESP.getFreeHeap());
  WiFiClientSecure tls;
  WiFiClient plain;
  HTTPClient http;
  ausc_http_begin(http, tls, plain, ausc_server() + "/api/audio/start");
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"sample_rate\":" + AUSC_SAMPLE_RATE + ",\"source\":\"real\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  if (code != 200) {
    Serial.printf("[AUSC] El servidor rechazo el inicio: HTTP %d %s\r\n", code, resp.c_str());
    ausc_result_color = strip.Color(255, 120, 0);
    ausc_result_until = millis() + 3000;
    ausc_state = AUSC_SHOW_RESULT;
    return false;
  }
  ausc_recording_id = ausc_json_field(resp, "recording_id");

  ausc_upload_error = false;
  ausc_capture_done = false;
  ausc_fill_index = -1;
  ausc_fill_pos = 0;
  ausc_samples_total = 0;
  ausc_dc = 0.0f;
  i2s_zero_dma_buffer(I2S_NUM_0);
  // 16 KB de pila: el saludo TLS (https) la necesita.
  xTaskCreatePinnedToCore(ausc_upload_task, "ausc_upload", 16384, nullptr, 1, &ausc_task, 0);

  ausc_state = AUSC_RECORDING;
  Serial.printf("[AUSC] Grabando %d s -> %s\r\n", AUSC_DURATION_S, ausc_recording_id.c_str());
  return true;
}

static void ausc_finish() {
  int end_marker = -1;
  xQueueSend(ausc_full_queue, &end_marker, portMAX_DELAY);
  while (ausc_task) delay(10);  // esperar a que se envien todos los bloques

  ausc_state = AUSC_PROCESSING;
  for (int i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, strip.Color(150, 0, 150));
  strip.show();
  String result = "error";
  if (!ausc_upload_error) {
    WiFiClientSecure tls;
    WiFiClient plain;
    HTTPClient http;
    ausc_http_begin(http, tls, plain, ausc_server() + "/api/audio/finish?recording_id=" + ausc_recording_id);
    http.setTimeout(30000);  // la clasificacion + red por internet
    int code = http.POST((uint8_t*)nullptr, 0);
    String resp = http.getString();
    http.end();
    if (code == 200) result = ausc_json_field(resp, "result");
    Serial.printf("[AUSC] Resultado: %s (HTTP %d)\r\n", result.c_str(), code);
  }

  if (result == "normal") ausc_result_color = strip.Color(0, 200, 60);
  else if (result == "anormal") ausc_result_color = strip.Color(255, 0, 0);
  else ausc_result_color = strip.Color(255, 120, 0);  // calidad insuficiente o error
  ausc_result_until = millis() + 6000;
  ausc_state = AUSC_SHOW_RESULT;
}

// ------------------------------------------------------------------------------
// Captura: llamar en cada vuelta del loop mientras ausc_state == AUSC_RECORDING
// ------------------------------------------------------------------------------
void ausc_capture_step() {
  if (ausc_state != AUSC_RECORDING) return;

  int32_t raw[256];
  size_t bytes_read = 0;
  if (i2s_read(I2S_NUM_0, (char*)raw, sizeof(raw), &bytes_read, pdMS_TO_TICKS(20)) != ESP_OK) return;
  int n = bytes_read / sizeof(int32_t);

  for (int i = 0; i < n; i++) {
    if (ausc_fill_index < 0) {
      if (xQueueReceive(ausc_free_queue, &ausc_fill_index, 0) != pdTRUE) {
        // Red demasiado lenta: se descarta la muestra (el backend lo vera como un bloque corto)
        ausc_fill_index = -1;
        continue;
      }
      ausc_fill_pos = 0;
    }
    // Filtro pasa-altas de 1 polo para quitar el offset DC del MEMS.
    float s = (float)(raw[i] >> AUSC_GAIN_SHIFT);
    ausc_dc += 0.001f * (s - ausc_dc);
    float v = s - ausc_dc;
    if (v > 32767.0f) v = 32767.0f;
    if (v < -32768.0f) v = -32768.0f;
    ausc_buffers[ausc_fill_index][ausc_fill_pos++] = (int16_t)v;
    ausc_samples_total++;

    if (ausc_fill_pos >= AUSC_CHUNK_SAMPLES) {
      xQueueSend(ausc_full_queue, &ausc_fill_index, portMAX_DELAY);
      ausc_fill_index = -1;
    }
    if (ausc_samples_total >= (uint32_t)AUSC_SAMPLE_RATE * AUSC_DURATION_S) {
      ausc_capture_done = true;
      break;
    }
  }

  if (ausc_capture_done || ausc_upload_error) {
    ausc_finish();
  }
}

bool ausc_busy() {
  return ausc_state == AUSC_RECORDING || ausc_state == AUSC_PROCESSING;
}

// ------------------------------------------------------------------------------
// LEDs: barra de progreso azul mientras graba; verde/rojo/naranja con el resultado.
// Devuelve true si el modo auscultacion controla los LEDs en este momento.
// ------------------------------------------------------------------------------
bool ausc_update_leds(int num_leds) {
  if (ausc_state == AUSC_IDLE) return false;

  if (ausc_state == AUSC_RECORDING) {
    float progress = (float)ausc_samples_total / (AUSC_SAMPLE_RATE * AUSC_DURATION_S);
    int lit = (int)(progress * num_leds + 0.999f);
    for (int i = 0; i < num_leds; i++) {
      strip.setPixelColor(i, i < lit ? strip.Color(0, 60, 255) : strip.Color(0, 0, 8));
    }
  } else if (ausc_state == AUSC_PROCESSING) {
    uint8_t p = (millis() / 4) % 255;
    for (int i = 0; i < num_leds; i++) strip.setPixelColor(i, strip.Color(p, 0, p));
  } else if (ausc_state == AUSC_SHOW_RESULT) {
    if (millis() > ausc_result_until) {
      ausc_state = AUSC_IDLE;
      return false;
    }
    for (int i = 0; i < num_leds; i++) strip.setPixelColor(i, ausc_result_color);
  }
  strip.show();
  return true;
}

// ------------------------------------------------------------------------------
// Diagnóstico para pruebas en la placa real: comando "DIAG" por el monitor serie.
// Muestra memoria, WiFi, servidor, sensor óptico y nivel del micrófono (1 s de audio).
// ------------------------------------------------------------------------------
void ausc_diag(bool sensor_found, bool finger, int bpm, float spo2) {
  Serial.println(F("\r\n================ DIAGNOSTICO SPIROSCAN ================"));
  Serial.printf("Memoria libre: %u bytes | minima historica: %u | bloque mayor: %u\r\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
  Serial.println(ESP.getMaxAllocHeap() >= AUSC_CHUNK_SAMPLES * sizeof(int16_t) + 45000
                 ? F("  -> Memoria suficiente para grabar con https")
                 : F("  -> OJO: poca memoria; con https la grabacion puede fallar"));

  if (ausc_wifi_ready()) {
    Serial.printf("WiFi: conectado a \"%s\" | senal %d dBm | IP %s\r\n", WIFI_SSID, WiFi.RSSI(),
                  WiFi.localIP().toString().c_str());
    if (WiFi.RSSI() < -75) Serial.println(F("  -> Senal debil: acerca el ESP32 al router"));
  } else {
    Serial.printf("WiFi: SIN CONEXION a \"%s\" (revisa nombre/clave y que sea de 2.4 GHz)\r\n", WIFI_SSID);
  }

  if (ausc_server_known()) {
    WiFiClientSecure tls;
    WiFiClient plain;
    HTTPClient http;
    unsigned long t0 = millis();
    ausc_http_begin(http, tls, plain, ausc_server() + "/api/status");
    int code = http.GET();
    http.end();
    Serial.printf("Servidor: %s -> HTTP %d en %lu ms\r\n", ausc_server().c_str(), code, millis() - t0);
  } else {
    Serial.println(F("Servidor: no encontrado todavia (mDNS) y SERVER_URL vacio"));
  }

  Serial.printf("Sensor optico MAX30102: %s | dedo: %s | pulso %d BPM | SpO2 %.1f %%\r\n",
                sensor_found ? "detectado" : "NO detectado (revisa SDA/SCL)", finger ? "si" : "no", bpm, spo2);

  // 1 segundo de audio del INMP441 con el mismo escalado que la grabacion
  int32_t raw[256];
  size_t bytes_read = 0;
  uint32_t n = 0, clipped = 0;
  double sum = 0, sum_sq = 0;
  int32_t peak = 0;
  unsigned long t0 = millis();
  while (millis() - t0 < 1000) {
    if (i2s_read(I2S_NUM_0, (char*)raw, sizeof(raw), &bytes_read, pdMS_TO_TICKS(50)) != ESP_OK) continue;
    for (size_t i = 0; i < bytes_read / sizeof(int32_t); i++) {
      int32_t s = raw[i] >> AUSC_GAIN_SHIFT;
      sum += s;
      sum_sq += (double)s * s;
      if (abs(s) > peak) peak = abs(s);
      if (abs(s) >= 32767) clipped++;
      n++;
    }
  }
  if (n == 0) {
    Serial.println(F("Microfono INMP441: SIN DATOS (revisa SCK=14, WS=15, SD=32 y L/R a GND)"));
  } else {
    double mean = sum / n;
    double rms = sqrt(sum_sq / n - mean * mean);
    Serial.printf("Microfono INMP441: %u muestras/s | RMS %.0f | pico %d | saturadas %.2f %%\r\n",
                  (unsigned)n, rms, (int)peak, 100.0 * clipped / n);
    if (rms < 5) Serial.println(F("  -> Casi silencio: microfono desconectado o sin contacto"));
    else if (clipped > n / 100) Serial.println(F("  -> Satura: sube AUSC_GAIN_SHIFT (menos ganancia)"));
    else Serial.println(F("  -> Nivel correcto"));
  }
  Serial.println(F("=======================================================\r\n"));
}
