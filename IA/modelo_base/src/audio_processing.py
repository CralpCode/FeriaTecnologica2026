"""
Módulo de Procesamiento Digital de Señales de Audio (DSP)
Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (f tecno 2026)
"""

from pathlib import Path
from typing import Optional, Tuple, Union
import numpy as np


def load_audio_normalized(
    file_path: Union[str, Path],
    target_sr: int = 16000
) -> Tuple[np.ndarray, int]:
    """
    Carga un archivo de audio .wav, lo convierte a mono y lo remuestrea a target_sr (por defecto 16 kHz).
    Normaliza la amplitud al rango [-1.0, 1.0].
    """
    file_path = str(file_path)
    
    # Intentar usar librosa o soundfile según disponibilidad
    try:
        import librosa
        audio, sr = librosa.load(file_path, sr=target_sr, mono=True)
        return audio.astype(np.float32), sr
    except ImportError:
        pass
        
    try:
        import soundfile as sf
        from scipy import signal
        
        audio, sr = sf.read(file_path)
        # Convertir a mono si es estéreo
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
            
        # Remuestrear si es necesario
        if sr != target_sr:
            num_samples = int(len(audio) * float(target_sr) / sr)
            audio = signal.resample(audio, num_samples)
            sr = target_sr
            
        # Normalizar amplitud si no está normalizada
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val
            
        return audio.astype(np.float32), sr
    except ImportError:
        from scipy.io import wavfile
        from scipy import signal
        
        sr, audio = wavfile.read(file_path)
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
            
        # Convertir int16 / int32 a float normalizado
        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype == np.int32:
            audio = audio.astype(np.float32) / 2147483648.0
            
        if sr != target_sr:
            num_samples = int(len(audio) * float(target_sr) / sr)
            audio = signal.resample(audio, num_samples)
            sr = target_sr
            
        return audio.astype(np.float32), sr


def butter_bandpass_filter(
    data: np.ndarray,
    lowcut: float = 100.0,
    highcut: float = 2000.0,
    fs: float = 16000.0,
    order: int = 4
) -> np.ndarray:
    """
    Aplica un filtro digital Butterworth paso-banda (100 Hz - 2000 Hz por defecto)
    para aislar ruidos pulmonares (sibilancias y crepitantes) y remover artefactos de roce mecánico.
    """
    from scipy.signal import butter, filtfilt
    
    nyq = 0.5 * fs
    low = max(lowcut / nyq, 0.001)
    high = min(highcut / nyq, 0.999)
    
    b, a = butter(order, [low, high], btype="band")
    filtered = filtfilt(b, a, data)
    return filtered.astype(np.float32)


def segment_cycle(
    audio: np.ndarray,
    start_time: float,
    end_time: float,
    sr: int = 16000,
    target_duration: float = 4.0
) -> np.ndarray:
    """
    Extrae la porción de audio correspondiente a un ciclo respiratorio individual [start_time, end_time].
    Ajusta el segmento a una duración fija (target_duration = 4.0s por defecto) mediante:
    - Zero-padding si es más corto.
    - Truncado simétrico o final si es más largo.
    """
    start_sample = int(start_time * sr)
    end_sample = int(end_time * sr)
    
    # Asegurar límites válidos
    start_sample = max(0, start_sample)
    end_sample = min(len(audio), end_sample)
    
    segment = audio[start_sample:end_sample]
    
    target_samples = int(target_duration * sr)
    current_samples = len(segment)
    
    if current_samples == target_samples:
        return segment
    elif current_samples < target_samples:
        # Padding con ceros al final
        padded = np.zeros(target_samples, dtype=np.float32)
        padded[:current_samples] = segment
        return padded
    else:
        # Truncar al target
        return segment[:target_samples]
