"""
Modelo BASE de pulmón (nivel 1, tabular): regresión logística entrenada con ICBHI 2017 por el equipo.
Clasifica Normal vs Patológico a partir de 61 características acústicas (RMS, ZCR, centroide,
rolloff, MFCC 1-13 con deltas).

Archivos en Backend/models/: mejor_clasificador_icbhi.joblib (pipeline scikit-learn) o, si no se
puede cargar, modelo_icbhi_exportado.json (mismos coeficientes, sin dependencias).

Para analizar una GRABACIÓN hace falta calcular las 61 características exactamente igual que en el
entrenamiento; eso vive en lung_baseline_features.py y está pendiente del código del autor.
"""
import json
import math
import os

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
MODEL_JOBLIB_PATH = os.path.join(MODEL_DIR, "mejor_clasificador_icbhi.joblib")
MODEL_JSON_PATH = os.path.join(MODEL_DIR, "modelo_icbhi_exportado.json")
# Puntaje ICBHI informado por el autor al entrenar (no se recalcula en el servidor)
REPORTED_ICBHI_SCORE = 61.22
# Umbral calibrado por el autor para tamizaje (prioriza no dejar pasar casos anormales)
THRESHOLD = 0.30


def _result(p_abn: float, classes: list[str], model_name: str) -> dict:
    """Resultado con la probabilidad REAL del modelo como confianza (sin escalas artificiales)."""
    pred = 1 if p_abn >= THRESHOLD else 0
    return {
        "prediction": classes[pred] if pred < len(classes) else ("Patologico" if pred else "Normal"),
        "is_abnormal": pred,
        "confidence": round((p_abn if pred else 1 - p_abn) * 100.0, 1),
        "probability_abnormal": round(p_abn, 4),
        "umbral": THRESHOLD,
        "model_name": model_name,
        "score_icbhi": REPORTED_ICBHI_SCORE,
    }

_model_bundle = None
_model_json_data = None


def _load():
    global _model_bundle, _model_json_data
    if _model_bundle is not None or _model_json_data is not None:
        return
    if os.path.exists(MODEL_JOBLIB_PATH):
        try:
            import joblib
            _model_bundle = joblib.load(MODEL_JOBLIB_PATH)
            print(f"[MODELO BASE] Cargado (joblib): {_model_bundle.get('best_model_name')}")
            return
        except Exception as e:
            print(f"[MODELO BASE] joblib no disponible ({e}); se intenta el JSON")
    if os.path.exists(MODEL_JSON_PATH):
        try:
            with open(MODEL_JSON_PATH, "r", encoding="utf-8") as f:
                _model_json_data = json.load(f)
            print("[MODELO BASE] Cargado desde JSON")
        except Exception as e:
            print(f"[MODELO BASE] Error cargando JSON: {e}")


def _meta() -> dict | None:
    _load()
    return _model_bundle or _model_json_data


def model_info() -> dict:
    meta = _meta()
    if meta is None:
        return {"loaded": False}
    from . import lung_baseline_features
    return {
        "loaded": True,
        "format": "joblib" if _model_bundle else "json",
        "model_name": meta.get("best_model_name", "Regresión logística L2"),
        "num_features": len(meta.get("feature_names", [])),
        "classes": meta.get("class_names", ["Normal", "Patologico"]),
        "puntaje_icbhi_reportado": meta.get("score_icbhi", REPORTED_ICBHI_SCORE),
        "extractor_listo": lung_baseline_features.READY,
    }


def _vector(features, names: list[str]) -> list[float]:
    if isinstance(features, dict):
        return [float(features.get(k, 0.0)) for k in names]
    if isinstance(features, (list, tuple)):
        v = [float(x) for x in list(features)[:len(names)]]
        return v + [0.0] * (len(names) - len(v))
    return [0.0] * len(names)


def classify_features(features) -> dict:
    """Clasifica un vector (lista o dict) de 61 características ya calculadas."""
    meta = _meta()
    if meta is None:
        return {"prediction": "no_disponible", "detail": "El modelo base de pulmón no está en Backend/models/."}
    names = meta.get("feature_names", [])
    classes = meta.get("class_names", ["Normal", "Patologico"])
    x = _vector(features, names)

    if _model_bundle is not None:
        try:
            import numpy as np
            pipeline = _model_bundle["pipeline"]
            arr = np.array([x], dtype=np.float32)
            p_abn = float(pipeline.predict_proba(arr)[0][1])
            return _result(p_abn, classes, _model_bundle.get("best_model_name", "Regresión logística L2"))
        except Exception as e:
            print(f"[MODELO BASE] Error en inferencia joblib ({e}); se usa el JSON")

    d = _model_json_data
    if d is None:
        try:
            with open(MODEL_JSON_PATH, "r", encoding="utf-8") as f:
                d = json.load(f)
        except OSError:
            return {"prediction": "no_disponible", "detail": "No se pudo usar el modelo base."}
    z = d["intercept"]
    for i, xi in enumerate(x):
        scale = d["scaler_scale"][i] or 1.0
        z += d["coef"][i] * (xi - d["scaler_mean"][i]) / scale
    p_abn = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
    return _result(p_abn, classes, "Regresión logística L2 (JSON)")


def classify_audio(y, sr: int) -> dict:
    """Grabación -> 61 características -> modelo base. Si el extractor aún no está, lo informa."""
    from . import lung_baseline_features
    if _meta() is None:
        return {"estado": "no_disponible"}
    if not lung_baseline_features.READY:
        return {"estado": "pendiente_extractor",
                "detalle": "Falta el código con que el equipo calculó las 61 características."}
    out = classify_features(lung_baseline_features.extract(y, sr))
    out["estado"] = "ok"
    return out
