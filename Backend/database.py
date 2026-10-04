import sqlite3
import json
import os
from datetime import datetime, timedelta

DB_PATH = os.getenv("SPIROSCAN_DB_PATH", os.path.join(os.path.dirname(__file__), "telemetry.db"))

from measurement_quality import metadata, usable_value

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn

def init_db():
    conn = get_db_connection()
    with conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS vitals_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            heartRate INTEGER NOT NULL,
            bloodOxygen REAL NOT NULL,
            systolicPressure INTEGER DEFAULT 120,
            diastolicPressure INTEGER DEFAULT 80,
            temperature REAL DEFAULT 36.5,
            hrv INTEGER DEFAULT 45,
            stressLevel INTEGER DEFAULT 25,
            audio_rms REAL DEFAULT 0.0,
            audio_peak REAL DEFAULT 0.0,
            device_id TEXT DEFAULT 'ESP32-BIO-01'
        );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON vitals_log(timestamp);")
        conn.execute("""
        CREATE TABLE IF NOT EXISTS recordings (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            location TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            finished_at TEXT,
            sample_rate INTEGER NOT NULL,
            duration_s REAL DEFAULT 0,
            wav_path TEXT,
            status TEXT DEFAULT 'recording',
            probability REAL,
            threshold REAL,
            result TEXT,
            quality TEXT,
            model TEXT
        );
        """)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            type TEXT NOT NULL,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            action TEXT DEFAULT '',
            llm_generated INTEGER DEFAULT 0,
            data TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            acknowledged INTEGER DEFAULT 0
        );
        """)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            content TEXT NOT NULL,
            llm_generated INTEGER DEFAULT 0,
            pdf_path TEXT
        );
        """)
        conn.execute("""CREATE TABLE IF NOT EXISTS clinical_context (
            session_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        vcols = {r[1] for r in conn.execute("PRAGMA table_info(vitals_log)")}
        if "measurement_metadata" not in vcols:
            conn.execute("ALTER TABLE vitals_log ADD COLUMN measurement_metadata TEXT DEFAULT '{}'")
        # Migraciones simples para bases creadas con versiones anteriores
        cols = {r[1] for r in conn.execute("PRAGMA table_info(recordings)")}
        if "source" not in cols:
            conn.execute("ALTER TABLE recordings ADD COLUMN source TEXT DEFAULT 'unknown'")
        if "details" not in cols:
            conn.execute("ALTER TABLE recordings ADD COLUMN details TEXT")
        if "mode" not in cols:
            conn.execute("ALTER TABLE recordings ADD COLUMN mode TEXT DEFAULT 'corazon'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_rec_session ON recordings(session_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_alert_session ON alerts(session_id);")
    conn.close()

def save_reading(data: dict):
    conn = get_db_connection()
    now_iso = datetime.now().isoformat()
    
    # 0 = sin lectura (un valor ausente o no válido nunca se rellena)
    bpm = int(data.get("bpm") or data.get("heartRate") or 0)
    spo2 = float(data.get("spo2") or data.get("bloodOxygen") or 0.0)
    audio_rms = float(data.get("audio_rms") or 0.0)
    audio_peak = float(data.get("audio_peak") or 0.0)
    device_id = str(data.get("session_id", data.get("device_id", "default")))
    
    # Solo se guarda lo que el hardware mide. El MAX30102 no mide presión arterial ni
    # temperatura corporal (su termómetro es el del propio chip), así que quedan en 0.
    systolic = 0
    diastolic = 0
    temp = 0.0
    hrv = int(data.get("hrv", 0) or 0) if bpm > 0 else 0
    # Índice experimental calculado en el firmware; no es una medición validada.
    stress = int(data.get("stress", data.get("stressLevel", 0)) or 0) if bpm > 0 else 0

    with conn:
        conn.execute("""
        INSERT INTO vitals_log 
        (timestamp, heartRate, bloodOxygen, systolicPressure, diastolicPressure, temperature, hrv, stressLevel, audio_rms, audio_peak, device_id, measurement_metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (now_iso, bpm, spo2, systolic, diastolic, temp, hrv, stress, audio_rms, audio_peak, device_id, json.dumps(metadata(data))))
    conn.close()

    return {
        **metadata(data),
        "heartRate": bpm,
        "bloodOxygen": spo2,
        "systolicPressure": systolic,
        "diastolicPressure": diastolic,
        "temperature": temp,
        "hrv": hrv,
        "stressLevel": stress,
        "audio_rms": audio_rms,
        "audio_peak": audio_peak,
        "steps": 0,
        "calories": 0,
        "timestamp": now_iso,
        "session_id": device_id,
        "device_id": device_id
    }

def get_latest_reading(session_id: str = None):
    conn = get_db_connection()
    row = None
    if session_id:
        row = conn.execute("SELECT * FROM vitals_log WHERE device_id = ? ORDER BY id DESC LIMIT 1", (session_id,)).fetchone()
    
    if not row and session_id is None:
        row = conn.execute("SELECT * FROM vitals_log ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()

    if row:
        try:
            dt = datetime.fromisoformat(row["timestamp"])
            if (datetime.now() - dt).total_seconds() <= 15:
                is_active = bool(row["heartRate"] > 0 and row["bloodOxygen"] > 0)
                return {
                    **json.loads(row["measurement_metadata"] or "{}"),
                    "device_connected": is_active,
                    "heartRate": row["heartRate"],
                    "bloodOxygen": row["bloodOxygen"],
                    "systolicPressure": row["systolicPressure"],
                    "diastolicPressure": row["diastolicPressure"],
                    "temperature": row["temperature"],
                    "hrv": row["hrv"],
                    "stressLevel": row["stressLevel"],
                    "audio_rms": row["audio_rms"],
                    "audio_peak": row["audio_peak"],
                    "steps": 0,
                    "calories": 0,
                    "timestamp": row["timestamp"],
                    "session_id": row["device_id"]
                }
        except:
            pass

    return {
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
        "steps": 0,
        "calories": 0,
        "timestamp": "",
        "session_id": session_id or "default"
    }

def get_history_points(time_range: str = "24h", limit: int = 100, session_id: str = None):
    conn = get_db_connection()
    max_rows = max(1, min(limit, 10000))
    since = (datetime.now() - timedelta(days={"24h": 1, "7d": 7, "30d": 30}.get(time_range, 1))).isoformat()
    rows = conn.execute("SELECT * FROM vitals_log WHERE device_id = ? AND timestamp >= ? ORDER BY id DESC LIMIT ?",
                        (session_id or "default", since, max_rows)).fetchall()
    conn.close()

    if not rows:
        return []

    points = []
    for r in reversed(rows):
        try:
            dt = datetime.fromisoformat(r["timestamp"])
            time_label = dt.strftime("%H:%M:%S")
        except:
            time_label = "Ahora"

        points.append({
            **json.loads(r["measurement_metadata"] or "{}"),
            "timestamp": r["timestamp"],
            "timeLabel": time_label,
            "heartRate": r["heartRate"],
            "bloodOxygen": r["bloodOxygen"],
            "systolicPressure": r["systolicPressure"],
            "diastolicPressure": r["diastolicPressure"],
            "temperature": r["temperature"],
            "stressLevel": r["stressLevel"],
            "audio_rms": r["audio_rms"] if "audio_rms" in r.keys() else 0.0,
            "audio_peak": r["audio_peak"] if "audio_peak" in r.keys() else 0.0,
            "hrv": r["hrv"] if "hrv" in r.keys() else 0,
            "device_id": r["device_id"] if "device_id" in r.keys() else "default",
            "session_id": r["device_id"] if "device_id" in r.keys() else "default"
        })
    return points

def get_distinct_sessions():
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT device_id as session_id, count(*) as count, max(timestamp) as last_seen 
        FROM vitals_log 
        GROUP BY device_id 
        ORDER BY last_seen DESC
    """).fetchall()
    conn.close()
    return [{"session_id": r["session_id"], "records_count": r["count"], "last_seen": r["last_seen"]} for r in rows]


# ---------------------------------------------------------------------------
# Grabaciones de auscultación
# ---------------------------------------------------------------------------

def create_recording(rec_id: str, session_id: str, location: str, sample_rate: int):
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO recordings (id, session_id, location, created_at, sample_rate) VALUES (?, ?, ?, ?, ?)",
            (rec_id, session_id, location, datetime.now().isoformat(), sample_rate),
        )
    conn.close()


def update_recording(rec_id: str, **fields):
    if not fields:
        return
    for k in ("quality", "details"):
        if k in fields and not isinstance(fields[k], str):
            fields[k] = json.dumps(fields[k])
    cols = ", ".join(f"{k} = ?" for k in fields)
    conn = get_db_connection()
    with conn:
        conn.execute(f"UPDATE recordings SET {cols} WHERE id = ?", (*fields.values(), rec_id))
    conn.close()


def _recording_dict(row) -> dict:
    d = dict(row)
    d["quality"] = json.loads(d["quality"]) if d.get("quality") else None
    d["details"] = json.loads(d["details"]) if d.get("details") else {}
    d["recording_id"] = d["id"]  # mismo nombre que en los resultados en vivo
    d["has_audio"] = bool(d.get("wav_path")) and os.path.exists(d["wav_path"])
    d.pop("wav_path", None)
    return d


def get_recording(rec_id: str):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_recordings(session_id: str = None, limit: int = 50):
    conn = get_db_connection()
    if session_id:
        rows = conn.execute("SELECT * FROM recordings WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
                            (session_id, limit)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM recordings ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [_recording_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Alertas
# ---------------------------------------------------------------------------

def _alert_dict(row) -> dict:
    d = dict(row)
    d["data"] = json.loads(d["data"] or "{}")
    d["acknowledged"] = bool(d["acknowledged"])
    d["llm_generated"] = bool(d["llm_generated"])
    return d


def create_alert(session_id: str, type_: str, severity: str, title: str, message: str, action: str, data: dict) -> dict:
    conn = get_db_connection()
    with conn:
        cur = conn.execute(
            "INSERT INTO alerts (session_id, type, severity, title, message, action, data, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, type_, severity, title, message, action, json.dumps(data), datetime.now().isoformat()),
        )
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return _alert_dict(row)


def update_alert_text(alert_id: int, message: str, action: str) -> dict | None:
    conn = get_db_connection()
    with conn:
        conn.execute("UPDATE alerts SET message = ?, action = ?, llm_generated = 1 WHERE id = ?",
                     (message, action, alert_id))
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    conn.close()
    return _alert_dict(row) if row else None


def acknowledge_alert(alert_id: int) -> dict | None:
    conn = get_db_connection()
    with conn:
        conn.execute("UPDATE alerts SET acknowledged = 1 WHERE id = ?", (alert_id,))
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    conn.close()
    return _alert_dict(row) if row else None


def list_alerts(session_id: str = None, only_active: bool = False, limit: int = 100):
    q = "SELECT * FROM alerts WHERE 1=1"
    params = []
    if session_id:
        q += " AND session_id = ?"
        params.append(session_id)
    if only_active:
        q += " AND acknowledged = 0"
    q += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    conn = get_db_connection()
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [_alert_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Informes y resumen de sesión
# ---------------------------------------------------------------------------

def save_report(session_id: str, content: dict, llm_generated: bool, pdf_path: str | None) -> int:
    conn = get_db_connection()
    with conn:
        cur = conn.execute(
            "INSERT INTO reports (session_id, created_at, content, llm_generated, pdf_path) VALUES (?, ?, ?, ?, ?)",
            (session_id, datetime.now().isoformat(), json.dumps(content, ensure_ascii=False), int(llm_generated), pdf_path),
        )
        rid = cur.lastrowid
    conn.close()
    return rid


def get_report(report_id: int):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["content"] = json.loads(d["content"])
    return d


def get_vitals_summary(session_id: str) -> dict:
    """Only explicitly real, valid measurements; each channel is independent."""
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM vitals_log WHERE device_id = ? ORDER BY id", (session_id,)).fetchall()
    conn.close()
    points = [_measurement_dict(r) for r in rows]
    hr = [v for p in points if (v := usable_value(p, "heartRate", check_timestamp=False)) is not None]
    spo2 = [v for p in points if (v := usable_value(p, "bloodOxygen", check_timestamp=False)) is not None]
    out = {"n": len(hr), "n_spo2": len(spo2), "inicio": points[0]["timestamp"] if points else None,
           "fin": points[-1]["timestamp"] if points else None, "hrv_prom": None}
    for name, values in (("hr", hr), ("spo2", spo2)):
        out.update({name + "_prom": round(sum(values) / len(values), 1) if values else None,
                    name + "_min": min(values) if values else None,
                    name + "_max": max(values) if values else None})
    return out


def _measurement_dict(row):
    out = dict(row)
    out.update(json.loads(out.pop("measurement_metadata", None) or "{}"))
    return out


def get_recent_readings(session_id: str, seconds: int = 60) -> list[dict]:
    since = (datetime.now() - timedelta(seconds=seconds)).isoformat()
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM vitals_log WHERE device_id = ? AND timestamp >= ? ORDER BY id",
                        (session_id, since)).fetchall()
    conn.close()
    return [_measurement_dict(r) for r in rows]


def get_clinical_context(session_id: str) -> dict:
    conn = get_db_connection()
    row = conn.execute("SELECT content FROM clinical_context WHERE session_id = ?", (session_id,)).fetchone()
    conn.close()
    return json.loads(row["content"]) if row else {}


def save_clinical_context(session_id: str, content: dict) -> dict:
    conn = get_db_connection()
    with conn:
        conn.execute("INSERT INTO clinical_context (session_id, content, updated_at) VALUES (?, ?, ?) "
                     "ON CONFLICT(session_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at",
                     (session_id, json.dumps(content, allow_nan=False), datetime.now().isoformat()))
    conn.close()
    return content


def list_reports(session_id: str = None, limit: int = 50) -> list[dict]:
    conn = get_db_connection()
    q = "SELECT id, session_id, created_at, llm_generated, pdf_path FROM reports"
    rows = (conn.execute(q + " WHERE session_id = ? ORDER BY id DESC LIMIT ?", (session_id, limit)) if session_id
            else conn.execute(q + " ORDER BY id DESC LIMIT ?", (limit,))).fetchall()
    conn.close()
    return [{"report_id": r["id"], "session_id": r["session_id"], "created_at": r["created_at"],
             "llm_generated": bool(r["llm_generated"]), "pdf_url": f"/api/reports/{r['id']}/pdf",
             "has_pdf": bool(r["pdf_path"]) and os.path.exists(r["pdf_path"])} for r in rows]


def get_sessions_overview(limit: int = 100) -> list[dict]:
    """Una fila por sesión (paciente): lecturas, grabaciones, alertas e informes, ordenadas por última actividad."""
    conn = get_db_connection()
    out: dict[str, dict] = {}

    def row(sid):
        return out.setdefault(sid, {"session_id": sid, "first_seen": None, "last_seen": None, "readings": 0,
                                    "recordings": 0, "abnormal_recordings": 0, "alerts": 0, "active_alerts": 0,
                                    "reports": 0})

    def touch(d, first, last):
        if first and (d["first_seen"] is None or first < d["first_seen"]):
            d["first_seen"] = first
        if last and (d["last_seen"] is None or last > d["last_seen"]):
            d["last_seen"] = last

    for r in conn.execute("SELECT device_id s, COUNT(*) n, MIN(timestamp) a, MAX(timestamp) b FROM vitals_log "
                          "WHERE heartRate > 0 GROUP BY device_id"):
        d = row(r["s"]); d["readings"] = r["n"]; touch(d, r["a"], r["b"])
    for r in conn.execute("SELECT session_id s, COUNT(*) n, SUM(result = 'anormal') ab, MIN(created_at) a, "
                          "MAX(created_at) b FROM recordings GROUP BY session_id"):
        d = row(r["s"]); d["recordings"] = r["n"]; d["abnormal_recordings"] = r["ab"] or 0; touch(d, r["a"], r["b"])
    for r in conn.execute("SELECT session_id s, COUNT(*) n, SUM(acknowledged = 0) act, MAX(created_at) b "
                          "FROM alerts GROUP BY session_id"):
        d = row(r["s"]); d["alerts"] = r["n"]; d["active_alerts"] = r["act"] or 0; touch(d, None, r["b"])
    for r in conn.execute("SELECT session_id s, COUNT(*) n, MAX(created_at) b FROM reports GROUP BY session_id"):
        d = row(r["s"]); d["reports"] = r["n"]; touch(d, None, r["b"])
    conn.close()
    # Se omiten las sesiones vacías (se crea una cada vez que alguien abre la app sin medir nada)
    rows = [d for d in out.values()
            if d["recordings"] or d["reports"] or d["alerts"] or d["readings"] >= 5]
    rows.sort(key=lambda d: d["last_seen"] or "", reverse=True)
    return rows[:limit]
