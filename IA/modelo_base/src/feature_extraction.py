"""
Módulo de Extracción de Características Acústicas (Feature Engineering)
Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (f tecno 2026)
"""

from typing import Dict, List, Optional, Union
import numpy as np


def extract_cycle_features(
    segment: np.ndarray,
    sr: int = 16000,
    n_mfcc: int = 13
) -> Dict[str, float]:
    """
    Extrae un vector de características tabulares para un ciclo respiratorio preprocesado:
    - Estadísticos de Coeficientes Cepstrales en la Escala Mel (MFCCs: media y desviación estándar).
    - Primeras y segundas derivadas de MFCCs (Deltas y Delta-Deltas) para capturar dinámicas temporales.
    - Energía cuadrática media (RMS).
    - Tasa de cruces por cero (Zero Crossing Rate - ZCR).
    - Centroide espectral y Spectral Roll-off (85%).
    """
    import librosa
    
    features = {}
    
    # 1. Energía RMS
    rms = librosa.feature.rms(y=segment)
    features["rms_mean"] = float(np.mean(rms))
    features["rms_std"] = float(np.std(rms))
    features["rms_max"] = float(np.max(rms))
    
    # 2. Zero Crossing Rate (ZCR)
    zcr = librosa.feature.zero_crossing_rate(y=segment)
    features["zcr_mean"] = float(np.mean(zcr))
    features["zcr_std"] = float(np.std(zcr))
    
    # 3. Centroide Espectral (Frecuencia media ponderada por amplitud)
    spectral_centroid = librosa.feature.spectral_centroid(y=segment, sr=sr)
    features["centroid_mean"] = float(np.mean(spectral_centroid))
    features["centroid_std"] = float(np.std(spectral_centroid))
    
    # 4. Spectral Roll-off (Frecuencia bajo la cual reside el 85% de la energía)
    spectral_rolloff = librosa.feature.spectral_rolloff(y=segment, sr=sr, roll_percent=0.85)
    features["rolloff_mean"] = float(np.mean(spectral_rolloff))
    features["rolloff_std"] = float(np.std(spectral_rolloff))
    
    # 5. Coeficientes MFCC (Estáticos, Delta y Delta-Delta)
    mfcc = librosa.feature.mfcc(y=segment, sr=sr, n_mfcc=n_mfcc)
    mfcc_delta = librosa.feature.delta(mfcc)
    mfcc_delta2 = librosa.feature.delta(mfcc, order=2)
    
    for i in range(n_mfcc):
        features[f"mfcc_{i+1}_mean"] = float(np.mean(mfcc[i]))
        features[f"mfcc_{i+1}_std"] = float(np.std(mfcc[i]))
        features[f"mfcc_delta_{i+1}_mean"] = float(np.mean(mfcc_delta[i]))
        features[f"mfcc_delta2_{i+1}_mean"] = float(np.mean(mfcc_delta2[i]))
        
    return features


def compute_mel_spectrogram(
    segment: np.ndarray,
    sr: int = 16000,
    n_fft: int = 1024,
    hop_length: int = 512,
    n_mels: int = 64
) -> np.ndarray:
    """
    Genera el espectrograma Mel en escala logarítmica (dB) para análisis 2D o CNNs.
    """
    import librosa
    
    mel_spec = librosa.feature.melspectrogram(
        y=segment,
        sr=sr,
        n_fft=n_fft,
        hop_length=hop_length,
        n_mels=n_mels,
        fmin=50,
        fmax=sr // 2
    )
    mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max)
    return mel_spec_db.astype(np.float32)
