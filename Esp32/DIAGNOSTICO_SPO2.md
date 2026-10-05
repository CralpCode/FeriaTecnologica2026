# Diagnóstico de captura óptica — 4 de octubre de 2026

Referencia indicada por el usuario: **97 % de SpO₂ y 77 BPM**. No se utiliza para rellenar ni desplazar los resultados del prototipo. La referencia no se registró continuamente durante la captura, por lo que no demuestra exactitud punto a punto.

## Corrección aplicada y comprobada

SparkFun MAX3010x 1.1.2 tiene un búfer circular de cuatro posiciones. `check()` puede leer hasta 31 muestras del FIFO antes de que la aplicación las consuma; al escribir más posiciones que las disponibles se sobrescriben datos. Se incorporó una copia del controlador, `MAX30105Buffered.h/.cpp`, con **64 posiciones**. Se conservan las transacciones originales, la licencia y el resto del código del controlador.

Se verificó por comparación de fuentes que la copia solo difiere en el nombre de clase y la capacidad del búfer. Las funciones de inicialización del MAX30102 y del micrófono, y el cálculo independiente de latidos, son idénticos a `main`. No se cambiaron pines, corrientes de los LEDs, frecuencia I²C ni configuración óptica.

La alternativa inicial de lectura directa del FIFO no mostró recuperación fiable en la prueba y se retiró. La versión cargada es **2026-10-04-ppg-buffer64**, basada en el controlador original con más almacenamiento.

## Resultado de la captura real

- Modo infinito, ventana de observación de 32 segundos.
- 290 de 292 paquetes detectaron contacto.
- Contador de adquisición: 8.848 a 11.240 muestras entre las consultas a los 6 y 30 segundos: **2.392 pares en aproximadamente 24 s**, coherente con 100 Hz.
- **Cero descartes detectados en el búfer de software**, cero errores I²C registrados y cero reinicios durante esta captura.
- Tres ventanas completas de 100 pares, a 25 Hz, obtenidas a los 8, 16 y 24 segundos.
- No hubo paquetes con SpO₂ aceptada. El cálculo siguió devolviendo resultados inválidos.

El contador de descartes de software no mide por sí solo todas las pérdidas posibles del FIFO físico. Tampoco una correlación alta de los canales valida el porcentaje de oxígeno.

## Señales y reconstrucción del algoritmo

Se retiró una tendencia lineal para comparar formas de onda y se calculó su correlación. Separadamente se reconstruyó en Python el cálculo de valles y cociente del algoritmo de referencia sobre las ventanas guardadas, conservando sus reglas de división entera y selección de cocientes. Esta reconstrucción es un análisis offline, no una lectura adicional enviada por el firmware.

| Ventana | Correlación IR/rojo | Componente espectral dominante en ambos canales | Cociente R reconstruido |
|---|---:|---:|---:|
| 8 s | 0,984 | 75 BPM | 2,01 |
| 16 s | 0,909 | 45 BPM | 2,53 |
| 24 s | 0,979 | 75 BPM | 2,17 |

La resolución espectral de estas ventanas de cuatro segundos es de 15 BPM. Estos números son componentes de la señal, no una nueva medición validada del pulso. El detector de latidos conservado de `main` informó 47–110 BPM, con mediana de 91 BPM en la captura; no se ajustó para coincidir con la referencia.

El algoritmo acepta el índice de su tabla solo si `2 < R × 100 < 184`. Los tres cocientes reconstruidos son mayores que ese límite y explican que el resultado sea `-999`. La comparación óptica también muestra deriva del nivel de fondo, especialmente en la ventana de 16 segundos. Por ello no se pueden considerar todas las ventanas libres de perturbaciones.

![Señales ópticas adquiridas](.cache/web-smoke/ppg-signals.png)

## Qué queda pendiente

La pérdida por sobrescritura de software está corregida en la prueba realizada. **La precisión de SpO₂ no está resuelta.** Las señales se reciben y comparten actividad pulsátil, pero la relación medida no produce un porcentaje aceptable con la tabla actual. Aún hay que aislar los efectos de contacto, deriva, integración óptica y extracción de la componente pulsátil antes de evaluar una curva de calibración para este montaje. Una sola referencia de 97 % no permite establecer esa curva.

Los datos brutos, métricas, reconstrucción y gráfica se guardaron localmente en `.cache/web-smoke/ppg-*`; esa carpeta está ignorada por Git. El puerto serial se deja cerrado al terminar la prueba.

Fuentes: [controlador SparkFun](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library/blob/master/src/MAX30105.cpp), [hoja de datos MAX30102](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf), [fundamento y calibración de SpO₂, Analog Devices](https://www.analog.com/en/resources/technical-articles/guidelines-for-spo2-measurement--maxim-integrated.html).

## Segunda revisión: procesamiento de ciclos comunes

Se añadió `spo2_signal.cpp/.h`: detección de ciclos en IR con retirada de deriva, cálculo de AC/DC de rojo e IR en los mismos intervalos y controles de señal débil, correlación, variación de intervalos y dispersión del cociente. El procesamiento se ejecutó como C++ real en el PC, usando el mismo código que compila el ESP32; Python solo genera entradas y verifica resultados.

Pasaron diez casos artificiales. Esto comprueba las propiedades matemáticas y el rechazo de entradas defectuosas; no prueba exactitud de SpO₂.

| Ventana real | Ciclos utilizables | Cociente RMS | Cociente de referencia C++ | Resultado del filtro |
|---|---:|---:|---:|---|
| 8,06 s | 4 | 2,126 | 2,01 | Supera los controles de calidad; cociente alto |
| 16,06 s | 2 | 2,300 | 2,53 | Ciclos insuficientes |
| 24,06 s | 3 | 2,127 | 2,17 | Intervalos inestables |

La deriva lineal y la selección de ciclos no explican por sí solas el cociente alto: sigue apareciendo en la primera ventana. La comparación con el límite de la tabla es orientativa: esta tabla emplea amplitudes por máximos, mientras que el nuevo diagnóstico emplea RMS. **No se sustituyó un estimador por otro en la curva de calibración.**

El código del firmware incorpora el filtro de calidad antes de aceptar el resultado existente. Mantiene el porcentaje del algoritmo de referencia, la exigencia de acuerdo con el pulso y las tres ventanas coherentes. También exige acuerdo de los dos estimadores del cociente dentro de 20 % como control de ingeniería. Añade `ratio_ref` (valor exacto de la tabla) y `ratio_rms` (diagnóstico) al serial. Los motivos de rechazo ahora priorizan calidad óptica y validez del cálculo antes de informar discrepancia de pulso. No se modifican inicialización de hardware ni detector de latidos.

Se ejecutó también el algoritmo de referencia C++ con los helpers de SparkFun en el PC. Sus tres resultados fueron `-999` con cocientes 2,01, 2,53 y 2,17, confirmando la reconstrucción previa. El cálculo por ciclos comunes conserva valores elevados: el fallo restante no se explica únicamente por una fórmula de software ni por la pérdida de muestras corregida.

Versión preparada: **2026-10-04-spo2-quality**. La captura anterior corresponde al firmware **2026-10-04-ppg-buffer64**. Estos resultados son un análisis de datos guardados; no una nueva validación física de la versión preparada. Reproducción: [herramientas de comprobación](../tools/spo2/README.md). Resultados completos: `.cache/web-smoke/ppg-matched-processing.json`.

## Prueba física del filtro de calidad

Después del análisis anterior, se compiló y cargó **2026-10-04-spo2-quality**, con verificación de hash al terminar. Se volvieron a comparar con `main` las funciones `setup_i2s`, `setup_max30102`, todo el bloque independiente de latidos/PRV y `platformio.ini`: se mantienen idénticos.

El usuario confirmó que estaba listo para la captura y comunicó **95 % de oxígeno y 77 BPM** durante esta prueba. Es una referencia comunicada, no un registro continuo del oxímetro.

- Captura de 32 segundos en modo infinito: 295 paquetes válidos como JSON, 294 con contacto.
- Cero paquetes con oxígeno aceptado.
- Contador de adquisición: 601 a 2.996 entre las consultas a los 6 y 30 segundos, aproximadamente 100 pares/s.
- Cero descartes de software registrados y cero errores I²C registrados.
- 13 de 28 evaluaciones periódicas superaron los controles ópticos de calidad; durante las últimas evaluaciones hubo ciclos estables de 78,9–80,4 BPM, correlación de 0,994–0,998 y cociente de referencia de 1,94–2,08, fuera del dominio de la tabla.
- El detector de pulso conservado informó 83–109 BPM (mediana 100). Esto difiere de la referencia de 77 BPM; no se modifica ese detector porque el usuario pidió conservarlo. Los ciclos diagnósticos no reemplazan el pulso de la app.
- En otras ventanas, la tabla devolvió candidatos inferiores a 70 %, también rechazados. El filtro no convierte esos valores en lecturas aceptadas ni ajusta los resultados para alcanzar 95 %.

Se guardaron `ppg-quality-capture.json/.log`, `ppg-quality-analysis.json` y `ppg-quality-summary.json` en la caché local. El puerto serial se cerró al finalizar la captura. **La versión nueva filtra y explica mejor los rechazos; la exactitud de SpO₂ sigue sin estar resuelta.** Se requiere una prueba controlada de contacto/luz y evaluación de la integración óptica antes de elegir una curva de calibración.

## Prueba con el módulo cubierto y protección de lecturas incompletas

El usuario confirmó que cubrió el sensor con la otra mano, manteniendo el dedo. La segunda captura no permite aislar la luz ambiental: registró contadores de error I²C de 8 y 10 y ventanas de 54, 100 y 15 muestras. Hubo pares de canales en `262143`. Los contadores son acumulativos; no se demuestra que cubrir el sensor causara los errores ni que todos ocurrieran durante los 32 segundos observados. La única ventana completa conservó un cociente de referencia de 2,14 y no hubo oxígeno aceptado.

La inspección del controlador detectó dos defectos de adquisición:

1. No verificaba el ACK ni que `requestFrom()` entregara todos los bytes. Cuando `read()` devolvía `-1`, convertir a byte y aplicar la máscara de 18 bits producía `262143`. Por tanto, no se puede considerar cada aparición del máximo del ADC como saturación óptica real.
2. `check()` avanzaba el índice de escritura antes de almacenar, pero los getters FIFO devolvían la posición del último dato consumido. Entregaban un dato anterior, incluían la posición inicial vacía y retrasaban la muestra final. Se corrigieron para leer la siguiente posición del búfer.

La versión **2026-10-04-spo2-read-guard** comprueba ACK, rango de punteros de cinco bits y longitud de cada transferencia. Ante un fallo descarta toda la tanda, incluida cualquier parte recibida antes del error, y devuelve un marcador que el ESP32 utiliza para invalidar la ventana y limpiar el FIFO físico. Conserva la secuencia de transacciones válidas y los ajustes de hardware. `safeCheck()` distingue cantidades positivas de muestras de errores.

Pasaron 17 casos de adquisición con el código C++ real del controlador y un `TwoWire` simulado: secuencias completas de pares, cruce del búfer circular, fallo de ACK/datos en ambos punteros, punteros fuera de rango, fallos en el primer y segundo bloque FIFO, recuperación y saturación real con transporte íntegro. Estos casos no sustituyen la verificación del bus físico.

Se compiló y cargó esta versión con verificación de hash. La captura final de 32 segundos produjo:

- 295 paquetes JSON, 294 con contacto y tres ventanas completas de 100 pares.
- Contador de adquisición de 600 a 2.994 entre las consultas a los 6 y 30 segundos: aproximadamente 100 pares/s.
- Cero errores I²C y cero descartes de software registrados en esta captura.
- Cero paquetes de oxígeno aceptado; 5 de 28 evaluaciones superaron los controles ópticos de calidad. Persistieron ventanas perturbadas y cocientes incompatibles con una estimación de oxígeno aceptable.
- Pulso de `main` entre 45 y 88 BPM, mediana 56. La última referencia comunicada fue 77 BPM, antes de esta captura final; no se actualizó ni registró continuamente. No se puede afirmar coincidencia ni validación del pulso. Su detector permanece idéntico a `main`.

La primera captura con cero errores también presentó cocientes altos en ciclos estables. La última captura elimina los fallos registrados de adquisición durante su observación, pero no resuelve la relación óptica ni la exactitud. **No está demostrado que el módulo esté dañado, ni que calibrar la curva sea por sí solo suficiente.** Se necesita identificar el módulo y revisar contacto/óptica con señales repetibles.

Los archivos finales son `ppg-read-guard-capture.json/.log`, `ppg-read-guard-analysis.json` y `ppg-read-guard-summary.json`, en la caché local. El monitor serial se dejó cerrado. Ninguna rama de colaboradores ni `main` se modificó; los cambios permanecen sin commit ni push en la rama de integración.

## Comparación de baudios — 4 de octubre de 2026

Se cargó **2026-10-04-serial-baud-test**, que permite cambiar temporalmente la velocidad del UART. El usuario confirmó que mantendría el dedo colocado. Se conservan `Serial.begin(115200)` al arrancar, `platformio.ini`, los ajustes I²C/I2S del sensor y el detector independiente de latidos de `main`.

Se compararon **ambos extremos a la misma velocidad**, no únicamente un monitor configurado incorrectamente. El ESP32 confirmó su divisor real de UART; las pequeñas diferencias 115201, 230423 y 460929 respecto a las velocidades solicitadas son redondeos del divisor. Cada prueba activó modo infinito, esperó seis segundos y registró aproximadamente veinte segundos.

| Baudios solicitados | JSON válidos | JSON dañados | Pares ópticos/s | Nuevos errores I²C | Nuevos descartes software | SpO₂ aceptadas |
|---:|---:|---:|---:|---:|---:|---:|
| 115200 | 193 | 1 | 99,60 | 0 | 0 | 0 |
| 230400 | 194 | 0 | 99,59 | 0 | 0 | 0 |
| 460800 | 195 | 0 | 99,75 | 0 | 0 | 0 |
| 57600 | 189 | 6 | 99,65 | 0 | 0 | 0 |
| 115200, repetición | 193 | 0 | 99,62 | 0 | 0 | 0 |

### Qué muestran los resultados

Aumentar los baudios **no resolvió SpO₂ en estas capturas**. El sensor siguió adquiriendo aproximadamente cien pares por segundo a todas las velocidades. Los porcentajes se rechazan en el ESP32 antes de transmitirse; la prueba no permite atribuir el fallo de oxígeno al UART. Esto no valida la captura óptica ni descarta toda influencia temporal del programa.

El paquete dañado del primer control a 115200 contenía 32 bytes nulos dentro del JSON. Su origen no quedó identificado y no se repitió en el segundo control; no se puede afirmar que fuera un desajuste de baudios.

Los seis JSON dañados a 57600 contienen mensajes de error `BLECharacteristic.cpp:537 ... notify: rc=-1` intercalados dentro de la trama JSON. No son simplemente texto ilegible por elegir una velocidad incorrecta. Además, se registraron errores de notificación BLE a todas las velocidades: 24, 32, 24 y 18 en la primera serie, respectivamente. Estos fallos pueden contribuir a pérdidas de actualización de la app, pero no explican por sí solos la invalidez del cálculo de oxígeno. Aún no se determinó la causa del fallo GATT (por ejemplo, congestión o restricciones de transmisión); no se demostró un problema específico de MTU.

**Estado final verificado:** UART del ESP32 y PC configurados a 115200 (divisor informado 115201), puerto COM5 cerrado y modo infinito activo. No se abrió nuevamente el gateway ni se cambiaron ramas externas. El comando de diagnóstico permanece disponible, con 115200 como valor de arranque.

Datos: `.cache/web-smoke/baud-test-2026-10-04/baud-results.json`, sus cuatro logs, y `.cache/web-smoke/baud-test-repeat-115200/baud-results.json`. La herramienta reproducible es [baud_probe.py](../tools/spo2/baud_probe.py).

Fuente de la API de cambio/verificación de UART: [Espressif, Serial](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html). Se comprobó también su disponibilidad en el `HardwareSerial.h/.cpp` instalado y se validó mediante las respuestas físicas de la placa.

## Aclaración del usuario: indicadores RGB retirados

El usuario confirmó después que los LEDs RGB del equipo ya estaban retirados desde la prueba anterior. Por tanto, la interferencia de esos indicadores no se mantiene como explicación de las capturas realizadas en esa condición, y no corresponde repetir una prueba de apagarlos. Esto no implica que los LEDs rojo e infrarrojo internos del MAX30102 estuvieran apagados.

Se revisó de nuevo el recorrido de los canales: el controlador lee tres bytes para rojo y después tres para infrarrojo; la aplicación entrega el array IR como primer parámetro y el rojo como tercer parámetro del algoritmo. Corresponde al orden LED1/rojo y LED2/IR del MAX30102 en modo SpO₂. No se encontró una inversión de canales en ese recorrido del código, aunque aún falta identificar visualmente el módulo y comprobar su respuesta física.

En las ventanas guardadas, el cálculo original de amplitudes y el diagnóstico de RMS obtienen cocientes elevados semejantes. Esto confirma el motivo del rechazo de la tabla, pero no establece una causa única. Siguen pendientes contacto/óptica, respuesta de ambos emisores internos y adecuación de la curva de calibración. La siguiente prueba que discrimina la respuesta física consiste en medir cada emisor interno por separado y restaurar los valores originales; aún no se ejecutó. El UART continúa a 115200 y el puerto serial permanece cerrado.

## Prueba física de emisores internos — 4 de octubre de 2026

Tras confirmar el usuario que había colocado el dedo, se ejecutó la prueba con **2026-10-04-optical-emitter-test**, compilado y cargado con verificación de hash. El comando `OPTICAL` se encola para ejecutarse en el bucle principal; durante la prueba se invalida la telemetría biométrica y se pausa su cálculo. Solo se alteran temporalmente las corrientes de los emisores internos, conservando el resto de la configuración. Se restablecen los valores guardados incluso si una fase falla.

Cada fase adquirió 100 pares FIFO en aproximadamente un segundo, con cero errores I²C registrados:

| Emisores activos | Media rojo (ADC) | Media IR (ADC) | Pico a pico rojo | Pico a pico IR |
|---|---:|---:|---:|---:|
| Ambos, antes | 6.830,2 | 4.808,7 | 108 | 125 |
| Ninguno | 50,9 | 52,1 | 93 | 91 |
| Solo rojo | 6.824,0 | 47,0 | 137 | 89 |
| Solo infrarrojo | 50,6 | 4.813,6 | 83 | 142 |
| Ambos, restaurados | 6.826,2 | 4.802,6 | 132 | 123 |

**Resultado:** ambos emisores producen respuesta y sus canales no están intercambiados. El canal cuyo emisor está apagado vuelve cerca del fondo observado con ambos apagados. Esto no demuestra la longitud de onda efectiva, la calidad del módulo ni la exactitud de SpO₂. La variación pico a pico del fondo es apreciable frente a la variación de las fases encendidas; con fases de un segundo no se puede separar de manera fiable ruido, movimiento y componente cardíaca ni calcular una calibración.

Se verificaron `complete:1 restored:1 configuration_unchanged:1` y una lectura independiente posterior: registros `08=5F`, `09=03`, `0A=2F`, `0C=35`, `0D=35`, todos con lectura correcta; identificador `FF=15`. `setup_i2s`, `setup_max30102` y el bloque independiente de latidos/PRV se compararon de nuevo con `main` y permanecen idénticos. El puerto COM5 quedó cerrado y el UART permanece en 115200. No se reinició el gateway.

No se midió un porcentaje de oxígeno durante esta prueba ni se registró un oxímetro simultáneo. El rechazo de las capturas anteriores sigue sin una causa única confirmada. Identificar visualmente el módulo y comparar el montaje con otro MAX30102 conocido permitiría distinguir un problema del módulo/óptica de una limitación de integración o calibración, manteniendo los ajustes de `main`.

Datos locales: `.cache/web-smoke/optical-emitters-2026-10-04/optical-emitters.json` y `.log`. Herramienta: [optical_emitters.py](../tools/spo2/optical_emitters.py). Fuente para la asignación y control independiente de los emisores: [hoja de datos MAX30102, registros LED1_PA y LED2_PA](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf).

## Firmware mínimo: MAX30102 sin las demás tareas

Por solicitud del usuario se preparó y cargó temporalmente **2026-10-04-max30102-only**. Su código está en `tools/spo2/module_firmware/main.cpp` y la configuración de compilación en `Esp32/platformio.max30102-test.ini`. No se sustituyeron el código completo ni `platformio.ini`; se conservó también una copia del binario completo y sus hashes en `.cache/web-smoke/full-firmware-before-minimal`.

Las funciones de recuperación e inicialización del sensor se copiaron literalmente del firmware completo y se comprobó su igualdad. La prueba reutiliza el controlador corregido y los dos procesadores existentes, pero no inicia Bluetooth, WiFi, micrófono ni NeoPixel. Captura todas las muestras sin exigir un umbral de contacto y analiza ventanas consecutivas, sin presentar candidatos como medidas clínicas ni enviar datos a la app. El detector de latidos del firmware completo permanece sin cambios y no se ejecuta en este ensayo.

Compilación satisfactoria (17,66 s), RAM 24.244 bytes y flash 298.577 bytes. Carga satisfactoria (10,05 s), con hashes verificados. La identidad del firmware y sus parámetros se confirmaron mediante respuesta física: SDA21/SCL22, I²C100 kHz, ADC400 Hz, promedio FIFO4 y análisis25 Hz. Registros `08=5F`, `09=03`, `0A=2F`, `0C=35`, `0D=35`, `FF=15`, todos con lectura correcta.

El usuario confirmó el dedo colocado y comunicó **95 % de oxígeno y 81 BPM** durante la captura, sin registro continuo del oxímetro:

- 2.990 pares adquiridos en 30,002 s: 99,66 pares/s.
- Cero errores I²C, cero huecos de adquisición mayores de 250 ms registrados y cero descartes de software registrados; tanda máxima de 12 pares.
- El log serial recibió 2.982 líneas brutas, sin líneas RAW/JSON malformadas. Faltan las secuencias 1.313–1.320: ocho líneas cuyo origen de pérdida no se determinó. No se confunde esta pérdida de líneas con un error de adquisición del sensor ni se afirma un transporte perfecto.
- Medianas brutas: rojo 184.843,5 e IR 106.738; cero pares saturados en las líneas recibidas.
- Siete ventanas completas de 100 pares a 25 Hz. Cinco superaron los controles de calidad óptica, aunque conservaron un cociente alto.

| Tiempo aproximado | Cociente de referencia | Cociente RMS | Candidato de la tabla | Calidad óptica |
|---|---:|---:|---:|---|
| 4 s | 1,88 | 1,951 | -999 (inválido) | Supera controles |
| 8 s | 1,91 | 1,996 | -999 (inválido) | Supera controles |
| 12 s | 1,85 | 1,939 | -999 (inválido) | Inestable |
| 16 s | 1,74 | 1,858 | 11 | Supera controles |
| 20 s | 1,62 | Sin ciclos válidos | 26 | Ciclos insuficientes |
| 24 s | 1,79 | 1,877 | 5 | Supera controles |
| 28 s | 1,81 | 1,913 | 2 | Supera controles |

**11, 26, 5 y 2 son salidas diagnósticas de la tabla, no porcentajes de oxígeno aceptados.** La bandera interna de la referencia solo indica que encontró un índice admisible; ninguno está en el rango 70–100 exigido por el firmware completo. `-999` también es un marcador de invalidez. Los pulsos diagnósticos de la referencia variaron 60–150 BPM y los de ciclos comunes 74,1–94,9 BPM en ventanas con ciclos, sin demostrar exactitud frente a los 81 BPM comunicados.

**Conclusión limitada:** desactivar las demás tareas no resolvió el cociente alto ni la estimación de oxígeno en esta captura. No se puede atribuir el problema únicamente a Bluetooth, micrófono o carga del firmware completo, ni declarar el módulo dañado. La posición del dedo y las ventanas no fueron idénticas a los ensayos anteriores, por lo que no se interpreta la diferencia de amplitudes como efecto causal del firmware. Sigue siendo útil identificar el módulo y comparar un segundo MAX30102 conocido con el mismo programa antes de cambiar la calibración.

Datos: `.cache/web-smoke/max30102-only-2026-10-04/module.json` y `.log`. La captura terminó, se envió `STOP` y COM5 quedó cerrado. **Permanece cargado el firmware temporal; la web no recibe telemetría de esta versión.** Para restaurar el completo se usa la configuración habitual: desde `Esp32`, `python -m platformio run -t upload`. Instrucciones en [tools/spo2/README.md](../tools/spo2/README.md).

## Revisión posterior y comparación de módulos pendiente

Se reprodujeron las siete ventanas de la captura mínima con el ejecutable C++ del PC (`spo2-signal-runner.exe`). Coincidieron en las siete el candidato de la referencia, su bandera y ambos cocientes, dentro de la precisión publicada por el serial. Resultado: `.cache/web-smoke/max30102-only-2026-10-04/offline-replay.json`, con `all_desktop_results_match_device: true`.

Esto confirma la reproducción del procesamiento guardado en otro entorno; **no es una validación independiente de la fórmula ni de su calibración**, porque se ejecuta el mismo código. En las cinco ventanas que superaron los controles, la correlación mínima entre ciclos fue aproximadamente 0,982–0,997, y los cocientes RMS permanecieron en 1,858–1,996. La correlación alta por sí sola no garantiza que esas señales produzcan una estimación correcta de SpO₂.

No se realizó una nueva captura, no se abrió COM5 y no se modificó ni volvió a cargar el firmware durante esta reproducción. El programa temporal permanece preparado para repetir el ensayo con otro módulo. La sustitución física depende del usuario: apagar/desconectar el ESP32 antes de cambiar el módulo y conservar exactamente las conexiones. Se solicitó confirmar la disponibilidad de un segundo MAX30102 o aportar fotos nítidas de ambos lados del actual. Hasta contar con esa información no se puede informar una comparación entre sensores ni atribuir el problema al módulo.

La documentación del fabricante también exige evaluar las señales y calibrar el conjunto óptico; no permite concluir exactitud a partir de ejecutar una tabla existente: [Analog Devices, Guidelines for SpO2 Measurement](https://www.analog.com/en/resources/technical-articles/guidelines-for-spo2-measurement--maxim-integrated.html).

## Repetición solicitada con el mismo módulo

El usuario pidió volver a escanear y confirmó que sigue conectado el mismo MAX30102. La primera consulta `INFO` no respondió dentro del plazo; se cerró COM5 sin iniciar la captura. Una consulta posterior confirmó el firmware temporal y todos los registros esperados, y se reintentó sin volver a cargar código ni cambiar parámetros.

Captura satisfactoria: **2.989 pares en 30,000 s (99,63 pares/s)**, cero errores I²C, cero huecos de adquisición mayores de 250 ms y cero descartes de software registrados. El log recibió 2.987 líneas RAW, con un hueco de dos secuencias y sin líneas RAW/JSON malformadas; no se ha determinado el origen de esa pérdida de líneas. No hubo pares saturados en los datos recibidos. Medianas brutas: rojo 189.400 e IR 105.744.

Las siete ventanas completas superaron los controles de calidad óptica. Los ciclos comunes indicaron **81,1–82,2 BPM**, pero el algoritmo original de referencia indicó 125–150 BPM. Ambos son diagnósticos del programa mínimo, no el detector de latidos de `main`; no se modificó ese detector. El usuario no proporcionó una lectura nueva del oxímetro durante esta repetición. Los 95 %/81 BPM comunicados pertenecen al ensayo anterior y no se consideran una referencia simultánea de este.

Los cocientes RMS fueron **1,880–2,013**, manteniendo el problema aun con ciclos estables. La referencia seleccionó cocientes de 1,54–1,88 y produjo candidatos `16, 3, 27, 6, 3, 35, -999`; ninguno constituye una lectura de oxígeno aceptable. El acuerdo entre estimadores tampoco fue uniforme: la diferencia supera el 20 % en la ventana cuyo cociente de referencia fue 1,54. Que una ventana supere controles de forma/ciclos no valida su conversión a SpO₂.

**Resultado:** la repetición mejora la estabilidad de los ciclos frente a la captura mínima anterior, pero no resuelve el porcentaje de oxígeno ni demuestra un defecto físico del módulo. No es una comparación con un segundo sensor. Datos guardados en `.cache/web-smoke/max30102-only-repeat-2026-10-04-02/module.json` y `.log`; el intento fallido se conserva en la carpeta terminada en `-01`. Captura detenida y puerto serial cerrado. Sigue cargado el firmware temporal.

## Inspección de la primera fotografía del módulo

Se recibió `Videos/WhatsApp Image 2026-10-04 at 4.00.06 PM.jpeg`. La cara fotografiada muestra una placa verde rotulada MAX30102, marca de revisión aparentemente `708-2`, tres resistencias `472` (valor nominal 4,7 kΩ) y un conector con etiquetas VIN, SCL, SDA, INT, IRD, RD y GND. La inscripción de la placa no permite identificar de forma fiable al fabricante ni comprobar el chip instalado. No se aprecia una rotura inequívoca; los reflejos/restos superficiales y soldaduras no permiten concluir un corto ni un defecto óptico a partir de esta imagen. No se ven el reverso ni los cables al ESP32.

La [documentación de Theremino, página 5](https://www.theremino.com/wp-content/uploads/files/Theremino_ArduHAL_Reading_I2C_Sensors_ENG.pdf) muestra una placa verde similar y un esquema con pullups a 1,8 V. La propia publicación advierte que no comprobó esa variante y que puede corresponder a una revisión antigua. **No es el esquema confirmado de la placa del usuario y no demuestra que tenga ese problema.** Se toma únicamente como motivo para medir los niveles reales, sin retirar resistencias ni cortar pistas.

Se solicitaron una foto del reverso/conexiones y voltajes de VIN, SDA y SCL respecto a GND con la alimentación actual y el multímetro en V continuo. El firmware mínimo permanece detenido tras la captura y sin monitor abierto, por lo que no se inicia otra lectura I²C mientras se pide medir el bus en reposo. Si SDA/SCL están aproximadamente en 1,8 V al estar libres, no alcanzarían el nivel alto garantizado del ESP32 alimentado a 3,3 V: mínimo 0,75 × VDD, aproximadamente 2,48 V, según [Espressif, características DC del ESP32](https://documentation.espressif.com/esp32_datasheet_en.html). Hay que medir y comprobar el circuito antes de aplicar cambios.

El [MAX30102, hoja de datos](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf), distingue VDD de 1,7–2,0 V y VLED+ de 3,1–5,0 V. Esos son los suministros del chip, no un rango confirmado de VIN para esta placa genérica. No se ha recomendado cambiar VIN ni conectar IRD/RD sin conocer su circuito. Un problema de nivel del bus sería una cuestión eléctrica que revisar, pero no se atribuye a él el cociente alto de las capturas sin errores registradas anteriormente.

No se abrió COM5, no se cargó código ni se modificaron los ajustes de `main` durante la inspección de esta foto. Las mediciones y la segunda cara de la placa siguen pendientes.

## Resistencias añadidas y niveles comunicados por el usuario

El usuario aclaró que alimenta VIN desde 3V3 y que para lograr comunicación añadió dos resistencias externas hacia 3V3, manteniendo SDA/SCL conectadas al ESP32: **4,59 kΩ en SCL y 1 kΩ en SDA**. Después comunicó **SCL=2,54 V y SDA=2,91 V** respecto a GND. Son mediciones del usuario, no lecturas realizadas por el ESP32 ni una captura de flancos con osciloscopio.

Suponiendo la alimentación de E/S del ESP32 a 3,3 V, el mínimo alto garantizado de 0,75 × VDD es 2,475 V. SCL tiene solo unos 65 mV de margen estático; SDA tiene unos 435 mV. Esto identifica un margen reducido en SCL que merece mejorar, pero no confirma un fallo de bits ni la causa de la relación óptica elevada. Las últimas capturas no registraron errores I²C. Una lectura de multímetro tampoco verifica el tiempo de subida del bus.

El modelo simplificado con una resistencia interna de 4,7 kΩ a 1,8 V predice SCL≈2,56 V con la externa de 4,59 kΩ, compatible con la medida comunicada. No demuestra la topología interna: se ignoran las resistencias internas del ESP32, tolerancias y otros circuitos. Con una externa de 2,2 kΩ, el mismo modelo predice aproximadamente 2,82 V, pendiente de medir físicamente.

Se propone una prueba reversible: con la alimentación desconectada, sustituir únicamente la resistencia externa de SCL por **2,2 kΩ**, conservando la de SDA, los pines y VIN. Volver a alimentar y medir SCL en reposo antes de repetir el escaneo. No se cortan pistas ni se retiran componentes internos. 2,2 kΩ está dentro del intervalo orientativo 2–5 kΩ de [Espressif para pullups I²C](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/i2c.html); el valor definitivo depende del circuito y su carga. **El cambio no se ha realizado ni probado todavía**, y no se presenta como solución confirmada de SpO₂.

La revisión del reverso y de la alimentación interna del módulo sigue pendiente. El puerto serial permanece cerrado; no se cambió el firmware ni la configuración de `main` durante esta evaluación.

## Sustitución externa de SCL comunicada por el usuario

El usuario indicó que dispone de resistencias de 2 kΩ y 1 kΩ. Se acordó utilizar **2 kΩ en sustitución de la externa de 4,59 kΩ de SCL**, conservando la externa de SDA de 1 kΩ, y después confirmó haber realizado el cambio. No se ha recibido todavía la medida del voltaje posterior ni se ha confirmado el dedo colocado para esta nueva captura.

La comprobación serial posterior respondió con `2026-10-04-max30102-only`, detección activa en SDA21/SCL22 y los registros `08=5F`, `09=03`, `0A=2F`, `0C=35`, `0D=35`, `FF=15`, todos leídos correctamente. No se volvió a cargar firmware ni se modificaron parámetros. Log: `.cache/web-smoke/max30102-after-scl-2k-2026-10-04/preflight.log`.

Esta comprobación confirma respuesta del bus y configuración, **no el resultado de SpO₂ después del cambio**. Se cerró COM5 al terminar. La captura con dedo y los niveles de SDA/SCL posteriores siguen pendientes.

## Captura después de sustituir la resistencia externa de SCL

Posteriormente el usuario comunicó **2,75 V y dedo recién colocado**. Al haber solicitado primero SCL y después SDA, se interpretó esa única cifra como SCL y se comunicó esa interpretación antes de iniciar la prueba. No se recibió un nuevo valor de SDA. La cifra de SCL mejora el margen estático respecto a los 2,54 V anteriores; no verifica flancos ni determina por sí sola el voltaje de las resistencias internas de la placa.

Con el mismo firmware mínimo y configuración se registraron **2.988 pares en 30,000 s (99,60 pares/s)**. El log recibió las 2.988 líneas RAW completas, sin huecos de secuencia ni líneas RAW/JSON malformadas. Se registraron cero errores I²C, cero huecos de adquisición mayores de 250 ms y cero descartes de software; tanda máxima de 12 pares. No hubo pares saturados en lo recibido. Medianas brutas: rojo 182.446 e IR 107.812.

Las siete ventanas completas dieron `candidate:-999`, `candidate_valid:0`; es un marcador de cálculo inválido, no una medición de oxígeno. Los cocientes de referencia fueron **1,90–2,08**, todos fuera del intervalo admitido por la tabla. Tres ventanas superaron los controles de calidad óptica, conservando cocientes RMS 1,973, 1,987 y 2,027. Los ciclos diagnósticos de esas tres ventanas indicaron 68,2, 75,9 y 80,4 BPM. En las demás se informaron inestabilidad o ciclos insuficientes. El detector de latidos del firmware completo no se ejecuta ni se cambia en esta prueba.

El usuario confirmó tener el oxímetro puesto y respondió **95 % y 78 BPM** a la pregunta formulada durante esta captura. La respuesta con los números llegó después de terminar; se conserva como referencia comunicada para este ensayo, sin asumir un registro continuo ni alineación exacta de cada ventana. Los 95 % y 81 BPM anteriores pertenecen al ensayo previo.

**Conclusión:** el cambio eleva la lectura estática comunicada de SCL, pero no resuelve la estimación de SpO₂ en esta captura. Los cambios de calidad entre ensayos no se atribuyen a la resistencia: contacto, posición y referencia no se controlaron continuamente. No se confirma un daño del módulo ni una calibración correcta. Sigue pendiente revisar el reverso/alimentación interna o comparar otro módulo con el mismo programa.

Datos: `.cache/web-smoke/max30102-after-scl-2k-2026-10-04/module.json`, `.log` y `preflight.log`. Se envió `STOP`, se cerró COM5 y se mantiene cargado el firmware temporal. No se modificaron pines, código ni ajustes de `main` durante este cambio físico.

## Aclaración exacta de voltajes y ruta física

El usuario precisó después: **VIN=3,15 V; SCL=2,75 V conectado a P22; SDA=2,92 V conectado a P21; GND a GND**. Se actualizó la metadata de la captura con esos datos, indicando que son lecturas comunicadas posteriormente, no un registro continuo durante las ventanas.

Las rutas coinciden con las detectadas por el firmware. Ambas líneas superan estáticamente el mínimo alto de 2,475 V calculado suponiendo 3,3 V en las E/S del ESP32. No se midió directamente la alimentación de E/S; el VIN del módulo no se sustituye automáticamente por ese valor en el cálculo del umbral. Estos datos no prueban tiempos de subida ni integridad completa del bus, pero no justifican atribuir únicamente a las resistencias el rechazo persistente de SpO₂.

Los **3,15 V de VIN son la entrada de la placa**, no una medición de VDD o VLED+ del chip. Si existe una etapa reguladora en la alimentación de los emisores, podría haber una caída adicional; falta medirlo. La hoja de datos requiere VDD=1,7–2,0 V y VLED+=3,1–5,0 V. Una entrada de 3,15 V no demuestra por sí sola que VLED+ esté fuera de especificación, ni que cambiar VIN resolvería el problema.

Se propuso medir respecto a GND cada extremo metálico de los tres capacitores amarillos C106 visibles en la cara ya fotografiada, distinguiendo el izquierdo y los dos derechos. Se usan como puntos accesibles para observar las tensiones sin asumir de antemano qué rail corresponde a cada capacitor; la asociación exacta dependerá de las mediciones y del circuito. Esas seis lecturas siguen pendientes. No se cambió la alimentación ni se abrió el puerto serial para esta revisión.

## Lecturas comunicadas en los capacitores

El usuario informó **3,15 V y aproximadamente 0,01 V en el capacitor de entrada**, y **3,25 V y 1,77 V**, respectivamente, en los dos últimos capacitores. Se interpretan como lecturas respecto a GND conforme a las instrucciones anteriores. No se proporcionó el valor del segundo terminal de cada capacitor derecho, ni se comprobó continuidad hasta los pines de alimentación del chip.

- Un extremo cercano a 0 V en un capacitor de desacoplo es normal si está unido a masa; 0,01 V no indica por sí solo una salida regulada ausente.
- 3,25 V es compatible con una alimentación VLED+ dentro de 3,1–5,0 V.
- 1,77 V es compatible con una alimentación VDD dentro de 1,7–2,0 V.

Estos intervalos proceden de la [hoja de datos MAX30102, características eléctricas](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf). La coincidencia de valores **no confirma la conexión exacta de cada capacitor a esos pines**, ni descarta rizado/caídas durante pulsos que el multímetro no resuelve. Las lecturas disponibles no aportan evidencia de una alimentación continua claramente fuera de esos rangos; la sospecha anterior de una caída de tensión del regulador no se ha confirmado.

Como comprobación orientativa del bus, un modelo con resistencias internas de 4,7 kΩ a 1,77 V y las externas de SCL=2 kΩ/SDA=1 kΩ a 3,15 V predice SCL≈2,74 V y SDA≈2,91 V, próximos a los 2,75/2,92 V medidos. Se omiten pullups internos del ESP32, tolerancias y otros circuitos. Este acuerdo no prueba la topología ni explica la relación óptica elevada.

Se guardaron las mediciones como datos comunicados después de la captura en `module.json`. No se abrió el puerto serial ni se cambió firmware/alimentación durante la revisión. SpO₂ continúa sin validación: las señales, la óptica y la adecuación de la calibración siguen pendientes de contrastar; no se declara dañado el módulo a partir de estas lecturas.
