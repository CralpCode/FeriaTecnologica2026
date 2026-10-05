# Actualización de la rama de integración

Rama destino: `integracion/main-servidor-ia-2026-10-04`.
Rama incorporada: `origin/feature/servidor-ia-completo`, hasta `6a25184` (9 commits nuevos).
Los cambios locales previos se guardaron en `bef8d41`. `main` conserva `28747bd`.

## Resolución

- Se combinan los cambios de consulta, notas, mapa, PDF, archivo de pacientes y respaldos con las lecturas reales de sensores y el contexto enviado a la IA.
- Se conserva Expo 58 y su conjunto de dependencias, y se añaden las fuentes y Playwright del servidor.
- Pulso y otras lecturas conservan su validez y la retención temporal señalada como última lectura. El oxígeno sin calibración no entra al triaje; el nivel del micrófono continúa siendo relativo.
- El cambio de paciente reinicia el estado de grabación y mantiene separadas las respuestas de cada sesión.
- El estado de grabación se inicializa antes de enviar la petición HTTP: una respuesta lenta no reemplaza los eventos de inicio o resultado ya recibidos por WebSocket.
- El historial descarta respuestas de peticiones anteriores o de otra vista: cambiar a Archivados mientras se refresca la lista activa no vacía la lista nueva.
- Los respaldos SQLite que venían en la rama externa permanecen en disco y se excluyen del repositorio.

## Orden de grabación desde la web

La respuesta de `POST /api/telemetry` puede incluir `comando` con `accion: grabar` e identificador de 8 caracteres hexadecimales.

- Por WiFi, la tarea de telemetría del ESP32 recoge la orden y el bucle principal inicia la captura.
- Por gateway USB, el gateway envía `REC_<id>` y el mismo bucle principal inicia la captura.
- Se ignoran identificadores inválidos y repeticiones de la misma orden. `/api/audio/start` recibe `comando_id`, para que el servidor rechace órdenes vencidas o sustituidas sin asignarlas a otro paciente o foco.
- K2 y los comandos anteriores `REC`/`GRABAR` siguen disponibles.
- Se conservan pines, frecuencias de captura, detector de latidos, calidad óptica y modos de escaneo.

El firmware nuevo se compiló, sin cargarlo a la placa ni abrir el monitor serial. Para utilizar esta orden en el hardware hace falta cargarlo. La subida de audio sigue requiriendo WiFi y un servidor accesible desde el ESP32, también cuando la orden llega por USB.

## Verificación

Las pruebas de software utilizan señales sintéticas y bases temporales, sin validar exactitud clínica del hardware.

- Backend: 72 pruebas aprobadas; 2 de paridad AST omitidas porque `torchaudio` no está instalado en el entorno de validación.
- IA: 9 pruebas aprobadas.
- App: TypeScript, exportación web y 8 pruebas de lecturas aprobadas.
- Gateway: 6 pruebas de telemetría y 5 de órdenes aprobadas.
- Cola de órdenes: prueba C++ en PC aprobada; firmware completo compilado con PlatformIO.
- Playwright: 2 recorridos completos aprobados, en celular y computadora, con paciente, pulso, grabación, resultado, notas, PDF e historial. Se retrasan intencionalmente la respuesta HTTP de armado y una respuesta anterior del historial para comprobar la coordinación con los eventos en vivo y el cambio a Archivados.

El modelo AST grande no viene en Git. Se conservan sus metadatos y el soporte para cargarlo; el modelo CNN disponible permanece como alternativa. No se entrenaron ni descargaron pesos durante el merge.
