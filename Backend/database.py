import sqlite3
import json
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "telemetry.db")

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
    conn.close()

def save_reading(data: dict):
    conn = get_db_connection()
    now_iso = datetime.now().isoformat()
    
    bpm = int(data.get("bpm", data.get("heartRate", 0)))
    spo2 = float(data.get("spo2", data.get("bloodOxygen", 0.0)))
    audio_rms = float(data.get("audio_rms", 0.0))
    audio_peak = float(data.get("audio_peak", 0.0))
    device_id = str(data.get("session_id", data.get("device_id", "default")))
    
    systolic = int(data.get("systolic", int(115 + (bpm - 70) * 0.45) if bpm > 0 else 0))
    diastolic = int(data.get("diastolic", int(75 + (bpm - 70) * 0.25) if bpm > 0 else 0))
    stress = int(min(100, max(10, (bpm - 55) * 1.3 + (audio_rms * 0.4)))) if bpm > 0 else 0
    hrv = int(max(20, 65 - (bpm - 70) * 0.5)) if bpm > 0 else 0
    temp = round(36.5 + (bpm - 70) * 0.008, 1) if bpm > 0 else 0.0

    with conn:
        conn.execute("""
        INSERT INTO vitals_log 
        (timestamp, heartRate, bloodOxygen, systolicPressure, diastolicPressure, temperature, hrv, stressLevel, audio_rms, audio_peak, device_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (now_iso, bpm, spo2, systolic, diastolic, temp, hrv, stress, audio_rms, audio_peak, device_id))
    conn.close()

    return {
        "heartRate": bpm,
        "bloodOxygen": spo2,
        "systolicPressure": systolic,
        "diastolicPressure": diastolic,
        "temperature": temp,
        "hrv": hrv,
        "stressLevel": stress,
        "audio_rms": audio_rms,
        "audio_peak": audio_peak,
        "steps": 5420,
        "calories": 380,
        "timestamp": now_iso,
        "session_id": device_id,
        "device_id": device_id
    }

def get_latest_reading(session_id: str = None):
    conn = get_db_connection()
    row = None
    if session_id:
        row = conn.execute("SELECT * FROM vitals_log WHERE device_id = ? ORDER BY id DESC LIMIT 1", (session_id,)).fetchone()
    
    if not row:
        row = conn.execute("SELECT * FROM vitals_log ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()

    if row:
        try:
            dt = datetime.fromisoformat(row["timestamp"])
            if (datetime.now() - dt).total_seconds() <= 15:
                is_active = bool(row["heartRate"] > 0 and row["bloodOxygen"] > 0)
                return {
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
                    "steps": 5420,
                    "calories": 380,
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
    max_rows = 50 if time_range == "24h" else (150 if time_range == "7d" else 300)
    
    if session_id:
        rows = conn.execute("SELECT * FROM vitals_log WHERE device_id = ? ORDER BY id DESC LIMIT ?", (session_id, max_rows)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM vitals_log ORDER BY id DESC LIMIT ?", (max_rows,)).fetchall()
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
            "hrv": r["hrv"] if "hrv" in r.keys() else 45,
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
