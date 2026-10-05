# Prueba del ESP32 real (lista paso a paso)

Objetivo: confirmar en la placa lo que no se puede probar sin hardware: memoria con `https`, WiFi,
micrófono, sensor óptico y una grabación completa analizada por la IA.

## Comprobación de SpO2 por serial

- Se conserva la inicialización de hardware de `main` y el cálculo actual del latido: pines, bus I²C a 100 kHz y configuración óptica `setup(0x35, 4, 2, 400, 411, 4096)`.
- Monitor a 115200 baudios; enviar `SPO2` para consultar versión, ventana, edad del resultado y muestras perdidas.
- Antes de medir, enviar `CONT` para modo infinito o `CARD` para la prueba cardíaca de 20 segundos. En reposo no se adquiere una ventana válida de oxígeno; en `CARD` el conteo comienza al fijar el pulso.
- Configuración óptica: ADC a 400 Hz con promedio de 4, FIFO a 100 Hz; promedio adicional de 4 en software para el algoritmo de referencia a 25 Hz. La ventana de 100 muestras representa 4 segundos de señal continua.
- Las líneas `[SPO2]` muestran el resultado del algoritmo, su indicador de validez, el pulso de referencia y los niveles DC y pico a pico de rojo e infrarrojo. `fifo_lost` creciente indica pérdidas de captura; se reinicia la ventana.
- La adquisición conserva el controlador SparkFun 1.1.2 usado en `main`, en una copia local `MAX30105Buffered` con 64 posiciones de almacenamiento en lugar de cuatro. Es suficiente para retener un lote completo del FIFO de 32 posiciones sin sobrescritura en software. Se conserva el bus a 100 kHz y el procesamiento de latidos de `main`.
- `PPG` devuelve una ventana óptica adquirida de hasta 100 pares a 25 Hz; sirve para comparar las formas de onda de ambos canales. `PPGREG` consulta por separado punteros, modo, frecuencia, corriente de LED e identificador del chip. `SPO2` informa muestras adquiridas, mayor lote leído, valores brutos y errores I²C. `fifo_lost` cuenta descartes detectados en el búfer de software; no sustituye al registro físico de desbordamiento ni prueba por sí solo que la señal esté libre de ruido.
- `spo2_safe.cpp` conserva la tabla y la detección de valles del algoritmo MAXREFDES117 de SparkFun 1.1.2, pero usa productos de 64 bits para evitar desbordamiento con muestras de 18 bits. También calcula la componente AC infrarroja en su propio máximo, en lugar del máximo del canal rojo. Esto no cambia el detector de latidos independiente ni equivale a calibrar la SpO2.
- Un cálculo inválido, señal saturada, pérdida de contacto o interrupción de muestras invalida la estimación. La lectura de temperatura del chip se realiza sin bloquear el FIFO.
- Se requieren tres ventanas consecutivas con variación máxima de 3 puntos y acuerdo entre los dos detectores de pulso (tolerancia de 20 % o 10 BPM). Son filtros de coherencia de ingeniería, no validación clínica. Se envía el último resultado aceptado del algoritmo, sin ajustar la cifra para acercarla al oxímetro. `i2c_errors` indica fallos de lectura; esos paquetes quedan invalidados.
- Sin `spiroscan_config.h`, WiFi permanece apagado y se usa USB/BLE. Con configuración local, WiFi conserva modem sleep para coexistir con Bluetooth.
- El micrófono transmite dBFS: `20 * log10(RMS / 8388608)`. Los valores negativos son normales; 0 representa la escala digital completa. El indicador acústico usa umbrales visuales de -58 a -30 dBFS, equivalentes a la respuesta anterior, sin afirmar que mide dB SPL.
- Para comparar, mantener contacto y posición estables y registrar simultáneamente las lecturas de un oxímetro de referencia. Una comparación puntual sirve para detectar discrepancias; no calibra clínicamente el prototipo. `cal:false` se mantiene.
- No sumar un desplazamiento ni recortar los resultados para acercarlos al oxímetro: primero revisar señal, temporización y montaje óptico.

Fuentes: [frecuencia efectiva con promedio, Analog Devices](https://ez.analog.com/optical_sensing/a/documents/DO19535/if-i-enable-sample-averaging-in-max30101-max30102-and-keep-the-sampling-rate-setting-to-be-the-same-does-the-effective-sampling-rate-go-down), [hoja de datos MAX30102](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf).

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
