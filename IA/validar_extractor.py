"""
OBSOLETO: el código original del autor ya está en IA/modelo_base/ y está verificado
(modelo_base/verificar_modelo_base.py). Este script queda solo como registro del intento de reconstrucción.

Reconstruye y VALIDA el cálculo de las 61 características del modelo base de pulmón.

El modelo base (regresión logística, ICBHI) se entrenó con 61 medidas por ciclo respiratorio, pero no
tenemos el código exacto con que se calcularon. Los 5 casos de Backend/demo_audios/demoSamples.json
traen esas medidas ya calculadas para un ciclo concreto de una grabación ICBHI. Este script:
  1. Busca esas grabaciones ORIGINALES de ICBHI dentro de IA/data/ (con su .txt de ciclos).
  2. Recorta el ciclo cuya duración coincide con la del caso.
  3. Prueba configuraciones de cálculo y compara con las 61 medidas guardadas.
  4. Si una configuración coincide en los 5 casos (error relativo mediano < 2 % y máximo < 10 %),
     la guarda en Backend/models/lung_baseline_extractor.json y el servidor la activa sola.

Uso:
    python validar_extractor.py
"""
import itertools
import json
from pathlib import Path

import librosa
import numpy as np

from src.lung_data import DATA_DIR, FILE_RE, _cycles, rglob

ROOT = Path(__file__).resolve().parent
SAMPLES = ROOT.parent / "Backend" / "demo_audios" / "demoSamples.json"
OUT = ROOT.parent / "Backend" / "models" / "lung_baseline_extractor.json"

GRID = {
    "sr": [None, 4000, 8000, 16000, 22050],    # None = frecuencia original de la grabación
    "n_fft": [2048, 1024, 512],
    "hop_length": [512, 256, 128],
    "normalizar": [False, True],               # pico a 1 antes de calcular
}
MEDIAN_TOL, MAX_TOL = 0.02, 0.10


def extract(y: np.ndarray, sr: int, cfg: dict) -> dict:
    """Mismo cálculo que usará el servidor (Backend/ml/lung_baseline_features.py)."""
    if cfg["normalizar"]:
        y = y / (np.max(np.abs(y)) + 1e-9)
    kw = {"n_fft": cfg["n_fft"], "hop_length": cfg["hop_length"]}
    rms = librosa.feature.rms(y=y, frame_length=cfg["n_fft"], hop_length=cfg["hop_length"])[0]
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=cfg["n_fft"], hop_length=cfg["hop_length"])[0]
    cen = librosa.feature.spectral_centroid(y=y, sr=sr, **kw)[0]
    rol = librosa.feature.spectral_rolloff(y=y, sr=sr, **kw)[0]
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, **kw)
    width = min(9, mfcc.shape[1] - (1 - mfcc.shape[1] % 2)) if mfcc.shape[1] >= 3 else 3
    d1 = librosa.feature.delta(mfcc, width=max(3, width))
    d2 = librosa.feature.delta(mfcc, order=2, width=max(3, width))
    f = {"rms_mean": rms.mean(), "rms_std": rms.std(), "rms_max": rms.max(),
         "zcr_mean": zcr.mean(), "zcr_std": zcr.std(),
         "centroid_mean": cen.mean(), "centroid_std": cen.std(),
         "rolloff_mean": rol.mean(), "rolloff_std": rol.std()}
    for i in range(13):
        f[f"mfcc_{i + 1}_mean"] = mfcc[i].mean()
        f[f"mfcc_{i + 1}_std"] = mfcc[i].std()
        f[f"mfcc_delta_{i + 1}_mean"] = d1[i].mean()
        f[f"mfcc_delta2_{i + 1}_mean"] = d2[i].mean()
    return {k: float(v) for k, v in f.items()}


def rel_errors(ours: dict, ref: dict) -> np.ndarray:
    keys = [k for k in ref if k in ours]
    a = np.array([ours[k] for k in keys])
    b = np.array([ref[k] for k in keys])
    return np.abs(a - b) / (np.abs(b) + 1e-3)


def find_cycle(rec_name: str, duration: float):
    for wav in rglob(DATA_DIR, f"{rec_name}.wav"):
        if FILE_RE.match(wav.name):
            for a, b, _, _ in _cycles(wav.with_suffix(".txt")):
                if abs((b - a) - duration) < 0.01:
                    return wav, a, b
    return None


def main():
    samples = json.loads(SAMPLES.read_text(encoding="utf-8"))
    cases = []
    for key, s in samples.items():
        found = find_cycle(s["recording_name"], s["duration"])
        if found is None:
            print(f"✗ {key}: no encuentro {s['recording_name']}.wav con un ciclo de {s['duration']} s en {DATA_DIR}")
            continue
        wav, a, b = found
        y, sr0 = librosa.load(wav, sr=None, mono=True)
        cases.append((key, y, sr0, a, b, s["features"]))
        print(f"✓ {key}: {wav.name} ciclo {a:.3f}-{b:.3f} s ({sr0} Hz)")
    if len(cases) < len(samples):
        raise SystemExit("\nFaltan audios originales de ICBHI. Descárgalos en IA/data/ y vuelve a correr el script.")

    best = None
    for values in itertools.product(*GRID.values()):
        cfg = dict(zip(GRID, values))
        errs = []
        for _, y, sr0, a, b, ref in cases:
            sr = cfg["sr"] or sr0
            yy = librosa.resample(y, orig_sr=sr0, target_sr=sr) if sr != sr0 else y
            seg = yy[int(a * sr):int(b * sr)]
            errs.append(rel_errors(extract(seg, sr, cfg), ref))
        e = np.concatenate(errs)
        score = (float(np.median(e)), float(np.max(e)))
        if best is None or score < best[0]:
            best = (score, cfg)

    (med, mx), cfg = best
    print(f"\nMejor configuración: {cfg} · error mediano {med:.2%} · máximo {mx:.2%}")
    if med < MEDIAN_TOL and mx < MAX_TOL:
        OUT.write_text(json.dumps({"config": cfg, "error_mediano": med, "error_maximo": mx,
                                   "validado_con": [c[0] for c in cases]}, indent=2, ensure_ascii=False))
        print(f"✅ Coincide. Guardado en {OUT}: reinicia el servidor para activar el modelo base con grabaciones.")
    else:
        print("❌ Ninguna configuración coincide lo suficiente: el cálculo original usa otros pasos. "
              "Hace falta el código del autor; el modelo base sigue sin analizar grabaciones.")


if __name__ == "__main__":
    main()
