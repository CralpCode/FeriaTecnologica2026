"""
Preprocesamiento y características de audio PULMONAR (ICBHI 2017 y grabaciones del dispositivo).

IMPORTANTE: igual que features.py, este archivo se copia al servidor
(FeriaTecnologica2026/Backend/ml/lung_features.py). Si se cambia algo aquí, hay que copiarlo
y reentrenar los modelos de pulmón.
"""
import numpy as np
import librosa
from scipy.signal import butter, sosfiltfilt

# ICBHI se grabó entre 4 y 44.1 kHz; 4 kHz conserva la banda de interés (100-1800 Hz)
TARGET_SR = 4000
BAND_HZ = (100.0, 1800.0)   # quita los tonos del corazón (< 100 Hz) y ruido alto

WINDOW_S = 4.0              # un ciclo respiratorio típico dura 1.5-3.5 s
HOP_S = 2.0

N_FFT = 512                 # 128 ms
HOP_LENGTH = 128            # 32 ms
N_MELS = 64
FMIN, FMAX = 100.0, 2000.0


def preprocess(y: np.ndarray, sr: int) -> np.ndarray:
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=0)
    if sr != TARGET_SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=TARGET_SR, res_type="soxr_hq")
    sos = butter(4, BAND_HZ, btype="bandpass", fs=TARGET_SR, output="sos")
    y = sosfiltfilt(sos, y).astype(np.float32)
    return y / (np.max(np.abs(y)) + 1e-8)


def fit_window(y: np.ndarray) -> np.ndarray:
    """Recorta o rellena con ceros a la longitud fija de ventana."""
    win = int(WINDOW_S * TARGET_SR)
    return y[:win] if len(y) >= win else np.pad(y, (0, win - len(y)))


def segment(y: np.ndarray) -> list[np.ndarray]:
    win = int(WINDOW_S * TARGET_SR)
    hop = int(HOP_S * TARGET_SR)
    if len(y) <= win:
        return [fit_window(y)]
    return [y[i:i + win] for i in range(0, len(y) - win + 1, hop)]


def logmel(window: np.ndarray) -> np.ndarray:
    m = librosa.feature.melspectrogram(
        y=window, sr=TARGET_SR, n_fft=N_FFT, hop_length=HOP_LENGTH,
        n_mels=N_MELS, fmin=FMIN, fmax=FMAX, power=2.0,
    )
    m = librosa.power_to_db(m, ref=np.max, top_db=80.0)
    return ((m - m.mean()) / (m.std() + 1e-6)).astype(np.float32)


def features_from_audio(y: np.ndarray, sr: int) -> np.ndarray:
    """Audio crudo -> (n_ventanas, 1, N_MELS, frames). Para grabaciones sin anotar (dispositivo)."""
    y = preprocess(y, sr)
    return np.stack([logmel(w) for w in segment(y)])[:, None, :, :]


def features_from_cycles(y: np.ndarray, sr: int, cycles: list[tuple[float, float]]) -> np.ndarray:
    """Audio + ciclos anotados (inicio, fin en s) -> una ventana por ciclo respiratorio."""
    y = preprocess(y, sr)
    wins = [fit_window(y[int(a * TARGET_SR):int(b * TARGET_SR)]) for a, b in cycles]
    return np.stack([logmel(w) for w in wins])[:, None, :, :]
