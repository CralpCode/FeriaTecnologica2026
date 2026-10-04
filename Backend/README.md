# 🚀 Backend API - SpiroScan (Feria Tecnológica)

> **Actualización 2026-10-03:** el resumen clínico, informes y semáforo usan reglas trazables y resultados acústicos de la sesión. El LLM se conserva para guía de uso. SpO2, HRV y estrés no están disponibles como mediciones validadas en el firmware actualizado. [Informe completo](../docs/INFORME_MEJORAS_2026-10-03.md).


Servidor en **Python + FastAPI + SQLite (WAL)** que corre en la Mac del equipo y concentra todo:
telemetría del ESP32, base de datos, **CNN de audio cardíaco** y **LLM local (Ollama)**.

```
ESP32 ──WiFi──► FastAPI (:8000) ──► SQLite (vitales, grabaciones, alertas, informes)
                   ├─► CNN PyTorch  → soplo sí/no + probabilidad
                   ├─► Reglas fijas → alertas (WebSocket /ws/live)
                   └─► Qwen (Ollama) → redacta alertas, informes, chat y guía
App Expo ──HTTP/WS──► FastAPI
```

**Regla de diseño:** el LLM solo *redacta*. Las alertas las deciden reglas fijas (`alerts.py`) y la CNN
(`ml/classifier.py`). Si el LLM no responde, se usa un texto de plantilla.

---

## ⚡ Cómo iniciar el servidor (Mac)

Desde la raíz del repositorio:
```bash
./start_server.sh            # red local
./start_server.sh --tunnel   # además, túnel de Cloudflare como respaldo por internet
```
El script inicia Ollama si hace falta, precarga el modelo, muestra la IP de la Mac y evita que se duerma.

Manual:
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Configuración en `.env` (ver `.env.example`): `LLM_BASE_URL`, `LLM_MODEL` (por defecto `qwen3:32b`),
`HEART_MODEL_PATH`. Para usar Splash en lugar de Ollama basta con cambiar `LLM_BASE_URL`.

El modelo `models/heart_cnn.pt` se entrena en la carpeta `IA/` (`train_heart.py`) y se copia aquí
junto con su `heart_cnn.json` (umbral y métricas). `ml/features.py` debe ser idéntico al de ese repo.

---

## 📚 Endpoints (documentación interactiva en `http://<IP>:8000/docs`)

**Telemetría**
- `POST /api/telemetry` · `GET /api/vitals/current` · `GET /api/vitals/history`
- `WS /ws/live`: eventos `VITALS_UPDATE`, `ALERT`, `ALERT_UPDATED`, `RECORDING_ARMED`, `RECORDING_STARTED`, `RECORDING_RESULT`

**Auscultación**
- `POST /api/audio/arm` `{session_id, location}`: la app indica sesión y foco (AV, PV, TV, MV) de la próxima grabación
- `POST /api/audio/start` → `POST /api/audio/chunk?recording_id=` (PCM int16) → `POST /api/audio/finish?recording_id=` (ESP32)
- `POST /api/audio/upload` (WAV completo, para pruebas) · `GET /api/recordings` · `GET /api/model/heart`

**Alertas, informes y guía**
- `GET /api/alerts` · `POST /api/alerts/{id}/ack`
- `POST /api/reports/session/{session_id}` → `GET /api/reports/{id}/pdf`
- `POST /api/ai/chat` (responde solo con datos reales de la sesión) · `GET /api/guide/{foco}` · `POST /api/guide/ask`

**Exportaciones:** `/api/export/pdf`, `/api/export/xlsx`, `/api/export/csv`, `/api/export/png`, `/api/export/report`

---

## ⚠️ Qué mide y qué no mide el dispositivo
- **Mide:** pulso y SpO2 (MAX30102), variabilidad entre latidos (HRV) y audio cardíaco (INMP441).
- **No mide:** presión arterial ni temperatura corporal. Esos campos quedan en 0 por compatibilidad.
- El "índice de estrés" es experimental y no está validado.

## Contexto y valoración orientativa

- `GET/PUT /api/clinical/context/{session_id}`: edad, reposo, altitud, síntomas y antecedentes; `null` conserva desconocidos.
- `GET /api/clinical/assessment/{session_id}`: hallazgos, posibilidades a confirmar, fuentes y limitaciones; sin probabilidades de enfermedad.
- Telemetría: `source`, `heartRateValid`, `bloodOxygenValid`, `spo2Calibrated`, `signalQuality`, `sampleAgeMs`, `finger`. Datos sin procedencia/validez no se usan clínicamente.
- Audio: `source` en `/api/audio/start` y `/api/audio/upload` (`real`, `simulated`, `unknown`). Por defecto `unknown`.
- Exportaciones: especificar `session_id`; sin mezcla de sesiones ni puntuaciones de salud. PDF/HTML resumen la sesión; CSV/XLSX/PNG respetan el periodo solicitado.
- Pruebas aisladas: `SPIROSCAN_DB_PATH` con base temporal y `SPIROSCAN_MDNS=0` para no anunciar el servidor de pruebas.
