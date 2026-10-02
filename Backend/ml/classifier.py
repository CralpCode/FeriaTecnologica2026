"""
Carga la CNN cardíaca entrenada en spiroscan-analysis (TorchScript) y clasifica grabaciones.
El modelo y su .json (umbral, parámetros) se copian a Backend/models/.
"""
import json
import os
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

from . import features as F

MODEL_PATH = Path(os.getenv("HEART_MODEL_PATH", Path(__file__).resolve().parents[1] / "models" / "heart_cnn.pt"))
MIN_DURATION_S = 5.0

_lock = threading.Lock()
_model = None
_meta: dict = {}


def _load():
    global _model, _meta
    with _lock:
        if _model is not None:
            return
        import torch
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"No existe el modelo {MODEL_PATH}. Entrénalo con spiroscan-analysis/train_heart.py")
        _model = torch.jit.load(str(MODEL_PATH), map_location="cpu").eval()
        meta_path = MODEL_PATH.with_suffix(".json")
        _meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"umbral": 0.5}


def model_info() -> dict:
    try:
        _load()
    except FileNotFoundError as e:
        return {"loaded": False, "error": str(e)}
    return {
        "loaded": True,
        "path": MODEL_PATH.name,
        "dataset": _meta.get("dataset"),
        "correccion_acustica": _meta.get("correccion_acustica"),
        "umbral": _meta.get("umbral"),
        "metricas_prueba": _meta.get("metricas_prueba"),
        "limitaciones": _meta.get("limitaciones", []),
    }


def classify_wav(path: str | Path) -> dict:
    """Devuelve probabilidad de anormalidad, resultado y calidad de la señal."""
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)
    duration = len(y) / sr
    quality = F.signal_quality(y)
    quality["duration_s"] = round(duration, 2)

    if duration < MIN_DURATION_S:
        return {"result": "calidad_insuficiente", "reason": f"Grabación muy corta ({duration:.1f} s; mínimo {MIN_DURATION_S:.0f} s)",
                "probability": None, "threshold": None, "quality": quality}
    if quality["too_quiet"]:
        return {"result": "calidad_insuficiente", "reason": "Señal casi en silencio: revisar contacto del estetoscopio",
                "probability": None, "threshold": None, "quality": quality}

    _load()
    import torch
    x = torch.from_numpy(F.features_from_audio(y, sr))
    with torch.no_grad():
        window_probs = torch.sigmoid(_model(x)).numpy()
    prob = float(np.mean(window_probs))
    thr = float(_meta.get("umbral", 0.5))
    quality["windows"] = int(len(window_probs))
    return {
        "result": "anormal" if prob >= thr else "normal",
        "reason": None,
        "probability": round(prob, 4),
        "threshold": round(thr, 4),
        "window_probabilities": [round(float(p), 4) for p in window_probs],
        "quality": quality,
        "model": MODEL_PATH.name,
    }
