"""
Preprocesamiento y extracción de características de audio cardíaco (PCG).

IMPORTANTE: este archivo se usa tanto para ENTRENAR (IA/) como para
INFERIR en el servidor (FeriaTecnologica2026/Backend/ml/features.py). Si se cambia
un parámetro aquí, hay que copiar el archivo al backend y reentrenar el modelo.
"""
import numpy as np
import librosa
from scipy.signal import butter, sosfiltfilt

# Frecuencia de trabajo del modelo. PhysioNet 2016 está a 2 kHz y CirCor a 4 kHz;
# la banda cardíaca de interés (20-600 Hz) cabe completa bajo el Nyquist de 1 kHz.
TARGET_SR = 2000
BAND_HZ = (20.0, 600.0)

WINDOW_S = 5.0          # 3-5 ciclos cardíacos completos
HOP_S = 2.5             # 50 % de solapamiento

N_FFT = 256             # 128 ms
HOP_LENGTH = 64         # 32 ms
N_MELS = 48
FMIN, FMAX = 20.0, 1000.0

MIN_RMS = 1e-4          # por debajo de esto la ventana se considera silencio


def preprocess(y: np.ndarray, sr: int) -> np.ndarray:
    """Remuestrea a TARGET_SR (con filtro antialiasing), filtra 20-600 Hz y normaliza."""
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=0)
    if sr != TARGET_SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=TARGET_SR, res_type="soxr_hq")
    sos = butter(4, BAND_HZ, btype="bandpass", fs=TARGET_SR, output="sos")
    y = sosfiltfilt(sos, y).astype(np.float32)
    peak = np.max(np.abs(y)) + 1e-8
    return y / peak


def segment(y: np.ndarray) -> list[np.ndarray]:
    """Corta la señal en ventanas fijas con solapamiento; rellena con ceros la última si es corta."""
    win = int(WINDOW_S * TARGET_SR)
    hop = int(HOP_S * TARGET_SR)
    if len(y) < win:
        return [np.pad(y, (0, win - len(y)))]
    return [y[i:i + win] for i in range(0, len(y) - win + 1, hop)]


def logmel(window: np.ndarray) -> np.ndarray:
    """Espectrograma log-mel estandarizado de una ventana. Salida: (N_MELS, frames) float32."""
    m = librosa.feature.melspectrogram(
        y=window, sr=TARGET_SR, n_fft=N_FFT, hop_length=HOP_LENGTH,
        n_mels=N_MELS, fmin=FMIN, fmax=FMAX, power=2.0,
    )
    m = librosa.power_to_db(m, ref=np.max, top_db=80.0)
    m = (m - m.mean()) / (m.std() + 1e-6)
    return m.astype(np.float32)


def signal_quality(y_raw: np.ndarray) -> dict:
    """Indicadores simples de calidad de la grabación (antes de normalizar)."""
    y_raw = np.asarray(y_raw, dtype=np.float32)
    rms = float(np.sqrt(np.mean(y_raw ** 2))) if len(y_raw) else 0.0
    clipped = float(np.mean(np.abs(y_raw) >= 0.99)) if len(y_raw) else 0.0
    return {
        "rms": rms,
        "clipping_ratio": clipped,
        "too_quiet": rms < MIN_RMS,
        "clipped": clipped > 0.01,
    }


def features_from_audio(y: np.ndarray, sr: int) -> np.ndarray:
    """Audio crudo -> tensor (n_ventanas, 1, N_MELS, frames) listo para la CNN."""
    y = preprocess(y, sr)
    specs = [logmel(w) for w in segment(y)]
    return np.stack(specs)[:, None, :, :]
