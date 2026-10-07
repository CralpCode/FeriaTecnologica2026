#pragma once
#include <WiFiClientSecure.h>

// Arduino-ESP32 2.0.17 stop_ssl_socket() limpia el contexto con memset y
// deja socket=0. Un stop/destructor posterior puede cerrar un archivo VFS
// que haya reutilizado ese descriptor. Restablecer el sentinel tras cada cierre.
class SpiroScanTLSClient : public WiFiClientSecure {
public:
  void stop() override {
    WiFiClientSecure::stop();
    sslclient->socket = -1;
  }
  ~SpiroScanTLSClient() override {
    stop(); // El destructor de la base encontrara socket=-1.
  }
};
