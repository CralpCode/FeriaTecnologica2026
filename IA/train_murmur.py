"""
Caracterización del soplo (CirCor 2022): momento, intensidad, tono, calidad y forma.

Solo se entrena con grabaciones de focos donde el cardiólogo anotó soplo. Se parte del
extractor del modelo cardíaco ya entrenado (transfer learning), porque hay pocos pacientes.
NO identifica la causa del soplo: CirCor no trae diagnóstico por paciente (ver manual, sección 10).

Uso:
    python train_murmur.py                     # usa models/heart_cnn_both.pt como punto de partida
    python train_murmur.py --base models/heart_cnn_circor.pt

Salida: models/murmur_cnn.pt + models/murmur_cnn.json (clases, columnas, métricas y si se muestra en la app)
"""
import argparse
import csv
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import balanced_accuracy_score, f1_score, confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold
from torch import nn

from src.data_loader import load_circor, _circor_root
from src.model import MultiHeadCNN
from train_heart import compute_features, spec_augment

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"

# característica -> (columna de CirCor, {valor original: etiqueta en español})
HEADS = {
    "momento": ("Systolic murmur timing", {
        "Holosystolic": "holosistólico (toda la sístole)",
        "Early-systolic": "protosistólico (inicio de la sístole)",
        "Mid-systolic": "meso/telesistólico (mitad o final de la sístole)",
        "Late-systolic": "meso/telesistólico (mitad o final de la sístole)",
    }),
    "intensidad": ("Systolic murmur grading", {
        "I/VI": "leve (grado I/VI)",
        "II/VI": "moderado o mayor (grado II/VI o más)",
        "III/VI": "moderado o mayor (grado II/VI o más)",
    }),
    "tono": ("Systolic murmur pitch", {"Low": "grave", "Medium": "medio", "High": "agudo"}),
    "calidad": ("Systolic murmur quality", {"Harsh": "áspero", "Blowing": "soplante"}),
    "forma": ("Systolic murmur shape", {
        "Plateau": "en meseta (intensidad constante)",
        "Decrescendo": "decreciente",
        "Diamond": "romboidal (crece y decrece)",
    }),
}


def patient_labels() -> dict[str, dict[str, str]]:
    root = _circor_root()
    with open(root / "training_data.csv", newline="") as f:
        return {r["Patient ID"]: r for r in csv.DictReader(f) if r["Murmur"] == "Present"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=None, help="extractor con manifiesto de pacientes sin solapamiento con val/test; por defecto se entrena desde cero")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    rows = patient_labels()
    recs = [r for r in load_circor() if r.label == 1 and r.group[3:] in rows]
    classes = {h: sorted(set(m.values())) for h, (_, m) in HEADS.items()}
    # etiquetas por grabación y característica (-1 = sin dato / clase descartada)
    y = np.full((len(recs), len(HEADS)), -1, dtype=np.int64)
    for i, r in enumerate(recs):
        row = rows[r.group[3:]]
        for j, (h, (col, mapping)) in enumerate(HEADS.items()):
            v = mapping.get(row.get(col, ""))
            if v is not None:
                y[i, j] = classes[h].index(v)
    groups = np.array([r.group for r in recs])
    print(f"{len(recs)} grabaciones con soplo · {len(set(groups))} pacientes")

    feats = compute_features(recs, None, "sin_correccion")

    # Partición por paciente, estratificada por "momento" (la característica principal)
    strat = y[:, 0].copy()
    strat[strat < 0] = 0
    idx = np.arange(len(recs))
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=args.seed)
    trval, te = next(outer.split(idx, strat, groups))
    inner = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=args.seed + 1)
    tr_i, va_i = next(inner.split(trval, strat[trval], groups[trval]))
    tr, va = trval[tr_i], trval[va_i]
    assert not (set(groups[tr]) & set(groups[te])) and not (set(groups[va]) & set(groups[te]))
    print(f"particiones: train={len(tr)} val={len(va)} test={len(te)} grabaciones")

    sizes = [len(classes[h]) for h in HEADS]
    slices, start = {}, 0
    for h, k in zip(HEADS, sizes):
        slices[h] = (start, start + k)
        start += k

    model = MultiHeadCNN(sizes)
    if args.base:
        base_path = ROOT / args.base
        base_meta = json.loads(base_path.with_suffix(".json").read_text())
        manifest = base_meta.get("grupos_particiones")
        if not manifest:
            raise ValueError("El modelo base carece de manifiesto: no se puede descartar fuga de pacientes")
        exposed = set(manifest.get("train", [])) | set(manifest.get("val", []))
        if exposed & (set(groups[va]) | set(groups[te])):
            raise ValueError("El extractor ya vio pacientes de validación/prueba; use otro base o entrene desde cero")
        base = torch.jit.load(str(base_path), map_location="cpu").state_dict()
        model.features.load_state_dict({k[len("features."):]: v for k, v in base.items() if k.startswith("features.")})
    model.to(device)

    x_tr = torch.from_numpy(np.concatenate([feats[i] for i in tr]))
    y_tr = torch.from_numpy(np.concatenate([np.repeat(y[i:i + 1], len(feats[i]), 0) for i in tr]))
    # pesos por clase para compensar el desbalance
    losses = []
    for j, h in enumerate(HEADS):
        counts = np.bincount(y_tr[:, j][y_tr[:, j] >= 0].numpy(), minlength=sizes[j]).astype(float)
        w = torch.tensor(counts.sum() / (len(counts) * np.maximum(counts, 1)), dtype=torch.float32, device=device)
        losses.append(nn.CrossEntropyLoss(weight=w, ignore_index=-1))

    opt = torch.optim.AdamW([
        {"params": model.features.parameters(), "lr": 2e-4},   # extractor ya entrenado: ajuste suave
        {"params": list(model.pool.parameters()) + list(model.heads.parameters()), "lr": 1e-3},
    ], weight_decay=1e-4)

    @torch.no_grad()
    def predict(idxs):
        model.eval()
        out = {h: [] for h in HEADS}
        for i in idxs:
            logits = model(torch.from_numpy(feats[i]).to(device)).cpu()
            for h, (a, b) in slices.items():
                out[h].append(torch.softmax(logits[:, a:b], dim=1).mean(0).numpy())
        return {h: np.stack(v) for h, v in out.items()}

    def score(idxs):
        probs = predict(idxs)
        res = {}
        for j, h in enumerate(HEADS):
            mask = y[idxs, j] >= 0
            yt, yp = y[idxs, j][mask], probs[h][mask].argmax(1)
            res[h] = {
                "n": int(mask.sum()),
                "exactitud_balanceada": float(balanced_accuracy_score(yt, yp)) if mask.any() else float("nan"),
                "f1_macro": float(f1_score(yt, yp, average="macro")) if mask.any() else float("nan"),
                "azar": 1.0 / sizes[j],
                "matriz_confusion": confusion_matrix(yt, yp, labels=list(range(sizes[j]))).tolist(),
            }
        return res

    best, best_state, bad = -1.0, None, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(len(x_tr))
        for s in range(0, len(perm), 32):
            b = perm[s:s + 32]
            logits = model(spec_augment(x_tr[b]).to(device))
            yb = y_tr[b].to(device)
            valid_losses = [losses[j](logits[:, a:c], yb[:, j])
                            for j, (a, c) in enumerate(slices.values()) if (yb[:, j] >= 0).any()]
            if not valid_losses:
                continue
            loss = sum(valid_losses)
            opt.zero_grad()
            loss.backward()
            opt.step()
        val = score(va)
        mean_ba = float(np.mean([v["exactitud_balanceada"] for v in val.values()]))
        print(f"época {epoch:2d} · val exactitud balanceada media {mean_ba:.3f} · " +
              " ".join(f"{h}={v['exactitud_balanceada']:.2f}" for h, v in val.items()))
        if mean_ba > best:
            best, bad = mean_ba, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= args.patience:
                print("parada temprana")
                break

    model.load_state_dict(best_state)
    validation = score(va)
    # Toda decisión se fija con validación ANTES de consultar test.
    visible = {h: m["exactitud_balanceada"] >= max(0.6, m["azar"] + 0.15)
               for h, m in validation.items()}
    test = score(te)
    print("\n=== PRUEBA (pacientes nunca vistos) ===")
    heads_meta = {}
    for h, m in test.items():
        # Solo se muestra en la app si supera claramente al azar
        show = visible[h]
        a, b = slices[h]
        heads_meta[h] = {"columnas": [a, b], "clases": classes[h], "mostrar": bool(show),
                         "metricas_validacion": validation[h], "metricas_prueba": m}
        print(f"{h:11s} exactitud balanceada {m['exactitud_balanceada']:.2f} (azar {m['azar']:.2f}) "
              f"F1 {m['f1_macro']:.2f} n={m['n']} -> {'se muestra' if show else 'NO se muestra'}")

    MODELS.mkdir(exist_ok=True)
    model = model.cpu().eval()
    torch.jit.trace(model, torch.from_numpy(feats[te[0]][:1])).save(str(MODELS / "murmur_cnn.pt"))
    meta = {
        "modelo": "MultiHeadCNN",
        "tarea": "caracterización de soplos sistólicos (CirCor 2022)",
        "entrenado": datetime.now().isoformat(timespec="seconds"),
        "base": args.base,
        "seed": args.seed,
        "validacion_independiente": True,
        "validado_dispositivo": False,
        "grupos_particiones": {name: sorted(set(groups[part])) for name, part in
                               zip(("train", "val", "test"), (tr, va, te))},
        "pacientes": int(len(set(groups))),
        "particiones": {"train": int(len(tr)), "val": int(len(va)), "test": int(len(te))},
        "caracteristicas": heads_meta,
        "limitaciones": [
            "Describe el soplo (momento, intensidad, tono, calidad, forma); no identifica su causa.",
            "Solo soplos sistólicos: CirCor tiene muy pocos diastólicos para entrenar.",
            f"Entrenado con {len(set(groups))} pacientes: resultados orientativos.",
        ],
    }
    (MODELS / "murmur_cnn.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print("\nModelo guardado en models/murmur_cnn.pt")


if __name__ == "__main__":
    main()
