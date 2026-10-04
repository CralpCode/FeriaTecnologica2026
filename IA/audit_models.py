"""Auditoría reproducible de datos y pesos existentes, sin entrenamiento ni promoción.

Ejecutar desde la raíz: .venv/bin/python FeriaTecnologica2026/IA/audit_models.py
La semilla reconstruida no demuestra cuál fue el test original: no es validación externa.
"""
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
import platform

import numpy as np
import soundfile as sf
import torch
from sklearn.model_selection import StratifiedGroupKFold

from src import features as F
from src.data_loader import load, load_circor, DATA_DIR
from src.evaluate import clinical_metrics
from train_heart import split

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    torch.set_num_threads(2)
    recs = load("both")
    tr, va, te = split(recs, 42)
    path = ROOT.parent / "Backend" / "models" / "heart_cnn.pt"
    meta = json.loads(path.with_suffix(".json").read_text())
    model = torch.jit.load(str(path), map_location="cpu").eval()
    rows = []
    with torch.no_grad():
        for n, i in enumerate(te):
            r = recs[i]
            y, sr = sf.read(r.path, dtype="float32")
            quality = F.signal_quality(y)
            x = torch.from_numpy(F.features_from_audio(y, sr))
            p = float(torch.sigmoid(model(x)).mean())
            rows.append({"file": str(r.path.relative_to(DATA_DIR)), "group": r.group,
                         "source": r.source, "label": r.label, "score": p,
                         "sha256": sha(r.path), "quality": quality})
            if (n + 1) % 100 == 0:
                print(f"Evaluados {n + 1}/{len(te)} registros", flush=True)

    def metrics(rows):
        return clinical_metrics([r["label"] for r in rows], [r["score"] for r in rows], meta["umbral"])

    # Reconstruye también el split antiguo de soplos para auditar transferencia.
    mur = [r for r in load_circor() if r.label == 1]
    csv_path = next(DATA_DIR.glob("circor/**/training_data.csv"))
    with csv_path.open() as f:
        patients = {r["Patient ID"]: r for r in csv.DictReader(f)}
    from train_murmur import HEADS
    col, mapping = HEADS["momento"]
    classes = sorted(set(mapping.values()))
    strat = np.array([classes.index(mapping[patients[r.group[3:]][col]])
                      if patients[r.group[3:]][col] in mapping else 0 for r in mur])
    groups = np.array([r.group for r in mur])
    _, mur_test = next(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42).split(
        np.arange(len(mur)), strat, groups))
    exposed = {recs[i].group for i in tr} | {recs[i].group for i in va}
    mur_test_groups = set(groups[mur_test])

    validation = list(DATA_DIR.glob("validation*/*.wav"))
    train_hashes = {sha(r.path) for r in recs if r.source.startswith("physionet")}
    report = {
        "protocol": "Reevaluación retrospectiva; split reconstruido con seed=42, sin manifiesto original. No validación externa ni clínica.",
        "runtime": {"python": platform.python_version(), "torch": torch.__version__, "numpy": np.__version__},
        "model_sha256": sha(path), "metadata_sha256": sha(path.with_suffix(".json")),
        "extractor_sha256": sha(Path(F.__file__)), "threshold": meta["umbral"],
        "total_wav": len(list(DATA_DIR.rglob("*.wav"))),
        "records_eligible": len(recs), "records_by_source": dict(Counter(r.source for r in recs)),
        "split_records": {n: len(p) for n, p in zip(("train", "val", "test"), (tr, va, te))},
        "split_groups": {n: len({recs[i].group for i in p}) for n, p in zip(("train", "val", "test"), (tr, va, te))},
        "validation_directory": {"records": len(validation), "exact_duplicates_in_training": sum(sha(p) in train_hashes for p in validation)},
        "legacy_murmur_transfer": {"test_patients": len(mur_test_groups),
            "overlap_with_base_train_or_validation": len(mur_test_groups & exposed),
            "interpretation": "Reconstrucción del código/semilla por defecto, no historial certificado de entrenamiento."},
        "metrics_all": metrics(rows),
        "metrics_by_source": {s: metrics([r for r in rows if r["source"] == s]) for s in sorted({r["source"] for r in rows})},
        "quality": {"clipped_records": sum(r["quality"]["clipped"] for r in rows)},
        "records": rows,
    }
    out = ROOT / "docs" / "audit_results.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    print(json.dumps({k: v for k, v in report.items() if k != "records"}, indent=2, ensure_ascii=False))
    print(f"Guardado: {out}")


if __name__ == "__main__":
    main()
