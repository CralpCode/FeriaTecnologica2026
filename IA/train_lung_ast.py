"""
Crepitantes y sibilancias con un modelo de audio PREENTRENADO (AST, Audio Spectrogram Transformer, AudioSet).

Mismo objetivo y mismas métricas que train_lung.py --task ruidos (red pequeña entrenada desde cero), para comparar:
  - Partición oficial de ICBHI por paciente; validación separada por paciente dentro de train.
  - Por ciclo: sensibilidad, especificidad, AUC y puntaje oficial ICBHI (4 clases).
  - Por grabación completa (como el servidor: ventanas de 5.12 s, promedio de las 2 más altas), con el
    umbral elegido en validación, igual que calibrar_pulmon.py.

Entrada del modelo: fbank Kaldi de 128 bandas a 16 kHz, 512 cuadros (5.12 s), normalizado como AST.
El servidor calcula exactamente lo mismo con torchaudio (Backend/ml/lung.py), sin depender de transformers.

Uso:
    python train_lung_ast.py --smoke      # prueba rápida del flujo (pocos ciclos, 1 época)
    python train_lung_ast.py              # entrenamiento completo (horas, en MPS)
Salida: models/lung_sounds_ast.(pt|json). No reemplaza al modelo actual: se publica solo si mejora.

Partición oficial: data/icbhi/ICBHI_challenge_train_test.txt (539 train / 381 test). El sitio del reto tiene un
certificado HTTPS defectuoso; se usó la copia del repositorio de Patch-Mix (Bae et al., Interspeech 2023),
data/icbhi_dataset/official_split.txt, verificada con esos totales. La lista oficial pone a los pacientes 156 y
218 en ambos lados: con load_icbhi(overlap_to_test=True) quedan completos en prueba (sin fuga).
El .pt (343 MB) no se sube a GitHub (límite de 100 MB): se regenera con este script en ~20 min en MPS.
"""
import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio
from sklearn.metrics import recall_score, roc_auc_score
from torch import nn

from src.lung_data import MOVED_TO_TEST, load_icbhi
from train_lung import SOUND_LABELS, split_train_val, youden

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
CACHE = ROOT / "data" / "cache"
PRETRAINED = "MIT/ast-finetuned-audioset-10-10-0.4593"

SR = 16000
FRAMES = 512                 # 5.12 s (desplazamiento de 10 ms)
SEG_S = FRAMES / 100
WIN_HOP_S = SEG_S / 2        # ventanas del servidor: 5.12 s con salto de 2.56 s
AST_MEAN, AST_STD = -4.2677393, 4.5689974   # normalización de AST (AudioSet)


def fbank(wave: torch.Tensor) -> torch.Tensor:
    """(muestras,) a 16 kHz -> (FRAMES, 128) normalizado como AST. Igual en el servidor."""
    w = wave - wave.mean()
    fb = torchaudio.compliance.kaldi.fbank(w.unsqueeze(0), htk_compat=True, sample_frequency=SR, use_energy=False,
                                           window_type="hanning", num_mel_bins=128, dither=0.0, frame_shift=10)
    n = fb.shape[0]
    fb = fb[:FRAMES] if n >= FRAMES else torch.nn.functional.pad(fb, (0, 0, 0, FRAMES - n))
    return (fb - AST_MEAN) / (AST_STD * 2)


def load_16k(path: Path) -> np.ndarray:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"ast16k_{path.stem}.npy"
    if f.exists():
        return np.load(f)
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(1)
    y = torchaudio.functional.resample(torch.from_numpy(y), sr, SR).numpy().astype(np.float32)
    np.save(f, y)
    return y


def fit_length(seg: np.ndarray, rng: np.random.Generator | None) -> np.ndarray:
    """Recorta (al azar en entrenamiento, al centro en evaluación) o repite el ciclo hasta 5.12 s."""
    n = int(SEG_S * SR)
    if len(seg) == 0:
        return np.zeros(n, np.float32)
    if len(seg) >= n:
        start = int(rng.integers(0, len(seg) - n + 1)) if rng is not None else (len(seg) - n) // 2
        return seg[start:start + n]
    reps = int(np.ceil(n / len(seg)))
    return np.tile(seg, reps)[:n]


def spec_augment(x: torch.Tensor, rng: np.random.Generator) -> torch.Tensor:
    x = x.clone()
    for _ in range(2):
        t = int(rng.integers(0, 48)); t0 = int(rng.integers(0, FRAMES - t + 1)); x[t0:t0 + t, :] = 0
        f = int(rng.integers(0, 24)); f0 = int(rng.integers(0, 128 - f + 1)); x[:, f0:f0 + f] = 0
    return x


class LungAST(nn.Module):
    """AST con posiciones recortadas a 512 cuadros y cabeza de 2 salidas (logits)."""

    def __init__(self):
        super().__init__()
        from transformers import ASTConfig, ASTForAudioClassification
        full = ASTForAudioClassification.from_pretrained(PRETRAINED)
        cfg = ASTConfig.from_pretrained(PRETRAINED, max_length=FRAMES, num_labels=2, torchscript=True)
        model = ASTForAudioClassification(cfg)
        state = full.state_dict()
        # Posiciones: [cls, dist, f_dim x t_dim]; se recorta el eje del tiempo (como el AST original)
        pos = state["audio_spectrogram_transformer.embeddings.position_embeddings"]
        f_dim, t_full = 12, (1024 - 16) // 10 + 1
        t_new = (FRAMES - 16) // 10 + 1
        grid = pos[:, 2:].reshape(1, f_dim, t_full, -1)[:, :, :t_new].reshape(1, f_dim * t_new, -1)
        state["audio_spectrogram_transformer.embeddings.position_embeddings"] = torch.cat([pos[:, :2], grid], 1)
        state = {k: v for k, v in state.items() if not k.startswith("classifier.")}
        missing, _ = model.load_state_dict(state, strict=False)
        assert all(k.startswith("classifier.") for k in missing), missing
        self.ast = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:   # x: (N, 512, 128)
        return self.ast(x)[0]


def build_cycles(recs):
    items = []      # (índice de grabación, ini, fin, crep, sib)
    for i, r in enumerate(recs):
        for a, b, c, w in r.cycles:
            items.append((i, a, b, c, w))
    return items


def cycle_batch(items, idx, audio, rng, augment):
    xs, ys = [], []
    for k in idx:
        i, a, b, c, w = items[k]
        y = audio[i]
        seg = y[int(a * SR):int(b * SR)]
        x = fbank(torch.from_numpy(fit_length(seg, rng if augment else None)))
        xs.append(spec_augment(x, rng) if augment else x)
        ys.append([c, w])
    return torch.stack(xs), torch.tensor(ys, dtype=torch.float32)


@torch.no_grad()
def predict(model, items, idx, audio, device, bs=32):
    model.eval()
    out = []
    for s in range(0, len(idx), bs):
        x, _ = cycle_batch(items, idx[s:s + bs], audio, None, False)
        out.append(torch.sigmoid(model(x.to(device))).cpu())
    return torch.cat(out).numpy()


def icbhi_score(y, p, thr):
    true4 = (y[:, 0] * 1 + y[:, 1] * 2).astype(int)
    pred4 = ((p[:, 0] >= thr[0]) * 1 + (p[:, 1] >= thr[1]) * 2).astype(int)
    se = float(np.mean(pred4[true4 > 0] == true4[true4 > 0])) if (true4 > 0).any() else float("nan")
    sp = float(np.mean(pred4[true4 == 0] == 0)) if (true4 == 0).any() else float("nan")
    return se, sp, (se + sp) / 2


@torch.no_grad()
def recording_score(model, y16k, device):
    """Igual que el servidor: ventanas de 5.12 s con salto de 2.56 s y promedio de las 2 más altas."""
    model.eval()
    n, hop = int(SEG_S * SR), int(WIN_HOP_S * SR)
    starts = list(range(0, max(1, len(y16k) - n + 1), hop)) or [0]
    x = torch.stack([fbank(torch.from_numpy(fit_length(y16k[s:s + n], None))) for s in starts])
    p = torch.sigmoid(model(x.to(device))).cpu().numpy()
    k = min(2, len(p))
    return np.sort(p, axis=0)[-k:].mean(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--patience", type=int, default=3)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"

    recs = [r for r in load_icbhi(overlap_to_test=True) if r.cycles]
    print(f"{len(recs)} grabaciones · cargando audio a 16 kHz…", flush=True)
    audio = [load_16k(r.path) for r in recs]
    items = build_cycles(recs)
    Y = np.array([[c, w] for _, _, _, c, w in items], dtype=np.float32)
    groups = np.array([recs[i].patient for i, *_ in items])
    splits = np.array([recs[i].split for i, *_ in items])
    te = np.where(splits == "test")[0]
    tr, va = split_train_val(groups, np.where(splits == "train")[0], args.seed)   # misma semilla que train_lung.py
    if args.smoke:
        tr, va, te = tr[:64], va[:32], te[:32]
        args.epochs = 1
    print(f"ciclos · train {len(tr)} · val {len(va)} · test {len(te)} · dispositivo {device}", flush=True)

    model = LungAST().to(device)
    pos_w = torch.tensor((len(tr) - Y[tr].sum(0)) / np.maximum(Y[tr].sum(0), 1), device=device)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_w)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * int(np.ceil(len(tr) / args.batch))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=max(1, steps), pct_start=0.1)

    best, best_state, bad = -1.0, None, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = rng.permutation(tr)
        t0, total = time.time(), 0.0
        for s in range(0, len(order), args.batch):
            x, y = cycle_batch(items, order[s:s + args.batch], audio, rng, True)
            loss = loss_fn(model(x.to(device)), y.to(device))
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            total += float(loss) * len(x)
        pv = predict(model, items, va, audio, device)
        thr = [youden(Y[va, j], pv[:, j]) for j in range(2)]
        _, _, score = icbhi_score(Y[va], pv, thr)
        print(f"época {epoch:2d} · pérdida {total / len(order):.4f} · ICBHI validación {score:.3f} · "
              f"{(time.time() - t0) / 60:.1f} min", flush=True)
        if score > best:
            best, bad = score, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= args.patience:
                break
    model.load_state_dict(best_state)

    pv, pt = predict(model, items, va, audio, device), predict(model, items, te, audio, device)
    thr = [youden(Y[va, j], pv[:, j]) for j in range(2)]
    metrics = {}
    for j, name in enumerate(SOUND_LABELS):
        vy = Y[va, j]
        val_auc = float(roc_auc_score(vy, pv[:, j])) if len(set(vy)) > 1 else 0.0
        val_se = float(recall_score(vy, pv[:, j] >= thr[j], zero_division=0))
        yt, pred = Y[te, j], pt[:, j] >= thr[j]
        metrics[name] = {
            "sensibilidad": float(recall_score(yt, pred, zero_division=0)),
            "especificidad": float(recall_score(1 - yt, ~pred, zero_division=0)),
            "auc": float(roc_auc_score(yt, pt[:, j])) if len(set(yt)) > 1 else float("nan"),
            "umbral": thr[j], "n_positivos": int(yt.sum()),
            "mostrar": bool(val_auc >= 0.7 and val_se >= 0.5),
            "criterio_mostrar": "AUC y sensibilidad exclusivamente en validación",
            "validacion": {"auc": val_auc, "sensibilidad": val_se},
        }
    se, sp, sc = icbhi_score(Y[te], pt, thr)
    metrics["icbhi"] = {"sensibilidad": se, "especificidad": sp, "puntaje": sc, "mostrar": True}

    # Grabación completa (como el servidor), umbral elegido con los pacientes de validación
    rec_va = sorted({items[k][0] for k in va}); rec_te = sorted({items[k][0] for k in te})
    scores = {i: recording_score(model, audio[i], device) for i in rec_va + rec_te}
    for j, name in enumerate(SOUND_LABELS):
        lab = lambda idx: np.array([int(any(c[2 + j] for c in recs[i].cycles)) for i in idx])
        sv, st = np.array([scores[i][j] for i in rec_va]), np.array([scores[i][j] for i in rec_te])
        t = youden(lab(rec_va), sv)
        yl = lab(rec_te); pred = st >= t
        m = {"sensibilidad": float((pred & (yl == 1)).sum() / max(1, (yl == 1).sum())),
             "especificidad": float((~pred & (yl == 0)).sum() / max(1, (yl == 0).sum())),
             "auc": float(roc_auc_score(yl, st)) if len(set(yl)) > 1 else float("nan"),
             "grabaciones": int(len(yl)), "positivas": int(yl.sum())}
        m["mostrar"] = bool(m["auc"] >= 0.7 and m["sensibilidad"] >= 0.5 and m["especificidad"] >= 0.5)
        metrics[name]["umbral_grabacion"] = t
        metrics[name]["grabacion_completa"] = m

    # Exportación TorchScript (el servidor no necesita transformers)
    model = model.cpu().eval()
    example = torch.zeros(2, FRAMES, 128)
    traced = torch.jit.trace(model, example, check_trace=False)
    MODELS.mkdir(exist_ok=True)
    suffix = "_smoke" if args.smoke else ""
    pt_path = MODELS / f"lung_sounds_ast{suffix}.pt"
    traced.save(str(pt_path))
    meta = {
        "tarea": "crepitantes y sibilancias (ICBHI 2017)", "arquitectura": "ast",
        "preentrenado": PRETRAINED, "salidas": SOUND_LABELS, "metricas_prueba": metrics,
        "agregacion": "promedio de las 2 ventanas más altas de la grabación",
        "features": {"sr": SR, "frames": FRAMES, "num_mel_bins": 128, "frame_shift_ms": 10,
                     "ventana_s": SEG_S, "salto_s": WIN_HOP_S, "media": AST_MEAN, "desviacion": AST_STD},
        "particiones": {"train": int(len(tr)), "val": int(len(va)), "test": int(len(te))},
        "particion": {"fuente": "oficial ICBHI 2017", "pacientes_en_ambos_lados_movidos_a_prueba": list(MOVED_TO_TEST)},
        "entrenado": datetime.now().isoformat(timespec="seconds"),
        "limitaciones": ["Sugerencia de tamizaje, no diagnóstico.",
                         "ICBHI tiene pocos pacientes en varias clases; resultados orientativos.",
                         "Validado con grabaciones de estetoscopios clínicos, no con el dispositivo propio."],
    }
    pt_path.with_suffix(".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("sensibilidad", "especificidad", "auc", "puntaje")}
                      for k, v in metrics.items()}, indent=1, ensure_ascii=False))
    for name in SOUND_LABELS:
        g = metrics[name]["grabacion_completa"]
        print(f"{name} por grabación: AUC {g['auc']:.3f} · detecta {g['sensibilidad']:.0%} · normales {g['especificidad']:.0%}")
    print(f"Guardado en {pt_path}")


if __name__ == "__main__":
    main()
