"""
Ecualizador del estetoscopio: corrige la respuesta de la pieza medida con el fantoma
(IA/fantoma/calcular_respuesta.py) para que el audio del dispositivo se parezca al de los
estetoscopios clínicos con que se entrenaron las redes.

- Sin medición no hace nada: no se inventan ganancias. Se activa con IA/fantoma/activar_ecualizador.py,
  que escribe Backend/models/ecualizador.json (el servidor lo relee solo, sin reiniciar).
- Solo usa las bandas con medición confiable (coherencia >= 0.8) y limita el refuerzo para no amplificar ruido.
- Se aplica después del control de calidad y antes del análisis; el audio guardado no cambia.
"""
import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np

CONFIG_PATH = Path(__file__).resolve().parents[1] / "models" / "ecualizador.json"
DEFAULT_MAX_BOOST_DB = 12.0
DEFAULT_MAX_CUT_DB = 12.0
NUMTAPS = 4097  # FIR de fase lineal: ~4 Hz de resolución a 16 kHz (la banda más baja medida es 30 Hz)

_cache: dict = {"mtime": None, "config": None}


def build_profile(resumen: dict, max_boost_db: float = DEFAULT_MAX_BOOST_DB,
                  max_cut_db: float = DEFAULT_MAX_CUT_DB) -> dict:
    """Perfil de corrección a partir del <nombre>_resumen.json de calcular_respuesta.py."""
    gains = resumen["ganancia_db_vs_100_600Hz"]
    excluded = set(resumen.get("bandas_coherencia_baja", []))
    correction = {}
    for band, gain in gains.items():
        if band in excluded or gain is None or not math.isfinite(gain):
            continue
        hz = float(band.split()[0])
        correction[str(int(hz))] = round(max(-max_cut_db, min(max_boost_db, -float(gain))), 2)
    if not correction:
        raise ValueError("La medición no tiene bandas confiables: no se puede ecualizar")
    return {
        "nombre": resumen.get("variante", "sin_nombre"),
        "creado": datetime.now().isoformat(timespec="seconds"),
        "relativa_a_referencia": bool(resumen.get("relativa_a_referencia")),
        "correccion_db": correction,
        "bandas_excluidas": sorted(excluded),
        "max_refuerzo_db": max_boost_db,
        "max_atenuacion_db": max_cut_db,
    }


def _config() -> dict | None:
    try:
        mtime = CONFIG_PATH.stat().st_mtime
    except OSError:
        _cache.update(mtime=None, config=None)
        return None
    if _cache["mtime"] != mtime:
        try:
            _cache.update(mtime=mtime, config=json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            print(f"[ECUALIZADOR] Configuración ilegible ({e}); no se aplica")
            _cache.update(mtime=mtime, config=None)
    return _cache["config"]


def profile_for(mode: str) -> dict | None:
    """Perfil activo para "corazon" o "pulmon", o None si no hay medición."""
    cfg = _config()
    return (cfg or {}).get("perfiles", {}).get(mode)


def _response_db(freqs: np.ndarray, profile: dict) -> np.ndarray:
    """Corrección en dB por frecuencia: interpolada en escala logarítmica, 0 dB fuera de lo medido."""
    pts = sorted((float(f), float(g)) for f, g in profile["correccion_db"].items())
    f_pts = [pts[0][0] / 2] + [p[0] for p in pts] + [pts[-1][0] * 1.5]
    g_pts = [0.0] + [p[1] for p in pts] + [0.0]
    out = np.zeros_like(freqs, dtype=float)
    inside = (freqs >= f_pts[0]) & (freqs <= f_pts[-1])
    out[inside] = np.interp(np.log(freqs[inside]), np.log(f_pts), g_pts)
    return out


def apply(y: np.ndarray, sr: int, profile: dict) -> np.ndarray:
    """Filtra la señal con el perfil (FIR de fase lineal, sin desfase)."""
    from scipy.signal import fftconvolve, firwin2
    nyq = sr / 2
    grid = np.linspace(0, nyq, 2049)
    gain = 10 ** (_response_db(np.maximum(grid, 1e-3), profile) / 20)
    taps = firwin2(NUMTAPS, grid, gain, fs=sr)
    return fftconvolve(np.asarray(y, dtype=np.float64), taps, mode="same").astype(np.float32)


def describe(profile: dict) -> dict:
    """Lo que se guarda con cada grabación ecualizada (trazabilidad)."""
    return {"perfil": profile["nombre"], "creado": profile.get("creado"),
            "relativa_a_referencia": profile.get("relativa_a_referencia"),
            "bandas_corregidas": len(profile["correccion_db"]),
            "max_refuerzo_db": profile.get("max_refuerzo_db")}
