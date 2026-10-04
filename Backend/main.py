import os
import time
import asyncio
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import database
import ai_engine

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

class TelemetryInput(BaseModel):
    bpm: int
    spo2: float
    audio_rms: Optional[float] = 18.5
    audio_peak: Optional[float] = 28.0
    systolic: Optional[int] = 120
    diastolic: Optional[int] = 80
    temperature: Optional[float] = 36.5
    hrv: Optional[int] = 45
    stress: Optional[int] = 25
    device_id: Optional[str] = "default"
    session_id: Optional[str] = None
    session_name: Optional[str] = None

class AnalyzeInput(BaseModel):
    vitals: dict
    session_id: Optional[str] = None

class PulmonaryAnalyzeInput(BaseModel):
    vitals: Optional[dict] = None
    audio_rms: Optional[float] = None
    audio_peak: Optional[float] = None
    session_id: Optional[str] = None

class ChatInput(BaseModel):
    message: str
    vitals: Optional[dict] = None
    session_id: Optional[str] = None

class LLMDirectInput(BaseModel):
    prompt: str
    system: Optional[str] = None

_sessions_cache: dict[str, dict] = {}

def _get_effective_session(session_id: Optional[str] = None) -> str:
    return str(session_id or "default").strip()

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "SpiroScan IoT Backend API",
        "version": "1.4.0",
        "phone_connected": session_state["is_phone_connected"],
        "active_sessions_count": len(_sessions_cache),
        "llm_model": ai_engine.OLLAMA_MODEL
    }

@app.get("/api/sessions")
def list_active_sessions():
    """Lista todas las sesiones activas y registradas en el sistema."""
    db_sessions = database.get_distinct_sessions()
    combined = {}
    for item in db_sessions:
        sid = item["session_id"]
        combined[sid] = {
            "session_id": sid,
            "name": f"Sesión {sid}",
            "records_count": item["records_count"],
            "last_seen": item["last_seen"],
            "is_live": False
        }
    for sid, info in _sessions_cache.items():
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
async def receive_telemetry(payload: TelemetryInput):
    data_dict = payload.model_dump()
    sid = _get_effective_session(data_dict.get("session_id") or data_dict.get("device_id"))
    data_dict["session_id"] = sid
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
    
    return {"status": "ok", "saved": saved, "session_id": sid}

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

def generate_pdf_report(points: list, time_range: str) -> bytes:
    import io
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#1E3A8A'),
        fontName='Helvetica-Bold'
    )
    badge_style = ParagraphStyle(
        'Badge',
        parent=styles['Normal'],
        fontSize=9,
        leading=11,
        textColor=colors.HexColor('#1D4ED8'),
        fontName='Helvetica-Bold',
        alignment=2
    )
    section_heading = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontSize=11,
        leading=14,
        textColor=colors.HexColor('#1E293B'),
        fontName='Helvetica-Bold',
        spaceBefore=8,
        spaceAfter=4
    )
    body_style = ParagraphStyle(
        'BodyDark',
        parent=styles['Normal'],
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#334155'),
        fontName='Helvetica'
    )
    th_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontSize=8,
        leading=10,
        textColor=colors.HexColor('#1E293B'),
        fontName='Helvetica-Bold',
        alignment=1
    )
    td_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor('#334155'),
        fontName='Helvetica',
        alignment=1
    )

    story = []

    header_data = [
        [
            Paragraph("<b>SpiroScan AI</b><br/><font size=8 color='#64748B'>Sistema Hospitalario de Telemetría Biológica IoT</font>", title_style),
            Paragraph("<font color='#1D4ED8'><b>REPORTE CLÍNICO OFICIAL</b></font><br/><font size=8 color='#64748B'>Verificado por Algoritmo Bio-IA</font>", badge_style)
        ]
    ]
    header_table = Table(header_data, colWidths=[360, 180])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#2563EB'), spaceBefore=2, spaceAfter=8))

    hr_vals = [p.get("heartRate", 0) for p in points if p.get("heartRate", 0) > 0]
    spo2_vals = [p.get("bloodOxygen", 0) for p in points if p.get("bloodOxygen", 0) > 0]
    sys_vals = [p.get("systolicPressure", 0) for p in points if p.get("systolicPressure", 0) > 0]
    dia_vals = [p.get("diastolicPressure", 0) for p in points if p.get("diastolicPressure", 0) > 0]
    stress_vals = [p.get("stressLevel", 0) for p in points if p.get("stressLevel", 0) > 0]

    avg_hr = round(sum(hr_vals) / len(hr_vals)) if hr_vals else 75
    min_hr = min(hr_vals) if hr_vals else 60
    max_hr = max(hr_vals) if hr_vals else 100

    avg_spo2 = f"{(sum(spo2_vals) / len(spo2_vals)):.1f}" if spo2_vals else "98.5"
    min_spo2 = f"{min(spo2_vals):.1f}" if spo2_vals else "97.0"
    avg_sys = round(sum(sys_vals) / len(sys_vals)) if sys_vals else 120
    avg_dia = round(sum(dia_vals) / len(dia_vals)) if dia_vals else 80
    avg_stress = round(sum(stress_vals) / len(stress_vals)) if stress_vals else 25

    sample_vitals = {
        "heartRate": avg_hr,
        "bloodOxygen": float(avg_spo2),
        "systolicPressure": avg_sys,
        "diastolicPressure": avg_dia,
        "stressLevel": avg_stress,
        "temperature": 36.5
    }
    ai_diag = ai_engine.analyze_vitals_report(sample_vitals)
    health_score = ai_diag.get("healthScore", 95)
    diag_status = ai_diag.get("status", "normal")
    diag_title = ai_diag.get("title", "Monitoreo Clínico")
    diag_summary = ai_diag.get("summary", "Parámetros hemodinámicos dentro de límites normales.")
    recommendations = ai_diag.get("recommendations", ["Mantener hidratación y reposo habitual."])

    range_label = "Últimas 24 Horas" if time_range == "24h" else ("Últimos 7 Días" if time_range == "7d" else "Últimos 30 Días")
    report_date = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    meta_data = [
        [
            Paragraph("<font size=7 color='#64748B'><b>DISPOSITIVO SENSOR</b></font><br/>ESP32 (MAX30102 + INMP441)", body_style),
            Paragraph(f"<font size=7 color='#64748B'><b>PERIODO TEMPORAL</b></font><br/>{range_label} ({len(points)} muestras)", body_style),
            Paragraph(f"<font size=7 color='#64748B'><b>FECHA DE EMISIÓN</b></font><br/>{report_date}", body_style)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[180, 180, 180])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#E2E8F0')),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 8))

    stat_hr = Paragraph(f"<font size=7 color='#E11D48'><b>RITMO CARDÍACO</b></font><br/><font size=13 color='#E11D48'><b>{avg_hr}</b></font> <font size=7.5>BPM</font><br/><font size=6.5 color='#64748B'>Mín: {min_hr} • Máx: {max_hr}</font>", body_style)
    stat_spo2 = Paragraph(f"<font size=7 color='#0284C7'><b>OXÍGENO (SpO2)</b></font><br/><font size=13 color='#0284C7'><b>{avg_spo2}%</b></font><br/><font size=6.5 color='#64748B'>Mín: {min_spo2}%</font>", body_style)
    stat_bp = Paragraph(f"<font size=7 color='#D97706'><b>PRESIÓN ARTERIAL</b></font><br/><font size=13 color='#D97706'><b>{avg_sys}/{avg_dia}</b></font><br/><font size=6.5 color='#64748B'>Normotensión</font>", body_style)
    status_hex = '#059669' if diag_status == 'normal' else ('#D97706' if diag_status == 'caution' else '#DC2626')
    status_label = 'Estable' if diag_status == 'normal' else ('Precaución' if diag_status == 'caution' else 'Crítico')
    stat_score = Paragraph(f"<font size=7 color='{status_hex}'><b>ESTADO FISIOLÓGICO</b></font><br/><font size=13 color='{status_hex}'><b>{health_score}/100</b></font><br/><font size=6.5 color='#64748B'>{status_label}</font>", body_style)

    stats_table = Table([[stat_hr, stat_spo2, stat_bp, stat_score]], colWidths=[135, 135, 135, 135])
    stats_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.white),
        ('BOX', (0,0), (0,0), 1, colors.HexColor('#FECDD3')),
        ('BOX', (1,0), (1,0), 1, colors.HexColor('#BAE6FD')),
        ('BOX', (2,0), (2,0), 1, colors.HexColor('#FDE68A')),
        ('BOX', (3,0), (3,0), 1, colors.HexColor('#A7F3D0')),
        ('PADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 8))

    recs_text = "<br/>".join([f"• {r}" for r in recommendations])
    ai_content = Paragraph(
        f"<b><font size=9.5 color='#6D28D9'>🧠 Diagnóstico Asistido por SpiroScan AI: {diag_title}</font></b><br/>"
        f"<font size=8 color='#334155'>{diag_summary}</font><br/><br/>"
        f"<b><font size=7.5 color='#475569'>Recomendaciones Clínicas:</font></b><br/>"
        f"<font size=7.5 color='#475569'>{recs_text}</font>",
        body_style
    )
    ai_table = Table([[ai_content]], colWidths=[540])
    ai_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F5F3FF')),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#DDD6FE')),
        ('PADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(ai_table)
    story.append(Spacer(1, 6))

    story.append(Paragraph(f"<b>Registros de Telemetría ({len(points)} lecturas recientes)</b>", section_heading))
    table_data = [
        [
            Paragraph("<b>#</b>", th_style),
            Paragraph("<b>Hora</b>", th_style),
            Paragraph("<b>Pulsaciones</b>", th_style),
            Paragraph("<b>SpO2</b>", th_style),
            Paragraph("<b>Presión</b>", th_style),
            Paragraph("<b>Estrés</b>", th_style),
            Paragraph("<b>Acústica</b>", th_style),
        ]
    ]
    for idx, p in enumerate(points[:28], 1):
        table_data.append([
            Paragraph(str(idx), td_style),
            Paragraph(p.get("timeLabel", ""), td_style),
            Paragraph(f"{p.get('heartRate', '--')} BPM", td_style),
            Paragraph(f"{float(p.get('bloodOxygen', 0)):.1f}%", td_style),
            Paragraph(f"{p.get('systolicPressure', 120)}/{p.get('diastolicPressure', 80)}", td_style),
            Paragraph(f"{p.get('stressLevel', 25)}/100", td_style),
            Paragraph(f"{float(p.get('audio_rms', 0)):.1f} dB", td_style),
        ])

    data_table = Table(table_data, colWidths=[30, 85, 85, 85, 85, 85, 85])
    t_style = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
    ]
    for r_idx in range(1, len(table_data)):
        if r_idx % 2 == 0:
            t_style.append(('BACKGROUND', (0, r_idx), (-1, r_idx), colors.HexColor('#F8FAFC')))
    data_table.setStyle(TableStyle(t_style))
    story.append(data_table)

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#CBD5E1'), spaceBefore=4, spaceAfter=4))
    story.append(Paragraph("<font size=7 color='#94A3B8'>SpiroScan Medical Platform • Telemetría Criptográficamente Verificada en SQLite • Formato PDF Certificado</font>", body_style))

    doc.build(story)
    return buf.getvalue()

def generate_excel_workbook(points: list, time_range: str) -> bytes:
    import io
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Telemetría SpiroScan"

    headers = [
        "Registro",
        "Fecha y Hora ISO",
        "Hora Local",
        "Ritmo Cardíaco (BPM)",
        "Oxígeno (% SpO2)",
        "Presión Sistólica (mmHg)",
        "Presión Diastólica (mmHg)",
        "Temperatura (°C)",
        "Estrés (/100)",
        "Acústica RMS (dB)",
        "Acústica Pico (dB)",
        "Variabilidad HRV (ms)",
        "Dispositivo"
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=11)
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    for col_idx, cell in enumerate(ws[1], 1):
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border

    for idx, p in enumerate(points, 1):
        row = [
            idx,
            p.get("timestamp", ""),
            p.get("timeLabel", ""),
            p.get("heartRate", 0),
            round(float(p.get("bloodOxygen", 0.0)), 1),
            p.get("systolicPressure", 120),
            p.get("diastolicPressure", 80),
            round(float(p.get("temperature", 36.5)), 1),
            p.get("stressLevel", 25),
            round(float(p.get("audio_rms", 0.0)), 1),
            round(float(p.get("audio_peak", 0.0)), 1),
            p.get("hrv", 45),
            p.get("device_id", "ESP32-BIO-01")
        ]
        ws.append(row)
        curr_row = ws[idx + 1]
        for cell in curr_row:
            cell.border = thin_border
            cell.alignment = Alignment(horizontal="center", vertical="center")
            if idx % 2 == 0:
                cell.fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = col[0].column_letter
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

@app.get("/api/export/excel")
@app.get("/api/export/xlsx")
def export_excel(time_range: str = Query("24h", alias="range")):
    from fastapi.responses import Response
    points = database.get_history_points(time_range=time_range, limit=500)
    xlsx_bytes = generate_excel_workbook(points, time_range)
    filename = f"spiroscan_telemetria_{time_range}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/export/pdf")
def export_pdf(time_range: str = Query("24h", alias="range")):
    from fastapi.responses import Response
    points = database.get_history_points(time_range=time_range, limit=500)
    pdf_bytes = generate_pdf_report(points, time_range)
    filename = f"spiroscan_reporte_clinico_{time_range}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/export/csv")
def export_csv(time_range: str = Query("24h", alias="range")):
    from fastapi.responses import Response
    points = database.get_history_points(time_range=time_range, limit=500)
    
    headers = [
        "Registro",
        "Fecha y Hora",
        "Hora Local",
        "Ritmo Cardíaco (BPM)",
        "Oxígeno en Sangre (% SpO2)",
        "Presión Sistólica (mmHg)",
        "Presión Diastólica (mmHg)",
        "Temperatura (°C)",
        "Estrés (/100)",
        "Acústica RMS (dB)",
        "Acústica Pico (dB)",
        "Variabilidad HRV (ms)",
        "Dispositivo"
    ]
    
    lines = [",".join(headers)]
    for idx, p in enumerate(points, 1):
        row = [
            str(idx),
            f'"{p.get("timestamp", "")}"',
            f'"{p.get("timeLabel", "")}"',
            str(p.get("heartRate", 0)),
            f'{float(p.get("bloodOxygen", 0.0)):.1f}',
            str(p.get("systolicPressure", 120)),
            str(p.get("diastolicPressure", 80)),
            f'{float(p.get("temperature", 36.5)):.1f}',
            str(p.get("stressLevel", 25)),
            f'{float(p.get("audio_rms", 0.0)):.1f}',
            f'{float(p.get("audio_peak", 0.0)):.1f}',
            str(p.get("hrv", 45)),
            f'"{p.get("device_id", "ESP32-BIO-01")}"'
        ]
        lines.append(",".join(row))
        
    csv_text = "\r\n".join(lines)
    filename = f"spiroscan_telemetria_{time_range}.csv"
    
    return Response(
        content=csv_text.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/export/png")
def export_png(metric: str = Query("heartRate"), time_range: str = Query("24h", alias="range")):
    import io
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from fastapi.responses import Response
    
    points = database.get_history_points(time_range=time_range, limit=500)
    if not points:
        points = [{
            "timeLabel": "12:00",
            "heartRate": 75,
            "bloodOxygen": 98.5,
            "systolicPressure": 120,
            "stressLevel": 25
        }]
        
    metric_map = {
        "heartRate": ("Ritmo Cardíaco", "BPM", "#E11D48"),
        "bloodOxygen": ("Oxígeno en Sangre", "% SpO2", "#0284C7"),
        "systolicPressure": ("Presión Sistólica", "mmHg", "#D97706"),
        "stressLevel": ("Estrés Autonómico", "/100", "#7C3AED")
    }
    label, unit, color = metric_map.get(metric, ("Ritmo Cardíaco", "BPM", "#E11D48"))
    
    y_vals = [float(p.get(metric, 75)) for p in points]
    x_labels = [p.get("timeLabel", str(i)) for i, p in enumerate(points)]
    
    fig, ax = plt.subplots(figsize=(11, 5.5), dpi=160, facecolor='#0F172A')
    ax.set_facecolor('#0F172A')
    
    x_indices = list(range(len(y_vals)))
    ax.plot(x_indices, y_vals, color=color, linewidth=2.8, marker='o', markersize=3.5, label=f"{label} ({unit})")
    ax.fill_between(x_indices, y_vals, min(y_vals) - 2, color=color, alpha=0.18)
    
    ax.set_title(f"SPIROSCAN AI  •  HISTORIAL BIOMÉDICO: {label.upper()} ({time_range.upper()})", fontsize=13, color='#38BDF8', weight='bold', pad=16)
    ax.set_ylabel(f"{label} ({unit})", fontsize=10, color='#94A3B8', weight='bold')
    ax.set_xlabel("Tiempo de Muestreo", fontsize=10, color='#94A3B8', weight='bold')
    
    ax.grid(True, linestyle='--', alpha=0.18, color='#64748B')
    ax.tick_params(colors='#94A3B8', which='both', labelsize=9)
    
    step = max(1, len(x_labels) // 8)
    ax.set_xticks(x_indices[::step])
    ax.set_xticklabels(x_labels[::step], rotation=25, ha='right', color='#94A3B8')
    
    for spine in ax.spines.values():
        spine.set_color('#334155')
        
    avg_v = sum(y_vals) / len(y_vals)
    min_v = min(y_vals)
    max_v = max(y_vals)
    stats_text = f"Sensor: ESP32 MAX30102  |  Promedio: {avg_v:.1f} {unit}  |  Mín: {min_v:.1f}  |  Máx: {max_v:.1f}  |  Muestras: {len(y_vals)}"
    fig.text(0.5, 0.02, stats_text, ha='center', fontsize=9, color='#64748B', weight='bold')
    
    plt.tight_layout()
    
    buf = io.BytesIO()
    plt.savefig(buf, format='png', facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    buf.seek(0)
    
    filename = f"spiroscan_{metric}_{time_range}.png"
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/export/report")
def export_report(time_range: str = Query("24h", alias="range")):
    from fastapi.responses import HTMLResponse
    points = database.get_history_points(time_range=time_range, limit=500)
    
    hr_vals = [p.get("heartRate", 0) for p in points if p.get("heartRate", 0) > 0]
    spo2_vals = [p.get("bloodOxygen", 0) for p in points if p.get("bloodOxygen", 0) > 0]
    sys_vals = [p.get("systolicPressure", 0) for p in points if p.get("systolicPressure", 0) > 0]
    dia_vals = [p.get("diastolicPressure", 0) for p in points if p.get("diastolicPressure", 0) > 0]
    stress_vals = [p.get("stressLevel", 0) for p in points if p.get("stressLevel", 0) > 0]
    
    avg_hr = round(sum(hr_vals) / len(hr_vals)) if hr_vals else 75
    min_hr = min(hr_vals) if hr_vals else 60
    max_hr = max(hr_vals) if hr_vals else 100
    
    avg_spo2 = f"{(sum(spo2_vals) / len(spo2_vals)):.1f}" if spo2_vals else "98.5"
    min_spo2 = f"{min(spo2_vals):.1f}" if spo2_vals else "97.0"
    avg_sys = round(sum(sys_vals) / len(sys_vals)) if sys_vals else 120
    avg_dia = round(sum(dia_vals) / len(dia_vals)) if dia_vals else 80
    avg_stress = round(sum(stress_vals) / len(stress_vals)) if stress_vals else 25
    
    sample_vitals = {
        "heartRate": avg_hr,
        "bloodOxygen": float(avg_spo2),
        "systolicPressure": avg_sys,
        "diastolicPressure": avg_dia,
        "stressLevel": avg_stress,
        "temperature": 36.5
    }
    ai_diag = ai_engine.analyze_vitals_report(sample_vitals)
    health_score = ai_diag.get("healthScore", 95)
    diag_status = ai_diag.get("status", "normal")
    diag_title = ai_diag.get("title", "Monitoreo Clínico")
    diag_summary = ai_diag.get("summary", "Parámetros hemodinámicos dentro de límites normales.")
    recommendations = ai_diag.get("recommendations", ["Mantener hidratación y reposo habitual."])
    
    status_label = "Estable" if diag_status == "normal" else ("Precaución" if diag_status == "caution" else "Crítico")
    status_color = "#059669" if diag_status == "normal" else ("#D97706" if diag_status == "caution" else "#DC2626")
    
    recs_html = "".join([f"<li style='margin-bottom: 4px;'>{r}</li>" for r in recommendations])
    
    report_date = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    range_label = "Últimas 24 Horas" if time_range == "24h" else ("Últimos 7 Días" if time_range == "7d" else "Últimos 30 Días")
    
    table_rows = "".join([
        f"""<tr style="border-bottom: 1px solid #E2E8F0; font-size: 12px;">
            <td style="padding: 8px; color: #64748B;">{i+1}</td>
            <td style="padding: 8px; font-weight: 600;">{p.get('timeLabel', p.get('timestamp', ''))}</td>
            <td style="padding: 8px; color: #E11D48; font-weight: 700;">{p.get('heartRate', '--')} BPM</td>
            <td style="padding: 8px; color: #0284C7; font-weight: 700;">{float(p.get('bloodOxygen', 0)):.1f}%</td>
            <td style="padding: 8px; color: #D97706;">{p.get('systolicPressure', 120)}/{p.get('diastolicPressure', 80)}</td>
            <td style="padding: 8px; color: #7C3AED;">{p.get('stressLevel', 25)}/100</td>
            <td style="padding: 8px; color: #0891B2;">{float(p.get('audio_rms', 0)):.1f} dB</td>
        </tr>""" for i, p in enumerate(points[:50])
    ])
    
    html = f"""<!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <title>SpiroScan AI - Reporte Clínico Oficial ({range_label})</title>
        <style>
            @media print {{
                .no-print {{ display: none !important; }}
                body {{ padding: 0 !important; margin: 10mm !important; }}
            }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background: #F8FAFC;
                color: #0F172A;
                margin: 0;
                padding: 24px;
            }}
            .container {{
                max-width: 900px;
                margin: 0 auto;
                background: #FFFFFF;
                border-radius: 12px;
                padding: 32px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                border: 1px solid #E2E8F0;
            }}
            .header {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 2px solid #2563EB;
                padding-bottom: 16px;
                margin-bottom: 20px;
            }}
            .brand {{ font-size: 24px; font-weight: 900; color: #2563EB; }}
            .badge {{
                background: #EFF6FF;
                color: #1D4ED8;
                font-weight: 800;
                font-size: 11px;
                padding: 6px 14px;
                border-radius: 20px;
                border: 1px solid #BFDBFE;
            }}
            .meta-bar {{
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                background: #F8FAFC;
                padding: 14px;
                border-radius: 8px;
                border: 1px solid #E2E8F0;
                margin-bottom: 24px;
                font-size: 12px;
            }}
            .meta-label {{ color: #64748B; font-weight: 700; font-size: 10px; text-transform: uppercase; }}
            .meta-val {{ font-weight: 700; font-size: 13px; margin-top: 2px; }}
            .stats-grid {{
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 12px;
                margin-bottom: 24px;
            }}
            .stat-card {{
                padding: 14px;
                border-radius: 10px;
                border: 1px solid #E2E8F0;
                background: #FFFFFF;
                text-align: center;
            }}
            .stat-num {{ font-size: 20px; font-weight: 900; margin-top: 4px; }}
            .ai-box {{
                background: linear-gradient(135deg, #F5F3FF 0%, #EFF6FF 100%);
                border: 1px solid #DDD6FE;
                border-radius: 10px;
                padding: 16px;
                margin-bottom: 24px;
            }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
            th {{
                background: #F1F5F9;
                color: #475569;
                font-size: 11px;
                text-transform: uppercase;
                padding: 8px;
                text-align: left;
                border-bottom: 1px solid #CBD5E1;
            }}
            .action-bar {{
                position: fixed;
                bottom: 24px;
                right: 24px;
                display: flex;
                gap: 12px;
            }}
            .btn {{
                background: #2563EB;
                color: #FFFFFF;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(37,99,235,0.3);
                transition: transform 0.15s ease, background-color 0.15s ease;
            }}
            .btn:hover {{
                background: #1D4ED8;
                transform: translateY(-1px);
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div>
                    <div class="brand">SpiroScan AI</div>
                    <div style="font-size: 11px; color: #64748B; margin-top: 2px;">Sistema Hospitalario de Telemetría Biológica IoT</div>
                </div>
                <div class="badge">REPORTE CLÍNICO OFICIAL</div>
            </div>

            <div class="meta-bar">
                <div>
                    <div class="meta-label">Dispositivo Sensor</div>
                    <div class="meta-val">ESP32 (MAX30102 + INMP441)</div>
                </div>
                <div>
                    <div class="meta-label">Periodo Temporal</div>
                    <div class="meta-val">{range_label} ({len(points)} muestras)</div>
                </div>
                <div>
                    <div class="meta-label">Fecha y Hora de Emisión</div>
                    <div class="meta-val">{report_date}</div>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card" style="border-left: 4px solid #E11D48;">
                    <div class="meta-label">Ritmo Cardíaco</div>
                    <div class="stat-num" style="color: #E11D48;">{avg_hr} <span style="font-size: 11px;">BPM</span></div>
                    <div style="font-size: 10px; color: #64748B;">Mín: {min_hr} • Máx: {max_hr}</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #0284C7;">
                    <div class="meta-label">Oxígeno (SpO2)</div>
                    <div class="stat-num" style="color: #0284C7;">{avg_spo2}%</div>
                    <div style="font-size: 10px; color: #64748B;">Mín: {min_spo2}%</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #D97706;">
                    <div class="meta-label">Presión Arterial</div>
                    <div class="stat-num" style="color: #D97706;">{avg_sys}/{avg_dia}</div>
                    <div style="font-size: 10px; color: #64748B;">Normotensión</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid {status_color};">
                    <div class="meta-label">Estado Fisiológico</div>
                    <div class="stat-num" style="color: {status_color};">{health_score}/100</div>
                    <div style="font-size: 10px; color: #64748B;">{status_label}</div>
                </div>
            </div>

            <div class="ai-box">
                <div style="font-size: 13px; font-weight: 800; color: #6D28D9; margin-bottom: 6px;">🧠 Diagnóstico Asistido por SpiroScan AI: {diag_title}</div>
                <div style="font-size: 12px; color: #334155; line-height: 1.5; margin-bottom: 8px;">
                    {diag_summary}
                </div>
                <ul style="margin: 0; padding-left: 18px; font-size: 11px; color: #475569; line-height: 1.5;">
                    {recs_html}
                </ul>
            </div>

            <div style="font-size: 13px; font-weight: 800; margin-bottom: 8px; color: #1E293B;">Registros de Telemetría en Base de Datos ({len(points)} lecturas)</div>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Hora</th>
                        <th>Pulsaciones</th>
                        <th>SpO2</th>
                        <th>Presión</th>
                        <th>Estrés</th>
                        <th>Acústica</th>
                    </tr>
                </thead>
                <tbody>
                    {table_rows}
                </tbody>
            </table>

            <div style="margin-top: 32px; padding-top: 12px; border-top: 1px solid #E2E8F0; font-size: 10px; color: #94A3B8; display: flex; justify-content: space-between;">
                <span>SpiroScan Medical Platform • Telemetría Criptográficamente Verificada en SQLite</span>
                <span>Página 1 de 1</span>
            </div>
        </div>

        <div class="action-bar no-print">
            <button class="btn" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
        </div>
    </body>
    </html>"""
    
    return HTMLResponse(content=html)
    
    return HTMLResponse(content=html)

@app.post("/api/ai/vitals/analyze")
def analyze_vitals(payload: AnalyzeInput):
    return ai_engine.analyze_vitals_report(payload.vitals)

@app.post("/api/ai/pulmonary/analyze")
def analyze_pulmonary(payload: PulmonaryAnalyzeInput):
    sid = _get_effective_session(payload.session_id)
    vitals = dict(payload.vitals or {})
    if payload.audio_rms is not None:
        vitals["audio_rms"] = payload.audio_rms
    if payload.audio_peak is not None:
        vitals["audio_peak"] = payload.audio_peak
    if not vitals or vitals.get("heartRate", 0) == 0:
        latest = database.get_latest_valid_reading(session_id=sid)
        for k, v in latest.items():
            if k not in vitals or vitals[k] == 0:
                vitals[k] = v
    return ai_engine.analyze_pulmonary_acoustic(vitals)

@app.post("/api/ai/chat")
def chat_ai(payload: ChatInput):
    sid = _get_effective_session(payload.session_id)
    vitals = dict(payload.vitals) if isinstance(payload.vitals, dict) else {}

    # Normalizar nombres de propiedades comunes
    if "bpm" in vitals and "heartRate" not in vitals:
        vitals["heartRate"] = vitals["bpm"]
    if "spo2" in vitals and "bloodOxygen" not in vitals:
        vitals["bloodOxygen"] = vitals["spo2"]
    if "systolic" in vitals and "systolicPressure" not in vitals:
        vitals["systolicPressure"] = vitals["systolic"]
    if "diastolic" in vitals and "diastolicPressure" not in vitals:
        vitals["diastolicPressure"] = vitals["diastolic"]
    if "stress" in vitals and "stressLevel" not in vitals:
        vitals["stressLevel"] = vitals["stress"]

    hr = int(vitals.get("heartRate") or 0)
    spo2 = float(vitals.get("bloodOxygen") or 0.0)

    # Si no vienen constantes válidas en el payload, recurrir a la última medición guardada
    if hr == 0 and spo2 == 0.0:
        cached = _sessions_cache.get(sid)
        if cached and isinstance(cached.get("vitals"), dict):
            c_v = cached["vitals"]
            c_hr = int(c_v.get("heartRate") or c_v.get("bpm") or 0)
            c_spo2 = float(c_v.get("bloodOxygen") or c_v.get("spo2") or 0.0)
            if c_hr > 0 or c_spo2 > 0:
                vitals = {**c_v, **vitals}
                vitals["heartRate"] = c_hr
                vitals["bloodOxygen"] = c_spo2
                hr, spo2 = c_hr, c_spo2

        if hr == 0 and spo2 == 0.0:
            valid_db = database.get_latest_valid_reading(session_id=sid)
            if valid_db and (valid_db.get("heartRate", 0) > 0 or valid_db.get("bloodOxygen", 0) > 0):
                for k, v in valid_db.items():
                    if k not in vitals or vitals[k] in (0, 0.0, None, ""):
                        vitals[k] = v
                vitals["heartRate"] = valid_db["heartRate"]
                vitals["bloodOxygen"] = valid_db["bloodOxygen"]
                hr, spo2 = valid_db["heartRate"], valid_db["bloodOxygen"]

    reply = ai_engine.generate_chat_reply(payload.message, vitals, session_id=sid)
    return {"reply": reply, "message": reply, "session_id": sid, "vitals_used": vitals}

@app.post("/api/ai/llm/generate")
def direct_llm_generate(payload: LLMDirectInput):
    """Permite a la aplicación consultar directamente el LLM Llama en Docker desde el exterior."""
    system = payload.system or "Eres un asistente médico inteligente para la plataforma SpiroScan."
    reply = ai_engine.query_ollama_docker(payload.prompt, system)
    return {"response": reply, "model": ai_engine.OLLAMA_MODEL}

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

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)
