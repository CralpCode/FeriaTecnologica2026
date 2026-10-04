# SpiroScan: firmware de investigación ESP32

El INMP441 captura audio para analizar en el servidor. El MAX30102 aporta señal
óptica PPG roja e infrarroja; el pulso mostrado es una estimación experimental
sobre esa señal. Este firmware no tiene exactitud clínica demostrada.

## Datos que se transmiten

- `source: "real"` significa origen físico, no certificación del resultado.
- `bpm` se estima con el detector SparkFun y las muestras FIFO a 100 Hz.
  `heartRateValid` requiere contacto, cinco segundos de estabilización, al menos
  tres intervalos aceptados, muestras de menos de 250 ms y un latido de menos
  de tres segundos. Los intervalos aceptados equivalen aproximadamente a
  30–220 BPM; es el rango del detector, no un intervalo de normalidad clínica.
- `signalQuality`: `good`, `acquiring`, `poor`, `no_contact`, `stale` o
  `sensor_unavailable`. Son comprobaciones técnicas básicas, sin validación
  clínica: no detectan todos los artefactos de movimiento ni la pigmentación.
- `sampleAgeMs` es el tiempo desde la última muestra óptica. `4294967295`
  indica que todavía no se recibió ninguna.
- **SpO2 no disponible hasta calibración y validación del equipo**:
  `spo2: 0`, `bloodOxygenValid: false`, `spo2Calibrated: false`.
  Ese cero es un marcador de ausencia para clientes antiguos; nunca significa
  una saturación medida. No se genera una onda artificial ni se limita la
  saturación a valores aparentemente normales.
- No se calculan presión arterial, temperatura corporal, estrés ni HRV.
- `audio_rms` utiliza dBFS digitales (`audioUnit: "dBFS"`), no dB SPL calibrados;
  `audio_peak` es amplitud digital. Los ceros de audio indican silencio o
  ausencia de adquisición y no constituyen una medición de presión sonora.

Las comprobaciones de contacto usan umbrales de ingeniería que deben probarse
con la carcasa y montaje reales. La comprobación de saturación rechaza señales
cercanas al límite del ADC de 18 bits. Retirar el dedo, perder muestras o
interrumpir la captura elimina el pulso anterior y exige una nueva adquisición.
Durante la grabación de audio, el pulso queda inválido.

## Conexiones

| Módulo | Señal | ESP32 |
| --- | --- | --- |
| MAX30102 | SDA / SCL | GPIO 21 / 22; también se sondea 23 / 22 |
| INMP441 | SCK / WS / SD | GPIO 14 / 15 / 32 |
| INMP441 | VDD / GND / L-R | 3V3 / GND / GND |
| WS2812B | DIN | GPIO 25 |
| Botón | contacto a tierra | GPIO 17, pull-up interno |

Verificar la tensión VIN admitida por la **placa concreta** del MAX30102 y por
la tira LED; no confundir la tensión de un módulo con la del circuito integrado.
El bus I2C del firmware usa 100 kHz.

## Comunicación y uso

- BLE GATT `SpiroScan-Band`, USB serie a 115200 y WiFi HTTP a 1 Hz.
- La telemetría JSON requiere MTU BLE suficiente (el ESP32 propone 512);
  se omite la notificación si el receptor no admite el paquete entero.
  El servicio estándar Heart Rate sigue disponible con indicador de contacto.
- El gateway `../gateway.py` preserva procedencia y validez; los paquetes antiguos
  sin metadatos quedan como `unknown`. Reiniciar la entrada serie evita reenviar
  colas acumuladas. No imprime valores clínicos ficticios para campos ausentes.
- `REC` / pulsación larga: graba 15 s y envía audio con `source: "real"`.
- `WAKE` / pulsación corta: activa transmisión; `SLEEP`: reposo lógico.
  `STATUS`: estado del dispositivo. No existe modo `TEST` en el firmware físico.
- Crear `spiroscan_config.h` a partir del ejemplo para configurar la red.
- Compilar con `pio run` desde esta carpeta; instalar las dependencias declaradas
  en `platformio.ini`. La compilación y carga deben hacerse para la placa real.

## Comprobaciones de software

Desde la raíz del repositorio:

```sh
clang++ -std=c++11 -Wall -Wextra -Werror Esp32/tests/ppg_quality_test.cpp -o /tmp/spiroscan-ppg-test
/tmp/spiroscan-ppg-test
python3 -m unittest discover -s Esp32/tests -p 'test_*.py'
```

Los casos de prueba son entradas sintéticas de protocolo, nunca datos de pacientes
ni material de entrenamiento. Verifican retirada de dedo, saturación ADC,
reacquisición, caducidad, rollover de reloj, procedencia y rechazo de metadatos
incompletos. No miden sensibilidad, especificidad ni exactitud clínica.

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
