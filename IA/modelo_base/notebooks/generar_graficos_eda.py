"""
Script ejecutable para Análisis Exploratorio Acústico (EDA) y generación de figuras
Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (f tecno 2026)
"""

import sys
import os
from pathlib import Path

# Añadir directorio raíz al path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

import numpy as np
from src.data_loader import load_icbhi_dataset, print_icbhi_summary
from src.audio_processing import load_audio_normalized, butter_bandpass_filter, segment_cycle


def run_eda_export(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("1. Cargando registros del dataset ICBHI...")
    data = load_icbhi_dataset()
    print_icbhi_summary(data)
    
    try:
        import matplotlib
        matplotlib.use("Agg") # Backend sin GUI para exportar imágenes limpiamente
        import matplotlib.pyplot as plt
        import librosa
        import librosa.display
        
        import pandas as pd
        if not isinstance(data, pd.DataFrame):
            df = pd.DataFrame(data)
        else:
            df = data
            
        print("2. Generando figura de distribución clínica...")
        fig, axes = plt.subplots(1, 2, figsize=(16, 5))
        
        # Clases de ciclo
        class_counts = df["cycle_class_name"].value_counts()
        axes[0].bar(class_counts.index, class_counts.values, color=["#2b5c8f", "#d95f02", "#7570b3", "#e7298a"])
        axes[0].set_title("Distribución de Ciclos Respiratorios (ICBHI)", fontsize=13, fontweight="bold")
        axes[0].set_ylabel("Cantidad de Ciclos")
        axes[0].tick_params(axis="x", rotation=20)
        axes[0].grid(True, linestyle="--", alpha=0.6)
        
        # Diagnósticos
        pat_df = df.drop_duplicates(subset=["patient_id"])
        diag_counts = pat_df["diagnosis"].value_counts()
        axes[1].bar(diag_counts.index, diag_counts.values, color="#e41a1c")
        axes[1].set_title("Distribución de Pacientes por Diagnóstico", fontsize=13, fontweight="bold")
        axes[1].set_ylabel("Cantidad de Pacientes")
        axes[1].tick_params(axis="x", rotation=25)
        axes[1].grid(True, linestyle="--", alpha=0.6)
        
        dist_path = output_dir / "distribucion_clinica_icbhi.png"
        plt.tight_layout()
        plt.savefig(dist_path, dpi=200)
        plt.close()
        print(f"   -> Gráfica guardada en: {dist_path}")
        
        print("3. Generando figura comparativa acústica (Forma de onda vs Espectrograma Mel)...")
        # Ciclos representativos
        sample_normal = df[df["cycle_class"] == 0].iloc[0]
        sample_crackles = df[df["cycle_class"] == 1].iloc[0]
        sample_wheezes = df[df["cycle_class"] == 2].iloc[0]
        
        samples = [
            ("Normal (Sin ruidos anormales)", sample_normal),
            ("Crepitantes (Crackles - Ruidos discontinuos)", sample_crackles),
            ("Sibilancias (Wheezes - Ruidos musicales continuos)", sample_wheezes)
        ]
        
        fig, axes = plt.subplots(3, 2, figsize=(16, 9))
        TARGET_SR = 16000
        
        for idx, (title, row) in enumerate(samples):
            audio, sr = load_audio_normalized(row["audio_path"], target_sr=TARGET_SR)
            audio_filt = butter_bandpass_filter(audio, lowcut=100.0, highcut=2000.0, fs=TARGET_SR)
            cycle_audio = segment_cycle(audio_filt, row["start_time"], row["end_time"], sr=TARGET_SR, target_duration=4.0)
            
            # Dominio temporal
            time_axis = np.linspace(0, 4.0, len(cycle_audio))
            axes[idx, 0].plot(time_axis, cycle_audio, color="#1f77b4", linewidth=0.8)
            axes[idx, 0].set_title(f"{title} - Forma de Onda (16 kHz)", fontweight="bold")
            axes[idx, 0].set_ylabel("Amplitud Norm.")
            axes[idx, 0].set_ylim([-1.05, 1.05])
            axes[idx, 0].grid(True, linestyle=":", alpha=0.6)
            if idx == 2:
                axes[idx, 0].set_xlabel("Tiempo (segundos)")
                
            # Dominio frecuencial (Espectrograma Mel)
            mel_spec = librosa.feature.melspectrogram(y=cycle_audio, sr=TARGET_SR, n_fft=1024, hop_length=512, n_mels=64)
            mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max)
            img = librosa.display.specshow(mel_spec_db, sr=TARGET_SR, hop_length=512, x_axis="time", y_axis="mel", ax=axes[idx, 1], cmap="magma")
            axes[idx, 1].set_title(f"{title} - Espectrograma Mel", fontweight="bold")
            fig.colorbar(img, ax=axes[idx, 1], format="%+2.0f dB")
            if idx == 2:
                axes[idx, 1].set_xlabel("Tiempo (segundos)")
                
        plt.tight_layout()
        comp_path = output_dir / "comparativa_acustica_espectrogramas.png"
        plt.savefig(comp_path, dpi=200)
        plt.close()
        print(f"   -> Gráfica comparativa guardada en: {comp_path}")
        print("¡EDA Acústico completado con éxito!")
        
    except ImportError as e:
        print(f"Aviso: Librerías gráficas aún no disponibles en el entorno ({e}). Ejecutar tras completar la instalación de pip.")


if __name__ == "__main__":
    out = ROOT_DIR / "docs" / "figuras_eda"
    run_eda_export(out)
