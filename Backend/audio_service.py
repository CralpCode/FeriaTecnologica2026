"""
Recepción de grabaciones de auscultación.

Protocolo para el ESP32 (no tiene RAM para 15 s de audio, así que envía por partes):
    POST /api/audio/start   {"session_id", "location", "sample_rate"}  -> {"recording_id"}
    POST /api/audio/chunk?recording_id=...   cuerpo: PCM int16 little-endian mono
    POST /api/audio/finish?recording_id=...  -> resultado de la clasificación
También se acepta un .wav completo en POST /api/audio/upload (app o pruebas).
"""
import json
import uuid
import wave
from datetime import datetime
from pathlib import Path

import database
from ml import classifier, lung

REC_DIR = Path(__file__).resolve().parent / "recordings"
REC_DIR.mkdir(exist_ok=True)

MAX_BYTES = 16000 * 2 * 60  # 60 s a 16 kHz / 16 bit
MAX_CHUNK_BYTES = 256 * 1024  # el ESP32 envía bloques de 0.5 s (16 KB a 16 kHz)
HEART_LOCATIONS = {"AV", "PV", "TV", "MV"}
LUNG_LOCATIONS = {"TC", "AL", "AR", "PL", "PR", "LL", "LR"}   # zonas del tórax de ICBHI
LOCATIONS = HEART_LOCATIONS | LUNG_LOCATIONS | {""}
MODES = {"corazon", "pulmon"}


def resolve_mode(location: str, mode: str | None) -> str:
    if mode in MODES:
        return mode
    return "pulmon" if (location or "").upper() in LUNG_LOCATIONS else "corazon"


def _check_location(location: str) -> str:
    location = (location or "").upper()
    if location not in LOCATIONS:
        raise ValueError(f"Foco inválido '{location}'. Corazón: AV, PV, TV, MV. Pulmón: TC, AL, AR, PL, PR, LL, LR.")
    return location


def _pcm_path(rec_id: str) -> Path:
    return REC_DIR / f"{rec_id}.pcm"


def _wav_path(rec_id: str) -> Path:
    return REC_DIR / f"{rec_id}.wav"


def start(session_id: str, location: str, sample_rate: int, mode: str | None = None, source: str = "unknown") -> str:
    location = _check_location(location)
    rec_id = f"rec_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}"
    _pcm_path(rec_id).write_bytes(b"")
    database.create_recording(rec_id, session_id, location, sample_rate)
    database.update_recording(rec_id, mode=resolve_mode(location, mode), source=source)
    return rec_id


def append_chunk(rec_id: str, data: bytes) -> int:
    rec = database.get_recording(rec_id)
    if not rec or rec["status"] != "recording":
        raise KeyError(f"Grabación '{rec_id}' no existe o ya fue cerrada")
    if len(data) % 2:
        raise ValueError("El bloque debe contener muestras int16 completas")
    if len(data) > MAX_CHUNK_BYTES:
        raise ValueError("Bloque de audio demasiado grande")
    path = _pcm_path(rec_id)
    if path.stat().st_size + len(data) > MAX_BYTES:
        raise ValueError("Grabación demasiado larga (máximo 60 s)")
    with open(path, "ab") as f:
        f.write(data)
    return path.stat().st_size


def finish(rec_id: str) -> dict:
    rec = database.get_recording(rec_id)
    if not rec:
        raise KeyError(f"Grabación '{rec_id}' no existe")
    if rec["status"] != "recording":
        # finish repetido (p. ej. reintento del ESP32): se devuelve lo que ya se guardó
        return _stored_result(rec)
    pcm = _pcm_path(rec_id)
    if not pcm.exists():
        raise KeyError(f"Grabación '{rec_id}' sin audio recibido")
    wav = _wav_path(rec_id)
    raw = pcm.read_bytes()
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rec["sample_rate"])
        w.writeframes(raw)
    pcm.unlink(missing_ok=True)
    return _classify_and_store(rec_id, wav, len(raw) / 2 / rec["sample_rate"])


def save_upload(session_id: str, location: str, data: bytes, mode: str | None = None, source: str = "unknown") -> dict:
    location = _check_location(location)
    rec_id = f"rec_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}"
    wav = _wav_path(rec_id)
    wav.write_bytes(data)
    with wave.open(str(wav), "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
    database.create_recording(rec_id, session_id, location, sr)
    database.update_recording(rec_id, mode=resolve_mode(location, mode), source=source)
    return _classify_and_store(rec_id, wav, n / sr)


def _classify_and_store(rec_id: str, wav: Path, duration: float) -> dict:
    database.update_recording(rec_id, status="processing", wav_path=str(wav), duration_s=round(duration, 2))
    try:
        mode = database.get_recording(rec_id).get("mode") or "corazon"
        out = (lung if mode == "pulmon" else classifier).classify_wav(wav)
        database.update_recording(
            rec_id, status="done", finished_at=datetime.now().isoformat(),
            probability=out["probability"], threshold=out["threshold"],
            result=out["result"], quality=out["quality"], model=out.get("model"),
            details=out.get("details") or {},
        )
    except Exception as e:
        database.update_recording(rec_id, status="error", result="error", quality={"error": str(e)})
        raise
    rec = database.get_recording(rec_id)
    return {
        "recording_id": rec_id,
        "session_id": rec["session_id"],
        "location": rec["location"],
        "source": rec["source"],
        "mode": rec.get("mode") or "corazon",
        "duration_s": rec["duration_s"],
        **out,
    }


def _stored_result(rec: dict) -> dict:
    def parsed(key):
        value = rec.get(key)
        return json.loads(value) if isinstance(value, str) and value else value

    return {
        "recording_id": rec["id"], "session_id": rec["session_id"], "location": rec["location"],
        "source": rec.get("source"), "mode": rec.get("mode") or "corazon", "duration_s": rec.get("duration_s"),
        "result": rec.get("result") or rec["status"], "probability": rec.get("probability"),
        "threshold": rec.get("threshold"), "quality": parsed("quality"), "model": rec.get("model"),
        "details": parsed("details") or {}, "reason": None, "repetido": True,
    }
