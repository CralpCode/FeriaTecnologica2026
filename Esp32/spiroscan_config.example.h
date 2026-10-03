// ==============================================================================
// CONFIGURACION DE RED DEL MODO AUSCULTACION
// Copia este archivo como "spiroscan_config.h" (no se sube a git) y completa tus datos.
// ==============================================================================
#pragma once

// Red WiFi (2.4 GHz) a la que están conectados la Mac (servidor) y el ESP32.
#define WIFI_SSID      "SpiroScan-Feria"
#define WIFI_PASSWORD  "cambia-esta-clave"

// Dirección del servidor (la Mac):
//   ""  (vacío)  -> el ESP32 busca la Mac solo, pero SOLO si están en el MISMO WiFi.
//   "https://xxxx.trycloudflare.com"  -> envía por internet desde CUALQUIER red.
//        Es el link público de la app (sin "/" al final). Si el link cambia, hay que
//        actualizarlo aquí y volver a subir el firmware.
#define SERVER_URL     ""

// Identificador del dispositivo (el backend lo asocia a la sesión que la app "armó").
#define DEVICE_ID      "ESP32-BIO-01"
