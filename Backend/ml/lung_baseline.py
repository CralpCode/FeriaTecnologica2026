"""
Modelo BASE de pulmón (nivel 1, tabular): regresión logística entrenada con ICBHI 2017 por el equipo.
Clasifica Normal vs Patológico a partir de 61 características acústicas (RMS, ZCR, centroide,
rolloff, MFCC 1-13 con deltas).

Archivos en Backend/models/: mejor_clasificador_icbhi.joblib (pipeline scikit-learn) o, si no se
puede cargar, modelo_icbhi_exportado.json (mismos coeficientes, sin dependencias).

El código original del autor y su verificación están en IA/modelo_base/ (AUC 0.71 con 24 pacientes no vistos;
con el umbral 0.30 marca como anormales a ~7 de cada 10 ciclos normales). Por eso se usa solo con los casos
demo ICBHI, que traen sus características ya calculadas, y no con grabaciones del dispositivo.
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
    """Puntaje del clasificador; no es probabilidad clínica calibrada."""
    if not math.isfinite(p_abn) or not 0 <= p_abn <= 1:
        raise ValueError("Puntaje del modelo no válido")
    pred = 1 if p_abn >= THRESHOLD else 0
    return {
        "prediction": classes[pred] if pred < len(classes) else ("Patologico" if pred else "Normal"),
        "is_abnormal": pred,
        "confidence": round((p_abn if pred else 1 - p_abn) * 100.0, 1),
        "probability_abnormal": round(p_abn, 4),
        "probability_kind": "uncalibrated_model_score",
        "score_provenance": "reported_by_author_not_revalidated",
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
        if any(k not in features for k in names):
            raise ValueError("Faltan características; no se rellenan datos con ceros")
        v = [float(features[k]) for k in names]
    elif isinstance(features, (list, tuple)) and len(features) == len(names):
        v = [float(x) for x in features]
    else:
        raise ValueError("Se requiere el vector completo de características")
    if not v or not all(math.isfinite(x) for x in v):
        raise ValueError("Características vacías o no finitas")
    return v


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
    """Grabación -> 61 características -> modelo base. Hoy no se usa con grabaciones reales (ver arriba)."""
    from . import lung_baseline_features
    if _meta() is None:
        return {"estado": "no_disponible"}
    if not lung_baseline_features.READY:
        return {"estado": "solo_demo",
                "detalle": "El modelo base se usa solo en los casos demo: no es confiable con grabaciones reales "
                           "(ver IA/modelo_base/README.md)."}
    out = classify_features(lung_baseline_features.extract(y, sr))
    out["estado"] = "ok" if "probability_abnormal" in out else "no_disponible"
    return out
