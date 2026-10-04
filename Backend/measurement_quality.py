"""Eligibility of measurements; missing provenance is never a normal reading."""
import math
from datetime import datetime, timezone

MAX_AGE_S = 15
QUALITY_FIELDS = ("source", "heartRateValid", "bloodOxygenValid", "spo2Calibrated",
                  "signalQuality", "sampleAgeMs", "finger", "audioUnit")


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


def usable_value(data: dict, channel: str, *, check_timestamp=True):
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
        if data.get("spo2Calibrated") is not True or value > 100:
            return None
    elif value > 300:
        return None
    return value
