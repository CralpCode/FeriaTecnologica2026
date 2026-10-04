# Integración de main con el servidor de IA

## Alcance

Rama de trabajo: `integracion/main-servidor-ia-2026-10-04`.

Parte de `main` (`28747bd`) e integra `origin/feature/servidor-ia-completo`
(`f3ffd0d`). Esta última ya contiene `feature/mejoras-historial-ia` (`0252acd`)
y `feature/modelo-entrenado-integracion` (`ce6d26e`), por lo que no se repiten
sus merges. Se resolvieron los 16 archivos en conflicto.

La preparación no modifica `main` ni las ramas de los colaboradores. No se
publica al remoto ni se carga firmware durante esta integración.

## Decisiones de resolución

- **ESP32:** se conserva el firmware de `main`, SCK GPIO27, WS GPIO15,
  SD GPIO32, botones GPIO17/16, BLE bidireccional con MTU 517, reposo inicial,
  escaneos de 20 s y modo continuo. Se incorporan WiFi/mDNS y las grabaciones
  de 15 s del servidor. La captura convierte parejas estéreo L/R en muestras
  mono a 16 kHz. Una pérdida de muestras por red lenta cancela la captura.
- **Botones:** K1 corto mide pulso; K2 corto mide nivel de audio. K1 largo
  y K1+K2 conservan continuo/reposo. K2 largo graba cuando hay WiFi y servidor;
  sin ellos conserva continuo/reposo. También existe `REC` por serie/BLE.
- **Datos:** se aceptan la máscara compacta `v:2/valid/cal` y los indicadores
  separados de calidad. La app, el gateway y el backend mantienen su significado.
  Cada canal se valida por separado; un RMSSD válido de cero sigue siendo cero.
- **Sin rellenos:** se eliminan SpO2 artificial alrededor de 98.2 %, presión
  calculada desde BPM y temperatura corporal por defecto de 36.6 °C. El chip
  se informa como `chipTemperature`, nunca como temperatura corporal. El estrés
  experimental no se publica como medición válida.
- **SpO2:** una estimación óptica válida puede mostrarse con la advertencia
  de falta de calibración. `cal:false` impide usarla en triaje o alertas de oxígeno.
- **Audio:** el nivel digital se informa en dBFS y el pico en amplitud relativa,
  sin declarar dB SPL calibrados. La pantalla pulmonar anterior abre el flujo
  de grabaciones y modelos; ya no genera porcentajes de enfermedades desde RMS.
- **Servidor:** se incorporan consultas por paciente, grabaciones, informes,
  alertas y reglas del LLM de la rama del servidor. El chat usa los datos de
  la sesión almacenada. El endpoint pulmonar antiguo devuelve una valoración
  orientativa de la sesión, sin el contrato antiguo de probabilidades inventadas.
- **Historial:** se leen `metadata_json` de main y `measurement_metadata` del
  servidor. La migración añade columnas y tablas; no borra registros existentes.
  Los registros sin calidad explícita no se convierten en lecturas válidas.
- **App:** conserva versión 1.0.16, controles de escaneo y conexión BLE;
  incorpora consulta guiada, auscultación, alertas, historial y diseño adaptable.
  El selector antiguo de sesiones no reaparece en el modal de conexión; los
  pacientes se gestionan con Nuevo paciente e Historial. Las respuestas de una
  sesión anterior no reemplazan los datos de la sesión abierta.

## Verificación de software

Los datos de prueba son sintéticos; se utilizan bases SQLite y archivos temporales.

Resultados: 37 pruebas del backend, 6 del gateway y 4 de la app aprobadas.
TypeScript pasa sin errores. PlatformIO generó el firmware (20.1 % de RAM y
57.8 % de flash en la compilación de verificación). Expo generó `dist` para web;
el proceso de exportación se cerró después de emitir los archivos porque permanecía
abierto. No se realizó una prueba visual ni una sesión real con la placa o el LLM.

```powershell
# Entorno aislado Python 3.11 creado para verificar esta integración
.\.venv-integracion\Scripts\python.exe -m pip install -r Backend\requirements-dev.txt
.\.venv-integracion\Scripts\python.exe -m unittest discover -s Backend\tests -p 'test_*.py'
python -m unittest discover -s Esp32\tests -p 'test_*.py'

# Desde App Movil
.\node_modules\.bin\tsc.cmd --noEmit
node --test --test-isolation=none tests/measurementQuality.test.cjs
.\node_modules\.bin\expo.cmd export --platform web

# Desde Esp32, con PlatformIO instalado
pio run
```

En Windows, si el sandbox impide utilizar el TEMP del usuario, dirigir `TEMP`
y `TMP` a una carpeta temporal dentro del proyecto antes de ejecutar unittest.
`--test-isolation=none` evita crear procesos secundarios en la prueba de Node.

## Pendiente en el equipo físico

- Configurar `Esp32/spiroscan_config.h`: actualmente la compilación utiliza
  el ejemplo de WiFi, no credenciales reales.
- Probar la placa con este firmware y verificar BLE, botones, niveles digitales
  y una grabación completa por WiFi con el paciente y foco preparados.
- Verificar el LLM real y el servidor en la red de uso.

Compilar y pasar estas pruebas no demuestra funcionamiento completo en la placa
ni exactitud clínica del sensor o de los modelos. Ver `Esp32/PRUEBAS_HARDWARE.md`.

## Segunda actualización de las ramas externas

Después de publicar la integración inicial (`6affa3e`), se consultó GitHub de nuevo.
Solo `feature/servidor-ia-completo` avanzó, de `f3ffd0d` a `9fbd569`:

- `03fa6b4`: ecualizador del servidor basado en una medición del fantoma.
- `c7c7410`: consulta guiada como pantalla principal.
- `9fbd569`: rediseño visual de la app.

Las ramas de historial y modelo entrenado no tienen commits adicionales.
Esta actualización no cambia ningún archivo de `Esp32`, ni conexiones físicas.

Se resolvieron seis archivos con conflictos adoptando la consulta y su diseño,
conservando los controles BLE de `main`, el contexto de conexión separado y el
acceso pulmonar mediante la nueva consulta. Se conserva la visualización de SpO2
sin calibrar y PRV óptica con etiquetas explícitas; ninguna se convierte en una
medición clínica validada. El selector de sesiones sigue en el flujo de pacientes
e historial, fuera del modal de conexión.

Los formularios se reinician al cambiar de paciente; las respuestas pendientes
de contexto, valoración, guardado e informe no se aplican a otra consulta. Las
instrucciones para grabar corresponden a K2 mantenido durante al menos 1.2 s.

El ecualizador permanece inactivo si no existe un perfil medido. No se creó
ningún perfil ni se afirmó haber calibrado físicamente el estetoscopio.

Verificación de esta actualización: 42 pruebas del backend (incluidas cinco del
ecualizador), cuatro pruebas de la app y TypeScript sin errores. La compilación
del firmware anterior sigue siendo la referencia porque sus archivos no cambiaron.
Expo generó el paquete web (`Exported: dist`, 464 módulos); se cerró el proceso
después de la exportación porque permanecía abierto. No se verificó visualmente
la interfaz ni se realizaron pruebas nuevas con el equipo físico.
