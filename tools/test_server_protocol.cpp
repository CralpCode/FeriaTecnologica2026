#include <cassert>
#include <cstring>
#include <iostream>
#include "server_protocol.h"
#include "recording_command.h"

int main() {
  char id[9] = {};
  assert(spiroscan_protocol::recording_id(
      "{ \"foco\": \"AV\", \"segundos\": 15, \"accion\": \"grabar\", \"id\": \"ABC12345\" }", id));
  assert(!std::strcmp(id, "abc12345"));
  RecordingCommand gate;
  assert(gate.queue("grabar", id));
  assert(gate.take(id));
  assert(!gate.queue("grabar", id));
  assert(spiroscan_protocol::recording_id(
      "{\"saved\":true,\"id\":\"wrong-id\",\"comando\":{\"accion\":\"grabar\",\"id\":\"22222222\",\"segundos\":15}}", id));
  assert(!std::strcmp(id, "22222222"));
  assert(gate.queue("grabar", id));
  for (const char* bad : {"{\"accion\":null}", "{\"comando\":null}", "{}", "[]", "broken",
       "{\"accion\":\"grabar\",\"id\":123}", "{\"accion\":\"reset\",\"id\":\"11111111\"}",
       "{\"accion\":\"grabar\",\"id\":\"11111111\",\"segundos\":30}",
       "{\"accion\":\"grabar\",\"id\":\"11111111\"} trailing",
       "{\"accion\":\"grabar\",\"id\":\"11111111x\"}",
       "{\"accion\":\"grabar\",\"id\":\"1111111!\"}"}) {
    assert(!spiroscan_protocol::recording_id(bad, id));
    assert(!id[0]);
  }

  const char* compact = "{\"v\":2,\"valid\":31,\"cal\":false,\"bpm\":78,\"spo2\":95,\"finger\":true,"
      "\"power\":\"active\",\"scan_mode\":\"continuous\",\"hrv\":40,\"audio_rms\":-45.2,\"audio_peak\":0.12,\"audio_unit\":\"dBFS\"}";
  char* wire = spiroscan_protocol::telemetry(compact, "ESP32-BIO-01", 50);
  assert(wire);
  cJSON* packet = cJSON_Parse(wire);
  auto field = [&](const char* name) { return cJSON_GetObjectItemCaseSensitive(packet, name); };
  assert(!std::strcmp(field("device_id")->valuestring, "ESP32-BIO-01"));
  assert(!std::strcmp(field("source")->valuestring, "real"));
  assert(!std::strcmp(field("audioUnit")->valuestring, "dBFS"));
  assert(cJSON_IsTrue(field("heartRateValid")));
  assert(cJSON_IsTrue(field("bloodOxygenValid")));
  assert(cJSON_IsFalse(field("spo2Calibrated")));
  assert(field("sampleAgeMs")->valueint == 50);
  assert(field("bpm")->valueint == 78);
  assert(field("hrv")->valueint == 40);
  assert(field("audio_rms")->valuedouble == -45.2);
  assert(field("audio_peak")->valuedouble == 0.12);
  std::cout << wire << '\n';  // Protocol fixture for the backend contract test.
  cJSON_Delete(packet);
  cJSON_free(wire);

  wire = spiroscan_protocol::telemetry(compact, "ESP32-BIO-01", 251);
  packet = cJSON_Parse(wire);
  assert(field("valid")->valueint == 0);
  assert(cJSON_IsFalse(field("heartRateValid")));
  assert(cJSON_IsFalse(field("bloodOxygenValid")));
  cJSON_Delete(packet);
  cJSON_free(wire);
  wire = spiroscan_protocol::telemetry(compact, "ESP32-BIO-01", UINT32_MAX);
  packet = cJSON_Parse(wire);
  assert(cJSON_IsNull(field("sampleAgeMs")));
  assert(field("valid")->valueint == 0);
  cJSON_Delete(packet);
  cJSON_free(wire);

  wire = spiroscan_protocol::telemetry("{\"v\":2,\"valid\":31,\"power\":\"standby\",\"finger\":true}", "ESP32-BIO-01", 0);
  packet = cJSON_Parse(wire);
  assert(field("valid")->valueint == 0);
  cJSON_Delete(packet);
  cJSON_free(wire);
  wire = spiroscan_protocol::telemetry("{\"v\":2,\"valid\":31,\"power\":\"active\",\"finger\":false}", "ESP32-BIO-01", 0);
  packet = cJSON_Parse(wire);
  assert((field("valid")->valueint & 7) == 0);
  assert((field("valid")->valueint & 16) != 0);
  cJSON_Delete(packet);
  cJSON_free(wire);
  assert(!spiroscan_protocol::telemetry("[]", "ESP32-BIO-01", 0));
  assert(!spiroscan_protocol::telemetry("{broken", "ESP32-BIO-01", 0));
}
