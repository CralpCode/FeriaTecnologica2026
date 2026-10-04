"""
Script de Extracción Masiva y Persistencia de Características Acústicas (ICBHI Completo)
Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (f tecno 2026)
"""

import sys
import os
import time
from pathlib import Path
import numpy as np
import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from src.data_loader import load_icbhi_dataset, print_icbhi_summary
from src.audio_processing import load_audio_normalized, butter_bandpass_filter, segment_cycle
from src.feature_extraction import extract_cycle_features


def extract_and_save_all_features(
    output_csv_path: str = "data/features_icbhi_dataset.csv"
):
    start_time = time.time()
    out_file = ROOT_DIR / output_csv_path
    
    print("=" * 65)
    print("   EXTRACCIÓN MASIVA DE CARACTERÍSTICAS (DATASET COMPLETO)")
    print("=" * 65)
    
    print("1. Cargando metadatos y pares de audios ICBHI...")
    df = load_icbhi_dataset()
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
        
    total_cycles = len(df)
    total_recordings = df["recording_name"].nunique()
    total_patients = df["patient_id"].nunique()
    print(f"• Total de ciclos a procesar: {total_cycles}")
    print(f"• Total de grabaciones únicas: {total_recordings}")
    print(f"• Total de pacientes:          {total_patients}")
    print("-" * 65)
    
    TARGET_SR = 16000
    audio_cache = {}
    feature_rows = []
    
    print("2. Iniciando filtrado DSP a 16 kHz y extracción de 61 variables...")
    
    # Agrupar por ruta de audio para procesar de forma ultra eficiente
    grouped = df.groupby("audio_path")
    processed_count = 0
    
    for audio_path, group in grouped:
        try:
            # Cargar y filtrar una sola vez por archivo de audio
            audio, sr = load_audio_normalized(audio_path, target_sr=TARGET_SR)
            audio_filt = butter_bandpass_filter(audio, lowcut=100.0, highcut=2000.0, fs=TARGET_SR)
        except Exception as e:
            print(f"Error procesando {audio_path}: {e}")
            continue
            
        for _, row in group.iterrows():
            cycle_audio = segment_cycle(
                audio_filt,
                row["start_time"],
                row["end_time"],
                sr=TARGET_SR,
                target_duration=4.0
            )
            
            feats = extract_cycle_features(cycle_audio, sr=TARGET_SR, n_mfcc=13)
            
            # Combinar metadatos del ciclo con características acústicas
            cycle_record = {
                "cycle_id": row["cycle_id"],
                "patient_id": row["patient_id"],
                "category": row["category"],
                "age": row["age"],
                "age_group": row["age_group"],
                "sex": row["sex"],
                "diagnosis": row["diagnosis"],
                "bmi": row["bmi"],
                "partition_suggested": row["partition_suggested"],
                "recording_name": row["recording_name"],
                "start_time": row["start_time"],
                "end_time": row["end_time"],
                "duration": row["duration"],
                "crackles": row["crackles"],
                "wheezes": row["wheezes"],
                "cycle_class": row["cycle_class"],
                "cycle_class_name": row["cycle_class_name"],
                "is_abnormal": row["is_abnormal"],
                **feats
            }
            feature_rows.append(cycle_record)
            processed_count += 1
            
            if processed_count % 500 == 0 or processed_count == total_cycles:
                elapsed = time.time() - start_time
                rate = processed_count / elapsed if elapsed > 0 else 0
                print(f"  -> {processed_count}/{total_cycles} ciclos procesados ({rate:.1f} ciclos/seg)...")
                
    features_df = pd.DataFrame(feature_rows)
    print(f"\n3. Guardando dataset estructurado en: {out_file}...")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    features_df.to_csv(out_file, index=False)
    
    total_elapsed = time.time() - start_time
    print(f"✅ Extracción completada en {total_elapsed:.1f} segundos.")
    print(f"• Dimensiones del dataset final: {features_df.shape} (filas, columnas)")
    print(f"• Archivo generado: {out_file.name} ({out_file.stat().st_size / (1024*1024):.2f} MB)")
    print("=" * 65)


if __name__ == "__main__":
    extract_and_save_all_features()
