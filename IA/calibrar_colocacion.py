"""
Calibra el control de colocación (Backend/ml/placement.py) con grabaciones reales.

- Corazón: periodicidad de latidos en PhysioNet 2016 (data/training) y CirCor 2022 (data/circor), primeros 15 s.
  Umbral = percentil 2: al menos el 98 % de las grabaciones cardíacas reales pasan.
- Pulmón: periodicidad de respiración en ICBHI 2017. Umbral = percentil 2.
- Se informa qué tanto separa: cuántas grabaciones de ruido (blanco, rosa, café y golpes al azar) y, para el
  corazón, cuántas de pulmón (ICBHI) quedarían marcadas. Si el ruido no se separa (menos de la mitad marcado),
  ese control queda inactivo.

Uso:  python calibrar_colocacion.py
Salida: Backend/models/colocacion.json
"""
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "Backend"))
from ml import placement  # noqa: E402

from src.lung_data import FILE_RE, rglob  # noqa: E402

DATA = ROOT / "data"
OUT = ROOT.parent / "Backend" / "models" / "colocacion.json"


def read15(path: Path):
    try:
        info = sf.info(str(path))
        y, sr = sf.read(str(path), dtype="float32", frames=int(15 * info.samplerate), always_2d=False)
    except Exception:
        return None, None
    if y.ndim > 1:
        y = y.mean(1)
    return (y, sr) if len(y) >= 5 * sr else (None, None)


def scores(paths, mode):
    out = []
    for p in paths:
        y, sr = read15(p)
        if y is not None:
            out.append(placement.measure(y, sr, mode))
    return np.array(out)


def noise_set(rng, n=200, sr=4000):
    sigs = []
    for k in range(n):
        t = 15 * sr
        kind = k % 4
        w = rng.standard_normal(t).astype(np.float32)
        if kind == 1:      # rosa
            f = np.fft.rfft(w); f /= np.maximum(1, np.sqrt(np.arange(len(f)))); w = np.fft.irfft(f, t)
        elif kind == 2:    # café
            w = np.cumsum(w); w -= np.linspace(w[0], w[-1], t)
        elif kind == 3:    # golpes y roces al azar (contacto inestable)
            w *= 0.05
            for _ in range(rng.integers(3, 15)):
                s = rng.integers(0, t - 400); w[s:s + rng.integers(50, 400)] += rng.standard_normal(1)[0] * 3
        w = (w / (np.abs(w).max() + 1e-9) * 0.3).astype(np.float32)
        sigs.append((w, sr))
    return sigs


def main():
    rng = np.random.default_rng(0)
    physionet = sorted((DATA / "training").rglob("*.wav"))
    circor = sorted((DATA / "circor").rglob("*.wav"))
    icbhi = sorted(p for p in rglob(DATA, "*.wav") if FILE_RE.match(p.name))
    icbhi = list({p.name: p for p in icbhi}.values())
    print(f"PhysioNet {len(physionet)} · CirCor {len(circor)} · ICBHI {len(icbhi)}", flush=True)

    heart = np.concatenate([scores(physionet, "corazon"), scores(circor, "corazon")])
    lung_as_heart = scores(icbhi, "corazon")
    lung = scores(icbhi, "pulmon")
    noise = noise_set(rng)
    noise_heart = np.array([placement.measure(y, sr, "corazon") for y, sr in noise])
    noise_lung = np.array([placement.measure(y, sr, "pulmon") for y, sr in noise])

    def block(real, thr, others: dict):
        flagged = {k: float(np.mean(v < thr)) for k, v in others.items()}
        return {"umbral": float(thr), "pasan_reales": float(np.mean(real >= thr)), "n_reales": int(len(real)),
                "mediana_reales": float(np.median(real)), "marcados": flagged,
                "activo": bool(flagged.get("ruido", 0) >= 0.5)}

    t_heart = float(np.percentile(heart, 2))
    t_lung = float(np.percentile(lung, 2))
    cfg = {
        "corazon": block(heart, t_heart, {"ruido": noise_heart, "pulmon_icbhi": lung_as_heart}),
        "pulmon": block(lung, t_lung, {"ruido": noise_lung}),
        "parametros": {k: {kk: list(vv) if isinstance(vv, tuple) else vv for kk, vv in v.items()}
                       for k, v in placement.PARAMS.items()},
        "generado": datetime.now().isoformat(timespec="seconds"),
        "nota": "Aviso de colocación: no cambia el resultado del clasificador. Calibrado con estetoscopios clínicos.",
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    for mode in ("corazon", "pulmon"):
        c = cfg[mode]
        print(f"{mode}: umbral {c['umbral']:.3f} · pasan {c['pasan_reales']:.1%} de {c['n_reales']} reales "
              f"(mediana {c['mediana_reales']:.3f}) · marcados {', '.join(f'{k} {v:.0%}' for k, v in c['marcados'].items())}"
              f" · {'ACTIVO' if c['activo'] else 'inactivo'}")
    print(f"Guardado en {OUT}")


if __name__ == "__main__":
    main()
