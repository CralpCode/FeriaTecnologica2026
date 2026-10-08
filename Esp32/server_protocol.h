#pragma once
#include <cstdint>
#include <cstring>
#include <cJSON.h>

namespace spiroscan_protocol {

// Used for the direct GET response and for an order inside POST /telemetry.
// A real JSON parser accepts whitespace/key order and rejects malformed replies.
inline bool recording_id(const char* body, char (&id)[9]) {
  id[0] = '\0';
  cJSON* root = cJSON_ParseWithOpts(body, nullptr, true);
  if (!root) return false;
  const cJSON* command = cJSON_GetObjectItemCaseSensitive(root, "comando");
  if (!command) command = root;
  const cJSON* action = cJSON_GetObjectItemCaseSensitive(command, "accion");
  const cJSON* number = cJSON_GetObjectItemCaseSensitive(command, "id");
  const cJSON* seconds = cJSON_GetObjectItemCaseSensitive(command, "segundos");
  bool ok = cJSON_IsString(action) && !std::strcmp(action->valuestring, "grabar")
      && cJSON_IsString(number) && std::strlen(number->valuestring) == 8
      && (!seconds || (cJSON_IsNumber(seconds) && seconds->valuedouble == 15));
  if (ok) {
    for (int i = 0; i < 8; ++i) {
      char c = number->valuestring[i];
      if (c >= 'A' && c <= 'F') c += 'a' - 'A';
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) { ok = false; break; }
      id[i] = c;
    }
    id[8] = '\0';
  }
  cJSON_Delete(root);
  if (!ok) id[0] = '\0';
  return ok;
}

// Caller frees the returned JSON with cJSON_free. Keep BLE/USB frames unchanged.
inline char* telemetry(const char* compact, const char* device_id, uint32_t age_ms) {
  cJSON* root = cJSON_ParseWithOpts(compact, nullptr, true);
  if (!cJSON_IsObject(root)) { cJSON_Delete(root); return nullptr; }
  const cJSON* mask = cJSON_GetObjectItemCaseSensitive(root, "valid");
  const cJSON* power = cJSON_GetObjectItemCaseSensitive(root, "power");
  const cJSON* finger = cJSON_GetObjectItemCaseSensitive(root, "finger");
  const cJSON* calibrated = cJSON_GetObjectItemCaseSensitive(root, "cal");
  unsigned valid = cJSON_IsNumber(mask) ? static_cast<unsigned>(mask->valueint) : 0;
  bool active = cJSON_IsString(power) && !std::strcmp(power->valuestring, "active");
  bool contact = cJSON_IsTrue(finger);
  // Old frames waiting in the network queue never become fresh measurements.
  if (!active || age_ms > 250) valid = 0;
  if (!contact) valid &= ~7U;
  if (mask) cJSON_SetNumberValue(const_cast<cJSON*>(mask), valid);
  bool ok = cJSON_AddStringToObject(root, "device_id", device_id)
      && cJSON_AddStringToObject(root, "source", "real")
      && cJSON_AddBoolToObject(root, "heartRateValid", (valid & 1) != 0)
      && cJSON_AddBoolToObject(root, "bloodOxygenValid", (valid & 2) != 0)
      && cJSON_AddBoolToObject(root, "spo2Calibrated", cJSON_IsTrue(calibrated))
      && cJSON_AddStringToObject(root, "signalQuality", (valid & 1) ? "good" : "unstable")
      && (age_ms == UINT32_MAX ? cJSON_AddNullToObject(root, "sampleAgeMs")
                              : cJSON_AddNumberToObject(root, "sampleAgeMs", age_ms))
      && cJSON_AddStringToObject(root, "audioUnit", "dBFS");
  char* out = ok ? cJSON_PrintUnformatted(root) : nullptr;
  cJSON_Delete(root);
  return out;
}

}  // namespace spiroscan_protocol
