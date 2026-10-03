# Diagnostico del INMP441 — 2026-10-03

## Prueba realizada

- El usuario indica que midio la alimentacion y es correcta; no se registro un valor numerico.
- Firmware compilado y cargado con PlatformIO en el ESP32 conectado a COM5. La carga termino con verificacion de los hashes de flash.
- Monitor serial a 115200 baudios, captura de 24 segundos despues de un reinicio.
- Conteo de flancos ascendentes mediante PCNT en los pads GPIO14/SCK y GPIO15/WS. Ventanas de aproximadamente 10 ms; tres mediciones, una al iniciar y dos mediante el comando `MIC`.
- PCNT se configura sin asignar pines al driver. Se habilita solo la entrada del pad y se conecta la matriz de entrada para conservar las salidas I2S.
- Se mantiene el pull-down interno de GPIO32/SD de la prueba anterior.

## Resultados

| Medicion | Ventana | SCK GPIO14 | WS GPIO15 |
| --- | ---: | ---: | ---: |
| Inicio | 10029 us | 1021737 Hz | 15954 Hz |
| MIC 1 | 10010 us | 1023277 Hz | 15984 Hz |
| MIC 2 | 10010 us | 1023277 Hz | 15984 Hz |

Las frecuencias son aproximadas: la ventana incluye el pequeno costo de reanudar y pausar los contadores. Son cercanas a los valores esperados de 1024000 Hz y 16000 Hz para dos ranuras de 32 bits a 16000 muestras/s.

- 22 bloques registrados por el diagnostico de audio; cada uno contiene 64 palabras de 32 bits y todas son cero (`nonzero:0`). El diagnostico imprime un bloque por segundo, no cada lectura realizada por el firmware.
- 185 paquetes de telemetria; ninguno tiene `audio_rms` mayor que cero.
- `i2s_read()` devuelve `ESP_OK` y 256 bytes en los bloques registrados. Eso confirma una lectura del periferico, no la presencia del microfono.
- `sensor_hw:true` en `STATUS` corresponde al MAX30102, no al INMP441.
- Registro completo: [serial_microfono_relojes_2026-10-03.log](serial_microfono_relojes_2026-10-03.log).

## Interpretacion y siguiente comprobacion

El ESP32 genera relojes cercanos a los esperados en sus propios pines. Esta prueba no comprueba que lleguen hasta el modulo, su calidad electrica ni el estado del microfono. La entrada de audio sigue sin mostrar datos distintos de cero en los bloques registrados. Todavia no hay evidencia suficiente para afirmar que el microfono este averiado.

Con el USB y cualquier alimentacion externa desconectados, usar continuidad o resistencia para comprobar desde el pin del ESP32 hasta el pad correspondiente del modulo:

| ESP32 | Modulo INMP441 |
| --- | --- |
| GPIO14 | SCK |
| GPIO15 | WS |
| GPIO32 | SD |
| GND | GND y L/R, si se usa el canal izquierdo |

Cada conexion directa debe tener una resistencia cercana a la de las puntas del multimetro al juntarlas. `OL` o una resistencia alta indica que hay que revisar ese cable, contacto o soldadura. No medir resistencia en el circuito alimentado.

Para repetir la prueba de relojes, enviar `MIC` con salto de linea en un monitor serial a 115200 baudios. El puerto quedo cerrado al terminar la captura.

## Documentacion consultada

- [Hoja de datos oficial INMP441, paginas 5 y 11](https://product.tdk.cn/system/files/dam/doc/product/sw_piezo/mic/mems-mic/data_sheet/inmp441.pdf): WS entre 7.8 y 50 kHz, SCK entre 0.5 y 3.2 MHz, 64 ciclos SCK por trama WS, formato I2S de 24 bits. Recomienda 100 kohm entre SD y GND; el pull-down interno se utiliza como prueba y no equivale a esa resistencia externa.
- [PCNT de ESP-IDF 4.4.7](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32/api-reference/peripherals/pcnt.html): conteo de flancos, filtros y operaciones de pausa, limpieza y reanudacion.
