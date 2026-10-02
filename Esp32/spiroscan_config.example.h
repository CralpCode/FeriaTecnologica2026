// ==============================================================================
// CONFIGURACION DE RED DEL MODO AUSCULTACION
// Copia este archivo como "spiroscan_config.h" (no se sube a git) y completa tus datos.
// ==============================================================================
#pragma once

// Red WiFi (2.4 GHz) a la que están conectados la Mac (servidor) y el ESP32.
#define WIFI_SSID      "SpiroScan-Feria"
#define WIFI_PASSWORD  "cambia-esta-clave"

// Dirección del servidor. Déjala VACÍA: el ESP32 encuentra la Mac solo (mDNS),
// en casa o en la feria. Solo pon una IP si la red bloquea mDNS, p. ej. "http://192.168.0.24:8000".
#define SERVER_URL     ""

// Identificador del dispositivo (el backend lo asocia a la sesión que la app "armó").
#define DEVICE_ID      "ESP32-BIO-01"
