"""
Calibra el modelo de ruidos pulmonares para GRABACIONES COMPLETAS (como las del ESP32).

train_lung.py elige el umbral por ciclo respiratorio, pero el servidor analiza la grabación entera
(promedio de sus 2 ventanas más altas). Este script calcula ese mismo puntaje por grabación, elige un
umbral con los pacientes de validación y mide el resultado con los pacientes de prueba. Guarda
"umbral_grabacion" y sus métricas en models/lung_sounds_cnn.json.

Uso:
    python calibrar_pulmon.py
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from sklearn.metrics import roc_auc_score

from src import lung_features as LF
from src.lung_data import load_icbhi
from train_lung import SOUND_LABELS, cached, split_train_val, youden

ROOT = Path(__file__).resolve().parent


def recording_score(model, path) -> np.ndarray:
    x = cached(f"{path}|ventanas", lambda: LF.features_from_audio(*sf.read(str(path), dtype="float32")))
    with torch.no_grad():
        p = torch.sigmoid(model(torch.from_numpy(x))).numpy()
    k = min(2, len(p))
    return np.sort(p, axis=0)[-k:].mean(0)          # misma agregación que Backend/ml/lung.py


def metrics(y, s, t):
    pred = s >= t
    se = (pred & (y == 1)).sum() / max(1, (y == 1).sum())
    sp = (~pred & (y == 0)).sum() / max(1, (y == 0).sum())
    return {"sensibilidad": float(se), "especificidad": float(sp),
            "auc": float(roc_auc_score(y, s)) if len(set(y)) > 1 else float("nan"),
            "grabaciones": int(len(y)), "positivas": int(y.sum())}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="lung_sounds_cnn")
    name = ap.parse_args().model
    META = ROOT / "models" / f"{name}.json"
    model = torch.jit.load(str(ROOT / "models" / f"{name}.pt"), map_location="cpu").eval()
    meta = json.loads(META.read_text())
    recs = [r for r in load_icbhi(overlap_to_test=True) if r.cycles]
    groups = np.array([r.patient for r in recs])
    train_idx = np.array([i for i, r in enumerate(recs) if r.split == "train"])
    _, va = split_train_val(groups, train_idx, 42)           # misma validación que en el entrenamiento
    te = np.array([i for i, r in enumerate(recs) if r.split == "test"])

    print(f"Puntuando {len(va)} grabaciones de validación y {len(te)} de prueba…")
    scores = {i: recording_score(model, recs[i].path) for i in np.concatenate([va, te])}
    for j, name in enumerate(SOUND_LABELS):
        label = lambda idx: np.array([int(any(c[2 + j] for c in recs[i].cycles)) for i in idx])
        sv, st = np.array([scores[i][j] for i in va]), np.array([scores[i][j] for i in te])
        t = youden(label(va), sv)
        m = metrics(label(te), st, t)
        m["mostrar"] = bool(m["auc"] >= 0.7 and m["sensibilidad"] >= 0.5 and m["especificidad"] >= 0.5)
        meta["metricas_prueba"][name]["umbral_grabacion"] = t
        meta["metricas_prueba"][name]["grabacion_completa"] = m
        print(f"{name:12s} umbral {t:.3f} · prueba: detecta {m['sensibilidad']:.0%}, normales {m['especificidad']:.0%}, "
              f"AUC {m['auc']:.2f} -> {'se muestra' if m['mostrar'] else 'NO se muestra'}")
    META.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"\nGuardado en {META}. Copia el .json a Backend/models/.")


if __name__ == "__main__":
    main()
