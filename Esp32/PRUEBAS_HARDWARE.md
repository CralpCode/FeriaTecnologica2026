# Prueba del ESP32 real (lista paso a paso)

Objetivo: confirmar en la placa lo que no se puede probar sin hardware: memoria con `https`, WiFi,
micrófono, sensor óptico y una grabación completa analizada por la IA.

## 0. Preparar
1. Copiar `spiroscan_config.example.h` como `spiroscan_config.h` y completar `WIFI_SSID` y `WIFI_PASSWORD`
   (red de **2.4 GHz**).
   - Misma red que la Mac: dejar `SERVER_URL ""`.
   - Desde otra red: `SERVER_URL "https://…trycloudflare.com"` (el link que muestra `./start_server.sh --tunnel`).
2. Compilar con Partition Scheme **Huge APP** y subir. Abrir el monitor serie a **115200**.
3. En la Mac, el servidor encendido (`./start_server.sh`).

## 1. Diagnóstico rápido
Escribir `DIAG` en el monitor serie y revisar:

| Línea | Bien | Qué hacer si falla |
|---|---|---|
| Memoria libre / bloque mayor | "Memoria suficiente para grabar con https" | Probar en la misma red (sin `https`) o avisar con la captura |
| WiFi | "conectado" y señal mayor a -75 dBm | Revisar nombre/clave, que sea 2.4 GHz, acercarse al router |
| Servidor | `HTTP 200` | Revisar que la Mac esté encendida y en la misma red, o el link en `SERVER_URL` |
| Sensor óptico | "detectado"; con el dedo: pulso y SpO2 | Revisar cables SDA/SCL y alimentación 3.3 V |
| Micrófono | "Nivel correcto" | "Sin datos": revisar SCK=27, WS=15, SD=32, L/R a GND. "Satura": subir `AUSC_GAIN_SHIFT` |

## 2. Vitales en la app
1. Abrir la app y, en el botón de conexión, tocar **Recibir datos en esta sesión** (ESP32 por WiFi).
2. Iniciar `SCAN_CARD` o pulsar K1; poner el dedo en el MAX30102. El conteo de 20 s empieza al fijar el pulso. La SpO2 solo se muestra como estimación sin calibrar y no participa en triaje.
3. Comparar con un oxímetro comercial y anotar ambos valores (sirve para el informe).

## 3. Grabación completa
1. En la app, pestaña **Auscultar**: elegir el foco y tocar **Preparar grabación**.
2. Apoyar el estetoscopio y **mantener K2 presionado al menos 1.2 segundos**.
3. LEDs: azul llenándose 15 s → morado (enviando) → verde, rojo o naranja.
4. En el monitor serie: `Memoria libre antes de grabar: …` y luego `[AUSC] Resultado: …`.
5. En la app debe aparecer el resultado y, en **Historial**, la grabación con el botón ▶️ para escucharla.

## 4. Calidad del micrófono (riesgo del manual, sección 8)
- Grabar el corazón de una persona sana en el foco mitral y escucharla en **Historial**.
- Si casi no se escuchan los "lub-dub" (graves por debajo de 60 Hz), anotarlo: es el límite conocido del INMP441
  y se compensa en parte con la corrección acústica (`IA/fantoma/`).

## Qué mandar si algo falla
Captura del monitor serie con la salida de `DIAG` y del intento de grabación.
