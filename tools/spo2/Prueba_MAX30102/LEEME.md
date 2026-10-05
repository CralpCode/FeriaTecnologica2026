# Prueba manual del MAX30102

Abre **Prueba_MAX30102.ino** en Arduino IDE. Conserva en la misma carpeta todos los archivos `.cpp` y `.h`: contienen el controlador con lecturas comprobadas y los cálculos diagnósticos. El paquete también incluye los helpers de SparkFun MAX3010x 1.1.2 con sus avisos originales de licencia; no necesitas instalar esa biblioteca por separado.

## Arduino IDE

1. Instala el soporte de placas **esp32 by Espressif Systems**. La compilación comprobada usa Arduino-ESP32 2.0.17; otras versiones no se han comprobado aquí.
2. Selecciona **ESP32 Dev Module** y **COM5**, o el puerto que corresponda a tu placa.
3. Compila y carga el sketch.
4. Abre el monitor serial a **115200 baudios** y selecciona **Nueva línea**.
5. Envía `INFO`: debe responder con sensor detectado, SDA21/SCL22 y registros.
6. Coloca el dedo quieto, espera unos segundos y envía `START`.
7. La prueba se detiene sola después de 30 segundos. Envía `START` para repetir o `STOP` para detenerla antes.

Este sketch usa solo el MAX30102. No envía datos a la web ni inicia micrófono, Bluetooth, WiFi o LEDs externos. La aplicación no recibirá nuevas medidas mientras esté cargado.

## Conexiones de la prueba actual

| Módulo | ESP32 |
|---|---|
| VIN | Alimentación actual desde 3V3 |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |

Conserva las resistencias externas del montaje actual: **2 kΩ de SCL a 3V3** y **1 kΩ de SDA a 3V3**, y las conexiones de cada línea a su GPIO. El programa no requiere conexiones en INT, IRD o RD. No se cambia la alimentación para ejecutar esta prueba.

Se conserva el sondeo de pines del firmware completo; la ruta física comunicada y detectada es SDA21/SCL22. Ajustes del sensor: I²C100 kHz; `setup(0x35, 4, 2, 400, 411, 4096)`; ambas corrientes `0x35`; ADC400 Hz; promedio FIFO4, aproximadamente100 pares/s; promedio por software4, análisis25 Hz con100 pares por ventana.

## Qué mirar

- `[MODULE INFO]`: identidad del programa y detección inicial. `found:1` significa detección al arrancar, no garantiza por sí solo todas las lecturas posteriores.
- `[MODULE REG]`: esperamos `08:5F:ok 09:03:ok 0A:2F:ok 0C:35:ok 0D:35:ok FF:15:ok`. El valor `15` está en hexadecimal.
- `[RAW] secuencia,rojo,infrarrojo`: datos brutos del ADC, **no porcentajes**. Al poner/quitar el dedo debe cambiar la respuesta; eso no basta para validar SpO₂.
- `[RESUMEN]`: salida breve de cada ventana, candidatos y diagnósticos.
- `[MODULE WINDOW]`: resultados completos y arrays de las dos señales. Puedes copiar estas líneas para analizar la misma adquisición en el PC.
- `[MODULE END]`: cantidad de pares, errores I²C, huecos de adquisición y descartes registrados. Esperamos aproximadamente3.000 pares en30 segundos; los contadores son controles de adquisición, no una validación clínica.

`candidate:-999` significa que la referencia no obtuvo un resultado admisible. `candidate_valid:1` **no garantiza oxígeno correcto**: solo indica que el algoritmo encontró un índice permitido de su tabla. Candidatos como2,11 o35 no son lecturas aceptables de oxígeno. `quality:1` indica controles de forma/ciclos, sin validar la calibración. El pulso de ciclos comunes y `pulse_ref` son diagnósticos y pueden discrepar; no sustituyen el detector de latidos del firmware completo.

Compara las señales con el dedo quieto y anota a la vez oxígeno y pulso de tu oxímetro. Conserva el log completo y ambas cifras. Este programa no aplica correcciones para coincidir con la referencia.

## PlatformIO

Desde esta carpeta:

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' -m platformio run -t upload
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' -m platformio device monitor --baud 115200 --port COM5
```

Sal del monitor antes de volver a cargar un programa. Si usas otro PC, ejecuta `pio` desde tu instalación y selecciona su puerto correspondiente.

## Restaurar el proyecto completo

En este proyecto, desde la carpeta `Esp32`, usa la configuración habitual:

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' -m platformio run -t upload
```

La prueba manual se guarda fuera de las fuentes del firmware completo. El código y las ramas del proyecto permanecen conservados.

## Procedencia

- Controlador basado en [SparkFun MAX3010x Sensor Library](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library), con las correcciones de adquisición usadas por el proyecto.
- Referencia MAXREFDES117 con productos ópticos de64 bits y controles adicionales de calidad.
- [Hoja de datos MAX30102](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf).

Los avisos de licencia originales permanecen en los archivos correspondientes.
