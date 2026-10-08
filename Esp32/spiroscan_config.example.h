// ==============================================================================
// CONFIGURACION DE RED DEL MODO AUSCULTACION
// Copia este archivo como "spiroscan_config.h" (no se sube a git) y completa tus datos.
// ==============================================================================
#pragma once

// Opcional: red inicial de 2.4 GHz. También se configura desde la app por BLE.
// Las credenciales guardadas desde la app tienen prioridad sobre estos valores.
// WiFi permanece apagado hasta la primera conexión BLE después de cada arranque.
#define WIFI_SSID      ""
#define WIFI_PASSWORD  ""

// Direccion del servidor:
//   ""  (vacío)  -> el ESP32 busca la Mac solo, pero SOLO si están en el MISMO WiFi.
//   "https://xxxx.trycloudflare.com"  -> envía por internet desde CUALQUIER red.
//        Es el link público de la app (sin "/" al final). Si el link cambia, hay que
//        actualizarlo aquí y volver a subir el firmware.
#define SERVER_URL     "https://spiroscan.tail8e9fc2.ts.net"

// Identificador del dispositivo (el backend lo asocia a la sesión que la app "armó").
#define DEVICE_ID      "ESP32-BIO-01"
