#pragma once
#include <Preferences.h>
#include "wifi_provisioning.h"

// Included after auscultacion.h. All flash/WiFi operations run in loop, not BLE callbacks.
static WifiCredentials wifi_credentials;
static bool wifi_saved = false;
static volatile bool wifi_bluetooth_seen = false;
static bool wifi_attempted = false;
static bool wifi_save_on_connect = false;
static volatile bool wifi_stop_ack = false;
static bool wifi_start_pending = false;
static uint32_t wifi_started_ms = 0;
static const char* wifi_state = "waiting_bluetooth";
static const char* wifi_error = "";
static char wifi_request_id[9] = "00000000";
static WifiProvisioningBuffer wifi_buffer;
static portMUX_TYPE wifi_setup_mux = portMUX_INITIALIZER_UNLOCKED;
static char wifi_pending_body[512] = {};
static char wifi_pending_id[9] = {};
static int wifi_pending_operation = 0;  // 1 apply, 2 status, 3 forget, 4 invalid frame
static uint32_t wifi_buffer_started_ms = 0;

static void wifi_setup_event(WiFiEvent_t event) {
  if (event == ARDUINO_EVENT_WIFI_STA_STOP) wifi_stop_ack = true;
}

static void wifi_publish_status() {
  char body[180];
  snprintf(body, sizeof(body), "{\"type\":\"wifi_status\",\"id\":\"%s\",\"state\":\"%s\",\"saved\":%s,\"error\":\"%s\"}\n",
           wifi_request_id, wifi_state, wifi_saved ? "true" : "false", wifi_error);
  if (ble_connected && pTelemetryCharacteristic) {
    // Status also works with the minimum BLE MTU; the app reassembles JSON.
    for (size_t offset = 0; offset < strlen(body); offset += 20) {
      size_t count = std::min((size_t)20, strlen(body) - offset);
      pTelemetryCharacteristic->setValue((uint8_t*)body + offset, count);
      pTelemetryCharacteristic->notify();
      delay(5);
    }
  }
}

static void wifi_load_settings() {
  WiFi.onEvent(wifi_setup_event);
  Preferences prefs;
  bool has_settings = false;
  if (prefs.begin("spiro_wifi", true)) {
    if (prefs.getBytesLength("credentials") == sizeof(wifi_credentials)) {
      has_settings = true;
      prefs.getBytes("credentials", &wifi_credentials, sizeof(wifi_credentials));
      wifi_saved = wifi_credentials_valid(wifi_credentials);
    }
    prefs.end();
  }
  if (!has_settings) {
    memset(&wifi_credentials, 0, sizeof(wifi_credentials));
    if (strlen(WIFI_SSID) <= 32 && strlen(WIFI_PASSWORD) <= 64) {
      strcpy(wifi_credentials.ssid, WIFI_SSID);
      strcpy(wifi_credentials.password, WIFI_PASSWORD);
    }
  }
  WiFi.mode(WIFI_OFF);  // Bluetooth must connect before even a saved network starts.
  ausc_server_base = SERVER_URL;
  ausc_server_base.trim();
  while (ausc_server_base.endsWith("/")) ausc_server_base.remove(ausc_server_base.length() - 1);
}

static bool wifi_receive_ble(const String& command) {
  if (!command.startsWith("WIFI_")) return false;
  // Never print these frames: even hex/base64 are credentials.
  portENTER_CRITICAL(&wifi_setup_mux);
  if (wifi_pending_operation) { portEXIT_CRITICAL(&wifi_setup_mux); return true; }
  if (command.startsWith("WIFI_BEGIN_")) {
    wifi_buffer.begin(command.c_str() + 11);
    wifi_buffer_started_ms = millis();
  } else if (command.startsWith("WIFI_PART_")) {
    if (millis() - wifi_buffer_started_ms <= 15000) wifi_buffer.append(command.c_str() + 10);
    else wifi_buffer.clear();
  } else if (command.startsWith("WIFI_APPLY_") || command.startsWith("WIFI_STATUS_") || command.startsWith("WIFI_FORGET_")) {
    const char* id = command.c_str() + (command.startsWith("WIFI_APPLY_") ? 11 : 12);
    if (command.length() >= 19 && WifiProvisioningBuffer::valid_id(id)) {
      strcpy(wifi_pending_id, id);
      if (command.startsWith("WIFI_APPLY_")) wifi_pending_operation = wifi_buffer.finish(id, wifi_pending_body) ? 1 : 4;
      else if (command.startsWith("WIFI_STATUS_")) wifi_pending_operation = 2;
      else if (command.startsWith("WIFI_FORGET_")) wifi_pending_operation = 3;
    }
  }
  portEXIT_CRITICAL(&wifi_setup_mux);
  return true;
}

static void wifi_start_connection(bool save) {
  wifi_attempted = true;
  wifi_save_on_connect = save;
  wifi_started_ms = millis();
  wifi_state = "connecting";
  wifi_error = "";
  // Wait for the old STA interface to stop before testing new credentials.
  // Otherwise an old WL_CONNECTED event could incorrectly save a new password.
  wifi_stop_ack = WiFi.getMode() == WIFI_OFF;
  if (!wifi_stop_ack) WiFi.disconnect(false, false);
  WiFi.mode(WIFI_OFF);
  wifi_start_pending = true;
  wifi_publish_status();
}

static void wifi_setup_maintain() {
  char body[512] = {}, id[9] = {};
  portENTER_CRITICAL(&wifi_setup_mux);
  int operation = wifi_pending_operation;
  if (operation) {
    memcpy(body, wifi_pending_body, sizeof(body));
    memcpy(id, wifi_pending_id, sizeof(id));
    memset(wifi_pending_body, 0, sizeof(wifi_pending_body));
    wifi_pending_operation = 0;
  }
  if (millis() - wifi_buffer_started_ms > 15000) wifi_buffer.clear();
  portEXIT_CRITICAL(&wifi_setup_mux);
  if (operation) {
    strcpy(wifi_request_id, id);
    if (operation == 2) wifi_publish_status();
    else if (!ble_connected || ausc_busy()) {
      wifi_error = ausc_busy() ? "recording_busy" : "bluetooth_required";
      wifi_publish_status();
    } else if (operation == 3) {
      Preferences prefs;
      WifiCredentials empty;
      bool removed = prefs.begin("spiro_wifi", false);
      if (removed) { removed = prefs.putBytes("credentials", &empty, sizeof(empty)) == sizeof(empty); prefs.end(); }
      if (removed) {
        WiFi.disconnect(false, false);
        WiFi.mode(WIFI_OFF);
        memset(&wifi_credentials, 0, sizeof(wifi_credentials));
        wifi_saved = false; wifi_attempted = true; wifi_save_on_connect = false; wifi_start_pending = false;
        wifi_state = "disabled"; wifi_error = "";
      } else wifi_error = "storage_error";
      wifi_publish_status();
    } else {
      WifiCredentials next;
      if (operation != 1 || !wifi_parse_credentials(body, next)) {
        wifi_error = "invalid_config";
        wifi_publish_status();
      } else {
        wifi_credentials = next;
        memset(&next, 0, sizeof(next));
        wifi_saved = false;
        wifi_start_connection(true);
      }
    }
  }
  memset(body, 0, sizeof(body));
  if (!wifi_bluetooth_seen) return;
  if (!wifi_attempted) {
    if (wifi_credentials_valid(wifi_credentials)) wifi_start_connection(false);
    else { wifi_attempted = true; wifi_state = "disabled"; wifi_publish_status(); }
  }
  if (!strcmp(wifi_state, "connecting")) {
    if (wifi_start_pending && wifi_stop_ack) {
      wifi_start_pending = false;
      wifi_started_ms = millis();
      WiFi.mode(WIFI_STA);
      WiFi.setSleep(true);
      WiFi.begin(wifi_credentials.ssid, wifi_credentials.password);
      ausc_start_network_task();
    }
    if (!wifi_start_pending && WiFi.status() == WL_CONNECTED && WiFi.SSID() == wifi_credentials.ssid) {
      wifi_state = "connected";
      if (wifi_save_on_connect) {
        Preferences prefs;
        if (prefs.begin("spiro_wifi", false)) {
          wifi_saved = prefs.putBytes("credentials", &wifi_credentials, sizeof(wifi_credentials)) == sizeof(wifi_credentials);
          prefs.end();
        }
        wifi_save_on_connect = false;
        if (!wifi_saved) wifi_error = "storage_error";
      }
      wifi_publish_status();
    } else if (millis() - wifi_started_ms > 30000) {
      WiFi.disconnect(false, false);
      wifi_start_pending = false;
      wifi_save_on_connect = false;
      wifi_state = "failed"; wifi_error = "connection_failed";
      wifi_publish_status();
    }
  } else if (!strcmp(wifi_state, "connected") && WiFi.status() != WL_CONNECTED) {
    wifi_state = "failed"; wifi_error = "connection_lost";
    wifi_publish_status();
  } else if (!strcmp(wifi_state, "failed") && !strcmp(wifi_error, "connection_lost") && WiFi.status() == WL_CONNECTED) {
    wifi_state = "connected"; wifi_error = ""; wifi_publish_status();
  }
}
