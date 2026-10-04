"""
Verifica el modelo base de pulmón (regresión logística, 61 características) con el código original del autor.

1. Extractor: recalcula las 61 características de ciclos de ICBHI con src/ (código original) y las compara
   con features_icbhi_dataset.csv, que generó el autor.
2. Modelo: mide Backend/models/mejor_clasificador_icbhi.joblib en la partición por paciente del CSV
   (Entrenamiento / Validacion, sin pacientes compartidos) con el umbral del servidor (0.30) y con 0.50.

Uso (desde IA/, con los audios de ICBHI en IA/data/icbhi):
    python modelo_base/verificar_modelo_base.py
Escribe modelo_base/resultados_verificacion.json.
"""
import csv
import json
import random
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from src.audio_processing import load_audio_normalized, butter_bandpass_filter, segment_cycle  # noqa: E402
from src.feature_extraction import extract_cycle_features  # noqa: E402

CSV_PATH = HERE / "features_icbhi_dataset.csv"
ICBHI_DIR = HERE.parent / "data" / "icbhi"
MODEL_PATH = HERE.parents[1] / "Backend" / "models" / "mejor_clasificador_icbhi.joblib"
SR = 16000
N_CYCLES = 60


def verify_extractor(rows, names):
    wavs = {p.stem: p for p in ICBHI_DIR.rglob("*.wav")}
    random.seed(0)
    errors, cache = [], {}
    for r in random.sample(rows, N_CYCLES):
        path = wavs.get(r["recording_name"])
        if path is None:
            continue
        if path not in cache:
            audio, _ = load_audio_normalized(path, target_sr=SR)
            cache[path] = butter_bandpass_filter(audio, 100.0, 2000.0, SR)
        seg = segment_cycle(cache[path], float(r["start_time"]), float(r["end_time"]), SR, 4.0)
        f = extract_cycle_features(seg, SR, 13)
        errors.append([abs(f[k] - float(r[k])) / (abs(float(r[k])) + 1e-6) for k in names])
    e = np.array(errors)
    return {"ciclos": int(len(e)), "error_relativo_mediano": float(np.median(e)),
            "error_relativo_p95": float(np.percentile(e, 95)), "error_relativo_maximo": float(e.max())}


def evaluate_model(rows):
    import joblib
    from sklearn.metrics import balanced_accuracy_score, confusion_matrix, roc_auc_score
    bundle = joblib.load(MODEL_PATH)
    names, pipe = bundle["feature_names"], bundle["pipeline"]
    train_p = {r["patient_id"] for r in rows if r["partition_suggested"] == "Entrenamiento"}
    out = {"modelo": bundle.get("best_model_name"), "pacientes_compartidos": len(
        train_p & {r["patient_id"] for r in rows if r["partition_suggested"] == "Validacion"})}
    for part in ("Entrenamiento", "Validacion"):
        sel = [r for r in rows if r["partition_suggested"] == part]
        x = np.array([[float(r[k]) for k in names] for r in sel], dtype=np.float32)
        y = np.array([int(r["is_abnormal"]) for r in sel])
        p = pipe.predict_proba(x)[:, 1]
        res = {"ciclos": int(len(y)), "pacientes": len({r["patient_id"] for r in sel}), "auc": float(roc_auc_score(y, p))}
        for thr in (0.30, 0.50):
            tn, fp, fn, tp = confusion_matrix(y, (p >= thr).astype(int)).ravel()
            res[f"umbral_{thr:.2f}"] = {"sensibilidad": tp / (tp + fn), "especificidad": tn / (tn + fp),
                                       "exactitud_balanceada": balanced_accuracy_score(y, (p >= thr).astype(int))}
        out[part] = res
    return out


def main():
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))
    names = [k for k in rows[0] if k.startswith(("rms", "zcr", "centroid", "rolloff", "mfcc"))]
    result = {"caracteristicas": len(names), "extractor": verify_extractor(rows, names), "modelo": evaluate_model(rows)}
    (HERE / "resultados_verificacion.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=float))
    print(json.dumps(result, ensure_ascii=False, indent=2, default=float))


if __name__ == "__main__":
    main()
