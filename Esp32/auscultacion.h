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
// El servidor se encuentra solo por mDNS (servicio _spiroscan._tcp que anuncia la Mac),
// asi que no hace falta escribir su IP. SERVER_URL solo se usa si se quiere forzar una.
// Ademas, por WiFi se envia la telemetria de pulso/SpO2 1 vez por segundo a /api/telemetry.
// ==============================================================================
#pragma once

#include <WiFi.h>
#include <HTTPClient.h>
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

static String ausc_server_base = "";   // p. ej. "http://192.168.0.24:8000" (descubierto por mDNS)
static bool ausc_mdns_started = false;
static int ausc_http_failures = 0;

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

// Envia un JSON de telemetria al servidor (1 Hz). Timeouts cortos para no frenar el loop.
void ausc_send_telemetry(const char* json) {
  static unsigned long last_sent = 0;
  if (!ausc_wifi_ready() || !ausc_server_known()) return;
  if (millis() - last_sent < 1000) return;
  last_sent = millis();
  HTTPClient http;
  http.setConnectTimeout(400);
  http.setTimeout(600);
  http.begin(ausc_server() + "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST((uint8_t*)json, strlen(json));
  http.end();
  ausc_note_http_result(code == 200);
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
  HTTPClient http;
  http.setReuse(true);
  String url = ausc_server() + "/api/audio/chunk?recording_id=" + ausc_recording_id;
  int idx;
  while (true) {
    if (xQueueReceive(ausc_full_queue, &idx, pdMS_TO_TICKS(200)) == pdTRUE) {
      if (idx < 0) break;  // marcador de fin
      if (!ausc_upload_error) {
        http.begin(url);
        http.addHeader("Content-Type", "application/octet-stream");
        int code = http.POST((uint8_t*)ausc_buffers[idx], AUSC_CHUNK_SAMPLES * sizeof(int16_t));
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
                   ? F("[AUSC] Servidor no encontrado: ¿esta encendido start_server.sh en la misma red?")
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

  HTTPClient http;
  http.begin(ausc_server() + "/api/audio/start");
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"sample_rate\":" + AUSC_SAMPLE_RATE + "}";
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
  xTaskCreatePinnedToCore(ausc_upload_task, "ausc_upload", 8192, nullptr, 1, &ausc_task, 0);

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
    HTTPClient http;
    http.setTimeout(20000);
    http.begin(ausc_server() + "/api/audio/finish?recording_id=" + ausc_recording_id);
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
