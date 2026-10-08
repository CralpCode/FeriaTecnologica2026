# SpiroScan: firmware de investigación ESP32

El INMP441 captura audio para analizar en el servidor. El MAX30102 aporta señal
óptica PPG roja e infrarroja; el pulso mostrado es una estimación experimental
sobre esa señal. Este firmware no tiene exactitud clínica demostrada.

## Datos que se transmiten

La integración conserva el protocolo compacto de `main`: `v: 2`, `valid` y `cal`.
La máscara `valid` usa 1 para pulso, 2 para estimación SpO2, 4 para PRV/RMSSD,
8 para temperatura del chip y 16 para audio. Un número sin su indicador válido
no se interpreta como una medición. El backend publica también los indicadores
`heartRateValid`, `bloodOxygenValid`, `spo2Calibrated`, `signalQuality` y `sampleAgeMs`.

- El pulso procede de la señal PPG del MAX30102. Se conservan el detector,
  los filtros y el conteo de escaneo de `main`; no demuestran exactitud clínica.
- La SpO2 es una **estimación de referencia sin calibrar** (`cal: false`). Puede
  mostrarse como estimación, pero no se usa para alertas ni triaje de oxígeno.
- `hrv` representa PRV/RMSSD de intervalos ópticos, no una medición ECG.
- `chip_temp` corresponde al chip MAX30102, nunca a temperatura corporal.
- Presión arterial, temperatura corporal y estrés quedan en cero y sin validez.
- `audio_rms` está en dBFS (`audio_unit: "dBFS"`), no dB SPL calibrados;
  `audio_peak` es amplitud relativa a la escala completa digital.
- Retirar el dedo, entrar en reposo o iniciar una grabación invalida el pulso.

El servidor mantiene la lectura de registros históricos de ambos esquemas de
metadatos (`metadata_json` y `measurement_metadata`). Los registros antiguos
sin calidad explícita no se convierten en valores clínicos válidos.

## Conexiones

| Módulo | Señal | ESP32 |
| --- | --- | --- |
| MAX30102 | SDA / SCL | GPIO 21 / 22; también se sondea 23 / 22 |
| INMP441 | SCK / WS / SD | GPIO 27 / 15 / 32 |
| INMP441 | VDD / GND / L-R | 3V3 / GND / GND |
| WS2812B | DIN | GPIO 25 |
| Botón K1 / K2 | contacto a tierra | GPIO 17 / 16, pull-up interno |

Verificar la tensión VIN admitida por la **placa concreta** del MAX30102 y por
la tira LED; no confundir la tensión de un módulo con la del circuito integrado.
El bus I2C del firmware usa 100 kHz.

## Comunicación y uso

- BLE GATT `SpiroScan-Band` bidireccional, MTU solicitado 517, USB a 115200 y
  WiFi HTTP aproximadamente a 1 Hz. La app reensambla JSON fragmentado.
- K1 corto / `SCAN_CARD`: adquiere pulso; cuenta 20 s después de fijarlo.
- K2 corto / `SCAN_PULM`: lee nivel de audio durante 20 s.
- K1+K2 / K1 largo / `SCAN_CONT`: modo continuo. `STOP_SCAN` / `OFF`: reposo.
- `REC` / `GRABAR`: graba 15 s y envía PCM mono a 16 kHz al servidor. Primero
  preparar paciente y foco en Auscultar. La captura extrae una muestra mono de
  cada pareja L/R del I2S estéreo; no duplica la frecuencia ni altera la duración.
- K2 largo (1.2 s): graba si WiFi y servidor están disponibles; sin ellos conserva
  la alternancia continuo/reposo. K1 largo y la combinación mantienen ese control.
- `STATUS`, `DIAG`, `MIC` y `MICSD`: diagnóstico. No existe modo `TEST` físico.
- Crear `spiroscan_config.h` a partir del ejemplo para configurar la red.
- Compilar con `pio run` desde esta carpeta. Compilar no carga la placa.

### Servidor público y grabación desde la web

El archivo local `spiroscan_config.h` queda fuera de Git. Completar allí el SSID
y la clave de una red de 2.4 GHz:

```cpp
#define WIFI_SSID      "nombre-de-tu-red"
#define WIFI_PASSWORD  "clave-de-tu-red"
#define SERVER_URL     "https://spiroscan.tail8e9fc2.ts.net"
#define DEVICE_ID      "ESP32-BIO-01"
```

Con el SSID vacío, WiFi permanece apagado y USB/BLE siguen funcionando. Para
usar búsqueda local por mDNS se puede dejar `SERVER_URL` vacío.

Con WiFi conectado, la tarea de red consulta
`GET /api/device/comando?device_id=ESP32-BIO-01` cada segundo, incluso en reposo.
La conexión puede aumentar ese intervalo si la red tarda en responder. Durante
la captura se pausa la consulta para dar prioridad al audio. Una orden nueva
se procesa en el bucle principal; repetir su identificador no inicia otra captura.
Las respuestas JSON aceptan espacios y distintos órdenes de campos.

El `POST /api/telemetry` conserva el paquete `v:2` y añade `device_id`,
`source: "real"`, `heartRateValid`, `bloodOxygenValid`, `spo2Calibrated`,
`signalQuality`, `sampleAgeMs` y `audioUnit: "dBFS"`. La edad incluye la espera
en la cola de red; una muestra vieja pierde su validez. Si no existe una muestra,
la edad es `null`. El paquete compacto enviado por BLE/USB no cambia.

La captura conserva el protocolo:

1. `POST /api/audio/start` con `device_id`, `sample_rate: 16000`,
   `source: "real"` y `comando_id` cuando la orden viene del servidor.
2. `POST /api/audio/chunk?recording_id=...`: PCM de 16 bits, little-endian,
   mono; 8.000 muestras por bloque (0,5 s), hasta completar 15 s.
3. `POST /api/audio/finish?recording_id=...`.

Si el inicio devuelve HTTP 409 o no entrega un `recording_id`, no se captura
ni se envían bloques. Se espera una orden distinta. Los controles K1/K2 y
`REC`/`GRABAR` permanecen disponibles.

## Comprobaciones de software

Desde la raíz del repositorio:

```sh
clang++ -std=c++11 -Wall -Wextra -Werror Esp32/tests/ppg_quality_test.cpp -o /tmp/spiroscan-ppg-test
/tmp/spiroscan-ppg-test
python3 -m unittest discover -s Esp32/tests -p 'test_*.py'
```

Los casos de prueba son entradas sintéticas de protocolo, nunca datos de pacientes.
El ensayo C++ verifica `ppg_quality.h`, que pertenece al firmware de la rama del
servidor y no sustituye el detector conservado de `main`. Las pruebas Python
verifican el gateway. Ninguna de ellas demuestra exactitud clínica del montaje.

`tools/test_server_protocol.cpp` verifica el JSON de órdenes y de telemetría,
identificadores repetidos/incorrectos, reposo, antigüedad y falta de contacto.
Para ejecutarlo en PC se compila junto con `cJSON.c` y `cJSON.h` de cJSON 1.7.17
(la misma versión incluida en el SDK instalado del ESP32), usando como rutas
de inclusión `Esp32` y la carpeta de cJSON. No se añade una biblioteca nueva al
firmware: utiliza cJSON del SDK.

## Fundamento y trabajo pendiente para SpO2

Analog Devices explica que la calibración depende de la geometría óptica y
que se evalúa el sistema completo. El MAX30102 no incluye una curva R universal.
Por eso no se usan coeficientes copiados de Internet como si validaran este
montaje. Hace falta un protocolo supervisado, referencias trazables, condiciones
representativas y validación independiente. No provocar hipoxia para obtener
muestras. La activación de SpO2 debe acompañarse de evidencia y control de calidad.

Fuentes oficiales consultadas el 3 de octubre de 2026:

- [Analog Devices: Guidelines for SpO2 Measurement](https://www.analog.com/en/resources/technical-articles/guidelines-for-spo2-measurement--maxim-integrated.html).
- [Analog Devices: MAX30102 datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf).
- [Analog Devices: ausencia de curva R universal](https://ez.analog.com/optical_sensing/a/documents/c/max30102efd-t-faq/DO19495/does-the-max30102-have-an-r-curve-associated-with-it-to-correlate-the-ratio-r-acred-dcred-acir-dcir).
- [SparkFun MAX3010x library y ejemplos](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library).

## Configurar WiFi desde la app

1. Carga una vez este firmware y abre **Dispositivo** en la app.
2. Pulsa **Buscar y enlazar** para conectar primero por Bluetooth.
3. Introduce el nombre de una red de **2.4 GHz** y su contraseña; pulsa **Guardar y conectar WiFi**.
4. Espera **WiFi conectado y guardado en el ESP32**. Puedes seleccionar **Recibir datos en este paciente** para usar el servidor.

Bluetooth funciona también sin WiFi. Los campos WiFi permanecen deshabilitados hasta enlazar físicamente por BLE; el puente serial del PC no permite configurar credenciales. En la web se necesita un navegador con Web Bluetooth, como Chrome/Edge, y un origen seguro; en Android se usa el cliente nativo.

El ESP32 guarda las credenciales juntas en NVS/Preferences **después de conectarse correctamente**. Una contraseña fallida no reemplaza la configuración previamente guardada. **Olvidar red WiFi** borra esa configuración activa y deja Bluetooth disponible. Tras reiniciar, el WiFi espera la primera conexión Bluetooth antes de intentar la red guardada; después puede continuar aunque se desconecte Bluetooth.

El formulario no guarda la contraseña en el navegador ni la envía al backend. El envío BLE conserva mayúsculas, espacios y Unicode y usa escrituras de hasta 20 bytes. Las confirmaciones `wifi_status` se procesan por separado de la telemetría clínica. El firmware anterior debe actualizarse para responder a estas órdenes; enlazar por Bluetooth por sí solo no demuestra que WiFi esté configurado.

Si falla la conexión, revisa la red y la contraseña y vuelve a intentar. Un campo de contraseña vacío permite una red abierta. Durante una grabación se rechaza cambiar la red. `SERVER_URL` y `DEVICE_ID` siguen configurándose en `spiroscan_config.h`; puedes dejar `WIFI_SSID` y `WIFI_PASSWORD` vacíos para configurar todo el WiFi desde la app.

Verificación del protocolo en PC: `tools/test_wifi_provisioning.cpp` y `App Movil/tests/wifiProvisioning.test.cjs`. Las pruebas de navegador utilizan un dispositivo BLE simulado y no comprueban la asociación física al router.
