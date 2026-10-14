"""Corrección del SpO2 del sensor del equipo contra un oxímetro de referencia, hecha en el servidor (el firmware no se toca).

Los pares (lo que marca el sensor y lo que marca el oxímetro al mismo tiempo) están en models/spo2_calibracion.json.
Método "desplazamiento": corregido = sensor + promedio(oxímetro - sensor). Con pocos pares es lo único defendible;
una recta (pendiente y desplazamiento) necesita más personas.
El valor crudo del sensor se guarda como spo2Raw para poder recalibrar. Uso: python spo2_calibration.py (informe).
"""
import json
import math
import os
from pathlib import Path

CONFIG_PATH = Path(os.getenv("SPIROSCAN_SPO2_CAL", Path(__file__).resolve().parent / "models" / "spo2_calibracion.json"))


def fit(pairs: list[dict]) -> dict:
    """Desplazamiento promedio y error antes/después (RMS, en puntos de %)."""
    diffs = [p["oximetro"] - p["sensor"] for p in pairs]
    if not diffs:
        return {"n": 0, "desplazamiento": 0.0, "rms_antes": None, "rms_despues": None}
    offset = sum(diffs) / len(diffs)
    rms = lambda errs: math.sqrt(sum(e * e for e in errs) / len(errs))
    return {"n": len(diffs), "desplazamiento": round(offset, 2), "rms_antes": round(rms(diffs), 2),
            "rms_despues": round(rms([d - offset for d in diffs]), 2)}


def _load() -> dict | None:
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not cfg.get("activo") or cfg.get("metodo") != "desplazamiento" or not cfg.get("pares"):
        return None
    return {**cfg, **fit(cfg["pares"])}


_CONFIG = _load()


def correct(value: float | None) -> float | None:
    """SpO2 corregido (máximo 100 %); sin calibración activa devuelve el mismo valor."""
    if _CONFIG is None or value is None or value <= 0:
        return value
    return round(min(100.0, max(0.0, value + _CONFIG["desplazamiento"])), 1)


def apply(data: dict) -> None:
    """Corrige data["spo2"] de un paquete del equipo real y guarda el valor del sensor en data["spo2Raw"]."""
    raw = data.get("spo2")
    if _CONFIG is None or data.get("source") != "real" or not raw:
        return
    data["spo2Raw"] = raw
    data["spo2"] = correct(raw)


if __name__ == "__main__":
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    r = fit(cfg["pares"])
    print(f"Pares: {r['n']} · desplazamiento: {r['desplazamiento']:+.2f} puntos")
    print(f"Error RMS sin corregir: {r['rms_antes']} · corregido: {r['rms_despues']}")
    for p in cfg["pares"]:
        print(f"  sensor {p['sensor']:5.1f} -> corregido {min(100.0, p['sensor'] + r['desplazamiento']):5.1f}"
              f" · oxímetro {p['oximetro']:5.1f}")
