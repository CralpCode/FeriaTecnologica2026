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
import time
import hashlib
import threading
from datetime import datetime, timedelta
import os
from pathlib import Path

import database
from ml import classifier, equalizer, lung

REC_DIR = Path(os.getenv("SPIROSCAN_REC_DIR", Path(__file__).resolve().parent / "recordings"))
REC_DIR.mkdir(exist_ok=True)

MAX_BYTES = 16000 * 2 * 60  # 60 s a 16 kHz / 16 bit
MAX_CHUNK_BYTES = 256 * 1024  # el ESP32 envía bloques de 0.5 s (16 KB a 16 kHz)
_audio_lock = threading.RLock()
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


def start(session_id: str, location: str, sample_rate: int, mode: str | None = None, source: str = "unknown",
          elapsed_s: float = 0.0) -> str:
    """elapsed_s: segundos que el dispositivo ya lleva grabando (registra la captura mientras envía otra)."""
    location = _check_location(location)
    started = datetime.now() - timedelta(seconds=max(0.0, elapsed_s))
    rec_id = f"rec_{started:%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}"
    _pcm_path(rec_id).write_bytes(b"")
    database.create_recording(rec_id, session_id, location, sample_rate, created_at=started)
    database.update_recording(rec_id, mode=resolve_mode(location, mode), source=source)
    return rec_id


def append_chunk(rec_id: str, data: bytes, offset: int | None = None) -> int:
    with _audio_lock:
        return _append_chunk(rec_id, data, offset)


def _append_chunk(rec_id: str, data: bytes, offset: int | None) -> int:
    rec = database.get_recording(rec_id)
    if not rec or rec["status"] != "recording":
        raise KeyError(f"Grabación '{rec_id}' no existe o ya fue cerrada")
    if len(data) % 2:
        raise ValueError("El bloque debe contener muestras int16 completas")
    if len(data) > MAX_CHUNK_BYTES:
        raise ValueError("Bloque de audio demasiado grande")
    path = _pcm_path(rec_id)
    current = path.stat().st_size
    if offset is not None and offset != current:
        if 0 <= offset < current and offset + len(data) <= current:
            with open(path, "rb") as previous:
                previous.seek(offset)
                if previous.read(len(data)) == data:
                    return current  # Reintento confirmado: nunca duplicar muestras.
        raise ValueError("El bloque no coincide con el audio recibido o falta un bloque anterior")
    if current + len(data) > MAX_BYTES:
        raise ValueError("Grabación demasiado larga (máximo 60 s)")
    with open(path, "ab") as f:
        f.write(data)
    return path.stat().st_size


def abort(rec_id: str, reason: str) -> dict:
    rec = database.get_recording(rec_id)
    if not rec:
        raise KeyError(f"Grabación '{rec_id}' no existe")
    if rec["status"] == "recording":
        database.update_recording(rec_id, status="error", result="error",
                                  finished_at=datetime.now().isoformat(), quality={"error": reason})
    return _stored_result(database.get_recording(rec_id))


STALE_RECORDING_S = 180


def expire_stale_recordings(session_id: str | None = None) -> int:
    """Cierra con error las capturas sin datos nuevos hace más de STALE_RECORDING_S (p. ej. el ESP32 se reinició)."""
    expired = 0
    for r in database.list_recordings(session_id=session_id, limit=500):
        if r["status"] != "recording":
            continue
        rec = database.get_recording(r["recording_id"])
        pcm = _pcm_path(rec["id"])
        last = pcm.stat().st_mtime if pcm.exists() else datetime.fromisoformat(rec["created_at"]).timestamp()
        if time.time() - last > STALE_RECORDING_S:
            abort(rec["id"], "No se recibió el audio completo del dispositivo. Repite la grabación.")
            expired += 1
    return expired


CAPTURE_SECONDS = 15
DEVICE_QUEUE = 2   # el ESP32 guarda en flash 1 captura enviándose + 1 grabándose


def _stage(rec: dict) -> tuple[str, float, int]:
    """Etapa de una grabación: capturing, waiting_upload, uploading, queued, processing, done o error."""
    age = (datetime.now() - datetime.fromisoformat(rec["created_at"])).total_seconds()
    pcm = _pcm_path(rec["id"])
    size = pcm.stat().st_size if pcm.exists() else 0
    stage = rec["status"]
    if stage == "recording":
        stage = "uploading" if size else ("capturing" if age < CAPTURE_SECONDS + 2 else "waiting_upload")
    return stage, age, size


def recording_status(session_id: str) -> dict:
    """La grabación más reciente (la que la app acaba de pedir) y las que el dispositivo aún no termina de enviar."""
    expire_stale_recordings(session_id)
    rows = database.list_recordings(session_id=session_id, limit=100)
    if not rows:
        return {"stage": "idle", "pending": []}
    pending = []
    for r in rows:
        if r["status"] != "recording":
            continue
        stage, age, size = _stage(database.get_recording(r["recording_id"]))
        pending.append({"recording_id": r["recording_id"], "location": r["location"], "stage": stage,
                        "age_s": age, "bytes_received": size})
    rec = database.get_recording(rows[0]["recording_id"])
    stage, age, size = _stage(rec)
    return {"stage": stage, "recording_id": rec["id"], "location": rec["location"],
            "age_s": age, "bytes_received": size, "pending": pending,
            "result": _stored_result(rec) if stage in ("done", "error") else None}


def arm_blocker(session_id: str) -> str | None:
    """Motivo para no pedir otra zona todavía, o None si el dispositivo puede grabarla."""
    pending = recording_status(session_id)["pending"]
    if any(p["stage"] == "capturing" for p in pending):
        return "Espera a que termine de grabar esta zona (15 s)."
    if len(pending) >= DEVICE_QUEUE:
        return "El estetoscopio todavía está enviando grabaciones anteriores; espera unos segundos."
    return None


def prepare_finish(rec_id: str, expected_bytes: int | None = None,
                   sha256: str | None = None, background: bool = False) -> dict:
    with _audio_lock:
        return _prepare_finish(rec_id, expected_bytes, sha256, background)


def _prepare_finish(rec_id: str, expected_bytes: int | None, sha256: str | None, background: bool) -> dict:
    rec = database.get_recording(rec_id)
    if not rec:
        raise KeyError(f"Grabación '{rec_id}' no existe")
    if rec["status"] != "recording":
        if expected_bytes is not None and rec.get('audio_bytes') != expected_bytes:
            raise ValueError("La longitud no coincide con la grabación confirmada")
        if sha256 and rec.get('audio_sha256') != sha256.lower():
            raise ValueError("La huella no coincide con la grabación confirmada")
        return rec
    pcm = _pcm_path(rec_id)
    if not pcm.exists():
        raise KeyError(f"Grabación '{rec_id}' sin audio recibido")
    wav = _wav_path(rec_id)
    raw = pcm.read_bytes()
    if expected_bytes is not None and len(raw) != expected_bytes:
        raise ValueError("Audio incompleto: faltan muestras o se recibieron muestras duplicadas")
    digest = hashlib.sha256(raw).hexdigest()
    if sha256 and digest != sha256.lower():
        raise ValueError("La huella SHA-256 del audio recibido no coincide")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rec["sample_rate"])
        w.writeframes(raw)
    with open(wav, "rb") as durable:
        os.fsync(durable.fileno())
    database.update_recording(rec_id, wav_path=str(wav), duration_s=len(raw) / 2 / rec['sample_rate'],
                              audio_bytes=len(raw), audio_sha256=digest,
                              transport_verified=int(expected_bytes is not None and sha256 is not None),
                              status='queued' if background else 'processing')
    pcm.unlink(missing_ok=True)
    return database.get_recording(rec_id)


def finish(rec_id: str) -> dict:
    previous = database.get_recording(rec_id)
    rec = prepare_finish(rec_id)
    if previous and previous['status'] != 'recording':
        return _stored_result(rec)
    return _classify_and_store(rec_id, Path(rec['wav_path']), rec['duration_s'], device=True)


def analyze_queued(rec_id: str) -> dict | None:
    if not database.claim_audio_job(rec_id):
        return None
    rec = database.get_recording(rec_id)
    try:
        return _classify_and_store(rec_id, Path(rec['wav_path']), rec['duration_s'], device=True)
    except Exception:
        return _stored_result(database.get_recording(rec_id))


def queue_receipt(rec: dict) -> dict:
    return {'recording_id': rec['id'], 'status': rec['status'],
            'audio_bytes': rec.get('audio_bytes'), 'sha256': rec.get('audio_sha256'),
            'verified': bool(rec.get('transport_verified'))}


def retry_analysis(rec_id: str) -> dict:
    with _audio_lock:
        rec = database.get_recording(rec_id)
        if not rec:
            raise KeyError('Grabación inexistente')
        if rec['status'] in ('queued', 'processing'):
            return rec
        if rec['status'] != 'error' or not rec.get('wav_path') or not Path(rec['wav_path']).exists():
            raise ValueError('No hay un audio guardado cuyo análisis pueda repetirse')
        with wave.open(rec['wav_path'], 'rb') as audio:
            raw = audio.readframes(audio.getnframes())
        if rec.get('audio_sha256') and hashlib.sha256(raw).hexdigest() != rec['audio_sha256']:
            raise ValueError('El archivo guardado no supera la comprobación de integridad')
        database.update_recording(rec_id, status='queued', result=None, quality=None, finished_at=None)
        return database.get_recording(rec_id)


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


def _classify_and_store(rec_id: str, wav: Path, duration: float, device: bool = False) -> dict:
    database.update_recording(rec_id, status="processing", wav_path=str(wav), duration_s=round(duration, 2))
    try:
        mode = database.get_recording(rec_id).get("mode") or "corazon"
        # Archivos subidos (casos demo, pruebas) ya vienen de estetoscopios clínicos: no se ecualizan
        profile = equalizer.profile_for(mode) if device else None
        eq = (lambda y, sr: equalizer.apply(y, sr, profile)) if profile else None
        inference_started = time.perf_counter()
        out = (lung if mode == "pulmon" else classifier).classify_wav(wav, eq=eq, check_placement=device)
        print(f"[AUDIO] {rec_id} modo={mode} analisis_s={time.perf_counter() - inference_started:.3f}", flush=True)
        if eq is not None and out.get("result") not in ("calidad_insuficiente", None):
            out["details"] = {**(out.get("details") or {}), "ecualizacion": equalizer.describe(profile)}
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
        "details": parsed("details") or {}, "reason": (parsed("quality") or {}).get("error"),
        "has_audio": bool(rec.get("wav_path")) and Path(rec["wav_path"]).exists(), "repetido": True,
    }
