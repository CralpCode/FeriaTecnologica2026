"""
Recepción de grabaciones de auscultación.

Protocolo para el ESP32 (no tiene RAM para 15 s de audio, así que envía por partes):
    POST /api/audio/start   {"session_id", "location", "sample_rate"}  -> {"recording_id"}
    POST /api/audio/chunk?recording_id=...   cuerpo: PCM int16 little-endian mono
    POST /api/audio/finish?recording_id=...  -> resultado de la clasificación
También se acepta un .wav completo en POST /api/audio/upload (app o pruebas).
"""
import uuid
import wave
from datetime import datetime
from pathlib import Path

import database
from ml import classifier

REC_DIR = Path(__file__).resolve().parent / "recordings"
REC_DIR.mkdir(exist_ok=True)

MAX_BYTES = 16000 * 2 * 60  # 60 s a 16 kHz / 16 bit
LOCATIONS = {"AV", "PV", "TV", "MV", ""}


def _pcm_path(rec_id: str) -> Path:
    return REC_DIR / f"{rec_id}.pcm"


def _wav_path(rec_id: str) -> Path:
    return REC_DIR / f"{rec_id}.wav"


def start(session_id: str, location: str, sample_rate: int) -> str:
    location = (location or "").upper()
    if location not in LOCATIONS:
        raise ValueError(f"Foco inválido '{location}'. Usa AV, PV, TV o MV.")
    rec_id = f"rec_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}"
    _pcm_path(rec_id).write_bytes(b"")
    database.create_recording(rec_id, session_id, location, sample_rate)
    return rec_id


def append_chunk(rec_id: str, data: bytes) -> int:
    rec = database.get_recording(rec_id)
    if not rec or rec["status"] != "recording":
        raise KeyError(f"Grabación '{rec_id}' no existe o ya fue cerrada")
    if len(data) % 2:
        raise ValueError("El bloque debe contener muestras int16 completas")
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
    pcm = _pcm_path(rec_id)
    wav = _wav_path(rec_id)
    raw = pcm.read_bytes()
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rec["sample_rate"])
        w.writeframes(raw)
    pcm.unlink(missing_ok=True)
    return _classify_and_store(rec_id, wav, len(raw) / 2 / rec["sample_rate"])


def save_upload(session_id: str, location: str, data: bytes) -> dict:
    location = (location or "").upper()
    if location not in LOCATIONS:
        raise ValueError(f"Foco inválido '{location}'. Usa AV, PV, TV o MV.")
    rec_id = f"rec_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}"
    wav = _wav_path(rec_id)
    wav.write_bytes(data)
    with wave.open(str(wav), "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
    database.create_recording(rec_id, session_id, location, sr)
    return _classify_and_store(rec_id, wav, n / sr)


def _classify_and_store(rec_id: str, wav: Path, duration: float) -> dict:
    database.update_recording(rec_id, status="processing", wav_path=str(wav), duration_s=round(duration, 2))
    try:
        out = classifier.classify_wav(wav)
        database.update_recording(
            rec_id, status="done", finished_at=datetime.now().isoformat(),
            probability=out["probability"], threshold=out["threshold"],
            result=out["result"], quality=out["quality"], model=out.get("model"),
        )
    except Exception as e:
        database.update_recording(rec_id, status="error", result="error", quality={"error": str(e)})
        raise
    rec = database.get_recording(rec_id)
    return {
        "recording_id": rec_id,
        "session_id": rec["session_id"],
        "location": rec["location"],
        "duration_s": rec["duration_s"],
        **out,
    }
