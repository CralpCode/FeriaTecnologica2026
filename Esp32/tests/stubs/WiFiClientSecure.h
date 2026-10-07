#pragma once
// Modelo del cierre de Arduino-ESP32 2.0.17: stop_ssl_socket usa memset.
class WiFiClientSecure {
protected:
  struct Context { int socket = 5; } context;
  Context* sslclient = &context;
public:
  inline static bool file_zero_open = false;
  virtual void stop() {
    if (sslclient->socket == 0) file_zero_open = false;
    sslclient->socket = 0;
  }
  virtual ~WiFiClientSecure() { stop(); }
};
