"""
Entrena la CNN de audio cardíaco (normal vs anormal/soplo) y la exporta para el servidor.

Uso:
    python train_heart.py --dataset physionet
    python train_heart.py --dataset circor
    python train_heart.py --dataset both --ir acoustic_correction/out/h_rama_b.npy

Salida en models/:
    heart_cnn.pt    modelo TorchScript (lo carga el backend)
    heart_cnn.json  umbral, parámetros de features y métricas en prueba
"""
import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import fftconvolve
from sklearn.model_selection import StratifiedGroupKFold
from torch import nn

from src import features as F
from src.data_loader import load
from src.evaluate import clinical_metrics, pick_threshold, leakage_warning
from src.model import HeartCNN

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data" / "cache"
MODELS = ROOT / "models"


def compute_features(recs, ir: np.ndarray | None, ir_tag: str):
    """Extrae (y cachea) las ventanas log-mel de cada grabación."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out = []
    for i, r in enumerate(recs):
        key = hashlib.md5(f"{r.path}|{ir_tag}|{F.TARGET_SR}|{F.N_MELS}|{F.WINDOW_S}".encode()).hexdigest()
        cf = CACHE / f"{key}.npy"
        if cf.exists():
            x = np.load(cf)
        else:
            y, sr = sf.read(r.path, dtype="float32", always_2d=False)
            if ir is not None:
                # Corrección acústica: simula que el audio clínico fue grabado con nuestro dispositivo.
                pre = F.preprocess(y, sr)
                y = fftconvolve(pre, ir, mode="full")[: len(pre)]
                sr = F.TARGET_SR
            x = F.features_from_audio(y, sr)
            np.save(cf, x)
        out.append(x)
        if (i + 1) % 500 == 0:
            print(f"  features {i + 1}/{len(recs)}")
    return out


def split(recs, seed: int):
    """Train / val / test estratificado y agrupado por paciente: ningún paciente cruza particiones."""
    y = np.array([r.label for r in recs])
    g = np.array([r.group for r in recs])
    idx = np.arange(len(recs))
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed)
    trval, test = next(outer.split(idx, y, g))
    inner = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed + 1)
    tr, va = next(inner.split(trval, y[trval], g[trval]))
    parts = trval[tr], trval[va], test
    groups = [set(g[p]) for p in parts]
    assert not (groups[0] & groups[1]) and not (groups[0] & groups[2]) and not (groups[1] & groups[2]), \
        "Fuga: un paciente aparece en dos particiones"
    return parts


def windows(feats, labels, idx):
    xs, ys = [], []
    for i in idx:
        xs.append(feats[i])
        ys.append(np.full(len(feats[i]), labels[i], dtype=np.float32))
    return torch.from_numpy(np.concatenate(xs)), torch.from_numpy(np.concatenate(ys))


def spec_augment(x: torch.Tensor) -> torch.Tensor:
    """Enmascara bandas de frecuencia y tiempo al azar + ganancia aleatoria (solo entrenamiento)."""
    x = x.clone()
    b, _, nf, nt = x.shape
    for k in range(b):
        f0 = np.random.randint(0, nf - 6)
        x[k, :, f0:f0 + np.random.randint(0, 6)] = 0
        t0 = np.random.randint(0, nt - 16)
        x[k, :, :, t0:t0 + np.random.randint(0, 16)] = 0
    return x * (1 + 0.1 * torch.randn(b, 1, 1, 1))


@torch.no_grad()
def record_probs(model, feats, idx, device):
    """Probabilidad por grabación = media de las probabilidades de sus ventanas."""
    model.eval()
    probs = []
    for i in idx:
        x = torch.from_numpy(feats[i]).to(device)
        probs.append(torch.sigmoid(model(x)).mean().item())
    return np.array(probs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="physionet", choices=["physionet", "circor", "both"])
    ap.add_argument("--ir", default=None, help="respuesta al impulso .npy del dispositivo (corrección acústica)")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--min-sensitivity", type=float, default=0.85)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="heart_cnn")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    recs = load(args.dataset)
    if not recs:
        raise SystemExit(f"No se encontraron audios para '{args.dataset}'.")
    labels = np.array([r.label for r in recs])
    print(f"{len(recs)} grabaciones · {labels.sum()} anormales · {len({r.group for r in recs})} pacientes/grupos")

    ir = np.load(args.ir).astype(np.float32) if args.ir else None
    ir_tag = Path(args.ir).stem if args.ir else "sin_correccion"
    feats = compute_features(recs, ir, ir_tag)

    tr, va, te = split(recs, args.seed)
    print(f"particiones (grabaciones): train={len(tr)} val={len(va)} test={len(te)}")
    x_tr, y_tr = windows(feats, labels, tr)

    model = HeartCNN().to(device)
    pos_weight = torch.tensor([(y_tr == 0).sum().item() / max(1, (y_tr == 1).sum().item())], device=device)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    best_auc, best_state, bad = -1.0, None, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(len(x_tr))
        total = 0.0
        for s in range(0, len(perm), 64):
            b = perm[s:s + 64]
            xb = spec_augment(x_tr[b]).to(device)
            yb = y_tr[b].to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            opt.step()
            total += loss.item() * len(b)
        sched.step()
        val = clinical_metrics(labels[va], record_probs(model, feats, va, device))
        print(f"época {epoch:2d} · pérdida {total / len(perm):.4f} · val AUC {val['auc']:.3f} "
              f"Se {val['sensibilidad']:.2f} Sp {val['especificidad']:.2f}")
        if val["auc"] > best_auc:
            best_auc, bad = val["auc"], 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= args.patience:
                print("parada temprana")
                break

    model.load_state_dict(best_state)
    thr = pick_threshold(labels[va], record_probs(model, feats, va, device), args.min_sensitivity)
    test = clinical_metrics(labels[te], record_probs(model, feats, te, device), thr)
    warn = leakage_warning(test)

    print("\n=== PRUEBA (pacientes nunca vistos) ===")
    print(json.dumps(test, indent=2, ensure_ascii=False))
    if warn:
        print("ADVERTENCIA:", warn)

    MODELS.mkdir(exist_ok=True)
    model = model.cpu().eval()
    example = torch.from_numpy(feats[te[0]][:1])
    torch.jit.trace(model, example).save(str(MODELS / f"{args.out}.pt"))
    meta = {
        "modelo": "HeartCNN",
        "tarea": "audio cardíaco normal (0) vs anormal/soplo (1)",
        "dataset": args.dataset,
        "correccion_acustica": ir_tag,
        "entrenado": datetime.now().isoformat(timespec="seconds"),
        "umbral": thr,
        "criterio_umbral": f"sensibilidad >= {args.min_sensitivity} en validación",
        "features": {k: getattr(F, k) for k in
                     ["TARGET_SR", "BAND_HZ", "WINDOW_S", "HOP_S", "N_FFT", "HOP_LENGTH", "N_MELS", "FMIN", "FMAX"]},
        "particiones": {"train": int(len(tr)), "val": int(len(va)), "test": int(len(te))},
        "metricas_prueba": test,
        "advertencia": warn,
        "limitaciones": [
            "Tamizaje: no diagnostica; sugiere referir a ecocardiograma.",
            "PhysioNet 2016 no publica ID de paciente: la partición es por registro.",
            "Validado solo con datasets públicos, no con pacientes.",
        ],
    }
    (MODELS / f"{args.out}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"\nModelo guardado en models/{args.out}.pt")


if __name__ == "__main__":
    main()
