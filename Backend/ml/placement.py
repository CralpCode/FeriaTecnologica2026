"""
Control de colocación: ¿la grabación tiene el ritmo esperado del órgano elegido?

- Corazón: envolvente de 25–400 Hz; los latidos se repiten cada 0.27–2.0 s (30–220 por minuto).
- Pulmón: envolvente de 100–1000 Hz; la respiración se repite cada 1.5–7 s.

La "periodicidad" es el pico de la autocorrelación normalizada del LOGARITMO de la envolvente en ese rango
(0 a 1). En escala logarítmica los golpes y roces aislados pesan menos que el ritmo repetido; con las bases
públicas fue la medida que mejor separó latidos de ruido (IA/calibrar_colocacion.py).
El umbral sale de IA/calibrar_colocacion.py con grabaciones reales (PhysioNet, CirCor, ICBHI) y queda en
Backend/models/colocacion.json; sin ese archivo el control está apagado.

Sin calibrar con el equipo es solo un AVISO. Calibrado con este estetoscopio (bloque "equipo" del json),
el clasificador del corazón no da normal/anormal cuando no hay latidos claros: pide repetir (ml/classifier.py).
"""
import json
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfiltfilt

CONFIG_PATH = Path(__file__).resolve().parents[1] / "models" / "colocacion.json"
MAX_S = 15.0   # misma duración que una grabación del dispositivo

PARAMS = {
    # inicio_s: los primeros segundos del dispositivo son el estetoscopio acomodándose (la grabación empieza al
    # llegar la orden); con las grabaciones de calibración del equipo, ignorarlos separó mejor latidos de ruido.
    "corazon": {"banda_hz": (25.0, 400.0), "env_sr": 50, "rango_s": (0.27, 2.0), "que": "latidos", "inicio_s": 3.0},
    "pulmon": {"banda_hz": (100.0, 1000.0), "env_sr": 10, "rango_s": (1.5, 7.0), "que": "respiración"},
}

_config: dict | None = None
_config_mtime: float | None = None


def _load_config() -> dict:
    global _config, _config_mtime
    try:
        mtime = CONFIG_PATH.stat().st_mtime
    except OSError:
        _config, _config_mtime = {}, None
        return {}
    if _config is None or mtime != _config_mtime:
        try:
            _config = json.loads(CONFIG_PATH.read_text())
        except (OSError, ValueError):
            _config = {}
        _config_mtime = mtime
    return _config


def envelope(y: np.ndarray, sr: int, lo: float, hi: float, env_sr: int) -> np.ndarray | None:
    hi = min(hi, sr / 2 * 0.9)
    if lo >= hi or len(y) < sr:
        return None
    x = sosfiltfilt(butter(4, [lo, hi], btype="band", fs=sr, output="sos"), np.asarray(y, dtype=np.float64))
    step = max(1, int(round(sr / env_sr)))
    n = len(x) // step
    if n < 4:
        return None
    return np.sqrt((x[:n * step] ** 2).reshape(n, step).mean(1))


def periodicity(env: np.ndarray, env_sr: int, lag_min_s: float, lag_max_s: float) -> float:
    x = env - env.mean()
    if not np.any(x):
        return 0.0
    n = len(x)
    f = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    if ac[0] <= 0:
        return 0.0
    ac = ac / ac[0]
    lo, hi = int(round(lag_min_s * env_sr)), min(n - 1, int(round(lag_max_s * env_sr)))
    return float(max(0.0, ac[lo:hi + 1].max())) if hi > lo else 0.0


def measure(y: np.ndarray, sr: int, mode: str) -> float:
    p = PARAMS[mode]
    y = np.asarray(y, dtype=np.float32)[: int(MAX_S * sr)]
    skip = int(p.get("inicio_s", 0.0) * sr)
    if len(y) - skip >= 8 * sr:   # solo si quedan al menos 8 s para medir el ritmo
        y = y[skip:]
    env = envelope(y, sr, *p["banda_hz"], p["env_sr"])
    if env is None:
        return 0.0
    log_env = np.log(env + 1e-6 * env.max() + 1e-12)
    return periodicity(log_env, p["env_sr"], *p["rango_s"])


def check(y: np.ndarray, sr: int, mode: str) -> dict | None:
    """None si el control está apagado para ese modo; si no, {periodicidad, umbral, ok, que, fuente, bloquea}.

    Con un umbral calibrado con ESTE estetoscopio (bloque "equipo", IA/calibrar_colocacion_equipo.py) el control
    bloquea: sin latidos claros no se da normal ni anormal. Sin esa calibración solo avisa (umbral clínico)."""
    cfg = (_load_config() or {}).get(mode) or {}
    if not cfg.get("activo") or mode not in PARAMS:
        return None
    r = measure(y, sr, mode)
    device = cfg.get("equipo") or {}
    calibrated = isinstance(device.get("umbral"), (int, float))
    thr = float(device["umbral"] if calibrated else cfg["umbral"])
    return {"periodicidad": round(r, 3), "umbral": round(thr, 3), "ok": bool(r >= thr), "que": PARAMS[mode]["que"],
            "fuente": "equipo" if calibrated else "clinico", "bloquea": calibrated}
