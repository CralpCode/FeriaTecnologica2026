# Ensayo general de la feria (lista de verificación)

Hacerlo completo al menos una vez, con el mismo equipo y red que se usarán en la feria.

## Antes de llegar
- [ ] Rama aprobada y unida a `main` (Pull Request revisado por el equipo).
- [ ] Mac cargada, con el cargador y Ollama con `qwen3-next-pro` (base de `spiroscan-qwen3next`) descargado.
- [ ] Router o hotspot propio de **2.4 GHz** (no depender del WiFi de la feria).
- [ ] `Esp32/spiroscan_config.h` con ese WiFi; firmware subido y `DIAG` sin errores (ver `Esp32/PRUEBAS_HARDWARE.md`).
- [ ] Batería del ESP32 cargada; estetoscopio, fantoma y un oxímetro comercial para comparar.
- [ ] Reglas del semáforo revisadas y firmadas (`Backend/REVISION_REGLAS_TRIAJE.md`).

## Al llegar (10 minutos)
1. [ ] Encender router → Mac conectada a ese WiFi.
2. [ ] `cd ~/Documents/spirosan/FeriaTecnologica2026 && VENV=~/Documents/spirosan/.venv ./start_server.sh`
   (con `--tunnel` si se quiere el link público). Dejar la ventana abierta.
3. [ ] Escanear el QR con un celular → la app abre.
4. [ ] Encender el ESP32 → en el monitor serie aparece `Servidor SpiroScan encontrado`.
5. [ ] En la app: botón de conexión → **Recibir datos en esta sesión**.

## Demostración (guion sugerido, 5 minutos)
1. **Monitoreo:** dedo en el sensor → pulso y SpO2 en vivo; explicar el semáforo.
2. **Auscultar → Corazón:** elegir foco mitral → *Preparar grabación* → K1 1 s → resultado + "cómo suena el soplo".
3. **Historial:** escuchar la grabación con ▶️.
4. **Banco de pruebas ICBHI:** cargar "sibilancias" o "neumonía" → comparar lo que dice el modelo con la etiqueta real.
5. **Alertas → Generar informe PDF.**
6. **Asistente:** "¿Qué es SpiroScan y cómo funciona?" y "¿Cuál es mi presión arterial?" (muestra que no inventa).
7. **¿Cómo funciona la IA?:** porcentajes reales y lo que todavía no hace.

## Preguntas típicas del jurado (respuestas cortas)
- **¿Diagnostica?** No: tamizaje para decidir a quién referir.
- **¿Con qué datos aprendió?** Bases públicas CirCor 2022, PhysioNet 2016 e ICBHI 2017, evaluadas con pacientes no vistos.
- **¿Qué tan bien funciona?** Corazón: detecta ≈ 90 % de los anormales y reconoce ≈ 92 % de los normales (pantalla "¿Cómo funciona la IA?").
- **¿Y con su estetoscopio barato?** Eso mide la corrección acústica con el fantoma (gráfico en `IA/fantoma/salida/`).
- **¿Por qué no mide presión?** El sensor óptico no puede medirla; preferimos no inventar el dato.
- **¿Necesita internet?** No: todo corre en la Mac, incluido el asistente.

## Si algo falla
| Problema | Solución rápida |
|---|---|
| La app no abre en un celular | Usar la IP que muestra `start_server.sh` en lugar de `spiroscan.local` |
| El ESP32 no encuentra el servidor | Revisar que esté en el mismo WiFi; como último recurso, poner la IP en `SERVER_URL` |
| El asistente tarda o no responde | Las alertas y el semáforo siguen funcionando (no dependen de Qwen) |
| Sin ESP32 | Usar el **Banco de pruebas ICBHI** desde la app |
