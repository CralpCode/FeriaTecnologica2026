"""
Genera el barrido sinusoidal exponencial para medir el estetoscopio con el fantoma
(manual, sección 7.2: 20 Hz - 2 kHz, 10 s, método de Farina).

Uso:
    python fantoma/generar_barrido.py
Salida (en IA/fantoma/salida/):
    barrido.wav          -> reproducir por el parlante del fantoma mientras el ESP32 graba (K1 1 s)
    barrido_info.json    -> parámetros que necesita calcular_respuesta.py

La grabación del ESP32 dura 15 s: el barrido son 10 s + 1 s de silencio antes y 2 s después.
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

FS = 16000           # misma frecuencia que graba el ESP32
F1, F2 = 20.0, 2000.0
DURATION = 10.0
PRE_SILENCE, POST_SILENCE = 1.0, 2.0
OUT = Path(__file__).resolve().parent / "salida"


def exp_sweep(fs=FS, f1=F1, f2=F2, T=DURATION) -> np.ndarray:
    t = np.arange(int(T * fs)) / fs
    R = np.log(f2 / f1)
    x = np.sin(2 * np.pi * f1 * T / R * (np.exp(t * R / T) - 1))
    fade = int(0.05 * fs)                        # rampas de 50 ms para no generar clics
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x.astype(np.float32)


def inverse_filter(sweep: np.ndarray, fs=FS, f1=F1, f2=F2, T=DURATION) -> np.ndarray:
    """Filtro inverso de Farina: barrido invertido en el tiempo con compensación de -6 dB/octava."""
    t = np.arange(len(sweep)) / fs
    R = np.log(f2 / f1)
    return (sweep[::-1] * np.exp(-t * R / T)).astype(np.float32)


def main():
    OUT.mkdir(exist_ok=True)
    sweep = exp_sweep()
    signal = np.concatenate([np.zeros(int(PRE_SILENCE * FS)), 0.8 * sweep, np.zeros(int(POST_SILENCE * FS))])
    sf.write(OUT / "barrido.wav", signal.astype(np.float32), FS)
    (OUT / "barrido_info.json").write_text(json.dumps(
        {"fs": FS, "f1": F1, "f2": F2, "duracion": DURATION, "silencio_previo": PRE_SILENCE}, indent=2))
    print(f"Barrido guardado en {OUT / 'barrido.wav'} ({len(signal) / FS:.0f} s).")
    print("Pasos: 1) volumen fijo en el parlante, 2) 'Preparar grabación' en la app, 3) K1 1 s y reproducir el barrido.")


if __name__ == "__main__":
    main()
