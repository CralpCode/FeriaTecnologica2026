# Revisión ESP32S — 6 de octubre de 2026

Se preparó el entorno de esta Mac y se cargó firmware basado en la versión más
reciente proporcionada, conservando las dos copias originales en `esp codigo`.
El proyecto listo para compilar está en `Esp32`; consultar `Esp32/README.md`.

## Correcciones

- Dependencias faltantes sustituidas por la biblioteca oficial SparkFun;
  placa NodeMCU-32S, Arduino ESP32 2.0.17 y dependencias fijadas en PlatformIO.
- I2C comienza con SDA GPIO23/SCL GPIO22; comprueba que el sensor responda.
- FIFO conserva todos los pares ópticos y rechaza errores y desbordamientos.
- Inicio continuo y botones físicos eliminados (GPIO16/17 sin configurar ni leer), comandos USB sin bloquear adquisición y cola
  independiente de envío HTTP que descarta muestras viejas.
- HTTPS verifica certificados con ISRG Root X1; reloj NTP y respaldo de hora
  de compilación. Watchdog de 30 segundos evita los reinicios observados con TLS.
- WiFi/USB configurados; Bluetooth desactivado para disponer de memoria.
- Calidad, antigüedad y validez conservadas desde firmware hasta SQLite/web.
  Ceros y sensores ausentes no se presentan como valores normales.
- Micrófono ausente al inicio, instalado después por el usuario y activado en
  la configuración local. La configuración de ejemplo mantiene el módulo
  ausente para no declarar el ruido de un pin flotante como audio válido.
- Código de audio conserva identificadores de orden, convierte estéreo a mono
  a 16 kHz y libera clientes TLS antes de reservar memoria y eliminar tareas.
- Captura completa en LittleFS antes de enviar por HTTPS: la velocidad de la red
  ya no obliga a descartar muestras. Detecta errores de escritura y overflow I2S.

## Entorno y comprobaciones

Python y dependencias del backend en `../../.venv` desde `Esp32`; PlatformIO,
framework, bibliotecas y herramienta USB instalados. Frontend preparado y
exportado para web; TypeScript sin errores. `pip check` sin conflictos.

Pasaron 69 pruebas del backend, 5 del enlace y dos ejecutables C++ de calidad
óptica/FIFO. Los tests usan datos y bases aisladas; las pruebas del dispositivo
usan exclusivamente su telemetría real.

La prueba directa WiFi de 70 segundos después de corregir TLS recibió 40
actualizaciones WebSocket y agregó 40 filas SQLite. Sin reenviar por USB:
629 paquetes USB observados, 0 errores JSON, 0 errores de red; un arranque
inicial observado al abrir el puerto. El servidor informó fuente `real`,
`device_connected=true` y calidad `sensor_unavailable`. Esto prueba el transporte
del estado del equipo, todavía no mediciones de pulso o audio válidas.

## Límites físicos pendientes

El MAX30102 devuelve timeout I2C (código 5) en GPIO23/22 y en las combinaciones
alternativas probadas. No se obtuvieron lecturas de pulso.
La comprobación final devolvió NACK (código 2). El sondeo independiente por
GPIO a unos 5 kHz también devolvió sin ACK, con SDA23=1/SCL22=1 en reposo.
El fallo precede a la configuración del brillo y del muestreo: no se pueden
escribir registros de LEDs mientras el módulo no confirme su dirección.
El usuario confirmó VIN3V3/GND y SDA23/SCL22; falta comprobar continuidad,
tensión real y el módulo físico. El INMP441 fue conectado
a SD32/WS15/SCK27, VDD3V3 y GND, confirmados por el usuario. La señal digital
respondió entre -67.9 y -39.1 dBFS; hubo 1304 paquetes USB con audio válido y
80 filas nuevas en SQLite durante una prueba de 150 segundos. Después se
completó una grabación física iniciada desde la web:
`rec_20261006_165553_0f58`, fuente real, SQLite `status=done`, WAV mono 16 kHz,
240000 muestras, 480000 bytes PCM, duración exacta 15.0 segundos. El envío
recibió HTTP 200 y la telemetría volvió al modo continuo. Los fallos previos
de memoria y de ancho de banda motivaron el almacenamiento local antes del envío.
Es una prueba técnica de captura/transporte, no una validación clínica del modelo.
SpO2 se mantiene no disponible
porque el montaje no tiene calibración validada. Bluetooth por radio no probado.

El ESP y la Mac estaban en redes distintas; el ESP usa el servidor HTTPS existente
autorizado por el usuario: https://spiroscan.tail8e9fc2.ts.net. El backend debe
permanecer activo en la Mac y conservar su enlace existente para recibir datos.
La última prueba de 70 segundos de la versión sin botones observó 635 paquetes
USB con audio válido, 0 errores JSON y 0 errores de envío HTTP; recepción vigente
en el servidor, fuente real. Se observó un arranque POWERON al abrir USB, sin
reinicios por watchdog durante el intervalo posterior. Red WiFi, IP y MAC del
equipo confirmadas. No se reenviaron paquetes por USB.
Con el arranque excluido, se verificaron otros 30 segundos: 281 paquetes con
audio válido, 0 errores JSON, 0 errores de red y 0 reinicios durante la medición.
El usuario informó que VIN y SCL del MAX30102 se estaban tocando y confirmó
que los separó y apagó/reconectó el USB durante 10 segundos. La nueva detección
sigue dando NACK a 0x57 en I2C nativo y sin ACK en el sondeo directo GPIO. No se
puede confirmar daño del módulo solo por la ausencia de calor. Falta inspeccionar
las conexiones y el módulo físico para terminar la lectura de pulso/oxígeno.
El usuario volvió a inspeccionar la separación y aportó fotos de ambas caras.
Las fotos no permiten verificar continuidad ni tensión de alimentación. No dispone
de multímetro y los cables están soldados también al ESP32. Se conserva SDA23/SCL22;
no se realizó el cambio propuesto a GPIO18/19, porque requiere desoldar.
La repetición posterior de 20 segundos confirmó 187 paquetes de audio válidos,
0 errores JSON/red y 0 reinicios durante la medición, con recepción real vigente
en el servidor y sin reenvío USB. MAX30102 sigue sin ACK tanto en Wire como en
el sondeo directo de GPIO23/22. Un arranque inicial al abrir USB fue excluido.
Posteriormente el usuario indicó que puede desoldar los cables del lado del ESP32.
Se añadió detección nativa SDA18/SCL19 y recuperación de ese bus, conservando
SDA23/SCL22 como primera opción. La nueva conexión queda pendiente de prueba
física; no se atribuye el fallo a un GPIO concreto sin ese resultado.
El usuario no dispone de resistencia para el LED suelto: no se realiza esa prueba.
El usuario confirmó después el cambio físico a SDA18/SCL19 y reconectó el ESP32.
El sondeo nativo a 0x57 devolvió NACK también en esa conexión. La prueba de
30 segundos recibió 285 paquetes con audio válido, 0 errores y 0 reinicios
durante la medición, y el servidor continuó recibiendo datos reales por WiFi.
Se amplió el sondeo directo de GPIO y la inicialización lenta para cubrir también
18/19, evitando depender del resultado anterior obtenido únicamente en 23/22.
Firmware compilado y cargado correctamente. El sondeo directo de SDA18/SCL19
a unos 5 kHz devolvió sin ACK, con ambas líneas en alto en reposo. La comprobación
posterior confirmó 139 paquetes con audio válido y recepción vigente por WiFi;
hubo una línea USB no parseable, sin errores de envío HTTP ni reinicios durante
la medición. No se obtuvieron paquetes de pulso válidos.

## Conservación y uso

### Grabaciones sucesivas y espera en la web

Se reprodujo el problema al pasar de TV a PV sin reiniciar: la primera captura
guarda 240000 muestras y la segunda falla en su primera escritura de 8000 bytes,
con `errno=9` (descriptor inválido). La web mostraba «Analizando» al cumplirse
15 segundos, aunque el audio no había llegado a la inferencia.
Se añadieron estados consultables de captura/envío/procesamiento, recuperación
por consulta aun con WebSocket, aviso `/api/audio/abort`, expiración tras 180 s
sin recepción y bloqueo de una segunda orden mientras la anterior sigue activa.
Se reinicia el tiempo al armar una zona y se oculta el resultado anterior durante
una nueva captura. Servidor: 73 pruebas unitarias correctas; TypeScript y exportación
web correctos. La web mostró el error terminal y permitió repetir durante la
reproducción física del fallo.

El envío ahora lee desde flash en cuatro bloques de hasta 128 KB, con clientes
destruidos al finalizar; se eliminó la pila adicional del uploader. LittleFS
se monta una vez por arranque. La primera grabación física completa observada
con ese envío tardó 49.824 s desde inicio en el servidor hasta resultado guardado;
ese tiempo incluye captura y transporte, no solo inferencia.

La biblioteca Arduino-ESP32 2.0.17 limpia `sslclient_context` con `memset` en
`stop_ssl_socket`, dejando `socket=0`. Cierres repetidos pueden cerrar un archivo
VFS que reutilizó ese descriptor. `SpiroScanTLSClient` restaura `socket=-1`
después del cierre y antes del destructor de la base, conservando validación CA.
La prueba C++ reproduce el cierre incorrecto y comprueba los cierres/destructores
corregidos. Firmware compilado y cargado con hash verificado.
El usuario reconectó el ESP y encendió la red WiFi. El firmware con el
cliente TLS corregido y la cola nueva se cargó con hash verificado. El ESP obtuvo
IP, pero la comprobación de grabaciones aún no se completa: el enlace
TLS desde el ESP devuelve cierre EOF (MBEDTLS -29312) o tiempo agotado. Desde la
Mac el mismo servidor responde por HTTPS/TLS 1.2. Se solicitó comprobar Internet
y acceso al dominio desde el teléfono que comparte esa red. No se da por verificada
aún la segunda captura física con el cliente TLS corregido.

### Cola de análisis e integridad

El firmware captura primero los 480000 bytes PCM de 15 segundos, calcula su
SHA-256 y envía bloques con desplazamiento y hasta tres intentos. El servidor
reconoce duplicados idénticos, rechaza huecos o cambios y no clasifica una recepción
incompleta. La confirmación final es idempotente y responde HTTP 202 tras guardar
WAV y un trabajo en SQLite. Se permite grabar otra zona después del envío aunque
la anterior siga en análisis. La app muestra la cola y separa los resultados por
identificador; un resultado antiguo no cancela la captura nueva.

Un solo proceso de análisis trabaja cada vez, separado de la API, con límite de
120 segundos. Los trabajos pendientes se recuperan al reiniciar. Si falla el
análisis, se conserva el WAV y la app permite volver a analizarlo sin capturarlo
de nuevo. Validación: 79 pruebas del backend correctas, incluida inferencia ocupada
mientras se acepta la siguiente captura, reintentos sin duplicación, hash/longitud
incorrectos, recuperación de cola, terminación real de un proceso trabado y
reanálisis del audio guardado. TypeScript y exportación web correctos.
Además, una base temporal aislada recibió tres trabajos con el PCM de la grabación
real previa `rec_20261006_165553_0f58`. El proceso nuevo clasificó cada trabajo
correctamente (1.311 s, 1.294 s y 1.271 s, incluyendo inicio del proceso), sin
crear resultados de prueba en la base clínica. Esto verifica el worker real;
no sustituye la prueba pendiente de tres capturas nuevas desde el ESP.
El diagnóstico físico de esta conexión observó señal -60 dBm, 117688 bytes libres
y bloque máximo de 94196 bytes: no indica falta de memoria. El mismo intento
HTTPS también falla desde el diagnóstico en el loop, con EOF. El micrófono
responde y el MAX30102 sigue sin detectarse en el montaje actual.

Respaldo completo de flash de 4 MB y originales en
`../../respaldos/revision-2026-10-06`, con hash SHA-256. Configuración WiFi y
binarios generados excluidos de Git; no publicar archivos que contengan claves.
Los scripts `Esp32/compilar_macos.command` y `Esp32/subir_macos.command` permiten
compilar/cargar. No se hicieron commits ni se publicaron cambios en GitHub.

## Lector del micrófono en tarea propia y verificación final

Con el firmware anterior, 1 de 5 capturas seguidas falló con «Desbordamiento I2S»
al medio segundo: el mismo loop leía el I2S y escribía en LittleFS, y un borrado
de sector de flash duraba más que los 128 ms de DMA. Ahora una tarea de prioridad 5
(núcleo 1) lee el I2S, convierte a int16 mono y deja el audio en un búfer de RAM de
32 KB (~1 s); el loop solo escribe en flash desde ese búfer. Si la flash no alcanza,
se avisa al servidor y no se clasifica audio incompleto.

Prueba física con el firmware nuevo: 7 grabaciones seguidas sin reiniciar
(AV, PV, TV, MV, AL, AR, PL), todas `done`, `transport_verified=1`, 480000 bytes;
corazón analizado con `heart_cnn.pt` y pulmón con los modelos de pulmón (`modo=pulmon`).
Captura 15 s + envío ~30 s por zona; análisis 0.6 s (corazón) y 1.2 s (pulmón).
Una grabación más iniciada desde la web completó todos los pasos y mostró el resultado.

El servidor ahora cierra al arrancar (y antes de informar el estado) cualquier captura
sin datos nuevos hace más de 180 s, en cualquier sesión.
El filtro de escucha «Según el foco» usa en corazón la banda que analiza la IA (20–600 Hz)
y en pulmón el diafragma (más de 100 Hz).

## Cola de capturas en el ESP32 (7 de octubre)

El análisis tarda ~1 s; el tiempo del examen es el envío (480 KB por hotspot → Tailscale Funnel).
El ESP32 guarda ahora hasta 2 capturas en flash (partición propia `spiroscan_partitions.csv`, LittleFS
de 1.56 MB) y una sola tarea de red registra, envía y confirma cada una mientras el loop graba la zona
siguiente. La siguiente orden viaja en las respuestas de `/api/audio/chunk` y `/finish`. Para que TLS y
captura quepan juntos: búfer del micrófono de 8 KB, escrituras de 2 KB y nunca un saludo TLS nuevo
durante una captura (mínimo observado: 23 KB libres, búfer usado como máximo 2.5 de 8 KB).

La confirmación vacía por la conexión reutilizada quedaba sin respuesta (HTTP -11) aunque el servidor
ya había respondido 202: ahora se envía con cuerpo `{}` y hay 6 reintentos con espera creciente
(el servidor no duplica bloques ni confirmaciones). Se agregaron DNS de respaldo (1.1.1.1 y 8.8.8.8) y
diagnóstico de DNS/señal en cada fallo de red.

Prueba física final con el ESP32 cerca del teléfono, 5 zonas por ronda, todas `done`, verificadas y sin
reintentos: con cola 186 s (37 s por zona), sin cola 241 s (48 s por zona). Envío sin grabación simultánea
21–30 s; con grabación simultánea 27–39 s. El servidor no deja pedir otra zona mientras una se graba,
mientras una orden ya entregada aún no se registra, ni con 2 capturas pendientes de envío.

## Compresión sin pérdida del audio (7 de octubre)

El ESP32 comprime cada bloque de 1024 muestras al grabar (`Esp32/rice_codec.h`: predicción de orden 1 o 2
y código Rice; un bloque que no se reduce se guarda tal cual) y calcula en la misma pasada el SHA-256 del
PCM original. El servidor (`Backend/audio_codec.py`) reconstruye el PCM y comprueba longitud y SHA-256
antes de guardar el WAV: si no coincide, responde 400 y la grabación no se analiza.

Verificación: el codificador del firmware, compilado en la Mac, produce los mismos bytes que la referencia
en Python y el audio reconstruido es idéntico bit a bit en 53 grabaciones reales y 8 casos extremos
(silencio, ruido a escala completa, saturación, escalones, longitudes cortas). En las grabaciones reales el
audio comprimido pesa en promedio el 59 % del original; descomprimir 15 s tarda menos de 0.2 s.

Prueba física con el ESP32 a un metro del teléfono, 10 grabaciones, todas `done`, verificadas, sin
reintentos, 54–58 % del tamaño original: envío 10–15 s por zona (antes 21–30 s).
Con cola: 117 s para 5 zonas (23 s por zona). Sin cola: 155 s (31 s por zona).

## MAX30102 nuevo: pull-ups a 1.8V y FIFO desbordado (7 de octubre)

El módulo de reemplazo (verde, tres capacitores 106) jala SDA/SCL a 1.8V: el ESP32 lo lee como 0 y el bus
parecía ocupado. Con resistencias de 2.2 kΩ de 3.3V a SDA (IO18) y SCL (IO19) se detecta normalmente.
Diagnóstico sin multímetro: el pin 18 pasó a 1 con el cable suelto; la prueba serie `LEDTEST` (escritura
sin lectura, SDA soltado en cada ACK) encendió el LED del sensor. Se agregaron también las orientaciones
19/18 y SCL activo a 3.3V para módulos con una sola resistencia en SDA.

`MAX30105Buffered.check()` trataba cualquier desborde del FIFO como error sin leer muestras; en este chip
el contador de desborde solo vuelve a 0 al leer, así que quedaba trabado (miles de errores, 0 muestras).
Ahora vacía el FIFO y descarta esas muestras. Resultado físico con el dedo: FC 97–110 BPM válidas con
calidad "good" en el servidor; SpO2 sigue "no calibrada" (no se muestra), como estaba previsto.
