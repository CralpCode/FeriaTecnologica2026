# 🚀 Backend API - SpiroScan IoT (Feria Tecnológica)

Servidor backend en **Python + FastAPI + SQLite (WAL)** para ingesta de telemetría del ESP32 en tiempo real, almacenamiento persistente, análisis biométrico y conexión con la App Móvil.

---

## ⚡ Cómo Iniciar el Backend

Ejecuta el script incluido:
```powershell
.\run.ps1
```
O manualmente:
```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 📚 Documentación Interactiva de la API (Swagger UI)

Una vez iniciado el servidor, abre tu navegador en:
👉 **[http://localhost:8000/docs](http://localhost:8000/docs)**

Podrás probar todos los endpoints interactivamente:
- `POST /api/telemetry`: Recibe datos del ESP32 (BPM, SpO2, Audio RMS).
- `GET /api/vitals/current`: Devuelve los signos vitales actuales para la App Móvil.
- `GET /api/vitals/history`: Devuelve el historial de datos para las gráficas.
- `POST /api/ai/vitals/analyze`: Genera el diagnóstico y reporte de IA.
- `POST /api/ai/chat`: Responde preguntas del usuario sobre sus métricas.
- `GET /api/device/status`: Información de batería y conexión del ESP32.
- `WS /ws/live`: Canal WebSocket para transmisión en vivo.
