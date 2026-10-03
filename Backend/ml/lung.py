"""
Clasificación de grabaciones PULMONARES con los modelos entrenados en spiroscan-analysis/train_lung.py:
  - lung_sounds_cnn   -> crepitantes / sibilancias (B)
  - lung_disease_cnn  -> patrón compatible con enfermedad (C); solo se muestra lo que el modelo
                         acierta de forma confiable según su .json ("mostrar")
Si un modelo aún no existe, se informa "modelo_no_disponible" en lugar de fallar.
"""
import json
import os
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

from . import lung_features as LF
from .features import signal_quality

MODELS_DIR = Path(os.getenv("LUNG_MODELS_DIR", Path(__file__).resolve().parents[1] / "models"))
MIN_DURATION_S = 8.0  # al menos 2 ciclos respiratorios

_lock = threading.Lock()
_cache: dict[str, tuple] = {}


def _load(name: str):
    with _lock:
        if name in _cache:
            return _cache[name]
        path = MODELS_DIR / f"{name}.pt"
        if not path.exists():
            return None
        import torch
        _cache[name] = (torch.jit.load(str(path), map_location="cpu").eval(),
                        json.loads(path.with_suffix(".json").read_text()))
        return _cache[name]


def model_info() -> dict:
    out = {}
    for name in ("lung_sounds_cnn", "lung_disease_cnn"):
        m = _load(name)
        out[name] = {"loaded": False} if m is None else {
            "loaded": True, "tarea": m[1].get("tarea"), "metricas_prueba": m[1].get("metricas_prueba"),
            "mostrar": m[1].get("mostrar", True), "limitaciones": m[1].get("limitaciones", []),
        }
    return out


def classify_wav(path: str | Path) -> dict:
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)
    duration = len(y) / sr
    quality = signal_quality(y)
    quality["duration_s"] = round(duration, 2)
    base = {"probability": None, "threshold": None, "quality": quality, "model": "pulmon"}
    if duration < MIN_DURATION_S:
        return {**base, "result": "calidad_insuficiente", "details": {},
                "reason": f"Grabación muy corta ({duration:.1f} s; mínimo {MIN_DURATION_S:.0f} s)"}
    if quality["too_quiet"]:
        return {**base, "result": "calidad_insuficiente", "details": {},
                "reason": "Señal casi en silencio: revisar contacto del estetoscopio"}

    sounds, disease = _load("lung_sounds_cnn"), _load("lung_disease_cnn")
    if sounds is None and disease is None:
        return {**base, "result": "modelo_no_disponible", "details": {},
                "reason": "Los modelos de pulmón aún no están entrenados (faltan los audios de ICBHI)."}

    import torch
    x = torch.from_numpy(LF.features_from_audio(y, sr))
    quality["windows"] = int(len(x))
    details: dict = {}
    abnormal = False
    top_prob = 0.0

    if sounds is not None:
        model, meta = sounds
        with torch.no_grad():
            p = torch.sigmoid(model(x)).numpy()          # (ventanas, 2)
        k = min(2, len(p))
        score = np.sort(p, axis=0)[-k:].mean(0)          # promedio de las 2 ventanas más altas
        found = {}
        for j, name in enumerate(meta["salidas"]):
            m = meta["metricas_prueba"][name]
            if not m.get("mostrar"):
                continue
            present = bool(score[j] >= m["umbral"])
            found[name] = {"presente": present, "probabilidad": round(float(score[j]), 3),
                           "umbral": round(m["umbral"], 3), "sensibilidad_modelo": round(m["sensibilidad"], 2)}
            abnormal |= present
            top_prob = max(top_prob, float(score[j]))
        details["ruidos"] = found

    if disease is not None and disease[1].get("mostrar"):
        model, meta = disease
        with torch.no_grad():
            p = torch.softmax(model(x), 1).mean(0).numpy()
        k = int(np.argmax(p))
        cls = meta["clases"][k]
        per = meta["metricas_prueba"]["por_clase"][cls]
        if per.get("mostrar"):
            details["patron"] = {"compatible_con": cls, "probabilidad": round(float(p[k]), 3),
                                 "sensibilidad_modelo": round(per["sensibilidad"], 2)}
            abnormal |= cls != "sano"

    return {**base, "result": "anormal" if abnormal else "normal", "reason": None,
            "probability": round(top_prob, 4) if "ruidos" in details else None, "details": details}
