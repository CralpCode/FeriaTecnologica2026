"""
Clasificación de grabaciones PULMONARES con los modelos entrenados en IA/train_lung.py:
  - lung_sounds_cnn   -> crepitantes / sibilancias (B)
  - lung_disease_cnn  -> patrón compatible con enfermedad (C); solo se muestra lo que el modelo
                         acierta de forma confiable según su .json ("mostrar")
Si un modelo aún no existe, se informa "modelo_no_disponible" en lugar de fallar.
"""
import json
import os
import threading
from pathlib import Path

import numpy as np

from . import placement
import soundfile as sf

from . import lung_baseline
from . import lung_features as LF
from .features import signal_quality

MODELS_DIR = Path(os.getenv("LUNG_MODELS_DIR", Path(__file__).resolve().parents[1] / "models"))
MIN_DURATION_S = 8.0  # al menos 2 ciclos respiratorios

_lock = threading.Lock()
_cache: dict[str, tuple] = {}


def _load(name: str):
    with _lock:
        if name in _cache:
            return _cache[name]
        path = MODELS_DIR / f"{name}.pt"
        if not path.exists():
            return None
        import torch
        _cache[name] = (torch.jit.load(str(path), map_location="cpu").eval(),
                        json.loads(path.with_suffix(".json").read_text()))
        return _cache[name]


def _sounds_model():
    """Modelo de crepitantes/sibilancias en uso: el AST preentrenado si está publicado; si no, la CNN."""
    return _load("lung_sounds_ast") or _load("lung_sounds_cnn")


def ast_features(y: np.ndarray, sr: int, f: dict):
    """Ventanas de audio -> fbank Kaldi normalizado (ventanas, cuadros, 128), igual que IA/train_lung_ast.py."""
    import torch
    import torchaudio
    w = torch.from_numpy(np.asarray(y, dtype=np.float32))
    if sr != f["sr"]:
        w = torchaudio.functional.resample(w, sr, f["sr"])
    n, hop = int(round(f["ventana_s"] * f["sr"])), int(round(f["salto_s"] * f["sr"]))
    starts = list(range(0, max(1, len(w) - n + 1), hop)) or [0]
    out = []
    for s in starts:
        seg = w[s:s + n]
        if len(seg) < n:   # se repite el audio hasta completar la ventana (como en el entrenamiento)
            seg = seg.repeat(int(np.ceil(n / max(1, len(seg)))))[:n]
        seg = seg - seg.mean()
        fb = torchaudio.compliance.kaldi.fbank(seg.unsqueeze(0), htk_compat=True, sample_frequency=f["sr"],
                                               use_energy=False, window_type="hanning", num_mel_bins=f["num_mel_bins"],
                                               dither=0.0, frame_shift=f["frame_shift_ms"])
        frames = f["frames"]
        fb = fb[:frames] if fb.shape[0] >= frames else torch.nn.functional.pad(fb, (0, 0, 0, frames - fb.shape[0]))
        out.append((fb - f["media"]) / (f["desviacion"] * 2))
    return torch.stack(out)


def model_info() -> dict:
    out = {}
    for name in ("lung_sounds_cnn", "lung_disease_cnn"):
        m = _sounds_model() if name == "lung_sounds_cnn" else _load(name)
        out[name] = {"loaded": False} if m is None else {
            "loaded": True, "tarea": m[1].get("tarea"), "metricas_prueba": m[1].get("metricas_prueba"),
            "mostrar": m[1].get("mostrar", True), "limitaciones": m[1].get("limitaciones", []),
            "arquitectura": m[1].get("arquitectura", "cnn"),
        }
    out["modelo_base"] = lung_baseline.model_info()
    return out


def classify_wav(path: str | Path, eq=None, check_placement: bool = False) -> dict:
    """eq: función (y, sr) -> y del ecualizador (ml/equalizer.py); se aplica tras el control de calidad."""
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)
    duration = len(y) / sr
    quality = signal_quality(y)
    quality["duration_s"] = round(duration, 2)
    base = {"probability": None, "threshold": None, "quality": quality, "model": "pulmon"}
    base.update({"probability_kind": "uncalibrated_model_score", "clinical_diagnosis": False})
    if quality["non_finite"] or quality["clipped"] or quality["flat"]:
        return {**base, "result": "calidad_insuficiente", "details": {},
                "reason": "Señal inválida, saturada o sin variación; repetir la grabación"}
    if duration < MIN_DURATION_S:
        return {**base, "result": "calidad_insuficiente", "details": {},
                "reason": f"Grabación muy corta ({duration:.1f} s; mínimo {MIN_DURATION_S:.0f} s)"}
    if quality["too_quiet"]:
        return {**base, "result": "calidad_insuficiente", "details": {},
                "reason": "Señal casi en silencio: revisar contacto del estetoscopio"}

    colocacion = placement.check(y, sr, "pulmon") if check_placement else None   # inactivo si no separa
    if eq is not None:
        y = eq(y, sr)
    sounds, disease = _sounds_model(), _load("lung_disease_cnn")
    # Modelo base del equipo (regresión logística): se usa solo, o como comparación si hay CNN
    baseline = lung_baseline.classify_audio(y, sr)
    if sounds is None and disease is None:
        if baseline.get("estado") == "ok":
            abn = baseline["is_abnormal"] == 1
            return {**base, "result": "anormal" if abn else "normal", "reason": None,
                    "probability": baseline["probability_abnormal"], "model": "pulmon_modelo_base",
                    "details": {"modelo_base": baseline}}
        reason = ("Los modelos de pulmón aún no están entrenados (faltan los audios de ICBHI)."
                  if baseline.get("estado") != "solo_demo" else
                  "Las CNN de pulmón no están disponibles y el modelo base se usa solo en los casos demo.")
        return {**base, "result": "modelo_no_disponible", "details": {}, "reason": reason}

    import torch
    x = torch.from_numpy(LF.features_from_audio(y, sr))
    quality["windows"] = int(len(x))
    details: dict = {}
    abnormal = False
    top_prob = 0.0
    usable_outputs = 0

    if sounds is not None:
        model, meta = sounds
        xs = ast_features(y, sr, meta["features"]) if meta.get("arquitectura") == "ast" else x
        with torch.no_grad():
            p = torch.sigmoid(model(xs)).numpy()         # (ventanas, 2)
        k = min(2, len(p))
        score = np.sort(p, axis=0)[-k:].mean(0)          # promedio de las 2 ventanas más altas
        found = {}
        for j, name in enumerate(meta["salidas"]):
            m = meta["metricas_prueba"][name]
            # Calibración para grabaciones completas (IA/calibrar_pulmon.py) si existe; si no, la de ciclos
            full = m.get("grabacion_completa") or {}
            show = full.get("mostrar", m.get("mostrar"))
            if not show or not np.isfinite(score[j]):
                continue
            thr = m.get("umbral_grabacion", m["umbral"])
            usable_outputs += 1
            present = bool(score[j] >= thr)
            found[name] = {"presente": present, "probabilidad": round(float(score[j]), 3), "umbral": round(thr, 3),
                           "sensibilidad_modelo": round(full.get("sensibilidad", m["sensibilidad"]), 2)}
            abnormal |= present
            top_prob = max(top_prob, float(score[j]))
        details["ruidos"] = found

    if disease is not None and disease[1].get("mostrar"):
        model, meta = disease
        with torch.no_grad():
            p = torch.softmax(model(x), 1).mean(0).numpy()
        k = int(np.argmax(p))
        cls = meta["clases"][k]
        per = meta["metricas_prueba"]["por_clase"][cls]
        if per.get("mostrar") and np.isfinite(p).all():
            usable_outputs += 1
            details["patron"] = {"compatible_con": cls, "probabilidad": round(float(p[k]), 3),
                                 "sensibilidad_modelo": round(per["sensibilidad"], 2)}
            abnormal |= cls != "sano"

    if baseline.get("estado") == "ok":
        details["modelo_base"] = baseline
    if colocacion:
        details["colocacion"] = colocacion
    if not usable_outputs:
        return {**base, "result": "indeterminado", "details": details,
                "reason": "Ninguna salida del modelo cumple los criterios de uso; no se puede concluir normalidad"}
    return {**base, "result": "anormal" if abnormal else "normal", "reason": None,
            "probability": round(top_prob, 4) if "ruidos" in details else None, "details": details}
