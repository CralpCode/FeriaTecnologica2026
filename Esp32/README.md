# ESP32S / SpiroScan — versión revisada el 6 de octubre de 2026

Proyecto completo: abrir esta carpeta, no solo el archivo `.ino`.
Las dos copias originales de `esp codigo` se conservan como referencia; necesitan
archivos auxiliares que no venían con ellas y no deben compilarse juntas.

## Entorno preparado en esta Mac

- PlatformIO en `../../.venv`, plataforma Espressif32 6.12.0 y Arduino ESP32 2.0.17.
- Placa `nodemcu-32s`, flash 4 MB, partición de aplicación de 3 MB.
- SparkFun MAX3010x 1.1.2 y Adafruit NeoPixel 1.15.2.
- USB CP2102 reconocido en `/dev/cu.usbserial-0001`; consola a 115200.
- Doble clic en `compilar_macos.command` para compilar.
- Doble clic en `subir_macos.command` para compilar y cargar por USB.
  Cerrar otros monitores serie antes de cargar. Si cambia el puerto, pasar su nombre al script.

También se puede usar desde la raíz de `spirosan`:

```sh
.venv/bin/python -m platformio run -d FeriaTecnologica2026/Esp32
.venv/bin/python -m platformio run -d FeriaTecnologica2026/Esp32 -t upload --upload-port /dev/cu.usbserial-0001
```

No usar `FIRMWARE_VITALSYNC.bin`: es el binario antiguo. El actualizado se genera en
`.pio/build/nodemcu-32s/firmware.bin`; PlatformIO carga también bootloader y particiones.
La configuración WiFi local contiene una clave y el binario compilado también:
no publicar ninguno. `spiroscan_config.h` y `.pio` están excluidos de Git.

## Conexiones

| Módulo | Señal | GPIO |
| --- | --- | --- |
| MAX30102 | SDA / SCL | 18 / 19, conexión de diagnóstico confirmada por el usuario; también admite 23 / 22 |
| INMP441 | SCK / WS / SD | 27 / 15 / 32 |
| WS2812B | DIN | 25 |

El micrófono estaba desconectado al inicio de la revisión; el usuario indicó
después que lo conectó. La tensión de alimentación
admitida por el módulo MAX30102 concreto debe verificarse antes de modificarla.
Si no aparece en I2C, revisar alimentación, GND común y los cables SDA/SCL.
El firmware admite también SDA18/SCL19 como prueba para descartar un fallo
de los GPIO23/22. Cambiar únicamente SDA y SCL con el USB y cualquier otra
alimentación desconectados; conservar VIN en 3.3 V y GND en GND.
La configuración de ejemplo usa `SPIROSCAN_MIC_CONNECTED=0`: descarta el ruido
del pin sin módulo y rechaza las grabaciones. En esta Mac se activó `1` en
`spiroscan_config.h` tras la confirmación del usuario. Si se retira el módulo,
volver a `0` y cargar de nuevo. Su presencia no se puede confirmar solo
porque el pin produzca muestras distintas de cero.

## Inicio y comunicación

La adquisición continua comienza al encender: no requiere botones. `WAKE` y
`SCAN_CONT` vuelven a activarla; `SCAN_CARD` inicia el escaneo cardíaco;
`STOP` o `SLEEP` pasan a reposo. `STATUS`, `DIAG`, `PPGREG` y `SPO2` dan diagnóstico.
Los comandos USB terminan en salto de línea.
Los botones físicos se eliminaron: GPIO16/17 no se configuran ni se leen. Las
órdenes de grabación vienen de la app. USB queda para diagnóstico técnico.

El WiFi se configura en `spiroscan_config.h`, solo local. El ESP32 utiliza WiFi de 2.4 GHz. Para descubrimiento local debe conectarse
al mismo WiFi que la Mac. En esta revisión se configuró el enlace HTTPS existente
porque la Mac y el ESP estaban en redes distintas. Con `SERVER_URL` vacío encuentra el servicio
`_spiroscan._tcp` anunciado por el servidor. Este debe escuchar en la red local.
HTTPS valida el certificado con ISRG Root X1. Se sincroniza la hora por NTP;
PlatformIO incorpora además la hora de compilación como respaldo inicial.
Si el equipo queda apagado mucho tiempo en una red que bloquea NTP y el servidor
renueva el certificado, volver a compilar para actualizar esa hora.

Con URL fija se puede indicar `http://IP_DE_LA_MAC:8000` y volver a compilar.

La telemetría sale por USB cada 100 ms y por HTTP aproximadamente una vez
por segundo. BLE es opcional (`SPIROSCAN_ENABLE_BLE=1`); esta configuración usa
WiFi/USB (`0`) para dejar memoria disponible para HTTPS y grabaciones. HTTP usa una tarea independiente y conserva solo el último paquete,
para no enviar una cola de lecturas antiguas. La búsqueda mDNS también corre fuera
de la adquisición óptica. BLE usa fragmentos de 20 bytes terminados en una línea
JSON; la web los reconstruye. La aplicación Android ya tenía un búfer de recepción.
Los callbacks BLE encolan los comandos y el loop los ejecuta.

Los paquetes incluyen procedencia, validez, edad de muestra, calidad, unidades,
modo y estado de alimentación. Un fallo de I2C, falta de dedo o muestras caducadas
no equivale a una lectura normal. El controlador FIFO conserva los 31 pares
rojo/IR disponibles y rechaza errores de bus y desbordamientos.
Si no responde a 100 kHz, se comprueba su dirección con un sondeo directo de
GPIO a unos 5 kHz. Si este recibe ACK, se intenta inicializar a 10 kHz con una
frecuencia de muestreo reducida. Esto distingue la respuesta eléctrica del
módulo de la configuración del controlador I2C.

SpO2 queda no disponible porque el montaje no tiene calibración validada. El
algoritmo de referencia solo sirve para diagnóstico técnico. Presión arterial y
temperatura corporal quedan ausentes; `chip_temp` corresponde al propio sensor.
El índice de estrés y PRV son experimentales y la web no los presenta como
mediciones clínicas validadas. El audio se expresa en dBFS, no en dB SPL.

Las órdenes de grabación enviadas por la web se recogen en la respuesta HTTP de
telemetría, conservando el identificador de la orden y la sesión del servidor.
Antes de reservar audio, se pausa telemetría y se cierra su conexión TLS. Los
clientes del envío de audio se destruyen antes de volver a telemetría.
Los 15 segundos se capturan primero en LittleFS, en la partición reservada por
`huge_app.csv`; la captura escribe bloques de 8 KB y después el envío HTTPS lee
directamente de flash en bloques de hasta 128 KB, sin reservarlos enteros en RAM.
LittleFS se monta una sola vez por arranque. El archivo temporal
se elimina al confirmar recepción completa. La red lenta puede prolongar el envío,
sin recortar la captura. Se comprueban errores de escritura y desbordamientos I2S.
El ESP comunica una interrupción mediante `/api/audio/abort`; la app consulta
`/api/audio/status` para distinguir captura, envío e inferencia y recuperar
resultados si se pierde un evento WebSocket. Una recepción sin actividad durante
180 segundos termina con error. Tras el envío, el servidor confirma longitud y
SHA-256 del PCM y guarda un trabajo en SQLite antes de responder HTTP 202. El ESP
queda disponible para otra zona mientras se analiza el audio anterior. Los bloques
llevan desplazamiento y se reintentan hasta tres veces sin duplicar muestras; también
se puede repetir la confirmación final. Un audio incompleto o alterado no se analiza.
La cola se recupera al reiniciar el servidor. Cada análisis corre en un proceso
separado con límite de 120 segundos; un fallo queda como error y conserva el WAV.
La app muestra los pendientes por zona y no permite que un resultado anterior
interrumpa la captura actual.
`SpiroScanTLSClient.h` corrige el cierre repetido de Arduino-ESP32 2.0.17:
`stop_ssl_socket` pone el identificador del socket en 0 mediante `memset`;
se restaura a -1 después de cada cierre para no cerrar un archivo VFS que
reutilice el identificador 0. La prueba C++ `tests/tls_file_descriptor_test.cpp`
reproduce el cierre incorrecto y comprueba el cierre y los destructores corregidos.
El watchdog mantiene un límite de 30 segundos para permitir la verificación
criptográfica y los tiempos máximos de conexión y lectura del cliente HTTPS.
La captura estéreo del I2S se convierte en un canal mono a 16 kHz para no duplicar
las muestras y alterar la duración del audio.

## Verificar un dispositivo conectado

Desde la raíz de `spirosan`, sin otro monitor serie abierto:

```sh
.venv/bin/python FeriaTecnologica2026/verificar_enlace.py --seconds 60
```

`--forward-usb` permite probar recepción por USB cuando WiFi no está disponible.
El script solo utiliza paquetes reales del dispositivo; no fabrica mediciones.

Pruebas de software desde `FeriaTecnologica2026`:

```sh
../.venv/bin/python -m unittest discover -s Backend/tests -p 'test_*.py'
../.venv/bin/python -m unittest discover -s Esp32/tests -p 'test_*.py'
clang++ -std=c++11 -Wall -Wextra -Werror -I Esp32/tests/stubs Esp32/tests/buffered_fifo_test.cpp -o /tmp/spiroscan-fifo-test
/tmp/spiroscan-fifo-test
```

Referencias de instalación: [NodeMCU-32S en PlatformIO](https://docs.platformio.org/en/latest/boards/espressif32/nodemcu-32s.html)
y [biblioteca oficial SparkFun MAX3010x](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library).
El almacenamiento local usa [LittleFS de Espressif](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/LittleFS/src/LittleFS.h).

La coexistencia WiFi/BLE mantiene `WiFi.setSleep(true)`: el ESP32 clásico aborta
si se desactiva el ahorro del módem mientras ambas radios están activas. Esto se
observó en la prueba USB y está documentado en el [repositorio de Espressif](https://github.com/espressif/esp-idf/issues/9595).
