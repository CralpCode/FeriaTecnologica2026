#include <cassert>
#include <iostream>
#include "wifi_provisioning.h"

int main() {
  WifiCredentials value;
  const char* json = "{\"ssid\":\"Mi Red \\u00f1\",\"password\":\" AaZ!234 \"}";
  WifiProvisioningBuffer buffer;
  assert(buffer.begin("12abcdef"));
  const char* hex = "0123456789abcdef";
  for (size_t i = 0; i < strlen(json); i += 5) {
    char part[11] = {};
    for (size_t j = 0; j < 5 && json[i + j]; ++j) {
      unsigned char c = json[i + j]; part[2*j] = hex[c >> 4]; part[2*j+1] = hex[c & 15];
    }
    assert(buffer.append(part));
  }
  char body[512] = {};
  assert(buffer.finish("12abcdef", body));
  assert(!strcmp(body, json));
  assert(wifi_parse_credentials(body, value));
  assert(!strcmp(value.ssid, "Mi Red \xc3\xb1"));
  assert(!strcmp(value.password, " AaZ!234 "));
  assert(!buffer.finish("12abcdef", body));
  assert(wifi_parse_credentials("{\"ssid\":\"Open\",\"password\":\"\"}", value));
  assert(!wifi_parse_credentials("{\"ssid\":\"X\",\"password\":\"short\"}", value));
  assert(!wifi_parse_credentials("{\"ssid\":\"X\\u0000evil\",\"password\":\"12345678\"}", value));
  assert(wifi_parse_credentials("{\"ssid\":\"X\\\\u0000\",\"password\":\"12345678\"}", value));
  assert(!wifi_parse_credentials("{\"ssid\":\"X\",\"password\":\"12345678\"}garbage", value));
  assert(!wifi_parse_credentials("{\"ssid\":42,\"password\":\"12345678\"}", value));
  assert(!buffer.begin("oops"));
  assert(buffer.begin("12345678")); assert(!buffer.append("ff00")); assert(!buffer.append("41"));
  assert(buffer.begin("12345678")); assert(buffer.append("4142")); assert(!buffer.finish("87654321", body));
  assert(buffer.begin("12345678")); assert(!buffer.append("a"));
  assert(buffer.begin("12345678")); assert(!buffer.append("gg"));
  assert(buffer.begin("12345678"));
  for (int i = 0; i < 102; ++i) assert(buffer.append("4141414141"));
  assert(!buffer.append("4141")); assert(!buffer.finish("12345678", body));
  std::cout << "WiFi framing, Unicode, validation and buffer isolation passed\n";
}
