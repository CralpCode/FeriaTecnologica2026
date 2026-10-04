"""
Benchmark y Comparación de Modelos de Machine Learning (Patient-Wise CV)
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

from src.evaluate import compute_icbhi_metrics, print_clinical_report


def run_model_benchmark(
    features_csv_path: str = "data/features_icbhi_dataset.csv"
):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import joblib
    
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import GroupKFold, GroupShuffleSplit
    from sklearn.pipeline import Pipeline
    from sklearn.ensemble import (
        RandomForestClassifier,
        ExtraTreesClassifier,
        HistGradientBoostingClassifier
    )
    from sklearn.svm import SVC
    from sklearn.linear_model import LogisticRegression
    
    csv_file = ROOT_DIR / features_csv_path
    if not csv_file.exists():
        print(f"No se encontró {csv_file}. Ejecutando extracción previa...")
        from src.extract_all_features import extract_and_save_all_features
        extract_and_save_all_features(features_csv_path)
        
    print("=" * 70)
    print("   BENCHMARK CLÍNICO DE MODELOS DE MACHINE LEARNING (ICBHI)")
    print("=" * 70)
    
    df = pd.read_csv(csv_file)
    print(f"• Dataset cargado: {len(df)} ciclos respiratorios de {df['patient_id'].nunique()} pacientes.")
    
    # Identificar columnas acústicas (todas las que no son metadatos)
    metadata_cols = {
        "cycle_id", "patient_id", "category", "age", "age_group", "sex",
        "diagnosis", "bmi", "partition_suggested", "recording_name",
        "start_time", "end_time", "duration", "crackles", "wheezes",
        "cycle_class", "cycle_class_name", "is_abnormal"
    }
    feature_cols = [c for c in df.columns if c not in metadata_cols]
    print(f"• Total de características acústicas predictoras: {len(feature_cols)}")
    
    X = df[feature_cols].values.astype(np.float32)
    # y: Tarea de Detección de Anomalías (0: Normal, 1: Patológico)
    y_binary = df["is_abnormal"].values.astype(np.int64)
    y_multiclass = df["cycle_class"].values.astype(np.int64)
    groups = df["patient_id"].values
    
    # 5 Modelos a comparar
    models = {
        "Random Forest": RandomForestClassifier(
            n_estimators=150, max_depth=14, class_weight="balanced", random_state=42, n_jobs=-1
        ),
        "Extra Trees": ExtraTreesClassifier(
            n_estimators=150, max_depth=14, class_weight="balanced", random_state=42, n_jobs=-1
        ),
        "HistGradientBoosting": HistGradientBoostingClassifier(
            max_iter=150, class_weight="balanced", random_state=42
        ),
        "SVM (RBF Kernel)": SVC(
            C=2.0, kernel="rbf", gamma="scale", class_weight="balanced", random_state=42
        ),
        "Logistic Regression (L2)": LogisticRegression(
            C=1.0, max_iter=1000, class_weight="balanced", random_state=42
        )
    }
    
    print("\nIniciando Validación Cruzada por Paciente (5-Fold GroupKFold)...")
    print("Garantía: Ningún paciente se comparte entre entrenamiento y validación.")
    print("-" * 70)
    
    gkf = GroupKFold(n_splits=5)
    benchmark_results = []
    
    for model_name, clf in models.items():
        print(f"\nEvaluando: {model_name}...")
        t0 = time.time()
        
        fold_se, fold_sp, fold_score, fold_f1, fold_acc = [], [], [], [], []
        
        for fold, (train_idx, val_idx) in enumerate(gkf.split(X, y_binary, groups=groups), 1):
            X_tr, X_val = X[train_idx], X[val_idx]
            y_tr, y_val = y_binary[train_idx], y_binary[val_idx]
            
            # Escalamiento estándar por fold para evitar data leakage
            scaler = StandardScaler()
            X_tr_scaled = scaler.fit_transform(X_tr)
            X_val_scaled = scaler.transform(X_val)
            
            clf.fit(X_tr_scaled, y_tr)
            preds = clf.predict(X_val_scaled)
            
            metrics = compute_icbhi_metrics(y_val, preds)
            fold_se.append(metrics["sensitivity"])
            fold_sp.append(metrics["specificity"])
            fold_score.append(metrics["icbhi_score"])
            fold_f1.append(metrics["f1_macro"])
            fold_acc.append(float(np.mean(preds == y_val)))
            
        elapsed = time.time() - t0
        mean_se = np.mean(fold_se) * 100
        mean_sp = np.mean(fold_sp) * 100
        mean_score = np.mean(fold_score) * 100
        mean_f1 = np.mean(fold_f1) * 100
        mean_acc = np.mean(fold_acc) * 100
        
        print(f"  -> Se: {mean_se:5.2f}% | Sp: {mean_sp:5.2f}% | SCORE ICBHI: {mean_score:5.2f}% | F1: {mean_f1:5.2f}% ({elapsed:.1f}s)")
        
        benchmark_results.append({
            "Modelo": model_name,
            "Sensibilidad (%)": round(mean_se, 2),
            "Especificidad (%)": round(mean_sp, 2),
            "Score ICBHI (%)": round(mean_score, 2),
            "F1-Score Macro (%)": round(mean_f1, 2),
            "Exactitud (%)": round(mean_acc, 2),
            "Tiempo (s)": round(elapsed, 2)
        })
        
    results_df = pd.DataFrame(benchmark_results).sort_values(by="Score ICBHI (%)", ascending=False)
    
    print("\n" + "=" * 70)
    print("   TABLA COMPARATIVA FINAL DE RENDIMIENTO CLÍNICO")
    print("=" * 70)
    print(results_df.to_string(index=False))
    print("=" * 70)
    
    # 4. Generar gráfica de barras comparativa
    out_fig_dir = ROOT_DIR / "docs" / "figuras_eda"
    out_fig_dir.mkdir(parents=True, exist_ok=True)
    fig_path = out_fig_dir / "comparativa_modelos_icbhi.png"
    
    fig, ax = plt.subplots(figsize=(12, 6))
    x_indices = np.arange(len(results_df))
    width = 0.25
    
    ax.bar(x_indices - width, results_df["Sensibilidad (%)"], width, label="Sensibilidad (Se)", color="#d95f02")
    ax.bar(x_indices, results_df["Especificidad (%)"], width, label="Especificidad (Sp)", color="#2b5c8f")
    ax.bar(x_indices + width, results_df["Score ICBHI (%)"], width, label="Score ICBHI Oficial", color="#7570b3")
    
    ax.set_title("Comparativa de Modelos de Machine Learning en ICBHI (5-Fold Patient-Wise)", fontsize=13, fontweight="bold")
    ax.set_ylabel("Rendimiento (%)", fontsize=11)
    ax.set_xticks(x_indices)
    ax.set_xticklabels(results_df["Modelo"], rotation=15, ha="right", fontsize=10)
    ax.set_ylim(0, 100)
    ax.legend(loc="lower right")
    ax.grid(True, linestyle="--", alpha=0.5)
    
    for i in x_indices:
        score_val = results_df.iloc[i]["Score ICBHI (%)"]
        ax.annotate(f"{score_val:.1f}%",
                    (i + width, score_val + 1.5),
                    ha="center", fontsize=9, fontweight="bold")
                    
    plt.tight_layout()
    plt.savefig(fig_path, dpi=200)
    plt.close()
    print(f"\n📊 Gráfica comparativa guardada en: {fig_path}")
    
    # 5. Entrenar y Serializar el Modelo Campeón
    best_model_name = results_df.iloc[0]["Modelo"]
    best_clf = models[best_model_name]
    print(f"\n🏆 Modelo Campeón Seleccionado: {best_model_name}")
    
    champion_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", best_clf)
    ])
    
    champion_pipeline.fit(X, y_binary)
    champion_path = ROOT_DIR / "models" / "mejor_clasificador_icbhi.joblib"
    champion_path.parent.mkdir(parents=True, exist_ok=True)
    
    joblib.dump({
        "pipeline": champion_pipeline,
        "feature_names": feature_cols,
        "class_names": ["Normal", "Patologico (Sibilancias/Crepitantes)"],
        "benchmark_summary": results_df.to_dict(orient="records"),
        "best_model_name": best_model_name
    }, champion_path)
    
    print(f"✅ Modelo Campeón serializado en: {champion_path}")
    print("=" * 70)


if __name__ == "__main__":
    run_model_benchmark()
