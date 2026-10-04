"""
Calcula la función de transferencia del estetoscopio a partir de grabaciones del barrido en el fantoma
(manual, secciones 7.1 y 7.2): deconvolución -> respuesta al impulso h(t), magnitud, fase y coherencia.

Uso (varias tomas de la misma variante mejoran la estimación):
    python fantoma/calcular_respuesta.py --nombre rama_b --id rec_20261005_101500_ab12 rec_...
    python fantoma/calcular_respuesta.py --nombre rama_a_40mm_8mm --wav toma1.wav toma2.wav
    # respuesta RELATIVA de una variante frente a la referencia (rama B, pieza comercial):
    python fantoma/calcular_respuesta.py --nombre rama_a_vs_b --wav a1.wav --referencia b1.wav

--id descarga el audio del servidor (por defecto http://localhost:8000; cambiar con --servidor).

Salida en IA/fantoma/salida/:
    <nombre>_respuesta.png   magnitud, fase y coherencia (para el informe y la presentación)
    <nombre>_h_2khz.npy      respuesta al impulso a 2 kHz -> python train_heart.py --dataset both --ir <archivo>
    <nombre>_resumen.json    ganancia por banda y bandas con coherencia baja (medición poco confiable)
"""
import argparse
import io
import json
import urllib.request
from pathlib import Path

import librosa
import matplotlib
import numpy as np
import soundfile as sf
from scipy.signal import coherence, fftconvolve, correlate

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from generar_barrido import FS, F1, F2, exp_sweep, inverse_filter, OUT  # noqa: E402

HEART_SR = 2000                      # frecuencia del modelo cardíaco (IA/src/features.py)
IR_PRE_S, IR_POST_S = 0.01, 0.25     # ventana alrededor del pico de la respuesta al impulso
BANDS = [30, 50, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000, 1500]


def load_audio(wav: str | None = None, rec_id: str | None = None, server: str = "") -> np.ndarray:
    if rec_id:
        with urllib.request.urlopen(f"{server.rstrip('/')}/api/recordings/{rec_id}/audio") as r:
            y, sr = sf.read(io.BytesIO(r.read()), dtype="float32", always_2d=False)
    else:
        y, sr = sf.read(wav, dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)
    return librosa.resample(y, orig_sr=sr, target_sr=FS) if sr != FS else y


def impulse_response(rec: np.ndarray, inv: np.ndarray) -> np.ndarray:
    """Deconvolución de Farina: la parte lineal queda como un pico; se recorta alrededor de él."""
    full = fftconvolve(rec, inv, mode="full")
    peak = int(np.argmax(np.abs(full)))
    a, b = max(0, peak - int(IR_PRE_S * FS)), peak + int(IR_POST_S * FS)
    h = full[a:b]
    h = h * np.hanning(2 * len(h))[len(h):] if len(h) > 8 else h   # cola suave al final
    return h / (np.max(np.abs(h)) + 1e-12)


def sweep_coherence(rec: np.ndarray, sweep: np.ndarray):
    """Coherencia entre el barrido emitido y lo grabado (alineados): 1 = medición confiable."""
    lag = int(np.argmax(correlate(rec, sweep, mode="valid", method="fft")))
    seg = rec[lag:lag + len(sweep)]
    if len(seg) < len(sweep):
        seg = np.pad(seg, (0, len(sweep) - len(seg)))
    return coherence(sweep, seg, fs=FS, nperseg=4096)


def spectrum(h: np.ndarray):
    n = 1 << int(np.ceil(np.log2(len(h) * 4)))
    H = np.fft.rfft(h, n)
    return np.fft.rfftfreq(n, 1 / FS), H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nombre", required=True, help="nombre de la variante (p. ej. rama_b, rama_a_40mm_8mm)")
    ap.add_argument("--wav", nargs="*", default=[])
    ap.add_argument("--id", nargs="*", default=[], help="IDs de grabación del servidor")
    ap.add_argument("--referencia", nargs="*", default=[], help="tomas de la referencia (wav) para respuesta relativa")
    ap.add_argument("--servidor", default="http://localhost:8000")
    args = ap.parse_args()

    takes = [load_audio(wav=w) for w in args.wav] + [load_audio(rec_id=i, server=args.servidor) for i in args.id]
    if not takes:
        raise SystemExit("Indica al menos una grabación con --wav o --id.")
    sweep, inv = exp_sweep(), inverse_filter(exp_sweep())

    irs = [impulse_response(t, inv) for t in takes]
    n = min(len(h) for h in irs)
    h = np.mean([x[:n] for x in irs], axis=0)
    f, H = spectrum(h)
    if args.referencia:
        refs = [impulse_response(load_audio(wav=w), inv) for w in args.referencia]
        m = min(len(x) for x in refs)
        _, Href = spectrum(np.mean([x[:m] for x in refs], axis=0))
        H = H / (Href + 1e-9 * np.max(np.abs(Href)))
        h = np.fft.irfft(H)[:n]

    band = (f >= F1) & (f <= F2)
    mag_db = 20 * np.log10(np.abs(H) + 1e-12)
    ref_db = np.median(mag_db[(f >= 100) & (f <= 600)])
    mag_db -= ref_db                                         # 0 dB = nivel típico en 100-600 Hz
    phase = np.unwrap(np.angle(H))
    cf, coh = np.mean([sweep_coherence(t, sweep)[0] for t in takes], axis=0), \
        np.mean([sweep_coherence(t, sweep)[1] for t in takes], axis=0)

    gains = {f"{b} Hz": round(float(np.interp(b, f, mag_db)), 1) for b in BANDS}
    low_coh = [f"{b} Hz" for b in BANDS if np.interp(b, cf, coh) < 0.8]
    summary = {
        "variante": args.nombre,
        "tomas": len(takes),
        "relativa_a_referencia": bool(args.referencia),
        "ganancia_db_vs_100_600Hz": gains,
        "caida_bajo_60Hz_db": round(float(np.interp(50, f, mag_db)), 1),
        "bandas_coherencia_baja": low_coh,
        "nota": "Bandas con coherencia < 0.8: la medición ahí no es confiable (ruido, fugas o resonancias).",
    }

    OUT.mkdir(exist_ok=True)
    h2k = librosa.resample(h.astype(np.float32), orig_sr=FS, target_sr=HEART_SR)
    np.save(OUT / f"{args.nombre}_h_2khz.npy", (h2k / (np.max(np.abs(h2k)) + 1e-12)).astype(np.float32))
    (OUT / f"{args.nombre}_resumen.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))

    fig, ax = plt.subplots(3, 1, figsize=(9, 9), sharex=True)
    ax[0].semilogx(f[band], mag_db[band]); ax[0].set_ylabel("Magnitud (dB)")
    ax[0].axvspan(F1, 60, color="red", alpha=0.08, label="< 60 Hz: el INMP441 atenúa")
    ax[0].axvspan(20, 150, color="orange", alpha=0.06, label="S1/S2 (20-150 Hz)"); ax[0].legend(loc="lower right")
    ax[1].semilogx(f[band], phase[band]); ax[1].set_ylabel("Fase (rad)")
    cb = (cf >= F1) & (cf <= F2)
    ax[2].semilogx(cf[cb], coh[cb]); ax[2].axhline(0.8, color="gray", ls="--")
    ax[2].set_ylabel("Coherencia"); ax[2].set_xlabel("Frecuencia (Hz)"); ax[2].set_ylim(0, 1.05)
    fig.suptitle(f"Respuesta del estetoscopio: {args.nombre} ({len(takes)} tomas)")
    fig.tight_layout()
    fig.savefig(OUT / f"{args.nombre}_respuesta.png", dpi=150)

    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\nArchivos en {OUT}. Para reentrenar con esta corrección:")
    print(f"  python train_heart.py --dataset both --ir fantoma/salida/{args.nombre}_h_2khz.npy --out heart_cnn_{args.nombre}")


if __name__ == "__main__":
    main()
