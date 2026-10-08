// ==============================================================================
// MODO AUSCULTACION: graba 15 s del INMP441 y los envia por WiFi al backend (Mac),
// que arma el WAV y lo clasifica con la CNN.
//
// Protocolo (ver Backend/audio_service.py):
//   POST /api/audio/start   {"device_id","sample_rate","comando_id","elapsed_ms"}  -> {"recording_id"}
//   POST /api/audio/chunk?recording_id=...&offset=...&codec=rice1&total=...   audio comprimido sin perdida
//   POST /api/audio/finish?recording_id=...&codec=rice1&expected_bytes=...&sha256=...  -> 202 en cola
// expected_bytes y sha256 son del PCM ORIGINAL (int16 LE mono): el servidor descomprime y los comprueba.
// Las respuestas de chunk/finish traen la siguiente orden ("comando"): la telemetria se pausa al enviar.
//
// La captura se guarda primero en flash, en una cola de 2: mientras la tarea de red envia una zona,
// el loop ya puede grabar la siguiente. El servidor analiza en segundo plano.
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
#include "rice_codec.h"
#include <LittleFS.h>
#include <mbedtls/sha256.h>
#include <freertos/stream_buffer.h>
#include <time.h>
#include <sys/time.h>
#include <esp_task_wdt.h>
#include "spiroscan_ca.h"
#include <ESPmDNS.h>
#include <lwip/dns.h>
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
#define AUSC_CHUNK_SAMPLES 1024           // 64 ms por escritura en flash (2 KB)
#define AUSC_NUM_BUFFERS   1              // Captura local; red solo despues de grabar
#define AUSC_GAIN_SHIFT    14             // 32 bit I2S -> int16 con ganancia x4 (sonidos cardiacos son debiles)
// Una tarea lee el I2S a este bufer en RAM mientras el loop escribe en flash:
// los borrados de sector de LittleFS pueden tardar mas que los 128 ms de DMA del I2S.
#define AUSC_RING_BYTES    8192           // ~0.25 s (+128 ms de DMA); la RAM se comparte con el TLS del envio

extern Adafruit_NeoPixel strip;

enum AuscState { AUSC_IDLE, AUSC_RECORDING, AUSC_PROCESSING, AUSC_SHOW_RESULT };
volatile AuscState ausc_state = AUSC_IDLE;

// Cola de capturas en flash: 1 enviandose + 1 grabandose. La tarea de red (nucleo 0) registra y
// envia cada captura mientras el loop (nucleo 1) ya puede grabar la zona siguiente.
#define AUSC_QUEUE_LEN     2
#define AUSC_UPLOAD_BLOCK  (64 * 1024)    // ~4 s por bloque: entre bloques se registra la captura nueva
enum AuscJobState : uint8_t { JOB_FREE, JOB_CAPTURING, JOB_READY, JOB_UPLOADING };
struct AuscJob {
  volatile AuscJobState state;
  volatile bool failed;      // captura incompleta: se avisa al servidor y no se envia
  volatile bool discarded;   // el servidor rechazo la orden (vencida o de otra zona): se borra sin enviar
  unsigned long started_ms;
  uint32_t bytes;          // PCM original (lo que se verifica en el servidor)
  uint32_t stream_bytes;   // archivo comprimido que se envia
  uint8_t reg_failures;
  char command[33];
  char rec_id[48];
  char sha[65];
};
static AuscJob ausc_jobs[AUSC_QUEUE_LEN];
static portMUX_TYPE ausc_jobs_mux = portMUX_INITIALIZER_UNLOCKED;
static int ausc_capture_job = -1;
static char ausc_last_command[33] = "";

static int16_t* ausc_buffers[AUSC_NUM_BUFFERS] = {nullptr};
static File ausc_spool;
static bool ausc_fs_ready = false;
static QueueHandle_t ausc_i2s_events = nullptr;
static volatile bool ausc_capture_error = false;
static volatile bool ausc_capture_done = false;
static int ausc_fill_pos = 0;
static uint32_t ausc_samples_total = 0;
static float ausc_dc = 0.0f;
// Compresion sin perdida mientras se graba (rice_codec.h) y SHA-256 del PCM original en la misma pasada.
static_assert(AUSC_CHUNK_SAMPLES == RICE_BLOCK, "cada escritura en flash es un bloque comprimido");
static uint8_t ausc_rice_out[RICE_MAX_OUT];
static mbedtls_sha256_context ausc_sha;
static uint32_t ausc_stream_written = 0;
// Bufer fijo (no se reserva en cada captura: la tarea de red puede tener TLS abierto al mismo tiempo).
static uint8_t ausc_ring_storage[AUSC_RING_BYTES + 1];
static StaticStreamBuffer_t ausc_ring_struct;
static StreamBufferHandle_t ausc_ring = nullptr;
static volatile bool ausc_reader_stop = false;
static volatile bool ausc_reader_done = true;
static volatile bool ausc_i2s_overflow = false;
static volatile bool ausc_ring_overflow = false;
static volatile size_t ausc_ring_peak = 0;
static unsigned long ausc_result_until = 0;
static uint32_t ausc_result_color = 0;

static void ausc_job_path(int i, char* out, size_t size) { snprintf(out, size, "/q%d.pcm", i); }

static String ausc_server_base = "";   // p. ej. "http://192.168.0.24:8000" (mDNS) o el link https
static bool ausc_mdns_started = false;
static volatile int ausc_http_failures = 0;

// Ultima telemetria pendiente de enviar (la escribe el loop, la lee la tarea de envio)
static char ausc_telem_json[768];
static unsigned long ausc_telem_queued_ms = 0;
static volatile bool ausc_telem_pending = false;
static portMUX_TYPE ausc_telem_mux = portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t ausc_telem_task = nullptr;

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

// Ultima respuesta correcta del servidor: la barra de LED muestra "conectado" mientras sea reciente.
static volatile unsigned long ausc_server_ok_ms = 0;
static void ausc_mark_server_ok() { ausc_server_ok_ms = millis(); if (!ausc_server_ok_ms) ausc_server_ok_ms = 1; }
bool ausc_connected() {
  return ausc_wifi_ready() && ausc_server_ok_ms && millis() - ausc_server_ok_ms < 15000;
}

static void ausc_note_http_result(bool ok) {
  if (ok) {
    ausc_mark_server_ok();
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
      // DNS de respaldo: si el del hotspot no responde, lwIP prueba estos (sin ellos el link https no resuelve).
      ip_addr_t backup;
      IP_ADDR4(&backup, 1, 1, 1, 1); dns_setserver(1, &backup);
      IP_ADDR4(&backup, 8, 8, 8, 8); dns_setserver(2, &backup);
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

// Una orden ya tomada (o en la cola de envio) no se vuelve a grabar aunque el servidor la repita
// mientras todavia no recibe el registro de esa captura.
static bool ausc_command_known(const char* id) {
  if (!strcmp(id, ausc_last_command)) return true;
  for (int i = 0; i < AUSC_QUEUE_LEN; i++)
    if (ausc_jobs[i].state != JOB_FREE && !strcmp(ausc_jobs[i].command, id)) return true;
  return false;
}
void ausc_queue_recording_id(const String& id) {
  if (!id.length() || id.length() > 32) return;
  if (!ausc_command_queue) ausc_command_queue = xQueueCreate(1, 33);
  char buffer[33] = {}; id.toCharArray(buffer, sizeof(buffer));
  if (ausc_command_queue) xQueueOverwrite(ausc_command_queue, buffer);
}
String ausc_take_recording_command() {
  char id[33] = {};
  if (ausc_command_queue && xQueueReceive(ausc_command_queue, id, 0) == pdTRUE) {
    strncpy(ausc_last_command, id, sizeof(ausc_last_command) - 1);
    return String(id);
  }
  return "";
}
static void ausc_receive_command(const String& response) {
  int at = response.indexOf("\"comando\"");
  if (at < 0) return;
  String command = response.substring(at);
  if (ausc_json_field(command, "accion") != "grabar") return;
  String id = ausc_json_field(command, "id");
  if (!id.length() || id.length() > 32 || ausc_command_known(id.c_str())) return;
  char buffer[33] = {}; id.toCharArray(buffer, sizeof(buffer));
  if (ausc_command_queue) xQueueOverwrite(ausc_command_queue, buffer);
}

static void ausc_net_reset(HTTPClient& http, WiFiClientSecure& tls, WiFiClient& plain) {
  http.end(); tls.stop(); plain.stop();
}

// Reintentos del envio: la red del hotspot a veces se cae unos segundos (DNS/TLS) justo al terminar.
// El servidor acepta repetir un bloque o la confirmacion sin duplicar nada, asi que se insiste ~30 s.
#define AUSC_SEND_ATTEMPTS 6
static String ausc_dns_report() {
  String host = ausc_server().substring(ausc_server().indexOf("//") + 2);
  if (host.indexOf('/') >= 0) host = host.substring(0, host.indexOf('/'));
  if (host.indexOf(':') >= 0) host = host.substring(0, host.indexOf(':'));
  IPAddress resolved;
  return WiFi.hostByName(host.c_str(), resolved) ? resolved.toString() : String("SIN RESPUESTA");
}

static void ausc_retry_pause(const char* what, int attempt, int code) {
  Serial.printf("[AUSC] %s fallo (HTTP %d), intento %d de %d; DNS %s; WiFi %d dBm\r\n", what, code, attempt + 1,
                AUSC_SEND_ATTEMPTS, ausc_dns_report().c_str(), WiFi.RSSI());
  if (attempt + 1 < AUSC_SEND_ATTEMPTS) delay(1000UL << min(attempt, 3));   // 1, 2, 4, 8, 8 s
}

// Durante una captura no se abre una conexion TLS nueva: el saludo necesita ~40 KB de RAM que en ese
// momento usa la grabacion. Se sigue por la conexion ya abierta o se espera a que termine la captura.
static void ausc_wait_for_memory(WiFiClientSecure& tls) {
  if (!ausc_is_https()) return;
  while (ausc_busy() && !tls.connected()) vTaskDelay(pdMS_TO_TICKS(100));
}

static void ausc_free_job(int j) {
  char path[12]; ausc_job_path(j, path, sizeof(path));
  LittleFS.remove(path);
  portENTER_CRITICAL(&ausc_jobs_mux);
  ausc_jobs[j].rec_id[0] = '\0';
  ausc_jobs[j].command[0] = '\0';
  ausc_jobs[j].state = JOB_FREE;
  portEXIT_CRITICAL(&ausc_jobs_mux);
}

// Registra la captura en el servidor (POST /api/audio/start). true si quedo resuelta: registrada o descartada.
static bool ausc_register_job(int j, HTTPClient& http, SpiroScanTLSClient& tls, WiFiClient& plain) {
  AuscJob& job = ausc_jobs[j];
  ausc_wait_for_memory(tls);
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"sample_rate\":" + AUSC_SAMPLE_RATE +
                ",\"source\":\"real\",\"elapsed_ms\":" + String(min(millis() - job.started_ms, 120000UL));
  if (job.command[0]) body += String(",\"comando_id\":\"") + job.command + "\"";
  body += "}";
  ausc_http_begin(http, tls, plain, ausc_server() + "/api/audio/start");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String resp = http.getString();
  if (code == 200) {
    String id = ausc_json_field(resp, "recording_id");
    if (id.length() && id.length() < sizeof(job.rec_id)) {
      strcpy(job.rec_id, id.c_str());
      ausc_mark_server_ok();
      Serial.printf("[AUSC] Captura registrada: %s\r\n", job.rec_id);
      return true;
    }
  }
  if (code >= 400 && code < 500) {
    Serial.printf("[AUSC] El servidor rechazo la captura: HTTP %d %s\r\n", code, resp.c_str());
    job.discarded = true;
    return true;
  }
  ausc_net_reset(http, tls, plain);
  if (++job.reg_failures >= 20) {
    // Sin servidor por ~30 s: se descarta (la web la da por fallida a los 180 s) y se libera la cola.
    Serial.printf("[AUSC] No se pudo registrar la captura (HTTP %d); se descarta.\r\n", code);
    job.discarded = true;
    return true;
  }
  Serial.printf("[AUSC] No se pudo registrar la captura (HTTP %d); se reintenta. Bloque mayor %u\r\n",
                code, (unsigned)ESP.getMaxAllocHeap());
  delay(1000);
  return false;
}

// Registra las capturas nuevas que todavia no tienen identificador (se llama tambien entre bloques).
static void ausc_register_pending(HTTPClient& http, SpiroScanTLSClient& tls, WiFiClient& plain) {
  for (int k = 0; k < AUSC_QUEUE_LEN; k++) {
    AuscJob& job = ausc_jobs[k];
    if ((job.state == JOB_CAPTURING || job.state == JOB_READY) && !job.rec_id[0] && !job.discarded)
      ausc_register_job(k, http, tls, plain);
  }
}

static void ausc_send_abort(const char* rec_id, HTTPClient& http, SpiroScanTLSClient& tls, WiFiClient& plain) {
  ausc_wait_for_memory(tls);
  ausc_http_begin(http, tls, plain, ausc_server() + "/api/audio/abort?recording_id=" + rec_id);
  int code = http.POST((uint8_t*)nullptr, 0);
  http.getString();
  Serial.printf("[AUSC] Captura/envio interrumpido; servidor avisado: HTTP %d\r\n", code);
}

// Envia desde flash por bloques con desplazamiento y confirma con SHA-256. Siempre libera el lugar en la cola.
static void ausc_upload_job(int j, HTTPClient& http, SpiroScanTLSClient& tls, WiFiClient& plain) {
  AuscJob& job = ausc_jobs[j];
  char path[12]; ausc_job_path(j, path, sizeof(path));
  unsigned long t0 = millis();
  bool ok = !job.failed;
  if (ok) {
    File input = LittleFS.open(path, "r");
    if (!input || input.size() != job.stream_bytes) {
      Serial.println("[AUSC] No se pudo abrir el audio local para envio.");
      ok = false;
    }
    String url = ausc_server() + "/api/audio/chunk?recording_id=" + job.rec_id + "&codec=rice1&total=" +
                 String(job.stream_bytes);
    while (ok && input.available()) {
      ausc_register_pending(http, tls, plain);
      size_t size = min((size_t)input.available(), (size_t)AUSC_UPLOAD_BLOCK);
      size_t offset = input.position();
      bool accepted = false;
      for (int attempt = 0; attempt < AUSC_SEND_ATTEMPTS && !accepted; ++attempt) {
        ausc_wait_for_memory(tls);
        input.seek(offset);
        ausc_http_begin(http, tls, plain, url + "&offset=" + String(offset));
        http.addHeader("Content-Type", "application/octet-stream");
        int code = http.sendRequest("POST", &input, size);
        String response = http.getString();
        int key = response.indexOf("\"bytes\"");
        int colon = response.indexOf(':', key);
        accepted = code == 200 && key >= 0 && colon >= 0 &&
                   response.substring(colon + 1).toInt() == offset + size;
        if (accepted) { ausc_mark_server_ok(); ausc_receive_command(response); }
        else { ausc_net_reset(http, tls, plain); ausc_retry_pause("Bloque", attempt, code); }
      }
      if (!accepted) ok = false;
    }
    if (input) input.close();
  }
  if (ok) {
    String finishUrl = ausc_server() + "/api/audio/finish?recording_id=" + job.rec_id +
                       "&background=true&codec=rice1&expected_bytes=" + String(job.bytes) + "&sha256=" + job.sha;
    ok = false;
    int code = 0;
    for (int attempt = 0; attempt < AUSC_SEND_ATTEMPTS && !ok; ++attempt) {
      ausc_wait_for_memory(tls);
      ausc_http_begin(http, tls, plain, finishUrl);
      http.setTimeout(15000);
      // Con cuerpo y Content-Length explicitos: un POST vacio por la conexion reutilizada se quedaba
      // sin respuesta en el proxy (HTTP -11) aunque el servidor ya habia contestado 202.
      http.addHeader("Content-Type", "application/json");
      code = http.POST(String("{}"));
      String resp = http.getString();
      ok = code == 202 && ausc_json_field(resp, "sha256") == job.sha && resp.indexOf("true") >= 0;
      if (ok) { ausc_mark_server_ok(); ausc_receive_command(resp); }
      else { ausc_net_reset(http, tls, plain); ausc_retry_pause("Confirmacion", attempt, code); }
    }
    Serial.printf("[AUSC] Audio %s confirmado: %s (HTTP %d) en %lu ms; pila libre %u\r\n", job.rec_id,
                  ok ? "queued" : "error", code, millis() - t0, (unsigned)uxTaskGetStackHighWaterMark(nullptr));
  }
  if (!ok) ausc_send_abort(job.rec_id, http, tls, plain);
  ausc_free_job(j);
}

static bool ausc_jobs_active() {
  for (int i = 0; i < AUSC_QUEUE_LEN; i++) if (ausc_jobs[i].state != JOB_FREE) return true;
  return false;
}

// Hay audio grabado que todavia se esta enviando (la barra parpadea en azul).
bool ausc_sending() { return ausc_jobs_active(); }

// Siguiente captura lista para enviar (la mas antigua), o -1.
static int ausc_next_ready_job() {
  int best = -1;
  for (int i = 0; i < AUSC_QUEUE_LEN; i++)
    if (ausc_jobs[i].state == JOB_READY && (ausc_jobs[i].rec_id[0] || ausc_jobs[i].discarded) &&
        (best < 0 || (long)(ausc_jobs[i].started_ms - ausc_jobs[best].started_ms) < 0)) best = i;
  return best;
}

// Tarea de red (nucleo 0): unica duena de la conexion HTTP(S). Envia la cola de audio y, cuando no hay
// audio pendiente ni grabacion, la telemetria 1 vez por segundo. Mantiene la conexion abierta entre
// envios (con https el saludo TLS es lo mas lento) y solo un cliente TLS en memoria.
static void ausc_telemetry_task(void*) {
  SpiroScanTLSClient tls;
  WiFiClient plain;
  HTTPClient http;
  http.setReuse(true);
  char json[sizeof(ausc_telem_json)];
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(ausc_jobs_active() ? 20 : 1000));
    static unsigned long last_discovery = 0;
    if (ausc_wifi_ready() && !ausc_server_known() && millis() - last_discovery >= 8000) {
      last_discovery = millis(); ausc_discover_server();
    }
    if (!ausc_wifi_ready() || !ausc_server_known()) continue;
    if (ausc_is_https() && time(nullptr) < 1700000000) {
      Serial.println("[TLS] Esperando hora de red para validar el certificado.");
      continue;
    }

    if (ausc_jobs_active()) {
      ausc_register_pending(http, tls, plain);
      int j = ausc_next_ready_job();
      if (j >= 0) {
        if (ausc_jobs[j].discarded) { ausc_free_job(j); continue; }
        ausc_jobs[j].state = JOB_UPLOADING;
        ausc_upload_job(j, http, tls, plain);
      }
      continue;
    }
    if (ausc_busy() || !ausc_telem_pending) continue;

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
    if (code != 200) {
      Serial.printf("[NET] Telemetria no enviada (HTTP %d); DNS %s; WiFi %d dBm; memoria libre %u, bloque mayor %u\r\n",
                    code, ausc_dns_report().c_str(), WiFi.RSSI(),
                    (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
      ausc_net_reset(http, tls, plain);
    }
    ausc_note_http_result(code == 200);
  }
}

// Guarda la ultima telemetria; la tarea de envio la manda (no bloquea el loop).
void ausc_send_telemetry(const char* json) {
  if (!ausc_command_queue) ausc_command_queue = xQueueCreate(1, 33);
  if (!ausc_telem_task) {
    xTaskCreatePinnedToCore(ausc_telemetry_task, "ausc_telem", 12288, nullptr, 1, &ausc_telem_task, 0);
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
    size_t used = xStreamBufferBytesAvailable(ausc_ring);
    if (used > ausc_ring_peak) ausc_ring_peak = used;
  }
  ausc_reader_done = true;
  vTaskDelete(nullptr);
}

static void ausc_reader_halt() {
  ausc_reader_stop = true;
  unsigned long started = millis();
  while (!ausc_reader_done && millis() - started < 500) delay(2);
}

// ------------------------------------------------------------------------------
// Inicio / fin de grabacion
// ------------------------------------------------------------------------------
static int ausc_free_slot() {
  for (int i = 0; i < AUSC_QUEUE_LEN; i++) if (ausc_jobs[i].state == JOB_FREE) return i;
  return -1;
}

// true si se puede tomar una orden ahora: sin grabacion en curso y con lugar en la cola de envio.
// Con una particion pequena (p. ej. huge_app del nucleo) solo cabe una captura: la orden espera al envio.
static const size_t AUSC_CAPTURE_SPACE = AUSC_SAMPLE_RATE * AUSC_DURATION_S * sizeof(int16_t) + 32768;
bool ausc_can_record() {
  if (ausc_state == AUSC_RECORDING || ausc_state == AUSC_PROCESSING || ausc_free_slot() < 0) return false;
  return !ausc_fs_ready || LittleFS.totalBytes() - LittleFS.usedBytes() >= AUSC_CAPTURE_SPACE;
}

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
  int slot = ausc_free_slot();
  if (slot < 0) {
    Serial.println(F("[AUSC] Cola de envio llena: espera a que termine de enviarse una grabacion."));
    return false;
  }

  for (int i = 0; i < AUSC_NUM_BUFFERS; i++) {
    if (!ausc_buffers[i]) ausc_buffers[i] = (int16_t*)malloc(AUSC_CHUNK_SAMPLES * sizeof(int16_t));
    if (!ausc_buffers[i]) {
      Serial.println(F("[AUSC] Memoria insuficiente para los bufers de audio"));
      for (int j = 0; j < AUSC_NUM_BUFFERS; j++) { free(ausc_buffers[j]); ausc_buffers[j] = nullptr; }
      return false;
    }
  }
  if (!ausc_fs_ready && !LittleFS.begin(true, "/littlefs", 2, "spiffs")) {
    Serial.println("[AUSC] No se pudo preparar la memoria local de audio.");
    return false;
  }
  ausc_fs_ready = true;
  char path[12]; ausc_job_path(slot, path, sizeof(path));
  ausc_spool = LittleFS.open(path, "w");
  if (!ausc_spool || LittleFS.totalBytes() - LittleFS.usedBytes() < AUSC_CAPTURE_SPACE) {
    if (ausc_spool) ausc_spool.close();
    Serial.println("[AUSC] Espacio insuficiente para 15 s de audio."); return false;
  }
  if (!ausc_ring) ausc_ring = xStreamBufferCreateStatic(AUSC_RING_BYTES, 2, ausc_ring_storage, &ausc_ring_struct);
  xStreamBufferReset(ausc_ring);

  AuscJob& job = ausc_jobs[slot];
  job.failed = false;
  job.discarded = false;
  job.reg_failures = 0;
  job.bytes = 0;
  job.stream_bytes = 0;
  job.sha[0] = '\0';
  job.rec_id[0] = '\0';
  strncpy(job.command, command_id.c_str(), sizeof(job.command) - 1);
  job.command[sizeof(job.command) - 1] = '\0';
  job.started_ms = millis();
  ausc_capture_job = slot;

  mbedtls_sha256_init(&ausc_sha);
  mbedtls_sha256_starts_ret(&ausc_sha, 0);
  ausc_stream_written = 0;
  ausc_capture_error = false;
  ausc_capture_done = false;
  ausc_fill_pos = 0;
  ausc_samples_total = 0;
  ausc_dc = 0.0f;
  ausc_i2s_overflow = false;
  ausc_ring_overflow = false;
  ausc_ring_peak = 0;
  ausc_reader_stop = false;
  // Descartar muestras y avisos acumulados antes de la orden.
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

  ausc_reader_done = false;
  if (xTaskCreatePinnedToCore(ausc_reader, "ausc_i2s", 4096, nullptr, 5, nullptr, 1) != pdPASS) {
    // La tarea de red registra la captura y avisa al servidor que se interrumpio.
    Serial.println(F("[AUSC] Memoria insuficiente para el lector del microfono."));
    ausc_reader_done = true;
    ausc_capture_error = true;
  }
  portENTER_CRITICAL(&ausc_jobs_mux);
  job.state = JOB_CAPTURING;   // desde aqui la tarea de red la registra en el servidor
  portEXIT_CRITICAL(&ausc_jobs_mux);
  ausc_state = AUSC_RECORDING;
  Serial.printf("[AUSC] Grabando %d s (cola %d, memoria libre %u) orden %s\r\n", AUSC_DURATION_S, slot,
                (unsigned)ESP.getFreeHeap(), command_id.length() ? command_id.c_str() : "-");
  return true;
}

// Comprime y guarda un bloque; el SHA-256 se calcula sobre el PCM original.
static bool ausc_store_block(size_t samples) {
  mbedtls_sha256_update_ret(&ausc_sha, (const uint8_t*)ausc_buffers[0], samples * sizeof(int16_t));
  size_t size = rice_encode_block(ausc_buffers[0], samples, ausc_rice_out);
  ausc_stream_written += size;
  return ausc_spool.write(ausc_rice_out, size) == size;
}

// Cierra la captura y la deja en la cola de envio; el loop queda libre para la zona siguiente.
static void ausc_finish() {
  ausc_state = AUSC_PROCESSING;
  int slot = ausc_capture_job;
  AuscJob& job = ausc_jobs[slot];
  if (ausc_fill_pos && !ausc_store_block(ausc_fill_pos)) ausc_capture_error = true;
  ausc_spool.close();
  job.stream_bytes = ausc_stream_written;
  uint8_t hash[32];
  char hex[65] = "";
  mbedtls_sha256_finish_ret(&ausc_sha, hash);
  mbedtls_sha256_free(&ausc_sha);
  for (int i = 0; i < 32; ++i) snprintf(hex + i * 2, 3, "%02x", hash[i]);
  String digest = ausc_capture_error || ausc_samples_total != (uint32_t)AUSC_SAMPLE_RATE * AUSC_DURATION_S
                  ? String("") : String(hex);
  job.bytes = ausc_samples_total * sizeof(int16_t);
  job.failed = ausc_capture_error || digest.length() != 64;
  strncpy(job.sha, digest.c_str(), sizeof(job.sha) - 1);
  job.sha[sizeof(job.sha) - 1] = '\0';
  Serial.printf("[AUSC] Captura: %u muestras, %u -> %u bytes comprimida; %s; bufer max %u/%u; memoria libre %u, minima %u\r\n",
                (unsigned)ausc_samples_total, (unsigned)job.bytes, (unsigned)job.stream_bytes,
                job.failed ? "INCOMPLETA" : "en cola de envio",
                (unsigned)ausc_ring_peak, (unsigned)AUSC_RING_BYTES,
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap());
  portENTER_CRITICAL(&ausc_jobs_mux);
  job.state = JOB_READY;
  portEXIT_CRITICAL(&ausc_jobs_mux);
  ausc_capture_job = -1;
  ausc_result_color = job.failed ? strip.Color(255, 120, 0) : strip.Color(0, 80, 200);
  ausc_result_until = millis() + (job.failed ? 3000 : 300);
  ausc_state = AUSC_SHOW_RESULT;
}

// ------------------------------------------------------------------------------
// Captura: llamar en cada vuelta del loop mientras ausc_state == AUSC_RECORDING
// ------------------------------------------------------------------------------
void ausc_capture_step() {
  if (ausc_state != AUSC_RECORDING) return;
  if (ausc_i2s_overflow && !ausc_capture_error) {
    Serial.println("[AUSC] Desbordamiento I2S: no se clasificara audio incompleto.");
    ausc_capture_error = true;
  }
  if (ausc_ring_overflow && !ausc_capture_error) {
    Serial.println("[AUSC] La flash no guardo el audio a tiempo: no se clasificara audio incompleto.");
    ausc_capture_error = true;
  }

  const uint32_t target = (uint32_t)AUSC_SAMPLE_RATE * AUSC_DURATION_S;
  if (!ausc_capture_error) {
    size_t want = (AUSC_CHUNK_SAMPLES - ausc_fill_pos) * sizeof(int16_t);
    size_t got = xStreamBufferReceive(ausc_ring, (uint8_t*)(ausc_buffers[0] + ausc_fill_pos), want, pdMS_TO_TICKS(20));
    ausc_fill_pos += got / sizeof(int16_t);
    ausc_samples_total += got / sizeof(int16_t);
    if (ausc_fill_pos >= AUSC_CHUNK_SAMPLES) {
      if (!ausc_store_block(AUSC_CHUNK_SAMPLES)) {
        Serial.printf("[AUSC] Fallo al guardar audio local en muestra %u; errno=%d.\r\n", (unsigned)ausc_samples_total, errno);
        ausc_capture_error = true;
      }
      ausc_fill_pos = 0;
    }
    if (ausc_samples_total >= target) ausc_capture_done = true;
  }

  if (ausc_capture_done || ausc_capture_error) {
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
    // Barra de carga azul: un LED mas por cada 1/8 de la grabacion.
    for (int i = 0; i < num_leds; i++) {
      strip.setPixelColor(i, i < lit ? strip.Color(0, 70, 255) : strip.Color(0, 0, 0));
    }
  } else if (ausc_state == AUSC_PROCESSING) {
    for (int i = 0; i < num_leds; i++) strip.setPixelColor(i, strip.Color(0, 70, 255));   // captura completa
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
