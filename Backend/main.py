import os
import time
import uuid
import json
import asyncio
from typing import List, Optional, Union, Dict, Any, Literal
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, StrictBool

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import database
import backup
import ai_engine
import discovery
import alerts
import audio_service
import llm_tasks
import reports
import triage
import clinical_assessment
import measurement_quality
from ml import classifier, lung, lung_baseline

app = FastAPI(
    title="SpiroScan IoT - API Backend",
    description="API en tiempo real para ingesta de telemetría ESP32, persistencia en SQLite y conexión con App Móvil",
    version="1.3.0"
)

# Estado de enlace reactivo
session_state = {
    "is_phone_connected": False,
    "last_connection_time": None
}

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

database.init_db()

PORT = int(os.getenv("PORT", 8000))
APP_DIST = os.getenv("APP_DIST", os.path.join(os.path.dirname(__file__), "..", "App Movil", "dist"))
server_info: dict = {}


@app.on_event("startup")
async def _announce_on_network():
    if os.getenv("SPIROSCAN_MDNS", "1") != "0":
        server_info.update(await discovery.start(PORT))


@app.on_event("shutdown")
async def _stop_announcing():
    await discovery.stop()


async def _backup_loop():
    """Respaldo automático: el primero un minuto después de arrancar y luego cada SPIROSCAN_BACKUP_MIN minutos."""
    await asyncio.sleep(60)
    while True:
        try:
            await asyncio.to_thread(backup.run_backup)
        except Exception as e:  # el servidor sigue funcionando aunque falle el respaldo; se avisa en la app
            backup.record_error(e)
            print(f"[RESPALDO] Falló: {e}")
        await asyncio.sleep(max(1.0, backup.interval_min()) * 60)


@app.on_event("startup")
async def _start_backups():
    if backup.interval_min() > 0:
        app.state.backup_task = asyncio.create_task(_backup_loop())


@app.get("/api/backup/status")
def backup_status():
    return backup.status()

# El ESP32 no sabe qué sesión está abierta en la app: la app "vincula" su sesión y el backend
# asigna a esa sesión la telemetría y el audio que lleguen del dispositivo sin session_id.
_device_link: dict = {}


def _linked_session() -> Optional[str]:
    return _device_link.get("session_id")

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

# /api/telemetry no usa un modelo estricto: lo que manda el ESP32 es externo y puede venir incompleto o
# con tipos raros. measurement_quality.clean_packet lo limpia sin fallar (ver receive_telemetry).
TELEMETRY_MAX_BYTES = 8 * 1024

class AnalyzeInput(BaseModel):
    vitals: Optional[dict] = None
    session_id: Optional[str] = None

class ChatInput(BaseModel):
    message: str
    vitals: Optional[dict] = None
    session_id: Optional[str] = None

class LLMDirectInput(BaseModel):
    prompt: str
    system: Optional[str] = None

class AudioClassifyInput(BaseModel):
    features: Optional[Union[dict, list]] = None
    session_id: Optional[str] = "default"

class AudioStartInput(BaseModel):
    session_id: Optional[str] = None
    device_id: Optional[str] = None
    location: Optional[str] = ""
    sample_rate: int = Field(16000, ge=4000, le=48000)
    source: Literal["real", "simulated", "unknown"] = "unknown"

class AudioArmInput(BaseModel):
    session_id: str
    location: Optional[str] = ""
    mode: Optional[str] = None   # "corazon" | "pulmon" (si falta, se deduce del foco)

class GuideQuestionInput(BaseModel):
    question: str
    location: Optional[str] = None
    session_id: Optional[str] = None

_sessions_cache: dict[str, dict] = {}

def _get_effective_session(session_id: Optional[str] = None) -> str:
    return str(session_id or "default").strip()

@app.get("/api/status")
def read_root():
    return {
        "status": "online",
        "service": "SpiroScan IoT Backend API",
        "version": "1.5.0",
        "phone_connected": session_state["is_phone_connected"],
        "active_sessions_count": len(_sessions_cache),
        "llm_model": ai_engine.LLM_MODEL,
        "llm_url": ai_engine.LLM_BASE_URL,
        "llm_online": ai_engine.llm_available(),
        "heart_model": classifier.model_info(),
        "server": server_info,
        "linked_session": _linked_session(),
        "app_url": f"http://{server_info.get('hostname', 'localhost')}:{PORT}",
        "acoustic_model": lung_baseline.model_info(),
    }

@app.get("/api/sessions")
def list_active_sessions():
    """Lista todas las sesiones activas y registradas en el sistema."""
    db_sessions = database.get_distinct_sessions()
    hidden = database.archived_ids()
    combined = {}
    for item in db_sessions:
        if item["session_id"] in hidden:
            continue
        sid = item["session_id"]
        combined[sid] = {
            "session_id": sid,
            "name": f"Sesión {sid}",
            "records_count": item["records_count"],
            "last_seen": item["last_seen"],
            "is_live": False
        }
    for sid, info in _sessions_cache.items():
        if sid in hidden:
            continue
        is_live = (time.time() - info["timestamp"]) <= 20
        if sid in combined:
            combined[sid]["is_live"] = is_live
            combined[sid]["last_seen"] = info["last_active"]
            combined[sid]["name"] = info.get("name", combined[sid]["name"])
        else:
            combined[sid] = {
                "session_id": sid,
                "name": info.get("name", f"Sesión {sid}"),
                "records_count": 1,
                "last_seen": info["last_active"],
                "is_live": is_live
            }
    return list(combined.values())

@app.post("/api/sessions/create")
def create_new_session(payload: dict = None):
    """Crea una sesión temporal independiente."""
    import uuid
    sid = f"sess_{uuid.uuid4().hex[:6]}"
    name = (payload or {}).get("name", f"Sesión {sid}")
    _sessions_cache[sid] = {
        "vitals": {
            "device_connected": False,
            "heartRate": 0,
            "bloodOxygen": 0.0,
            "systolicPressure": 0,
            "diastolicPressure": 0,
            "temperature": 0.0,
            "hrv": 0,
            "stressLevel": 0,
            "audio_rms": 0.0,
            "audio_peak": 0.0,
            "timestamp": datetime.now().isoformat(),
            "session_id": sid
        },
        "timestamp": time.time(),
        "last_active": datetime.now().isoformat(),
        "name": name
    }
    return {"session_id": sid, "name": name, "status": "created"}

@app.get("/api/device/session")
def get_device_session():
    return session_state

@app.post("/api/device/connect")
async def connect_device():
    session_state["is_phone_connected"] = True
    session_state["last_connection_time"] = datetime.now().isoformat()
    await manager.broadcast({"type": "DEVICE_CONNECTED", "status": True})
    return {"status": "connected", "is_phone_connected": True}

@app.post("/api/device/disconnect")
async def disconnect_device():
    session_state["is_phone_connected"] = False
    database.save_reading({
        "bpm": 0, "spo2": 0.0, "systolic": 0, "diastolic": 0,
        "audio_rms": 0.0, "audio_peak": 0.0, "temperature": 0.0,
        "hrv": 0, "stressLevel": 0, "steps": 0, "calories": 0
    })
    await manager.broadcast({"type": "DEVICE_DISCONNECTED", "status": False})
    return {"status": "disconnected", "is_phone_connected": False}

@app.post("/api/telemetry")
async def receive_telemetry(request: Request):
    body = await request.body()
    if len(body) > TELEMETRY_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Paquete de telemetría demasiado grande")
    try:
        raw = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="El cuerpo debe ser JSON")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="El cuerpo debe ser un objeto JSON")
    data_dict, avisos = measurement_quality.clean_packet(raw)
    sid = _get_effective_session(data_dict.get("session_id") or _linked_session() or data_dict.get("device_id") or "default")
    data_dict["session_id"] = sid
    if data_dict.pop("legacy"):
        # Formato original del firmware: la calidad la decide el servidor; SpO2, HRV y estrés no se guardan.
        data_dict.update(measurement_quality.validate_legacy(sid, data_dict))
        data_dict.update({"spo2": None, "hrv": None, "stress": None})
    elif data_dict.get("source") is None:
        data_dict["source"] = "unknown"
    saved = database.save_reading(data_dict)
    saved["device_connected"] = True
    
    _sessions_cache[sid] = {
        "vitals": saved,
        "timestamp": time.time(),
        "last_active": datetime.now().isoformat(),
        "name": data_dict.get("session_name") or f"Sesión {sid}"
    }
    
    await manager.broadcast({
        "type": "VITALS_UPDATE",
        "session_id": sid,
        "data": saved
    })
    for alert in alerts.evaluate_vitals(sid, saved):
        await _publish_alert(alert)
    await _publish_triage_if_changed(sid)
    
    return {"status": "ok", "saved": saved, "session_id": sid, "avisos": avisos}

@app.post("/api/sessions/{session_id}/disconnect")
async def disconnect_session(session_id: str):
    sid = _get_effective_session(session_id)
    if sid in _sessions_cache:
        del _sessions_cache[sid]
    zero_packet = {
        "bpm": 0,
        "spo2": 0.0,
        "systolic": 0,
        "diastolic": 0,
        "temperature": 0.0,
        "stress": 0,
        "stress_score": 0,
        "hrv": 0,
        "audio_rms": 0.0,
        "audio_peak": 0.0,
        "finger": False,
        "device_connected": False,
        "device_id": sid,
        "session_id": sid
    }
    database.save_reading(zero_packet)
    await manager.broadcast({
        "type": "DEVICE_DISCONNECTED",
        "session_id": sid
    })
    return {"status": "disconnected", "session_id": sid}

@app.get("/api/vitals/current")
def get_current_vitals(session_id: Optional[str] = Query(None)):
    sid = _get_effective_session(session_id)
    cached = _sessions_cache.get(sid)
    if cached and (time.time() - cached["timestamp"]) <= 15:
        return cached["vitals"]
    return database.get_latest_reading(session_id=sid if session_id else None)

@app.get("/api/vitals/history")
def get_vitals_history(range: str = Query("24h"), session_id: Optional[str] = Query(None)):
    return database.get_history_points(time_range=range, limit=100, session_id=session_id)

def export_points(session_id: str, time_range: str) -> list[dict]:
    from measurement_quality import usable_value
    rows = database.get_history_points(time_range=time_range, limit=10000, session_id=session_id)
    return [{"timestamp": r["timestamp"], "source": r.get("source", "unknown"),
             "heartRate": usable_value(r, "heartRate", check_timestamp=False),
             "bloodOxygen": usable_value(r, "bloodOxygen", check_timestamp=False),
             "signalQuality": r.get("signalQuality"), "session_id": session_id} for r in rows]


@app.get("/api/export/csv")
def export_csv(time_range: str = Query("24h", alias="range"), session_id: str = Query("default")):
    import csv
    import io
    from fastapi.responses import Response
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Fecha", "Origen", "Pulso válido (BPM)", "SpO2 válida calibrada (%)", "Calidad"])
    for p in export_points(session_id, time_range):
        writer.writerow([p["timestamp"], p["source"], p["heartRate"], p["bloodOxygen"], p["signalQuality"]])
    return Response(out.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="spiroscan_telemetria.csv"'})


@app.get("/api/export/excel")
@app.get("/api/export/xlsx")
def export_excel(time_range: str = Query("24h", alias="range"), session_id: str = Query("default")):
    import io
    from openpyxl import Workbook
    from fastapi.responses import Response
    book = Workbook()
    sheet = book.active
    sheet.title = "Mediciones"
    sheet.append(["Fecha", "Origen", "Pulso válido (BPM)", "SpO2 válida calibrada (%)", "Calidad"])
    for p in export_points(session_id, time_range):
        sheet.append([p["timestamp"], p["source"], p["heartRate"], p["bloodOxygen"], p["signalQuality"]])
    sheet.freeze_panes = "A2"
    for column in ("A", "B", "C", "D", "E"):
        sheet.column_dimensions[column].width = 29
    sheet.append([])
    sheet.append(["Celdas vacías: no hay medición válida. Prototipo sin validación clínica."])
    out = io.BytesIO()
    book.save(out)
    return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="spiroscan_telemetria.xlsx"'})


@app.get("/api/export/pdf")
def export_pdf(time_range: str = Query("24h", alias="range"), session_id: str = Query("default")):
    content, generated = llm_tasks.session_report(session_id)
    path = reports.build_session_pdf(0, session_id, content, generated)
    return FileResponse(path, media_type="application/pdf", filename="spiroscan_sesion.pdf")


@app.get("/api/export/png")
def export_png(metric: str = Query("heartRate"), time_range: str = Query("24h", alias="range"),
               session_id: str = Query("default")):
    import io
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from fastapi.responses import Response
    if metric not in ("heartRate", "bloodOxygen"):
        raise HTTPException(422, "HRV y estrés no tienen una medición validada disponible")
    points = [p for p in export_points(session_id, time_range) if p[metric] is not None]
    if not points:
        raise HTTPException(404, "No hay mediciones válidas para esta sesión y variable")
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot([p["timestamp"][11:19] for p in points], [p[metric] for p in points], marker=".")
    ax.set_title("SpiroScan - mediciones válidas del prototipo")
    ax.set_ylabel("BPM" if metric == "heartRate" else "SpO2 (%)")
    ax.tick_params(axis="x", rotation=45)
    ax.xaxis.set_major_locator(plt.MaxNLocator(8))
    fig.tight_layout()
    out = io.BytesIO()
    fig.savefig(out, format="png", dpi=140)
    plt.close(fig)
    return Response(out.getvalue(), media_type="image/png")


@app.get("/api/export/report")
def export_report(time_range: str = Query("24h", alias="range"), session_id: str = Query("default")):
    from html import escape
    from fastapi.responses import HTMLResponse
    a = clinical_assessment.evaluate_session(session_id)
    lines = [a["summary"], *a["next_steps"], *a["missing_data"], *a["limitations"]]
    body = "".join("<p>" + escape(line) + "</p>" for line in lines)
    return HTMLResponse('<!doctype html><html lang="es"><meta charset="utf-8"><title>SpiroScan</title>'
                        '<h1>Valoración experimental de la sesión</h1>' + body + '</html>')


@app.get("/api/clinical/context/{session_id}")
def clinical_context(session_id: str):
    return clinical_assessment.ClinicalContext.model_validate(database.get_clinical_context(session_id)).model_dump()


@app.put("/api/clinical/context/{session_id}")
async def update_clinical_context(session_id: str, payload: clinical_assessment.ClinicalContext):
    result = database.save_clinical_context(session_id, payload.model_dump())
    await _publish_triage_if_changed(session_id)
    return result


@app.get("/api/clinical/assessment/{session_id}")
def get_clinical_assessment(session_id: str):
    return clinical_assessment.evaluate_session(session_id)


@app.post("/api/ai/vitals/analyze")
def analyze_vitals(payload: AnalyzeInput):
    return ai_engine.assessment_to_report(clinical_assessment.evaluate_session(_get_effective_session(payload.session_id)))

@app.post("/api/ai/audio/classify")
def classify_audio_telemetry(payload: AudioClassifyInput):
    """Clasifica características acústicas del micrófono INMP441 mediante el modelo ICBHI (61 features)."""
    try:
        return lung_baseline.classify_features(payload.features or {})
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

@app.post("/api/ai/chat")
async def chat_ai(payload: ChatInput):
    sid = _get_effective_session(payload.session_id)
    reply = await asyncio.to_thread(llm_tasks.chat, sid, payload.message)
    return {"reply": reply, "message": reply, "session_id": sid}

@app.post("/api/ai/llm/generate")
def direct_llm_generate(payload: LLMDirectInput):
    """Consulta directa al LLM local, siempre con las reglas de seguridad de SpiroScan."""
    system = llm_tasks.BASE_RULES + (payload.system or "")
    try:
        reply = ai_engine.llm_chat([{"role": "system", "content": system}, {"role": "user", "content": payload.prompt}])
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"LLM no disponible: {e}")
    return {"response": reply, "model": ai_engine.LLM_MODEL}

# ---------------------------------------------------------------------------
# Alertas (reglas fijas; el LLM solo reescribe el texto en segundo plano)
# ---------------------------------------------------------------------------

async def _publish_alert(alert: dict):
    await manager.broadcast({"type": "ALERT", "session_id": alert["session_id"], "data": alert})
    # El mensaje de reglas sale de inmediato; Qwen lo reescribe en lenguaje claro después,
    # solo si no agrega cifras (llm_tasks.alert_text). Si falla, queda la plantilla.
    asyncio.create_task(_rewrite_alert(alert))


async def _rewrite_alert(alert: dict):
    text = await asyncio.to_thread(llm_tasks.alert_text, alert)
    if text:
        updated = database.update_alert_text(alert["id"], text["message"], text["action"])
        if updated:
            await manager.broadcast({"type": "ALERT_UPDATED", "session_id": alert["session_id"], "data": updated})


@app.get("/api/alerts")
def list_alerts(session_id: Optional[str] = Query(None), active: bool = Query(False), limit: int = Query(100)):
    return database.list_alerts(session_id=session_id, only_active=active, limit=limit)


@app.post("/api/alerts/{alert_id}/ack")
async def ack_alert(alert_id: int):
    alert = database.acknowledge_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    await manager.broadcast({"type": "ALERT_UPDATED", "session_id": alert["session_id"], "data": alert})
    return alert


# ---------------------------------------------------------------------------
# Auscultación: audio del estetoscopio -> CNN
# ---------------------------------------------------------------------------

# El ESP32 no sabe qué foco eligió la app: la app "arma" la próxima grabación (y vincula su sesión).
# Una preparación sirve para UNA grabación y vence pronto, para que nada caiga en otro foco o paciente.
ARM_TTL_S = 120
_armed: dict = {}


class DeviceLinkInput(BaseModel):
    session_id: str


@app.post("/api/device/link")
async def link_device(payload: DeviceLinkInput):
    """La app indica que el ESP32 (por WiFi) debe registrar sus datos en esta sesión."""
    sid = _get_effective_session(payload.session_id)
    if _armed and _armed.get("session_id") != sid:
        _armed.clear()  # la preparación era de otro paciente
    _device_link.update({"session_id": sid, "at": time.time()})
    await manager.broadcast({"type": "DEVICE_LINKED", "session_id": sid})
    return {"status": "linked", "session_id": sid}


@app.post("/api/audio/arm")
async def audio_arm(payload: AudioArmInput):
    try:
        loc = audio_service._check_location(payload.location)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    mode = audio_service.resolve_mode(loc, payload.mode)
    _armed.update({"session_id": _get_effective_session(payload.session_id), "location": loc, "mode": mode,
                   "at": time.time()})
    _device_link.update({"session_id": _armed["session_id"], "at": time.time()})
    await manager.broadcast({"type": "RECORDING_ARMED", "session_id": _armed["session_id"],
                             "data": {"location": loc, "mode": mode}})
    return {"status": "armed", **_armed}


def _consume_armed() -> dict | None:
    """Devuelve la preparación vigente y la borra: una preparación = una grabación."""
    armed = dict(_armed) if _armed and time.time() - _armed["at"] <= ARM_TTL_S else None
    _armed.clear()
    return armed


async def _after_classification(result: dict):
    await manager.broadcast({"type": "RECORDING_RESULT", "session_id": result["session_id"], "data": result})
    for alert in alerts.evaluate_recording(result):
        await _publish_alert(alert)
    await _publish_triage_if_changed(result["session_id"])


@app.post("/api/audio/start")
async def audio_start(payload: AudioStartInput):
    armed = None if payload.session_id else _consume_armed()
    sid = armed["session_id"] if armed else _get_effective_session(
        payload.session_id or _linked_session() or payload.device_id)
    location = payload.location or (armed["location"] if armed else "")
    try:
        # Sin "source": solo el ESP32 usa este flujo (los emuladores envían "simulated"), así que es audio del dispositivo.
        source = payload.source if "source" in payload.model_fields_set else "real"
        rec_id = audio_service.start(sid, location, payload.sample_rate, armed.get("mode") if armed else None, source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await manager.broadcast({"type": "RECORDING_STARTED", "session_id": sid,
                             "data": {"recording_id": rec_id, "location": location}})
    return {"recording_id": rec_id, "session_id": sid}


@app.post("/api/audio/chunk")
async def audio_chunk(request: Request, recording_id: str = Query(...)):
    data = await request.body()
    try:
        total = audio_service.append_chunk(recording_id, data)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"recording_id": recording_id, "bytes": total}


@app.post("/api/audio/finish")
async def audio_finish(recording_id: str = Query(...)):
    try:
        result = await asyncio.to_thread(audio_service.finish, recording_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al clasificar: {e}")
    await _after_classification(result)
    return result


@app.post("/api/audio/upload")
async def audio_upload(file: UploadFile = File(...), session_id: str = Form("default"), location: str = Form(""),
                       mode: Optional[str] = Form(None), source: Literal["real", "simulated", "unknown"] = Form("unknown")):
    data = await file.read()
    try:
        result = await asyncio.to_thread(audio_service.save_upload, _get_effective_session(session_id),
                                         location, data, mode, source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al clasificar: {e}")
    await _after_classification(result)
    return result


@app.get("/api/recordings")
def list_recordings(session_id: Optional[str] = Query(None), limit: int = Query(50)):
    return database.list_recordings(session_id=session_id, limit=limit)


@app.get("/api/recordings/{recording_id}/audio")
def get_recording_audio(recording_id: str):
    rec = database.get_recording(recording_id)
    if not rec or not rec.get("wav_path") or not os.path.exists(rec["wav_path"]):
        raise HTTPException(status_code=404, detail="Audio no disponible")
    return FileResponse(rec["wav_path"], media_type="audio/wav", filename=f"{recording_id}.wav")


@app.get("/api/model/heart")
def heart_model_info():
    return classifier.model_info()


@app.get("/api/models")
def all_models_info():
    return {"corazon": classifier.model_info(), "pulmon": lung.model_info()}


# ---------------------------------------------------------------------------
# Triaje combinado (semáforo): SpO2 + pulso + corazón + pulmón, por reglas fijas
# ---------------------------------------------------------------------------
_last_triage: dict[str, str] = {}


@app.get("/api/triage/{session_id}")
def get_triage(session_id: str):
    return triage.evaluate(_get_effective_session(session_id))


async def _publish_triage_if_changed(sid: str):
    t = triage.evaluate(sid)
    v = t["datos_usados"]["vitales_ultimo_minuto"] or {}
    # También avisa cuando el pulso o la SpO2 empiezan o dejan de usarse (para el paso "Pulso" de la consulta)
    key = t["nivel"] + "|" + "|".join(t["motivos"]) + f"|fc={v.get('fc') is not None}|spo2={v.get('spo2') is not None}"
    if _last_triage.get(sid) != key:
        _last_triage[sid] = key
        await manager.broadcast({"type": "TRIAGE_UPDATE", "session_id": sid, "data": t})


# ---------------------------------------------------------------------------
# Informe de sesión y guía de uso
# ---------------------------------------------------------------------------

@app.post("/api/reports/session/{session_id}")
async def create_session_report(session_id: str):
    sid = _get_effective_session(session_id)
    content, llm = await asyncio.to_thread(llm_tasks.session_report, sid)
    report_id = database.save_report(sid, content, llm, None)
    pdf = await asyncio.to_thread(reports.build_session_pdf, report_id, sid, content, llm)
    conn = database.get_db_connection()
    with conn:
        conn.execute("UPDATE reports SET pdf_path = ? WHERE id = ?", (str(pdf), report_id))
    conn.close()
    return {"report_id": report_id, "session_id": sid, "llm_generated": llm,
            "pdf_url": f"/api/reports/{report_id}/pdf", "content": content}


@app.get("/api/reports")
def list_reports(session_id: Optional[str] = Query(None)):
    return database.list_reports(session_id=session_id)


@app.post("/api/sessions/{session_id}/archive")
def archive_session(session_id: str):
    """Oculta una sesión de las listas (historial y sesiones). No borra grabaciones, informes ni alertas."""
    sid = _get_effective_session(session_id)
    if not database.session_exists(sid):
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    database.archive_session(sid)
    return {"session_id": sid, "archived": True}


@app.post("/api/sessions/{session_id}/unarchive")
def unarchive_session(session_id: str):
    sid = _get_effective_session(session_id)
    if not database.session_exists(sid):
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    database.unarchive_session(sid)
    return {"session_id": sid, "archived": False}


@app.get("/api/history")
def sessions_history(limit: int = Query(100), archived: bool = Query(False)):
    """Historial por paciente (sesión), con el nivel de triaje actual de cada una. archived=true: las archivadas."""
    rows = database.get_sessions_overview(limit, archived=archived)
    for r in rows:
        r["triaje"] = triage.evaluate(r["session_id"])["nivel"]
    return rows


@app.get("/api/reports/{report_id}/pdf")
def get_report_pdf(report_id: int):
    rep = database.get_report(report_id)
    if not rep or not rep.get("pdf_path") or not os.path.exists(rep["pdf_path"]):
        raise HTTPException(status_code=404, detail="Informe no encontrado")
    return FileResponse(rep["pdf_path"], media_type="application/pdf", filename=os.path.basename(rep["pdf_path"]))


@app.get("/api/guide/{location}")
def get_guide(location: str):
    try:
        return llm_tasks.guide(location)
    except KeyError:
        raise HTTPException(status_code=404, detail="Foco inválido. Usa AV, PV, TV o MV.")


@app.post("/api/guide/ask")
async def ask_guide(payload: GuideQuestionInput):
    last = database.list_recordings(session_id=payload.session_id, limit=1) if payload.session_id else []
    quality = last[0]["quality"] if last else None
    answer = await asyncio.to_thread(llm_tasks.guide_answer, payload.question, payload.location, quality)
    return {"answer": answer}


@app.get("/api/device/status")
def get_device_status():
    latest = database.get_latest_reading()
    return {
        "name": "Smart Band BioSync",
        "model": "ESP32-DEVKITC-V4",
        "connected": session_state["is_phone_connected"] and (latest.get("heartRate", 0) > 0),
        "battery": 92,
        "lastSync": latest.get("timestamp", datetime.now().isoformat()),
        "firmwareVersion": "v1.4.2",
        "signalStrength": "excellent"
    }

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        latest = database.get_latest_reading()
        await websocket.send_json({"type": "INITIAL_STATE", "data": latest})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# ---------------------------------------------------------------------------
# Banco de pruebas clínico (casos de ICBHI 2017 para demostraciones; autor: chayand-wil)
# Los signos vitales de cada caso son DATOS DE EJEMPLO: se guardan marcados como demo y solo
# pulso y SpO2 (el dispositivo no mide presión ni temperatura).
# ---------------------------------------------------------------------------
DEMO_AUDIOS_DIR = os.path.join(os.path.dirname(__file__), "demo_audios")



def _demo_samples() -> dict:
    json_path = os.path.join(DEMO_AUDIOS_DIR, "demoSamples.json")
    if not os.path.exists(json_path):
        return {}
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/demo/samples")
def get_demo_samples():
    """Catálogo de casos de ICBHI 2017 para demostraciones."""
    return _demo_samples()


@app.get("/api/demo/audio/{audio_id}")
def get_demo_audio_file(audio_id: str):
    """Audio .wav de un caso de demostración, para escucharlo en la app."""
    clean_id = os.path.basename(audio_id)
    if not clean_id.endswith(".wav"):
        clean_id += ".wav"
    file_path = os.path.join(DEMO_AUDIOS_DIR, clean_id)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="audio/wav")
    raise HTTPException(status_code=404, detail="Audio de demostración no encontrado")


@app.post("/api/demo/inject/{sample_id}")
async def inject_demo_sample(sample_id: str, session_id: Optional[str] = Query(None)):
    """Carga un caso de demostración en la sesión: vitales de ejemplo + análisis del modelo base de pulmón."""
    samples = _demo_samples()
    if sample_id not in samples:
        raise HTTPException(status_code=404, detail=f"Muestra '{sample_id}' no encontrada")
    sample = samples[sample_id]
    sid = _get_effective_session(session_id)

    saved = database.save_reading({"bpm": 0, "spo2": 0, "session_id": sid, "source": "simulated", "heartRateValid": False, "bloodOxygenValid": False})
    saved.update({"device_connected": True, "demo": True})
    _sessions_cache[sid] = {"vitals": saved, "timestamp": time.time(),
                            "last_active": datetime.now().isoformat(), "name": f"Demo ICBHI {sample['patient_id']}"}
    await manager.broadcast({"type": "VITALS_UPDATE", "session_id": sid, "data": saved})

    acoustic = lung_baseline.classify_features(sample.get("features", {}))
    report = ai_engine.analyze_vitals_report({**saved, "audio_features": sample.get("features", {})})

    # Se registra como una grabación de pulmón para que la vean el semáforo, las alertas y el informe.
    zone = (sample.get("recording_name", "").split("_") + ["", "", ""])[2].upper()
    zone = zone if zone in audio_service.LUNG_LOCATIONS else ""
    rec_id = f"demo_{sample_id}_{uuid.uuid4().hex[:4]}"
    database.create_recording(rec_id, sid, zone, 0)
    abnormal = acoustic.get("is_abnormal") == 1
    details = {"modelo_base": acoustic, "demo": {"caso": sample_id, "paciente_icbhi": sample["patient_id"],
                                                 "diagnostico_icbhi": sample["diagnosis"],
                                                 "ciclo": sample["cycle_class_name"]}}
    database.update_recording(rec_id, mode="pulmon", source="simulated", status="done", finished_at=datetime.now().isoformat(),
                              result="anormal" if abnormal else "normal",
                              probability=acoustic.get("probability_abnormal"),
                              threshold=acoustic.get("umbral"), details=details, model="modelo_base_demo")
    result = {"recording_id": rec_id, "session_id": sid, "location": zone, "mode": "pulmon", "duration_s": 0,
              "result": "anormal" if abnormal else "normal", "reason": None,
              "probability": acoustic.get("probability_abnormal"), "threshold": acoustic.get("umbral"),
              "details": details, "quality": None}
    await _after_classification(result)

    return {
        "status": "injected",
        "demo": True,
        "aviso": "Caso de demostración de ICBHI 2017: los signos vitales son datos de ejemplo.",
        "sample_id": sample_id,
        "patient_id": sample["patient_id"],
        "diagnosis": sample["diagnosis"],
        "cycle_class_name": sample["cycle_class_name"],
        "vitals": saved,
        "report": report,
        "recording": result,
    }


# ---------------------------------------------------------------------------
# App web servida por esta misma Mac (npx expo export --platform web -> App Movil/dist)
# Se monta al final para que las rutas /api y /ws tengan prioridad.
# ---------------------------------------------------------------------------
if os.path.isdir(APP_DIST):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=APP_DIST, html=True), name="app")
else:
    @app.get("/")
    def app_not_built():
        return {"status": "online", "detail": "App web no compilada. Ejecuta ./start_server.sh --build", "api": "/api/status"}


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)
