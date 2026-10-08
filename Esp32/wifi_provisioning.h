#pragma once
#include <cstring>
#include <cJSON.h>

struct WifiCredentials {
  char ssid[33] = {};
  char password[65] = {};
};

inline bool wifi_credentials_valid(const WifiCredentials& value) {
  if (!std::memchr(value.ssid, 0, sizeof(value.ssid)) || !std::memchr(value.password, 0, sizeof(value.password))) return false;
  size_t s = std::strlen(value.ssid), p = std::strlen(value.password);
  if (!s || s > 32 || (p && (p < 8 || p > 64))) return false;
  for (size_t i = 0; i < s; ++i) if ((unsigned char)value.ssid[i] < 32 || value.ssid[i] == 127) return false;
  for (size_t i = 0; i < p; ++i) {
    unsigned char c = value.password[i];
    if (c < 32 || c == 127) return false;
    if (p == 64 && !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return true;
}

inline bool wifi_parse_credentials(const char* json, WifiCredentials& value) {
  value = WifiCredentials{};
  if (!json) return false;
  // Reject an actual JSON NUL escape; escaped literal backslashes remain valid.
  for (size_t i = 0; json[i]; ++i) {
    if (json[i] == '\\' && json[i + 1]) {
      if (!std::strncmp(json + i + 1, "u0000", 5)) return false;
      ++i;
    }
  }
  cJSON* root = cJSON_ParseWithOpts(json, nullptr, true);
  const cJSON* ssid = cJSON_GetObjectItemCaseSensitive(root, "ssid");
  const cJSON* pass = cJSON_GetObjectItemCaseSensitive(root, "password");
  bool ok = cJSON_IsString(ssid) && cJSON_IsString(pass)
      && std::strlen(ssid->valuestring) <= 32 && std::strlen(pass->valuestring) <= 64;
  if (ok) {
    std::strcpy(value.ssid, ssid->valuestring);
    std::strcpy(value.password, pass->valuestring);
    ok = wifi_credentials_valid(value);
  }
  cJSON_Delete(root);
  if (!ok) std::memset(&value, 0, sizeof(value));
  return ok;
}

// Every BLE write is <=20 ASCII bytes, including when MTU negotiation fails.
// Payload is hex so fragmentation never trims spaces or changes Unicode/case.
class WifiProvisioningBuffer {
 public:
  bool begin(const char* id) {
    clear();
    if (!valid_id(id)) return false;
    std::strcpy(id_, id);
    return true;
  }
  bool append(const char* hex) {
    size_t n = std::strlen(hex);
    if (!id_[0] || !n || n > 10 || n % 2 || length_ + n / 2 >= sizeof(body_)) { clear(); return false; }
    for (size_t i = 0; i < n; i += 2) {
      int a = digit(hex[i]), b = digit(hex[i + 1]);
      if (a < 0 || b < 0 || (a == 0 && b == 0)) { clear(); return false; }
      body_[length_++] = (char)((a << 4) | b);
    }
    body_[length_] = 0;
    return true;
  }
  bool finish(const char* id, char (&body)[512]) {
    bool ok = valid_id(id) && id_[0] && !std::strcmp(id_, id) && length_;
    if (ok) std::memcpy(body, body_, sizeof(body_));
    clear();
    return ok;
  }
  void clear() { std::memset(body_, 0, sizeof(body_)); std::memset(id_, 0, sizeof(id_)); length_ = 0; }
  static bool valid_id(const char* id) {
    if (!id || std::strlen(id) != 8) return false;
    for (int i = 0; i < 8; ++i) if (digit(id[i]) < 0) return false;
    return true;
  }
 private:
  static int digit(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
  char id_[9] = {};
  char body_[512] = {};
  size_t length_ = 0;
};
