"""
Script de Entrenamiento y Validación de Modelos Clínicos de Clasificación
Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (f tecno 2026)
"""

import sys
import os
from pathlib import Path
import argparse
from typing import Tuple, List, Dict
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from src.data_loader import load_icbhi_dataset, print_icbhi_summary
from src.audio_processing import load_audio_normalized, butter_bandpass_filter, segment_cycle
from src.feature_extraction import extract_cycle_features
from src.evaluate import compute_icbhi_metrics, print_clinical_report


def extract_features_from_dataset(df, max_cycles_per_class: int = None) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[str]]:
    """
    Procesa los audios del dataset, filtra a 16 kHz y extrae el vector tabular de características.
    Retorna:
    - X: matriz de características (n_muestras, n_features)
    - y: vector de etiquetas de ciclo (0: Normal, 1: Crackles, 2: Wheezes, 3: Both)
    - groups: vector de patient_id para asegurar la partición patient-wise
    - feature_names: lista de nombres de variables
    """
    import pandas as pd
    
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
        
    if max_cycles_per_class:
        # Submuestreo balanceado para prototipado rápido
        sampled_dfs = []
        for c in df["cycle_class"].unique():
            cdf = df[df["cycle_class"] == c]
            sampled_dfs.append(cdf.head(max_cycles_per_class))
        df_to_process = pd.concat(sampled_dfs).sample(frac=1.0, random_state=42).reset_index(drop=True)
    else:
        df_to_process = df
        
    print(f"Extrayendo características acústicas para {len(df_to_process)} ciclos respiratorios...")
    
    feature_rows = []
    labels = []
    patient_groups = []
    feature_names = None
    
    # Cache simple de audio para no releer el archivo .wav en cada ciclo del mismo registro
    audio_cache = {}
    TARGET_SR = 16000
    
    for idx, row in df_to_process.iterrows():
        audio_path = row["audio_path"]
        
        if audio_path not in audio_cache:
            try:
                audio, sr = load_audio_normalized(audio_path, target_sr=TARGET_SR)
                audio_filt = butter_bandpass_filter(audio, lowcut=100.0, highcut=2000.0, fs=TARGET_SR)
                audio_cache[audio_path] = audio_filt
            except Exception as e:
                continue
                
        audio_filt = audio_cache[audio_path]
        cycle_audio = segment_cycle(audio_filt, row["start_time"], row["end_time"], sr=TARGET_SR, target_duration=4.0)
        
        feats = extract_cycle_features(cycle_audio, sr=TARGET_SR, n_mfcc=13)
        if feature_names is None:
            feature_names = sorted(feats.keys())
            
        feat_vector = [feats[k] for k in feature_names]
        feature_rows.append(feat_vector)
        labels.append(row["cycle_class"])
        patient_groups.append(row["patient_id"])
        
        if (len(feature_rows) % 100) == 0:
            print(f"  -> Procesados {len(feature_rows)}/{len(df_to_process)} ciclos...")
            
    X = np.array(feature_rows, dtype=np.float32)
    y = np.array(labels, dtype=np.int64)
    groups = np.array(patient_groups)
    
    return X, y, groups, feature_names


def train_and_evaluate_baseline(
    max_cycles: int = 500,
    model_output_path: str = "models/clasificador_respiratorio.joblib"
):
    """
    Entrena un clasificador Random Forest utilizando validación cruzada por paciente (GroupShuffleSplit)
    para evitar contaminación de datos entre entrenamiento y prueba.
    """
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import GroupShuffleSplit
    from sklearn.pipeline import Pipeline
    import joblib
    
    print("1. Cargando base de datos ICBHI...")
    df = load_icbhi_dataset()
    
    print("2. Extrayendo características (modo rápido para validación inicial)...")
    X, y, groups, feat_names = extract_features_from_dataset(df, max_cycles_per_class=max_cycles // 4 if max_cycles else None)
    
    print(f"Dataset estructurado: X = {X.shape}, y = {y.shape}, Pacientes únicos = {len(np.unique(groups))}")
    
    # Partición Patient-Wise estricta (80% pacientes para Train, 20% para Test)
    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(gss.split(X, y, groups=groups))
    
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]
    train_patients = np.unique(groups[train_idx])
    test_patients = np.unique(groups[test_idx])
    
    print(f"\nPartición Patient-Wise completada:")
    print(f"  • Muestras de Entrenamiento: {len(X_train)} (de {len(train_patients)} pacientes)")
    print(f"  • Muestras de Validación:    {len(X_test)} (de {len(test_patients)} pacientes)")
    
    # Pipeline con escalamiento y clasificador
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", RandomForestClassifier(
            n_estimators=150,
            max_depth=12,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1
        ))
    ])
    
    print("\n3. Entrenando clasificador Random Forest ponderado...")
    pipeline.fit(X_train, y_train)
    
    print("4. Evaluando en conjunto de prueba clínico...")
    y_pred = pipeline.predict(X_test)
    
    class_names = ["Normal", "Crackles", "Wheezes", "Both"]
    metrics = compute_icbhi_metrics(y_test, y_pred, class_names=class_names)
    print_clinical_report(metrics, title="EVALUACIÓN CLÍNICA DEL MODELO BASELINE (ICBHI)")
    
    # Guardar modelo
    out_file = ROOT_DIR / model_output_path
    out_file.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": pipeline, "feature_names": feat_names, "class_names": class_names}, out_file)
    print(f"\n✅ Modelo serializado exitosamente en: {out_file}")


if __name__ == "__main__":
    train_and_evaluate_baseline(max_cycles=400)
