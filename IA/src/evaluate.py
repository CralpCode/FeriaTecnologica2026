"""Métricas clínicas obligatorias (ver INSTRUCCIONES_DATOS_IA.md, sección 5.3)."""
import numpy as np
from sklearn.metrics import roc_auc_score, confusion_matrix, f1_score


def clinical_metrics(y_true, y_prob, threshold: float = 0.5) -> dict:
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob, dtype=float)
    y_pred = (y_prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    se = tp / (tp + fn) if (tp + fn) else 0.0
    sp = tn / (tn + fp) if (tn + fp) else 0.0
    return {
        "n": int(len(y_true)),
        "positivos": int(y_true.sum()),
        "umbral": float(threshold),
        "sensibilidad": float(se),
        "especificidad": float(sp),
        "score_medio": float((se + sp) / 2),
        "auc": float(roc_auc_score(y_true, y_prob)) if len(set(y_true)) > 1 else float("nan"),
        "f1_macro": float(f1_score(y_true, y_pred, average="macro")),
        "exactitud": float((tp + tn) / len(y_true)),
        "matriz_confusion": {"VN": int(tn), "FP": int(fp), "FN": int(fn), "VP": int(tp)},
    }


def pick_threshold(y_true, y_prob, min_sensitivity: float = 0.85) -> float:
    """
    Tamizaje: se prefiere no dejar pasar enfermos. Elige el umbral más alto que logra
    la sensibilidad mínima pedida (así se maximiza la especificidad dentro de esa condición).
    """
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob, dtype=float)
    best = 0.5
    for t in np.unique(y_prob)[::-1]:
        pred = y_prob >= t
        tp = np.sum(pred & (y_true == 1))
        se = tp / max(1, y_true.sum())
        if se >= min_sensitivity:
            best = float(t)
            break
    return best


def leakage_warning(metrics: dict) -> str | None:
    if metrics["exactitud"] > 0.97:
        return ("Exactitud > 97 %: sospechar fuga de datos entre entrenamiento y prueba "
                "(ver sección 9 del manual). Verificar la partición por paciente.")
    return None
