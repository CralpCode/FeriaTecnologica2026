"""Shared telemetry contract: missing measurements are never normal values.

Numeric zero is retained as the legacy unavailable sentinel. Consumers must use
validity and provenance before presenting or interpreting a measurement.
"""

import math

METRICS = {
    "heartRate": ("bpm", "bpm_valid"),
    "bloodOxygen": ("spo2", "spo2_valid"),
    "systolicPressure": ("systolic", "systolic_valid"),
    "diastolicPressure": ("diastolic", "diastolic_valid"),
    "temperature": ("temperature", "temperature_valid"),
    "chipTemperature": ("chip_temp", "chip_temp_valid"),
    "hrv": ("hrv", "hrv_valid"),
    "stressLevel": ("stress", "stress_valid"),
    "audio_rms": ("audio_rms", "audio_valid"),
    "audio_peak": ("audio_peak", "audio_valid"),
    "steps": ("steps", "steps_valid"),
    "calories": ("calories", "calories_valid"),
}
INTEGER_METRICS = {
    "heartRate", "systolicPressure", "diastolicPressure", "hrv",
    "stressLevel", "steps", "calories",
}
UNSUPPORTED_METRICS = {
    "systolicPressure", "diastolicPressure", "temperature",
    "stressLevel", "steps", "calories",
}
METADATA_FIELDS = (
    "finger", "scan_mode", "scan_sec", "scan_phase", "cardiac_locked",
    "power", "source", "sensor_hw", "audio_hw", "bpm_valid", "spo2_valid",
    "audio_valid", "audio_clipped", "audio_samples", "audio_sample_rate",
    "audio_unit", "audio_quality", "signal_quality", "quality", "uptime_s",
    "device_connected", "firmware_version", "spo2_method",
    "v", "valid", "cal", "spo2_calibrated", "chip_temp_valid", "hrv_valid",
)


def finite_number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError, OverflowError):
        return None


def _value_in_range(metric, number):
    if number is None:
        return False
    if metric == "bloodOxygen":
        return 0 < number <= 100
    if metric in ("audio_rms", "audio_peak"):
        return number >= 0
    if metric == "hrv":
        return number >= 0
    if metric == "chipTemperature":
        return -40 <= number <= 100
    return number > 0


def normalize_reading(data: dict) -> dict:
    """Respect explicit sensor validity; never infer it from a plausible number.

    MAX30102 + INMP441 cannot measure BP, temperature, stress, steps or calories.
    HRV describes derived optical pulse intervals, not an ECG measurement.
    Legacy records without metadata remain unverified, including plausible ones.
    """
    result = {key: data[key] for key in METADATA_FIELDS if data.get(key) is not None}
    version = data.get("v", data.get("telemetry_version", 0))
    source = str(data.get("source") or ("esp32" if version == 2 else "legacy_unverified"))
    result["source"] = source
    supplied_validity = data.get("validity") or {}
    supplied_provenance = data.get("provenance") or {}
    quality = data.get("quality") or {}
    mask = data.get("valid") if version == 2 else None
    mask = mask if isinstance(mask, int) and not isinstance(mask, bool) else None
    mask_bits = {"heartRate": 1, "bloodOxygen": 2, "hrv": 4, "chipTemperature": 8, "audio_rms": 16, "audio_peak": 16}
    validity, provenance, raw_values = {}, {}, {}
    simulated = source.lower() in {"simulated", "simulation", "emulator", "demo", "wokwi"}
    inactive = data.get("power") == "standby" or data.get("device_connected") is False
    for metric, (wire_name, flag) in METRICS.items():
        raw = data.get(wire_name, data.get(metric))
        if metric == "stressLevel" and raw is None:
            raw = data.get("stress_score")
        raw_values[metric] = raw
        number = finite_number(raw)
        explicitly_valid = data.get(flag) is True or supplied_validity.get(metric) is True
        if mask is not None:
            explicitly_valid = bool(mask & mask_bits.get(metric, 0))
        if isinstance(quality.get(metric), bool):
            explicitly_valid = quality[metric]
        # A contradictory false flag is authoritative.
        if data.get(flag) is False or supplied_validity.get(metric) is False:
            explicitly_valid = False
        supported = metric not in UNSUPPORTED_METRICS
        valid = supported and explicitly_valid and _value_in_range(metric, number) and not inactive
        if metric in {"heartRate", "bloodOxygen", "hrv"}:
            valid = valid and data.get("finger") is not False and data.get("sensor_hw") is not False
        if metric in {"audio_rms", "audio_peak"}:
            valid = valid and data.get("audio_hw") is not False and data.get("audio_clipped") is not True
        if simulated:
            valid = False
        validity[metric] = bool(valid)
        if not supported:
            provenance[metric] = "unavailable"
        elif simulated:
            provenance[metric] = "unverified"
        elif valid:
            default_provenance = "estimated" if metric == "bloodOxygen" else ("derived" if metric == "hrv" else "measured")
            incoming_provenance = supplied_provenance.get(metric)
            provenance[metric] = incoming_provenance if incoming_provenance in {"measured", "derived", "estimated"} else default_provenance
            if metric == "bloodOxygen":
                provenance[metric] = "estimated"
        else:
            provenance[metric] = "unverified" if source == "legacy_unverified" and raw is not None else "unavailable"
        result[metric] = (int(number) if metric in INTEGER_METRICS else number) if valid else 0
    result["validity"] = validity
    result["quality"] = {**quality, **validity}
    result["provenance"] = provenance
    result["raw_values"] = data.get("raw_values") or raw_values
    result["bpm_valid"] = validity["heartRate"]
    result["spo2_valid"] = validity["bloodOxygen"]
    result["audio_valid"] = validity["audio_rms"] and validity["audio_peak"]
    result["hrv_valid"] = validity["hrv"]
    result["chip_temp_valid"] = validity["chipTemperature"]
    result["spo2_calibrated"] = data.get("cal") is True or data.get("spo2_calibrated") is True
    result["telemetry_version"] = version
    result.setdefault("audio_unit", "relative_uncalibrated")
    return result


def measured_value(data: dict, metric: str, clinical=False):
    """Return a measurement or None, also for stored pre-contract rows."""
    normalized = normalize_reading(data)
    if not normalized["validity"].get(metric):
        return None
    if clinical and metric == "bloodOxygen" and not normalized["spo2_calibrated"]:
        return None
    if not clinical or normalized["provenance"].get(metric) == "measured" or metric == "bloodOxygen" and normalized["spo2_calibrated"]:
        return normalized[metric]
    return None


def display_value(data: dict, metric: str, decimals=None, suffix=""):
    value = measured_value(data, metric)
    if value is None:
        return "Sin datos"
    text = f"{value:.{decimals}f}" if decimals is not None else str(value)
    return text + suffix
