# Comprobación del procesamiento óptico

El ejecutable usa directamente `Esp32/spo2_signal.cpp`; no se mantiene una segunda implementación en Python. El script Python genera señales artificiales y entrega al mismo ejecutable las ventanas reales guardadas.

Desde una terminal de desarrollo de Visual Studio con MSVC disponible, en la raíz del proyecto:

```powershell
New-Item -ItemType Directory -Force Esp32/.cache/web-smoke | Out-Null
$spo2Library = 'Esp32/.pio/libdeps/esp32dev/SparkFun MAX3010x Pulse and Proximity Sensor Library/src'
cl /nologo /EHsc /std:c++14 /W4 /I Esp32 /I tools/spo2/host /I "$spo2Library" /Fe:Esp32/.cache/web-smoke/spo2-signal-runner.exe /Fo:Esp32/.cache/web-smoke/ tools/spo2/signal_runner.cpp Esp32/spo2_signal.cpp Esp32/spo2_safe.cpp "$spo2Library/spo2_algorithm.cpp"
.\.venv-integracion\Scripts\python.exe tools/spo2/verify_signal.py --runner Esp32/.cache/web-smoke/spo2-signal-runner.exe --capture Esp32/.cache/web-smoke/ppg-fifo-capture.json --output Esp32/.cache/web-smoke/ppg-matched-processing.json
```

`--capture` admite un JSON con `windows`, cada ventana con `count: 100`, `rate_hz: 25`, arrays `ir` y `red` de 100 valores, y `elapsed_seconds`. Las capturas físicas y los binarios permanecen en la caché ignorada por Git.

## Qué se comprueba

- Cociente conocido en canales con distinta amplitud y nivel DC.
- Retirada de una deriva lineal moderada y escalado del nivel DC.
- Un cociente alto se conserva; no se fuerza hacia un porcentaje deseado.
- Rechazo de canales planos, ceros, saturación, ciclos insuficientes, ruido independiente y canales con formas incompatibles.

El algoritmo retira una tendencia lineal de IR para detectar valles y suaviza únicamente esa señal de detección. Calcula las componentes AC de ambos canales en los mismos ciclos, retirando una línea entre sus extremos. Usa RMS dividido por la media DC de cada canal y la mediana de los cocientes. Exige al menos tres ciclos, correlación mínima de 0,85, variación de intervalos hasta 20 % y dispersión MAD relativa del cociente hasta 15 %. Estos son límites de ingeniería, pendientes de validar en más capturas.

**El cociente RMS es diagnóstico.** La tabla existente utiliza otro estimador de amplitud (máximos sobre una línea de base); su calibración no se puede transferir automáticamente al RMS. El firmware mantiene ese cálculo para el porcentaje y utiliza el nuevo procesador como filtro adicional de calidad. `ratio_ref` registra el cociente exacto utilizado por la tabla; `ratio_rms` registra el análisis de ciclos comunes. Se exige una discrepancia entre estimadores de hasta 20 % como otro control de ingeniería, sin aplicar la tabla al RMS. Ninguno se ajusta para coincidir con el oxímetro.

El ejecutable también ejecuta `spo2_safe.cpp` y los helpers de la dependencia SparkFun instalada. `host/Arduino.h` proporciona únicamente los tipos numéricos y `min` necesarios en el PC; no participa en la compilación del ESP32. Las pruebas verifican que los casos artificiales limpios también superan la referencia y la comparación de estimadores.

Pasar las pruebas artificiales comprueba propiedades matemáticas y rechazos; no valida exactitud clínica ni equivalencia con un oxímetro. El pulso de este análisis es exclusivamente diagnóstico y no reemplaza el detector de `main`.

## Regresión de adquisición I²C

El controlador copiado también se comprueba con un `TwoWire` simulado que inyecta transferencias incompletas y errores de ACK. La prueba verifica el orden exacto de los pares, el cruce del búfer circular, la eliminación de toda una tanda cuando falla su segundo bloque, la recuperación y la distinción entre saturación real y bytes ausentes.

```powershell
cl /nologo /EHsc /std:c++14 /W4 /DARDUINO=100 /I Esp32 /I tools/spo2/driver_host /Fe:Esp32/.cache/web-smoke/spo2-driver-test.exe /Fo:Esp32/.cache/web-smoke/ tools/spo2/driver_read_test.cpp Esp32/MAX30105Buffered.cpp
& Esp32/.cache/web-smoke/spo2-driver-test.exe
```

El simulador no forma parte del firmware y no reemplaza las pruebas del bus físico. Se mantiene la secuencia original de transacciones y configuración; se comprueban el ACK, la cantidad de bytes recibidos y el rango de los punteros antes de procesar datos. Un error devuelve `UINT16_MAX` y descarta el búfer de software; el código del ESP32 ya maneja ese resultado invalidando la ventana y limpiando el FIFO del sensor.

## Comparación de baudios UART

`baud_probe.py` requiere el firmware con comandos `BAUD` y `BAUD_<velocidad>`. `BAUD` devuelve la velocidad real del UART; los cambios solo se aplican durante la ejecución. El arranque permanece en 115200 y no se modifica `platformio.ini` ni la configuración del MAX30102/I2S.

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' tools/spo2/baud_probe.py --output-dir Esp32/.cache/web-smoke/baud-test
# Control adicional a una sola velocidad:
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' tools/spo2/baud_probe.py --rates 115200 --output-dir Esp32/.cache/web-smoke/baud-control
```

El script cambia el ESP32 y el PC a la misma velocidad, verifica la respuesta del UART, activa modo infinito, espera seis segundos y registra veinte segundos por caso. Mide los pares ópticos mediante dos consultas del contador de adquisición, además de los paquetes JSON, errores de decodificación y diagnósticos de SpO₂. Conserva fragmentos de lectura hasta recibir un salto de línea para no confundir el timeout de una lectura con un paquete incompleto.

La restauración a 115200 se verifica en `finally`, antes de cerrar el puerto. El JSON de resultados incluye `restored_115200` y `port_closed`; si falla la restauración, se debe recuperar el UART antes de conectar el gateway. El script no activa RTS/DTR y no persiste la velocidad en la placa.

Un ensayo breve sin JSON dañados no demuestra ausencia absoluta de errores. Variaciones de pulso entre ensayos consecutivos tampoco prueban un efecto del baudrate; no se registra continuamente un oxímetro ni se controla completamente la posición del dedo.

## Respuesta independiente de los emisores internos

`optical_emitters.py` requiere firmware con el comando `OPTICAL`. Mantener el dedo quieto durante la prueba:

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' tools/spo2/optical_emitters.py --output-dir Esp32/.cache/web-smoke/optical-emitters
```

El script abre COM5 a 115200, verifica el UART y activa modo infinito. Captura cinco fases de 100 pares a la frecuencia FIFO existente: ambos emisores, ninguno, solo rojo, solo IR y ambos restaurados. El firmware modifica temporalmente solo los registros de corriente 0C/0D y restaura los valores guardados; no procesa estas fases como mediciones biométricas.

Se guardan los arrays brutos y el log, se comprueban las cinco fases completas y las banderas de restauración, y se leen los registros físicos mediante `PPGREG` al terminar. El puerto se cierra en `finally`. Ante un fallo hay que revisar el resultado guardado y recuperar la configuración antes de interpretar la prueba.

Las medias permiten comprobar respuesta y orden de canales. No validan el porcentaje de SpO₂, la calibración, la longitud de onda ni la ausencia de defectos del módulo. Un segundo por fase tampoco permite interpretar su variación como pulso cardíaco fiable.

## Firmware temporal solo para MAX30102

El programa está en `module_firmware/main.cpp`, fuera de las fuentes del firmware completo. Usa una configuración de PlatformIO independiente: `Esp32/platformio.max30102-test.ini`. El archivo habitual `Esp32/platformio.ini` y `Esp32.ino` no se sustituyen. La compilación de diagnóstico usa `.pio/max30102-test`, conservando el binario completo en `.pio/build`.

Desde `Esp32`, compilar y cargar exclusivamente la prueba:

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' -m platformio run -c platformio.max30102-test.ini -t upload
```

Se conservan literalmente las funciones `i2c_bus_recovery` y `setup_max30102` del firmware completo: mismas rutas de pines, I²C a 100 kHz y `setup(0x35, 4, 2, 400, 411, 4096)`. Compila el mismo controlador con protección de lecturas y los mismos procesadores ópticos mediante tres archivos que incluyen sus fuentes existentes. No inicia Bluetooth, WiFi, micrófono, NeoPixel ni servicios de la app. No reemplaza el detector de pulso del firmware completo.

Comandos del monitor a 115200:

- `INFO`: versión, ruta I²C y registros leídos con comprobación de ACK/cantidad.
- `START`: limpia FIFO y comienza una captura limitada a 30 segundos.
- `STOP`: detiene la captura.

`[RAW]` entrega secuencia, rojo e IR, sin aplicar un umbral de contacto para ocultar señales bajas. Promedia cuatro pares FIFO, igual que el cálculo existente, y analiza ventanas consecutivas de 100 pares a 25 Hz. `[MODULE WINDOW]` incluye arrays, candidatos originales, sus banderas, cocientes y calidad. **Un candidato o una bandera de la referencia no constituyen una medición de SpO₂ validada**; no se aplica una calibración nueva ni se presenta como telemetría de la app.

Desde la raíz, capturar con el dedo quieto:

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' tools/spo2/module_capture.py --output-dir Esp32/.cache/web-smoke/max30102-only
```

El script verifica la identidad del firmware y detección del sensor, guarda log/JSON, resume frecuencia de adquisición, errores, huecos de secuencia y candidatos, y cierra COM5 al terminar. El contador de descartes de software no demuestra ausencia de toda pérdida física en el FIFO. Los ensayos anteriores no son simultáneos ni equivalentes a una comparación controlada; si esta captura mejora, hay que repetir una comparación para atribuir una causa a las tareas desactivadas.

Para restaurar el firmware completo, desde `Esp32` usar la configuración habitual:

```powershell
& 'C:/Users/calin/.platformio/penv/Scripts/python.exe' -m platformio run -t upload
```

Antes de la carga temporal se guardaron también el código completo, `firmware.bin`, `bootloader.bin`, `partitions.bin` y sus hashes en `.cache/web-smoke/full-firmware-before-minimal`. El programa de prueba permanece cargado hasta realizar la restauración; no hay datos nuevos para la web mientras esté activo.

## Paquete para que el usuario pruebe el módulo por su cuenta

Se preparó [Prueba_MAX30102.zip](Prueba_MAX30102.zip), con la carpeta [Prueba_MAX30102](Prueba_MAX30102/LEEME.md). Incluye un `.ino`, ocho archivos C++ de soporte, instrucciones y configuración opcional de PlatformIO. El sketch conserva la adquisición del programa mínimo, añade un resumen legible y utiliza includes locales para abrirlo directamente en Arduino IDE; incluye los helpers SparkFun/MAXREFDES117 con sus avisos originales y no depende de archivos situados fuera de la carpeta.

Se compiló la conversión real del `.ino` para ESP32 con Arduino-ESP32 2.0.17. El ZIP contiene solo los doce archivos de distribución; no incluye `.pio`, binarios, logs, credenciales ni el firmware completo. Durante la preparación no se cargó código ni se abrió COM5. Los comandos de uso manual son `INFO`, `START` (30 segundos) y `STOP`, a 115200 con nueva línea.
