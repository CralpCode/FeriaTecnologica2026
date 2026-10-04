"""
Modelos de PULMÓN con ICBHI 2017.

  --task ruidos      Detecta crepitantes y sibilancias por ciclo respiratorio (B).
  --task enfermedad  Patrón de la grabación compatible con: sano, EPOC, neumonía, bronquiectasia,
                     bronquiolitis o infección respiratoria (C). Es una SUGERENCIA, no un diagnóstico.

Uso (cuando los audios estén en data/):
    python train_lung.py --task ruidos
    python train_lung.py --task enfermedad

Partición: la oficial de ICBHI por paciente (ningún paciente cruza entre train y test).
Salida: models/lung_sounds_cnn.(pt|json) o models/lung_disease_cnn.(pt|json)
"""
import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, recall_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from torch import nn

from src import lung_features as LF
from src.lung_data import DATA_DIR, DISEASE_GROUPS, MOVED_TO_TEST, load_icbhi
from src.model import HeartCNN
from train_heart import spec_augment

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data" / "cache"
MODELS = ROOT / "models"
SOUND_LABELS = ["crepitantes", "sibilancias"]


def cached(key: str, fn):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"lung_{hashlib.md5(key.encode()).hexdigest()}.npy"
    if f.exists():
        return np.load(f)
    x = fn()
    np.save(f, x)
    return x


def read(path):
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    return y, sr


def split_train_val(groups: np.ndarray, idx: np.ndarray, seed: int):
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
    a, b = next(gss.split(idx, groups=groups[idx]))
    return idx[a], idx[b]


def train_loop(model, x_tr, y_tr, loss_fn, val_fn, epochs, patience, device):
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    best, best_state, bad = -1.0, None, 0
    for epoch in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(len(x_tr))
        for s in range(0, len(perm), 64):
            b = perm[s:s + 64]
            loss = loss_fn(model(spec_augment(x_tr[b]).to(device)), y_tr[b].to(device))
            opt.zero_grad()
            loss.backward()
            opt.step()
        v = val_fn()
        print(f"época {epoch:2d} · validación {v:.3f}")
        if v > best:
            best, bad = v, 0
            best_state = {k: t.detach().cpu().clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                print("parada temprana")
                break
    model.load_state_dict(best_state)
    return model


def youden(y, p):
    best_t, best_j = 0.5, -1
    for t in np.unique(p):
        pred = p >= t
        se = (pred & (y == 1)).sum() / max(1, (y == 1).sum())
        sp = (~pred & (y == 0)).sum() / max(1, (y == 0).sum())
        if se + sp - 1 > best_j:
            best_t, best_j = float(t), se + sp - 1
    return best_t


# ---------------------------------------------------------------------------
# B. Crepitantes y sibilancias (por ciclo respiratorio)
# ---------------------------------------------------------------------------
def task_sounds(recs, args, device):
    xs, ys, groups, splits = [], [], [], []
    for r in recs:
        if not r.cycles:
            continue
        x = cached(f"{r.path}|ciclos", lambda: LF.features_from_cycles(*read(r.path), [(a, b) for a, b, _, _ in r.cycles]))
        for k, (_, _, c, w) in enumerate(r.cycles):
            xs.append(x[k]); ys.append([c, w]); groups.append(r.patient); splits.append(r.split)
    X = torch.from_numpy(np.stack(xs))
    Y = np.array(ys, dtype=np.float32)
    groups, splits = np.array(groups), np.array(splits)
    print(f"{len(X)} ciclos · crepitantes {int(Y[:, 0].sum())} · sibilancias {int(Y[:, 1].sum())} · "
          f"{len(set(groups))} pacientes")

    te = np.where(splits == "test")[0]
    tr, va = split_train_val(groups, np.where(splits == "train")[0], args.seed)

    model = HeartCNN(n_outputs=2).to(device)
    pos = torch.tensor((len(Y[tr]) - Y[tr].sum(0)) / np.maximum(Y[tr].sum(0), 1), device=device)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos)

    @torch.no_grad()
    def probs(idx):
        model.eval()
        return torch.cat([torch.sigmoid(model(X[idx[i:i + 256]].to(device))).cpu()
                          for i in range(0, len(idx), 256)]).numpy()

    def val_fn():
        p = probs(va)
        return float(np.mean([roc_auc_score(Y[va, j], p[:, j]) for j in range(2) if len(set(Y[va, j])) > 1]))

    model = train_loop(model, X[tr], torch.from_numpy(Y[tr]), loss_fn, val_fn, args.epochs, args.patience, device)
    pv, pt = probs(va), probs(te)
    thr = [youden(Y[va, j], pv[:, j]) for j in range(2)]
    metrics = {}
    for j, name in enumerate(SOUND_LABELS):
        vy, vp = Y[va, j], pv[:, j] >= thr[j]
        val_auc = float(roc_auc_score(vy, pv[:, j])) if len(set(vy)) > 1 else 0.0
        val_se = float(recall_score(vy, vp, zero_division=0))
        yt, pred = Y[te, j], pt[:, j] >= thr[j]
        metrics[name] = {
            "sensibilidad": float(recall_score(yt, pred, zero_division=0)),
            "especificidad": float(recall_score(1 - yt, ~pred, zero_division=0)),
            "auc": float(roc_auc_score(yt, pt[:, j])) if len(set(yt)) > 1 else float("nan"),
            "umbral": thr[j],
            "n_positivos": int(yt.sum()),
            "mostrar": bool(val_auc >= 0.7 and val_se >= 0.5),
            "criterio_mostrar": "AUC y sensibilidad exclusivamente en validación",
            "validacion": {"auc": val_auc, "sensibilidad": val_se},
        }
    # Puntaje oficial ICBHI (4 clases por ciclo)
    true4 = (Y[te, 0] * 1 + Y[te, 1] * 2).astype(int)
    pred4 = ((pt[:, 0] >= thr[0]) * 1 + (pt[:, 1] >= thr[1]) * 2).astype(int)
    se = float(np.mean(pred4[true4 > 0] == true4[true4 > 0])) if (true4 > 0).any() else float("nan")
    sp = float(np.mean(pred4[true4 == 0] == 0)) if (true4 == 0).any() else float("nan")
    metrics["icbhi"] = {"sensibilidad": se, "especificidad": sp, "puntaje": (se + sp) / 2}
    metrics["icbhi"]["mostrar"] = True
    return model, X[te[:1]], {
        "tarea": "crepitantes y sibilancias (ICBHI 2017)",
        "salidas": SOUND_LABELS,
        "metricas_prueba": metrics,
        "agregacion": "promedio de las 2 ventanas más altas de la grabación",
        "validado_grabacion_sin_segmentacion": False,
        "advertencia_agregacion": "Métricas por ciclo anotado; no validan ventanas sin segmentación ni la agregación del servidor",
        "particiones": {"train": int(len(tr)), "val": int(len(va)), "test": int(len(te))},
    }


# ---------------------------------------------------------------------------
# C. Patrón compatible con enfermedad (por grabación / paciente)
# ---------------------------------------------------------------------------
def task_disease(recs, args, device):
    recs = [r for r in recs if r.diagnosis in DISEASE_GROUPS]
    classes = sorted(set(DISEASE_GROUPS[r.diagnosis] for r in recs))
    print("pacientes por clase:", dict(Counter(DISEASE_GROUPS[r.diagnosis] for r in {r.patient: r for r in recs}.values())))
    feats = [cached(f"{r.path}|ventanas", lambda r=r: LF.features_from_audio(*read(r.path))) for r in recs]
    labels = np.array([classes.index(DISEASE_GROUPS[r.diagnosis]) for r in recs])
    groups = np.array([r.patient for r in recs])
    splits = np.array([r.split for r in recs])

    te = np.where(splits == "test")[0]
    tr, va = split_train_val(groups, np.where(splits == "train")[0], args.seed)
    x_tr = torch.from_numpy(np.concatenate([feats[i] for i in tr]))
    y_tr = torch.from_numpy(np.concatenate([np.full(len(feats[i]), labels[i]) for i in tr]))

    model = HeartCNN(n_outputs=len(classes)).to(device)
    counts = np.bincount(y_tr.numpy(), minlength=len(classes)).astype(float)
    w = torch.tensor(counts.sum() / (len(classes) * np.maximum(counts, 1)), dtype=torch.float32, device=device)
    loss_fn = nn.CrossEntropyLoss(weight=w)

    @torch.no_grad()
    def patient_probs(idx):
        """Probabilidad por PACIENTE = promedio de sus grabaciones (cada una, promedio de ventanas)."""
        model.eval()
        per = {}
        for i in idx:
            p = torch.softmax(model(torch.from_numpy(feats[i]).to(device)), 1).mean(0).cpu().numpy()
            per.setdefault(groups[i], []).append(p)
        pids = sorted(per)
        y = np.array([labels[np.where(groups == pid)[0][0]] for pid in pids])
        return y, np.stack([np.mean(per[pid], 0) for pid in pids])

    def val_fn():
        y, p = patient_probs(va)
        return float(balanced_accuracy_score(y, p.argmax(1)))

    model = train_loop(model, x_tr, y_tr, loss_fn, val_fn, args.epochs, args.patience, device)
    yv, pv = patient_probs(va)
    val_bal = float(balanced_accuracy_score(yv, pv.argmax(1)))
    val_recalls = recall_score(yv, pv.argmax(1), labels=list(range(len(classes))), average=None, zero_division=0)
    visible = {k: bool(val_recalls[k] >= 0.5 and (yv == k).sum() >= 2) for k in range(len(classes))}
    y, p = patient_probs(te)
    pred = p.argmax(1)
    recalls = recall_score(y, pred, labels=list(range(len(classes))), average=None, zero_division=0)
    present = set(y.tolist())
    per_class = {c: {"sensibilidad": float(recalls[k]), "pacientes_prueba": int((y == k).sum()),
                     "mostrar": visible[k], "sensibilidad_validacion": float(val_recalls[k]),
                     "pacientes_validacion": int((yv == k).sum())}
                 for k, c in enumerate(classes)}
    bal = float(balanced_accuracy_score(y, pred))
    return model, torch.from_numpy(feats[te[0]][:1]), {
        "tarea": "patrón respiratorio compatible con enfermedad (ICBHI 2017)",
        "clases": classes,
        "metricas_prueba": {
            "exactitud_balanceada_pacientes": bal,
            "azar": 1 / len(classes),
            "pacientes_prueba": int(len(y)),
            "por_clase": per_class,
            "matriz_confusion": confusion_matrix(y, pred, labels=list(range(len(classes)))).tolist(),
        },
        "mostrar": bool(val_bal >= max(0.5, 1 / len(classes) + 0.15)),
        "criterio_mostrar": "Exclusivamente validación; test no decide salidas",
        "metricas_validacion": {"exactitud_balanceada_pacientes": val_bal},
        "validado_grabacion_individual": False,
        "particiones": {"train": int(len(tr)), "val": int(len(va)), "test": int(len(te))},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True, choices=["ruidos", "enfermedad"])
    ap.add_argument("--data-dir", default=str(DATA_DIR))
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=None, help="nombre del modelo (por defecto lung_sounds_cnn / lung_disease_cnn)")
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    recs = load_icbhi(Path(args.data_dir), overlap_to_test=True)
    if not recs:
        raise SystemExit("No se encontraron audios de ICBHI (nombres tipo 101_1b1_Al_sc_Meditron.wav) en "
                         f"{args.data_dir}. Descárgalos y colócalos en cualquier subcarpeta de data/.")
    print(f"{len(recs)} grabaciones ICBHI · {len({r.patient for r in recs})} pacientes")

    model, example, meta = (task_sounds if args.task == "ruidos" else task_disease)(recs, args, device)
    out = args.out or ("lung_sounds_cnn" if args.task == "ruidos" else "lung_disease_cnn")
    meta.update({
        "entrenado": datetime.now().isoformat(timespec="seconds"),
        "seed": args.seed,
        "probability_kind": "uncalibrated_model_score",
        "particion": {"fuente": "oficial ICBHI 2017", "pacientes_en_ambos_lados_movidos_a_prueba": list(MOVED_TO_TEST)},
        "validado_dispositivo": False,
        "features": {k: getattr(LF, k) for k in
                     ["TARGET_SR", "BAND_HZ", "WINDOW_S", "HOP_S", "N_FFT", "HOP_LENGTH", "N_MELS", "FMIN", "FMAX"]},
        "limitaciones": [
            "Sugerencia de tamizaje, no diagnóstico.",
            "ICBHI tiene pocos pacientes en varias clases; resultados orientativos.",
            "Validado con grabaciones de estetoscopios clínicos, no con el dispositivo propio.",
        ],
    })
    print("\n=== PRUEBA (pacientes nunca vistos) ===")
    print(json.dumps(meta["metricas_prueba"], indent=2, ensure_ascii=False))
    MODELS.mkdir(exist_ok=True)
    model = model.cpu().eval()
    torch.jit.trace(model, example).save(str(MODELS / f"{out}.pt"))
    (MODELS / f"{out}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"\nModelo guardado en models/{out}.pt")


if __name__ == "__main__":
    main()
