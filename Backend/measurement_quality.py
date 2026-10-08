"""Eligibility of measurements; missing provenance is never a normal reading."""
import math
import time
from collections import deque
from datetime import datetime, timezone

MAX_AGE_S = 15
QUALITY_FIELDS = ("source", "heartRateValid", "bloodOxygenValid", "spo2Calibrated", "spo2Estimated",
                  "signalQuality", "sampleAgeMs", "finger", "audioUnit", "audioValid", "device_connected", "validadoPor")
# Indicadores que solo envía el firmware nuevo; si no llega ninguno, el paquete es del formato original.
NEW_FORMAT_KEYS = ("v", "valid", "source", "heartRateValid", "heart_rate_valid", "bloodOxygenValid", "spo2_valid",
                   "spo2Calibrated", "spo2_calibrated", "spo2Estimated", "signalQuality", "signal_quality",
                   "sampleAgeMs", "sample_age_ms")


def metadata(data: dict) -> dict:
    return {key: data.get(key) for key in QUALITY_FIELDS}


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


# SpO2 estimada: fórmula genérica del fabricante (Maxim) sin calibrar con este módulo. Se muestra y se usa
# siempre con esa etiqueta; nunca cuenta como medición calibrada. Fuera de 70-100 % no es plausible.
ESTIMATED_SPO2_RANGE = (70.0, 100.0)


def usable_value(data: dict, channel: str, *, check_timestamp=True, allow_estimated=False):
    """Valor utilizable del canal. Para SpO2, allow_estimated acepta también la estimada sin calibrar."""
    if data.get("source") != "real" or data.get("demo"):
        return None
    if data.get("signalQuality") != "good" or data.get("finger") is not True:
        return None
    age = number(data.get("sampleAgeMs"))
    if age is None or not 0 <= age <= MAX_AGE_S * 1000:
        return None
    if check_timestamp:
        try:
            timestamp = datetime.fromisoformat(data["timestamp"])
            now = datetime.now(timestamp.tzinfo or None)
            if not 0 <= (now - timestamp).total_seconds() <= MAX_AGE_S - age / 1000:
                return None
        except (KeyError, TypeError, ValueError):
            return None
    flag = "heartRateValid" if channel == "heartRate" else "bloodOxygenValid"
    if data.get(flag) is not True:
        return None
    value = number(data.get(channel))
    if value is None or value <= 0:
        return None
    if channel == "bloodOxygen":
        if value > 100:
            return None
        if data.get("spo2Calibrated") is not True:
            lo, hi = ESTIMATED_SPO2_RANGE
            if not (allow_estimated and data.get("spo2Estimated") is True and lo <= value <= hi):
                return None
    elif value > 300:
        return None
    return value


# ---------------------------------------------------------------------------
# Paquetes del ESP32: datos externos. Se limpian sin fallar y nunca se rellenan valores.
# ---------------------------------------------------------------------------

_TRUE = {"true", "1", "si", "sí", "yes"}
_FALSE = {"false", "0", "no"}


def _flag(value):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.strip().lower() in _TRUE | _FALSE:
        return value.strip().lower() in _TRUE
    raise ValueError


def _text(value, max_len: int):
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        raise ValueError
    value = value.strip()[:max_len]
    return value or None


def clean_packet(raw: dict) -> tuple[dict, list[str]]:
    """Convierte un paquete de telemetría arbitrario en campos con tipo correcto.

    Lo que falta queda en None; lo que no se puede interpretar o está fuera de rango también,
    con un aviso. Nunca lanza excepción por el contenido del paquete.
    """
    raw = dict(raw)
    mask = raw.get("valid")
    if raw.get("v") == 2 and type(mask) is int and 0 <= mask <= 31:
        raw.setdefault("source", "simulated" if raw.get("test") is True else "real")
        raw.setdefault("heartRateValid", bool(mask & 1))
        raw.setdefault("bloodOxygenValid", bool(mask & 2))
        raw.setdefault("spo2Calibrated", raw.get("cal") is True)
        raw.setdefault("audioUnit", raw.get("audio_unit"))
        raw.setdefault("audioValid", bool(mask & 16))
        raw.setdefault("signalQuality", "good" if mask & 1 else "acquiring" if raw.get("finger") is True else "no_contact")
        # Older v2 packets have no acquisition age: keep it absent, never assume freshness.
    avisos: list[str] = []
    out: dict = {}

    def num(key, value, lo, hi, as_int=False):
        if value is None:
            return None
        v = number(value)
        if v is None or not lo <= v <= hi:
            avisos.append(f"{key}: valor no válido ({str(value)[:20]})")
            return None
        return int(round(v)) if as_int else v

    def pick(*keys):
        for k in keys:
            if raw.get(k) is not None:
                return raw[k]
        return None

    out["bpm"] = num("bpm", pick("bpm", "heartRate"), 0, 300, as_int=True)
    out["spo2"] = num("spo2", pick("spo2", "bloodOxygen"), 0, 100)
    out["audio_rms"] = num("audio_rms", raw.get("audio_rms"), -200, 200)
    out["audio_peak"] = num("audio_peak", raw.get("audio_peak"), -200, 200)
    out["hrv"] = num("hrv", raw.get("hrv"), 0, 5000, as_int=True)
    out["stress"] = num("stress", pick("stress", "stress_score", "stressLevel"), 0, 100, as_int=True)
    out["sampleAgeMs"] = num("sampleAgeMs", pick("sampleAgeMs", "sample_age_ms"), 0, 86_400_000)

    # Indicadores de validez: solo un booleano JSON cuenta; cualquier otra cosa queda como no válido.
    for key, aliases in (("heartRateValid", ("heartRateValid", "heart_rate_valid")),
                         ("bloodOxygenValid", ("bloodOxygenValid", "spo2_valid")),
                         ("spo2Calibrated", ("spo2Calibrated", "spo2_calibrated")),
                         ("spo2Estimated", ("spo2Estimated", "spo2_estimated")),
                         ("audioValid", ("audioValid", "audio_valid"))):
        value = pick(*aliases)
        if value is not None and not isinstance(value, bool):
            avisos.append(f"{key}: no es verdadero/falso")
            value = None
        out[key] = value
    for key in ("finger", "test"):
        try:
            out[key] = _flag(raw.get(key))
        except ValueError:
            avisos.append(f"{key}: no es verdadero/falso")
            out[key] = None

    for key, aliases, max_len in (("source", ("source",), 12), ("signalQuality", ("signalQuality", "signal_quality"), 24),
                                  ("audioUnit", ("audioUnit",), 12), ("device_id", ("device_id",), 64),
                                  ("session_id", ("session_id",), 64), ("session_name", ("session_name",), 80)):
        try:
            out[key] = _text(pick(*aliases), max_len)
        except ValueError:
            avisos.append(f"{key}: texto no válido")
            out[key] = None
    if out["source"] not in (None, "real", "simulated", "unknown"):
        avisos.append(f"source: valor desconocido ({out['source']})")
        out["source"] = "unknown"
    out["legacy"] = not any(k in raw for k in NEW_FORMAT_KEYS)
    return out, avisos


# Regla del servidor para el formato original (sin indicadores de calidad).
LEGACY_MIN_BPM, LEGACY_MAX_BPM = 30, 220
LEGACY_MIN_READINGS = 3
LEGACY_MAX_SPREAD_BPM = 20
_legacy_recent: dict[str, deque] = {}


def validate_legacy(session_id: str, packet: dict, now: float | None = None) -> dict:
    """Calidad calculada por el servidor para un paquete del formato original.

    Pulso válido solo con dedo puesto, dentro de 30-220 BPM y estable en las últimas 3 lecturas
    (máximo 15 s, rango de 20 BPM o menos). SpO2, HRV y estrés de este formato nunca se usan:
    el firmware original no tiene SpO2 calibrada.
    """
    now = time.time() if now is None else now
    bpm, finger = packet.get("bpm"), packet.get("finger") is True
    plausible = finger and bpm is not None and LEGACY_MIN_BPM <= bpm <= LEGACY_MAX_BPM
    buf = _legacy_recent.setdefault(session_id, deque(maxlen=LEGACY_MIN_READINGS))
    if buf and now - buf[-1][0] > MAX_AGE_S:
        buf.clear()
    buf.append((now, bpm if plausible else None))
    window = [b for t, b in buf if now - t <= MAX_AGE_S]
    stable = (len(window) >= LEGACY_MIN_READINGS and all(b is not None for b in window)
              and max(window) - min(window) <= LEGACY_MAX_SPREAD_BPM)
    return {
        "source": "simulated" if packet.get("test") is True else "real",
        "finger": packet.get("finger"),
        "heartRateValid": stable,
        "bloodOxygenValid": False,
        "spo2Calibrated": False,
        "signalQuality": "good" if stable else ("no_finger" if not finger else "unstable"),
        "sampleAgeMs": 0,
        "validadoPor": "servidor",
    }
