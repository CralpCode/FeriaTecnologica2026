"""
Cálculo de las 61 características que usa el modelo base de pulmón (lung_baseline.py).

Solo se activa si existe Backend/models/lung_baseline_extractor.json, que genera
IA/validar_extractor.py cuando su reconstrucción coincide con las medidas guardadas por el autor
en los casos de ICBHI. Sin ese archivo, READY = False y no se inventan parámetros.
Si el autor comparte su código original, puede reemplazar extract() directamente.

IMPORTANTE: _features() debe ser idéntica a extract() de IA/validar_extractor.py.
"""
import json
from pathlib import Path

import numpy as np

CONFIG_PATH = Path(__file__).resolve().parents[1] / "models" / "lung_baseline_extractor.json"
_CONFIG = json.loads(CONFIG_PATH.read_text())["config"] if CONFIG_PATH.exists() else None
READY = _CONFIG is not None


def _features(y: np.ndarray, sr: int, cfg: dict) -> dict:
    import librosa
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


def extract(y, sr: int) -> dict:
    if not READY:
        raise NotImplementedError("Extractor de las 61 características aún no validado (IA/validar_extractor.py).")
    import librosa
    y = np.asarray(y, dtype=np.float32)
    target = _CONFIG["sr"] or sr
    if target != sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target)
    return _features(y, target, _CONFIG)
