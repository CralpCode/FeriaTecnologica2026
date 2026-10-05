"""Eligibility of measurements; missing provenance is never a normal reading."""
import math
import time
from collections import deque
from datetime import datetime, timezone

MAX_AGE_S = 15
QUALITY_FIELDS = ("source", "heartRateValid", "bloodOxygenValid", "spo2Calibrated",
                  "signalQuality", "sampleAgeMs", "finger", "audioUnit", "validadoPor")
# Indicadores que solo envía el firmware nuevo; si no llega ninguno, el paquete es del formato original.
NEW_FORMAT_KEYS = ("source", "heartRateValid", "heart_rate_valid", "bloodOxygenValid", "spo2_valid",
                   "spo2Calibrated", "spo2_calibrated", "signalQuality", "signal_quality",
                   "sampleAgeMs", "sample_age_ms", "v", "valid", "validity")


def normalize_measurements(data: dict) -> dict:
    from telemetry import normalize_reading
    payload = dict(data)
    if 'validity' not in payload and payload.get('v') != 2:
        payload['validity'] = {
            'heartRate': payload.get('heartRateValid') is True,
            'bloodOxygen': payload.get('bloodOxygenValid') is True,
            'audio_rms': payload.get('audioUnit') == 'dBFS' and number(payload.get('audio_rms')) is not None,
            'audio_peak': payload.get('audioUnit') == 'dBFS' and number(payload.get('audio_peak')) is not None,
        }
    payload['spo2_calibrated'] = (payload.get('cal') is True if payload.get('v') == 2 else
        payload.get('spo2_calibrated') is True or payload.get('spo2Calibrated') is True)
    payload['audio_unit'] = payload.get('audioUnit') or payload.get('audio_unit') or 'relative_uncalibrated'
    normalized = normalize_reading(payload)
    source = normalized.get('source')
    normalized['source'] = 'real' if source in ('esp32', 'ble_hr') else source
    # Preserve the device's discrete heuristic separately from clinical stressLevel.
    reported_stress = number(data.get('stress', data.get('stress_score', data.get('experimentalStressScore'))))
    prv = normalized['hrv']
    expected_stress = 25 if prv >= 45 else 50 if prv >= 25 else 75
    normalized['experimentalStressScore'] = (reported_stress if normalized['source'] == 'real'
        and normalized['validity']['hrv'] and reported_stress == expected_stress else None)
    normalized.update({
        'heartRateValid': normalized['validity']['heartRate'],
        'bloodOxygenValid': normalized['validity']['bloodOxygen'],
        'spo2Calibrated': normalized['spo2_calibrated'],
        'signalQuality': data.get('signalQuality') or ('good' if any(
            normalized['validity'][key] for key in ('heartRate', 'bloodOxygen', 'hrv')) else 'unstable'),
        'sampleAgeMs': data.get('sampleAgeMs') if data.get('sampleAgeMs') is not None else (0 if payload.get('v') == 2 else None),
        'audioUnit': normalized['audio_unit'],
    })
    return normalized


def metadata(data: dict) -> dict:
    normalized = normalize_measurements(data)
    return {**{key: data.get(key, normalized.get(key)) for key in QUALITY_FIELDS},
            **{key: normalized[key] for key in ('validity', 'provenance', 'spo2_calibrated', 'chipTemperature', 'experimentalStressScore',
                'source', 'heartRateValid', 'bloodOxygenValid', 'spo2Calibrated', 'audioUnit', 'signalQuality', 'sampleAgeMs')},
            **{key: normalized[key] for key in ('v', 'valid', 'cal', 'scan_mode', 'scan_sec', 'scan_phase',
                'cardiac_locked', 'power') if key in normalized}}


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def usable_value(data: dict, channel: str, *, check_timestamp=True):
    if data.get("source") != "real" or data.get("demo"):
        return None
    if data.get("signalQuality") != "good":
        return None
    # Standard BLE pulse packets may not implement contact sensing. Do not invent
    # contact, but accept their explicit v2 pulse validity; SpO2 still needs it.
    pulse_without_contact_sensor = channel == 'heartRate' and data.get('v') == 2 and data.get('finger') is None
    if data.get("finger") is not True and not pulse_without_contact_sensor:
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
        if data.get("spo2Calibrated") is not True or value > 100:
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
    out["audio_peak"] = num("audio_peak", raw.get("audio_peak"), 0, 8_388_608)
    out["hrv"] = num("hrv", raw.get("hrv"), 0, 5000, as_int=True)
    out["stress"] = num("stress", pick("stress", "stress_score", "stressLevel"), 0, 100, as_int=True)
    out["sampleAgeMs"] = num("sampleAgeMs", pick("sampleAgeMs", "sample_age_ms"), 0, 86_400_000)

    # Indicadores de validez: solo un booleano JSON cuenta; cualquier otra cosa queda como no válido.
    for key, aliases in (("heartRateValid", ("heartRateValid", "heart_rate_valid")),
                         ("bloodOxygenValid", ("bloodOxygenValid", "spo2_valid")),
                         ("spo2Calibrated", ("spo2Calibrated", "spo2_calibrated"))):
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
                                  ("audioUnit", ("audioUnit",), 32), ("device_id", ("device_id",), 64),
                                  ("session_id", ("session_id",), 64), ("session_name", ("session_name",), 80)):
        try:
            out[key] = _text(pick(*aliases), max_len)
        except ValueError:
            avisos.append(f"{key}: texto no válido")
            out[key] = None
    if raw.get('v') == 2 and out['source'] in ('esp32', 'ble_hr'):
        out['source'] = 'real'
    if out["source"] not in (None, "real", "simulated", "unknown"):
        avisos.append(f"source: valor desconocido ({out['source']})")
        out["source"] = "unknown"
    if raw.get('v') == 2 and not isinstance(raw.get('v'), bool):
        mask = raw.get('valid')
        out['v'] = 2
        out['valid'] = mask if isinstance(mask, int) and not isinstance(mask, bool) and 0 <= mask <= 31 else 0
        out['cal'] = raw.get('cal') is True
        out['chip_temp'] = num('chip_temp', raw.get('chip_temp'), -40, 100)
        out['audio_unit'] = raw.get('audio_unit') if raw.get('audio_unit') in ('dBFS', 'relative_uncalibrated') else 'relative_uncalibrated'
        for key, choices in [('scan_mode', ('cardiac', 'pulmonary', 'continuous', 'none')),
                             ('scan_phase', ('calibrating', 'measuring', 'none')),
                             ('power', ('active', 'standby'))]:
            if raw.get(key) in choices:
                out[key] = raw[key]
        out['scan_sec'] = num('scan_sec', raw.get('scan_sec'), 0, 86_400_000, as_int=True)
        out['cardiac_locked'] = raw.get('cardiac_locked') is True
        if raw.get('source') in (None, 'esp32', 'ble_hr'):
            out['source'] = 'simulated' if out.get('test') is True else 'real'
        out.update(normalize_measurements(out))
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
