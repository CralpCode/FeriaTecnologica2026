// ==============================================================================
// MODO AUSCULTACION: graba 15 s del INMP441 y los envia por WiFi al backend (Mac),
// que arma el WAV y lo clasifica con la CNN.
//
// Protocolo (ver Backend/audio_service.py):
//   POST /api/audio/start   {"device_id","sample_rate"}  -> {"recording_id"}
//   POST /api/audio/chunk?recording_id=...   PCM int16 LE mono (0.5 s por bloque)
//   POST /api/audio/finish?recording_id=...  -> {"result": "normal" | "anormal" | "calidad_insuficiente"}
//
// La captura se guarda primero en flash. Tras el envio verificado, el servidor
// analiza en segundo plano y el ESP32 queda disponible para otra grabacion.
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
#include "SpiroScanTLSClient.h"
#include <LittleFS.h>
#include <mbedtls/sha256.h>
#include <freertos/stream_buffer.h>
#include <time.h>
#include <sys/time.h>
#include <esp_task_wdt.h>
#include "spiroscan_ca.h"
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
#define AUSC_CHUNK_SAMPLES 4000           // 0.25 s por bloque (8 KB)
#define AUSC_NUM_BUFFERS   1              // Captura local; red solo despues de grabar
#define AUSC_GAIN_SHIFT    14             // 32 bit I2S -> int16 con ganancia x4 (sonidos cardiacos son debiles)
// Una tarea lee el I2S a este bufer en RAM (~1 s de audio) mientras el loop escribe en flash:
// los borrados de sector de LittleFS pueden tardar mas que los 128 ms de DMA del I2S.
#define AUSC_RING_BYTES    32768

extern Adafruit_NeoPixel strip;

enum AuscState { AUSC_IDLE, AUSC_RECORDING, AUSC_PROCESSING, AUSC_SHOW_RESULT };
volatile AuscState ausc_state = AUSC_IDLE;

static int16_t* ausc_buffers[AUSC_NUM_BUFFERS] = {nullptr};
static File ausc_spool;
static bool ausc_fs_ready = false;
static QueueHandle_t ausc_i2s_events = nullptr;
static const char* AUSC_SPOOL_PATH = "/spiroscan-capture.pcm";
static TaskHandle_t ausc_task = nullptr;
static String ausc_recording_id = "";
static volatile bool ausc_upload_error = false;
static volatile bool ausc_capture_done = false;
static int ausc_fill_index = -1;
static int ausc_fill_pos = 0;
static uint32_t ausc_samples_total = 0;
static float ausc_dc = 0.0f;
static StreamBufferHandle_t ausc_ring = nullptr;
static volatile bool ausc_reader_stop = false;
static volatile bool ausc_reader_done = true;
static volatile bool ausc_i2s_overflow = false;
static volatile bool ausc_ring_overflow = false;
static unsigned long ausc_result_until = 0;
static uint32_t ausc_result_color = 0;

static String ausc_server_base = "";   // p. ej. "http://192.168.0.24:8000" (mDNS) o el link https
static bool ausc_mdns_started = false;
static volatile int ausc_http_failures = 0;

// Ultima telemetria pendiente de enviar (la escribe el loop, la lee la tarea de envio)
static char ausc_telem_json[768];
static unsigned long ausc_telem_queued_ms = 0;
static volatile bool ausc_telem_pending = false;
static portMUX_TYPE ausc_telem_mux = portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t ausc_telem_task = nullptr;
static volatile bool ausc_telem_paused = false;

static bool ausc_is_https() {
  return ausc_server_base.startsWith("https://");
}

// Abre la peticion con el cliente adecuado: TLS para https (link del tunel), normal para http (red local).
// HTTPS verifica la cadena del servidor mediante ISRG Root X1.
static void ausc_http_begin(HTTPClient& http, WiFiClientSecure& tls, WiFiClient& plain, const String& url) {
  if (url.startsWith("https://")) {
    tls.setCACert(SPIROSCAN_ROOT_CA);
    tls.setHandshakeTimeout(10);
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
  // La verificacion criptografica puede ocupar CPU mas de los 5 s por defecto.
  // Mantener vigilancia, con margen para los limites de conexion/TLS/lectura.
  esp_task_wdt_init(30, true);
#ifdef SPIROSCAN_BUILD_EPOCH
  if (time(nullptr) < SPIROSCAN_BUILD_EPOCH) {
    timeval anchor = {SPIROSCAN_BUILD_EPOCH, 0};
    settimeofday(&anchor, nullptr);
  }
#endif
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);  // Requerido por la coexistencia WiFi/BLE del ESP32 clasico.
  WiFi.setAutoReconnect(true);
  if (!strlen(WIFI_SSID)) { Serial.println("[WiFi] Sin configurar; usar USB/BLE."); return; }
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
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
  static wl_status_t last_status = WL_IDLE_STATUS;
  wl_status_t st = WiFi.status();
  if (st != last_status) {
    last_status = st;
    if (st == WL_CONNECTED) {
      configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
      Serial.printf("[OK] WiFi conectado. Red: %s | IP del ESP32: %s | MAC: %s\r\n",
                    WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.macAddress().c_str());
    }
  }
  // Discovery runs on the network task; mDNS must not pause optical sampling.
}

bool ausc_busy();
static QueueHandle_t ausc_command_queue = nullptr;
static String ausc_json_field(const String& body, const char* key);
void ausc_queue_recording_id(const String& id) {
  if (!id.length() || id.length() > 32) return;
  if (!ausc_command_queue) ausc_command_queue = xQueueCreate(1, 33);
  char buffer[33] = {}; id.toCharArray(buffer, sizeof(buffer));
  if (ausc_command_queue) xQueueOverwrite(ausc_command_queue, buffer);
}
String ausc_take_recording_command() {
  char id[33] = {};
  if (ausc_command_queue && xQueueReceive(ausc_command_queue, id, 0) == pdTRUE) return String(id);
  return "";
}
static void ausc_receive_command(const String& response) {
  int at = response.indexOf("\"comando\"");
  String command = at >= 0 ? response.substring(at) : response;
  if (ausc_json_field(command, "accion") != "grabar") return;
  String id = ausc_json_field(command, "id");
  if (!id.length() || id.length() > 32) return;
  char buffer[33] = {}; id.toCharArray(buffer, sizeof(buffer));
  if (ausc_command_queue) xQueueOverwrite(ausc_command_queue, buffer);
}

// Tarea (nucleo 0) que envia la telemetria pendiente 1 vez por segundo. Mantiene la conexion
// abierta entre envios (importante con https: el saludo TLS es lo mas lento).
static void ausc_telemetry_task(void*) {
  SpiroScanTLSClient tls;
  WiFiClient plain;
  HTTPClient http;
  http.setReuse(true);
  bool open = false;
  char json[sizeof(ausc_telem_json)];
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(1000));
    static unsigned long last_discovery = 0;
    if (ausc_wifi_ready() && !ausc_server_known() && millis() - last_discovery >= 8000) {
      last_discovery = millis(); ausc_discover_server();
    }
    if (ausc_busy()) {
      // Durante la grabacion se libera la conexion: la memoria y la red son para el audio.
      if (open) { http.end(); tls.stop(); plain.stop(); open = false; }
      ausc_telem_paused = true;
      continue;
    }
    ausc_telem_paused = false;
    if (!ausc_wifi_ready() || !ausc_server_known() || !ausc_telem_pending) continue;
    if (ausc_is_https() && time(nullptr) < 1700000000) {
      Serial.println("[TLS] Esperando hora de red para validar el certificado.");
      continue;
    }
    portENTER_CRITICAL(&ausc_telem_mux);
    memcpy(json, ausc_telem_json, sizeof(json));
    unsigned long queued_age = millis() - ausc_telem_queued_ms;
    bool expired = queued_age > 2000;
    ausc_telem_pending = false;
    portEXIT_CRITICAL(&ausc_telem_mux);
    if (expired) continue;

    String outgoing(json);
    int age_start = outgoing.indexOf("\"sampleAgeMs\":");
    if (age_start >= 0) {
      age_start += 14;
      int age_end = outgoing.indexOf(',', age_start);
      if (age_end > age_start) {
        unsigned long age = outgoing.substring(age_start, age_end).toInt() + queued_age;
        outgoing = outgoing.substring(0, age_start) + String(min(age, 86400000UL)) + outgoing.substring(age_end);
      }
    }
    String url = ausc_server() + "/api/telemetry";
    ausc_http_begin(http, tls, plain, url);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(outgoing);
    String response = http.getString();
    if (code == 200) ausc_receive_command(response);
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
  if (!ausc_command_queue) ausc_command_queue = xQueueCreate(1, 33);
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
static void ausc_upload_file() {
  {
  SpiroScanTLSClient tls;
  WiFiClient plain;
  HTTPClient http;
  http.setReuse(true);
  String url = ausc_server() + "/api/audio/chunk?recording_id=" + ausc_recording_id;
  File input = LittleFS.open(AUSC_SPOOL_PATH, "r");
  if (!input) {
    Serial.println("[AUSC] No se pudo abrir el audio local para envio.");
    ausc_upload_error = true;
  }
  while (input && input.available() && !ausc_upload_error) {
        // Enviar desde flash sin reservar un bloque grande en RAM: cuatro
        // peticiones para 15 s, en lugar de 60 rondas HTTPS de 8 KB.
        size_t size = min((size_t)input.available(), (size_t)(128 * 1024));
        if (!size) { ausc_upload_error = true; break; }
        size_t offset = input.position();
        bool accepted = false;
        for (int attempt = 0; attempt < 3 && !accepted; ++attempt) {
          input.seek(offset);
          ausc_http_begin(http, tls, plain, url + "&offset=" + String(offset));
          http.addHeader("Content-Type", "application/octet-stream");
          int code = http.sendRequest("POST", &input, size);
          String response = http.getString();
          int key = response.indexOf("\"bytes\"");
          int colon = response.indexOf(':', key);
          accepted = code == 200 && key >= 0 && colon >= 0 &&
                     response.substring(colon + 1).toInt() == offset + size;
          if (!accepted) { http.end(); tls.stop(); delay(500 * (attempt + 1)); }
        }
        if (!accepted) ausc_upload_error = true;
  }
  input.close();
  http.end(); tls.stop(); plain.stop();
  }
}

// ------------------------------------------------------------------------------
// Lector del microfono: convierte I2S a int16 mono y lo deja en ausc_ring
// ------------------------------------------------------------------------------
static void ausc_reader(void*) {
  const uint32_t target = (uint32_t)AUSC_SAMPLE_RATE * AUSC_DURATION_S;
  uint32_t captured = 0;
  int32_t raw[256];
  int16_t out[128];
  while (!ausc_reader_stop && captured < target) {
    i2s_event_t event;
    while (ausc_i2s_events && xQueueReceive(ausc_i2s_events, &event, 0) == pdTRUE)
      if (event.type == I2S_EVENT_RX_Q_OVF) ausc_i2s_overflow = true;
    if (ausc_i2s_overflow) break;

    size_t bytes_read = 0;
    if (i2s_read(I2S_NUM_0, (char*)raw, sizeof(raw), &bytes_read, pdMS_TO_TICKS(20)) != ESP_OK) continue;
    int n = bytes_read / sizeof(int32_t);
    uint64_t left = 0, right = 0;
    for (int i = 0; i + 1 < n; i += 2) { left += llabs((long long)raw[i]); right += llabs((long long)raw[i+1]); }
    int channel = right > left ? 1 : 0;
    size_t m = 0;
    for (int i = channel; i < n && captured + m < target; i += 2) {
      // Filtro pasa-altas de 1 polo para quitar el offset DC del MEMS.
      float s = (float)(raw[i] >> AUSC_GAIN_SHIFT);
      ausc_dc += 0.001f * (s - ausc_dc);
      float v = s - ausc_dc;
      if (v > 32767.0f) v = 32767.0f;
      if (v < -32768.0f) v = -32768.0f;
      out[m++] = (int16_t)v;
    }
    if (m && xStreamBufferSend(ausc_ring, out, m * sizeof(int16_t), 0) != m * sizeof(int16_t)) {
      ausc_ring_overflow = true;
      break;
    }
    captured += m;
  }
  ausc_reader_done = true;
  vTaskDelete(nullptr);
}

static void ausc_reader_halt() {
  ausc_reader_stop = true;
  unsigned long started = millis();
  while (!ausc_reader_done && millis() - started < 500) delay(2);
  // Si el lector no termino, se conserva el bufer para no liberarlo mientras lo usa.
  if (ausc_reader_done && ausc_ring) { vStreamBufferDelete(ausc_ring); ausc_ring = nullptr; }
}

// ------------------------------------------------------------------------------
// Inicio / fin de grabacion
// ------------------------------------------------------------------------------
bool ausc_start(const String& command_id = "") {
  if (!SPIROSCAN_MIC_CONNECTED) {
    Serial.println("[AUSC] Microfono no instalado: configurar SPIROSCAN_MIC_CONNECTED al conectarlo.");
    return false;
  }
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

  ausc_telem_paused = false;
  ausc_state = AUSC_PROCESSING;
  unsigned long pause_started = millis();
  while (ausc_telem_task && !ausc_telem_paused && millis() - pause_started < 22000) delay(10);
  if (ausc_telem_task && !ausc_telem_paused) {
    ausc_state = AUSC_IDLE;
    Serial.println("[AUSC] No se pudo liberar la conexion de telemetria; reintentar.");
    return false;
  }

  for (int i = 0; i < AUSC_NUM_BUFFERS; i++) {
    if (!ausc_buffers[i]) ausc_buffers[i] = (int16_t*)malloc(AUSC_CHUNK_SAMPLES * sizeof(int16_t));
    if (!ausc_buffers[i]) {
      Serial.println(F("[AUSC] Memoria insuficiente para los bufers de audio"));
      for (int j = 0; j < AUSC_NUM_BUFFERS; j++) { free(ausc_buffers[j]); ausc_buffers[j] = nullptr; }
      ausc_state = AUSC_IDLE;
      return false;
    }
  }
  if (!ausc_fs_ready && !LittleFS.begin(true, "/littlefs", 2, "spiffs")) {
    Serial.println("[AUSC] No se pudo preparar la memoria local de audio.");
    ausc_state = AUSC_IDLE; return false;
  }
  ausc_fs_ready = true;
  ausc_spool = LittleFS.open(AUSC_SPOOL_PATH, "w");
  if (!ausc_spool || LittleFS.totalBytes() - LittleFS.usedBytes() < AUSC_SAMPLE_RATE * AUSC_DURATION_S * sizeof(int16_t) + 32768) {
    ausc_spool.close(); ausc_state = AUSC_IDLE;
    Serial.println("[AUSC] Espacio insuficiente para 15 s de audio."); return false;
  }

  Serial.printf("[AUSC] Memoria libre antes de grabar: %u bytes\r\n", (unsigned)ESP.getFreeHeap());
  int code;
  String resp;
  {
  SpiroScanTLSClient tls;
  WiFiClient plain;
  HTTPClient http;
  ausc_http_begin(http, tls, plain, ausc_server() + "/api/audio/start");
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"sample_rate\":" + AUSC_SAMPLE_RATE + ",\"source\":\"real\"}";
  if (command_id.length()) { body.remove(body.length() - 1); body += ",\"comando_id\":\"" + command_id + "\"}"; }
  code = http.POST(body);
  resp = http.getString();
  http.end(); tls.stop(); plain.stop();
  } // Liberar TLS de inicio antes de reservar la pila y abrir TLS de bloques.
  if (code != 200) {
    ausc_spool.close();
    Serial.printf("[AUSC] El servidor rechazo el inicio: HTTP %d %s\r\n", code, resp.c_str());
    ausc_result_color = strip.Color(255, 120, 0);
    ausc_result_until = millis() + 3000;
    ausc_state = AUSC_SHOW_RESULT;
    return false;
  }
  ausc_recording_id = ausc_json_field(resp, "recording_id");

  ausc_upload_error = false;
  ausc_capture_done = false;
  ausc_fill_index = 0;
  ausc_fill_pos = 0;
  ausc_samples_total = 0;
  ausc_dc = 0.0f;
  ausc_i2s_overflow = false;
  ausc_ring_overflow = false;
  ausc_reader_stop = false;
  // Descartar muestras y avisos acumulados durante el inicio HTTPS.
  i2s_stop(I2S_NUM_0);
  int32_t discarded[256];
  size_t discarded_bytes = 0;
  do {
    discarded_bytes = 0;
    i2s_read(I2S_NUM_0, discarded, sizeof(discarded), &discarded_bytes, 0);
  } while (discarded_bytes);
  if (ausc_i2s_events) xQueueReset(ausc_i2s_events);
  i2s_zero_dma_buffer(I2S_NUM_0);
  i2s_start(I2S_NUM_0);

  ausc_ring = xStreamBufferCreate(AUSC_RING_BYTES, 2);
  ausc_reader_done = false;
  if (!ausc_ring || xTaskCreatePinnedToCore(ausc_reader, "ausc_i2s", 4096, nullptr, 5, nullptr, 1) != pdPASS) {
    // El servidor ya abrio la grabacion: ausc_capture_step la cierra con aviso de interrupcion.
    Serial.println(F("[AUSC] Memoria insuficiente para el lector del microfono."));
    ausc_reader_done = true;
    ausc_upload_error = true;
  }
  ausc_state = AUSC_RECORDING;
  Serial.printf("[AUSC] Grabando %d s -> %s\r\n", AUSC_DURATION_S, ausc_recording_id.c_str());
  return true;
}

static String ausc_audio_sha256() {
  File audio = LittleFS.open(AUSC_SPOOL_PATH, "r");
  if (!audio || audio.size() != AUSC_SAMPLE_RATE * 2 * AUSC_DURATION_S) return "";
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts_ret(&ctx, 0);
  while (audio.available()) {
    size_t count = audio.read((uint8_t*)ausc_buffers[0], AUSC_CHUNK_SAMPLES * sizeof(int16_t));
    if (!count) { audio.close(); mbedtls_sha256_free(&ctx); return ""; }
    mbedtls_sha256_update_ret(&ctx, (uint8_t*)ausc_buffers[0], count);
  }
  uint8_t hash[32]; char hex[65];
  mbedtls_sha256_finish_ret(&ctx, hash);
  mbedtls_sha256_free(&ctx); audio.close();
  for (int i = 0; i < 32; ++i) snprintf(hex + i * 2, 3, "%02x", hash[i]);
  return String(hex);
}

static void ausc_finish() {
  ausc_state = AUSC_PROCESSING;
  if (ausc_fill_pos && ausc_spool.write((uint8_t*)ausc_buffers[0], ausc_fill_pos * sizeof(int16_t)) != ausc_fill_pos * sizeof(int16_t)) ausc_upload_error = true;
  ausc_spool.close();
  Serial.printf("[AUSC] Captura: %u muestras; archivo: %u bytes; heap mayor: %u\r\n",
                (unsigned)ausc_samples_total,
                (unsigned)LittleFS.open(AUSC_SPOOL_PATH, "r").size(),
                (unsigned)ESP.getMaxAllocHeap());
  String digest = ausc_audio_sha256();
  if (digest.length() != 64) ausc_upload_error = true;
  if (!ausc_upload_error) {
    // El modo de captura ya termino: el envio secuencial no necesita reservar
    // otra pila de 16 KB. La tarea de WiFi sigue ejecutandose en el nucleo 0.
    ausc_upload_file();
  }
  for (int i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, strip.Color(150, 0, 150));
  strip.show();
  String result = "error";
  if (ausc_upload_error) {
    SpiroScanTLSClient tls;
    WiFiClient plain;
    HTTPClient http;
    ausc_http_begin(http, tls, plain, ausc_server() + "/api/audio/abort?recording_id=" + ausc_recording_id);
    int code = http.POST((uint8_t*)nullptr, 0);
    http.getString(); http.end();
    Serial.printf("[AUSC] Captura/envio interrumpido; servidor avisado: HTTP %d\r\n", code);
  }
  if (!ausc_upload_error) {
    SpiroScanTLSClient tls;
    WiFiClient plain;
    HTTPClient http;
    String finishUrl = ausc_server() + "/api/audio/finish?recording_id=" + ausc_recording_id +
                       "&background=true&expected_bytes=" + String(ausc_samples_total * 2) + "&sha256=" + digest;
    int code = 0;
    for (int attempt = 0; attempt < 3 && result != "queued"; ++attempt) {
      ausc_http_begin(http, tls, plain, finishUrl);
      http.setTimeout(15000);
      code = http.POST((uint8_t*)nullptr, 0);
      String resp = http.getString(); http.end(); tls.stop();
      if (code == 202 && ausc_json_field(resp, "sha256") == digest &&
          resp.indexOf("true") >= 0) {
        result = "queued";
        LittleFS.remove(AUSC_SPOOL_PATH);
      } else delay(500 * (attempt + 1));
    }
    Serial.printf("[AUSC] Audio %s confirmado: %s (HTTP %d)\r\n", ausc_recording_id.c_str(), result.c_str(), code);
  }

  if (result == "normal") ausc_result_color = strip.Color(0, 200, 60);
  else if (result == "anormal") ausc_result_color = strip.Color(255, 0, 0);
  else ausc_result_color = strip.Color(255, 120, 0);  // calidad insuficiente o error
  if (result == "queued") ausc_result_color = strip.Color(0, 80, 200);
  ausc_result_until = millis() + (result == "queued" ? 100 : 3000);
  ausc_state = AUSC_SHOW_RESULT;
}

// ------------------------------------------------------------------------------
// Captura: llamar en cada vuelta del loop mientras ausc_state == AUSC_RECORDING
// ------------------------------------------------------------------------------
void ausc_capture_step() {
  if (ausc_state != AUSC_RECORDING) return;
  if (ausc_i2s_overflow && !ausc_upload_error) {
    Serial.println("[AUSC] Desbordamiento I2S: no se clasificara audio incompleto.");
    ausc_upload_error = true;
  }
  if (ausc_ring_overflow && !ausc_upload_error) {
    Serial.println("[AUSC] La flash no guardo el audio a tiempo: no se clasificara audio incompleto.");
    ausc_upload_error = true;
  }

  const uint32_t target = (uint32_t)AUSC_SAMPLE_RATE * AUSC_DURATION_S;
  if (!ausc_upload_error && ausc_ring) {
    size_t want = (AUSC_CHUNK_SAMPLES - ausc_fill_pos) * sizeof(int16_t);
    size_t got = xStreamBufferReceive(ausc_ring, (uint8_t*)(ausc_buffers[0] + ausc_fill_pos), want, pdMS_TO_TICKS(20));
    ausc_fill_pos += got / sizeof(int16_t);
    ausc_samples_total += got / sizeof(int16_t);
    if (ausc_fill_pos >= AUSC_CHUNK_SAMPLES) {
      size_t size = AUSC_CHUNK_SAMPLES * sizeof(int16_t);
      if (ausc_spool.write((uint8_t*)ausc_buffers[0], size) != size) {
        Serial.printf("[AUSC] Fallo al guardar audio local en muestra %u; errno=%d.\r\n", (unsigned)ausc_samples_total, errno);
        ausc_upload_error = true;
      }
      ausc_fill_pos = 0;
    }
    if (ausc_samples_total >= target) ausc_capture_done = true;
  }

  if (ausc_capture_done || ausc_upload_error) {
    ausc_reader_halt();
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
    SpiroScanTLSClient tls;
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
