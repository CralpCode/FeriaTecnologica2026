"""
Carga la CNN cardíaca entrenada en IA/ (TorchScript) y clasifica grabaciones.
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

MURMUR_PATH = MODEL_PATH.parent / "murmur_cnn.pt"

_lock = threading.Lock()
_model = None
_meta: dict = {}
_murmur_model = None
_murmur_meta: dict = {}


def _load_murmur() -> bool:
    """Modelo opcional que describe el soplo. Si no existe, la clasificación sigue funcionando."""
    global _murmur_model, _murmur_meta
    with _lock:
        if _murmur_model is not None:
            return True
        if not MURMUR_PATH.exists():
            return False
        import torch
        _murmur_model = torch.jit.load(str(MURMUR_PATH), map_location="cpu").eval()
        _murmur_meta = json.loads(MURMUR_PATH.with_suffix(".json").read_text())
        return True


def describe_murmur(x) -> dict:
    """
    Características del soplo que el modelo predice de forma confiable (las marcadas "mostrar").
    Devuelve {caracteristica: {"valor": ..., "confianza": ...}}. No identifica la causa.
    """
    if not _load_murmur() or not _murmur_meta.get("validacion_independiente", False):
        return {}
    import torch
    with torch.no_grad():
        logits = _murmur_model(x)
    out = {}
    for name, h in _murmur_meta.get("caracteristicas", {}).items():
        if not h.get("mostrar"):
            continue
        a, b = h["columnas"]
        probs = torch.softmax(logits[:, a:b], dim=1).mean(0).numpy()
        k = int(np.argmax(probs))
        out[name] = {
            "valor": h["clases"][k],
            "confianza": round(float(probs[k]), 3),
            "exactitud_modelo": round(h["metricas_prueba"]["exactitud_balanceada"], 2),
        }
    return out


def _load():
    global _model, _meta
    with _lock:
        if _model is not None:
            return
        import torch
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"No existe el modelo {MODEL_PATH}. Entrénalo con IA/train_heart.py")
        meta_path = MODEL_PATH.with_suffix(".json")
        if not meta_path.exists():
            raise FileNotFoundError("Faltan los metadatos y el umbral del modelo; no se inventa un umbral")
        candidate_meta = json.loads(meta_path.read_text())
        threshold = candidate_meta.get("umbral")
        if threshold is None or not np.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError("Umbral del modelo inválido")
        for name, expected in candidate_meta.get("features", {}).items():
            actual = getattr(F, name, None)
            if isinstance(actual, tuple):
                actual = list(actual)
            if actual != expected:
                raise ValueError(f"Extractor incompatible con el modelo: {name}")
        _model = torch.jit.load(str(MODEL_PATH), map_location="cpu").eval()
        _meta = candidate_meta


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
        "probability_kind": "uncalibrated_model_score",
        "validado_dispositivo": _meta.get("validado_dispositivo", False),
        "limitaciones": _meta.get("limitaciones", []),
        "caracterizacion_soplo": {
            name: {"mostrar": bool(h["mostrar"] and _murmur_meta.get("validacion_independiente", False)),
                   "validacion_independiente": _murmur_meta.get("validacion_independiente", False),
                   "exactitud_balanceada": round(h["metricas_prueba"]["exactitud_balanceada"], 2),
                   "azar": round(h["metricas_prueba"]["azar"], 2)}
            for name, h in _murmur_meta.get("caracteristicas", {}).items()
        } if _load_murmur() else None,
    }


def classify_wav(path: str | Path, eq=None) -> dict:
    """Devuelve probabilidad de anormalidad, resultado y calidad de la señal.

    eq: función (y, sr) -> y del ecualizador (ml/equalizer.py); se aplica tras el control de calidad."""
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)
    duration = len(y) / sr
    quality = F.signal_quality(y)
    quality["duration_s"] = round(duration, 2)

    if quality["non_finite"] or quality["clipped"] or quality["flat"]:
        return {"result": "calidad_insuficiente", "reason": "Señal inválida, saturada o sin variación; repetir la grabación",
                "probability": None, "threshold": None, "quality": quality}

    if duration < MIN_DURATION_S:
        return {"result": "calidad_insuficiente", "reason": f"Grabación muy corta ({duration:.1f} s; mínimo {MIN_DURATION_S:.0f} s)",
                "probability": None, "threshold": None, "quality": quality}
    if quality["too_quiet"]:
        return {"result": "calidad_insuficiente", "reason": "Señal casi en silencio: revisar contacto del estetoscopio",
                "probability": None, "threshold": None, "quality": quality}

    if eq is not None:
        y = eq(y, sr)
    _load()
    import torch
    x = torch.from_numpy(F.features_from_audio(y, sr))
    with torch.no_grad():
        window_probs = torch.sigmoid(_model(x)).numpy()
    if not window_probs.size or not np.isfinite(window_probs).all():
        return {"result": "indeterminado", "reason": "El modelo no produjo una salida finita",
                "probability": None, "threshold": None, "quality": quality}
    prob = float(np.mean(window_probs))
    thr = float(_meta.get("umbral", 0.5))
    if not np.isfinite(thr) or not 0 <= thr <= 1:
        raise ValueError("Umbral del modelo inválido")
    quality["windows"] = int(len(window_probs))
    result = "anormal" if prob >= thr else "normal"
    return {
        "result": result,
        "details": {"caracteristicas_soplo": describe_murmur(x)} if result == "anormal" else {},
        "reason": None,
        "probability": round(prob, 4),
        "probability_kind": "uncalibrated_model_score",
        "clinical_diagnosis": False,
        "threshold": round(thr, 4),
        "window_probabilities": [round(float(p), 4) for p in window_probs],
        "quality": quality,
        "model": MODEL_PATH.name,
    }
