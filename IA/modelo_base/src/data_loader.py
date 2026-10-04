"""
Módulo de Carga e Ingesta de Datos Clínicos (ICBHI 2017 y PhysioNet 2016)
Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (f tecno 2026)
"""

import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
import csv

# Mapeo de clases de ciclos respiratorios (ICBHI 4-class)
CYCLE_CLASSES = {
    0: "Normal",
    1: "Crackles (Crepitantes)",
    2: "Wheezes (Sibilancias)",
    3: "Both (Ambos)"
}

DEFAULT_ICBHI_DIR = Path(__file__).resolve().parent.parent / "data" / "ICBHI_organizado - pacientes de los links filtrados"
DEFAULT_PHYSIONET_TRAIN_DIR = Path(__file__).resolve().parent.parent / "data" / "training"
DEFAULT_PHYSIONET_VAL_DIR = Path(__file__).resolve().parent.parent / "data" / "validation - pruebas realizadas"


def parse_patient_csv(csv_path: Union[str, Path]) -> Dict[str, str]:
    """
    Lee la ficha datos_paciente_<id>.csv y devuelve un diccionario con los metadatos clínicos.
    """
    meta = {}
    csv_path = Path(csv_path)
    if not csv_path.exists():
        return meta
        
    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for row in reader:
            if len(row) >= 2:
                campo = row[0].strip()
                valor = row[1].strip()
                meta[campo] = valor
    return meta


def parse_annotation_txt(txt_path: Union[str, Path]) -> List[Dict[str, Union[float, int]]]:
    """
    Lee un archivo de anotaciones de ciclos ICBHI (.txt) con formato:
    <inicio_s>  <fin_s>  <crackles>  <wheezes>
    """
    cycles = []
    txt_path = Path(txt_path)
    if not txt_path.exists():
        return cycles
        
    with open(txt_path, mode="r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 4:
                try:
                    start_s = float(parts[0])
                    end_s = float(parts[1])
                    crackles = int(parts[2])
                    wheezes = int(parts[3])
                    
                    # Determinación de clase (0: Normal, 1: Crepitantes, 2: Sibilancias, 3: Ambos)
                    if crackles == 0 and wheezes == 0:
                        class_id = 0
                    elif crackles == 1 and wheezes == 0:
                        class_id = 1
                    elif crackles == 0 and wheezes == 1:
                        class_id = 2
                    else:
                        class_id = 3
                        
                    cycles.append({
                        "start_time": start_s,
                        "end_time": end_s,
                        "duration": round(end_s - start_s, 4),
                        "crackles": crackles,
                        "wheezes": wheezes,
                        "cycle_class": class_id,
                        "cycle_class_name": CYCLE_CLASSES[class_id],
                        "is_abnormal": int(class_id > 0)
                    })
                except ValueError:
                    continue
    return cycles


def load_icbhi_dataset(base_dir: Optional[Union[str, Path]] = None):
    """
    Recorre toda la jerarquía de ICBHI organizado e indexa:
    - Pacientes y metadatos clínicos (edad, sexo, IMC, patología general).
    - Grabaciones de audio (.wav) y archivos de anotación (.txt).
    - Cada ciclo respiratorio individual identificado.
    
    Retorna un pandas.DataFrame si pandas está instalado, o una lista de diccionarios si no.
    """
    base_path = Path(base_dir) if base_dir else DEFAULT_ICBHI_DIR
    if not base_path.exists():
        raise FileNotFoundError(f"No se encontró el directorio de ICBHI en: {base_path}")
        
    records = []
    
    # Recorrer categorías
    for cat_dir in sorted(base_path.iterdir()):
        if not cat_dir.is_dir() or cat_dir.name.startswith("."):
            continue
            
        category_name = cat_dir.name
        
        # Recorrer carpetas de paciente (ej. paciente_104)
        for patient_dir in sorted(cat_dir.iterdir()):
            if not patient_dir.is_dir() or patient_dir.name.startswith("."):
                continue
                
            patient_folder_name = patient_dir.name
            patient_id = patient_folder_name.replace("paciente_", "")
            
            # Buscar ficha datos_paciente_<id>.csv
            csv_file = patient_dir / f"datos_paciente_{patient_id}.csv"
            meta = parse_patient_csv(csv_file)
            
            edad = meta.get("Edad (anos)", "")
            grupo_edad = meta.get("Grupo de edad", "")
            sexo = meta.get("Sexo", "")
            diagnostico = meta.get("Diagnostico", "")
            bmi = meta.get("BMI adulto (kg/m2)", "")
            particion = meta.get("Particion sugerida (train/validation)", "")
            
            # Audios
            audios_dir = patient_dir / "audios"
            if not audios_dir.exists():
                continue
                
            # Listar pares .wav y .txt
            for wav_file in sorted(audios_dir.glob("*.wav")):
                txt_file = wav_file.with_suffix(".txt")
                if not txt_file.exists():
                    continue
                    
                recording_name = wav_file.stem
                
                # Parsear los ciclos del archivo .txt
                cycles = parse_annotation_txt(txt_file)
                for cycle_idx, cycle in enumerate(cycles):
                    cycle_id = f"{recording_name}_c{cycle_idx:02d}"
                    records.append({
                        "cycle_id": cycle_id,
                        "patient_id": patient_id,
                        "category": category_name,
                        "age": edad,
                        "age_group": grupo_edad,
                        "sex": sexo,
                        "diagnosis": diagnostico,
                        "bmi": bmi,
                        "partition_suggested": particion,
                        "recording_name": recording_name,
                        "audio_path": str(wav_file),
                        "annotation_path": str(txt_file),
                        "cycle_index": cycle_idx,
                        "start_time": cycle["start_time"],
                        "end_time": cycle["end_time"],
                        "duration": cycle["duration"],
                        "crackles": cycle["crackles"],
                        "wheezes": cycle["wheezes"],
                        "cycle_class": cycle["cycle_class"],
                        "cycle_class_name": cycle["cycle_class_name"],
                        "is_abnormal": cycle["is_abnormal"]
                    })
                    
    # Intentar retornar como pandas.DataFrame si está disponible
    try:
        import pandas as pd
        return pd.DataFrame(records)
    except ImportError:
        return records


def print_icbhi_summary(df_or_records):
    """
    Imprime un resumen estadístico clínico completo del dataset ICBHI cargado.
    """
    try:
        import pandas as pd
        if isinstance(df_or_records, list):
            df = pd.DataFrame(df_or_records)
        else:
            df = df_or_records
            
        total_cycles = len(df)
        total_patients = df["patient_id"].nunique()
        total_recordings = df["recording_name"].nunique()
        
        print("=" * 65)
        print("   RESUMEN CLÍNICO Y ESTADÍSTICO DEL DATASET ICBHI 2017")
        print("=" * 65)
        print(f"• Total de Pacientes Únicos:      {total_patients}")
        print(f"• Total de Grabaciones de Audio: {total_recordings}")
        print(f"• Total de Ciclos Respiratorios: {total_cycles}")
        print("-" * 65)
        print("DISTRIBUCIÓN DE CLASES A NIVEL DE CICLO:")
        class_counts = df["cycle_class_name"].value_counts()
        for cname, count in class_counts.items():
            pct = (count / total_cycles) * 100
            print(f"  - {cname:<26}: {count:>5} ciclos ({pct:5.2f}%)")
        print("-" * 65)
        print("DISTRIBUCIÓN DE DIAGNÓSTICOS GENERALES (A NIVEL DE PACIENTE):")
        pat_df = df.drop_duplicates(subset=["patient_id"])
        diag_counts = pat_df["diagnosis"].value_counts()
        for diag, count in diag_counts.items():
            pct = (count / total_patients) * 100
            print(f"  - {diag:<26}: {count:>5} pacientes ({pct:5.2f}%)")
        print("=" * 65)
    except ImportError:
        from collections import Counter
        total_cycles = len(df_or_records)
        patients = set(r["patient_id"] for r in df_or_records)
        recordings = set(r["recording_name"] for r in df_or_records)
        
        print("=" * 65)
        print("   RESUMEN CLÍNICO Y ESTADÍSTICO DEL DATASET ICBHI 2017")
        print("=" * 65)
        print(f"• Total de Pacientes Únicos:      {len(patients)}")
        print(f"• Total de Grabaciones de Audio: {len(recordings)}")
        print(f"• Total de Ciclos Respiratorios: {total_cycles}")
        print("-" * 65)
        print("DISTRIBUCIÓN DE CLASES A NIVEL DE CICLO:")
        class_counts = Counter(r["cycle_class_name"] for r in df_or_records)
        for cname, count in sorted(class_counts.items(), key=lambda x: x[1], reverse=True):
            pct = (count / total_cycles) * 100
            print(f"  - {cname:<26}: {count:>5} ciclos ({pct:5.2f}%)")
        print("-" * 65)
        print("DISTRIBUCIÓN DE DIAGNÓSTICOS GENERALES (A NIVEL DE PACIENTE):")
        pat_diags = {}
        for r in df_or_records:
            pat_diags[r["patient_id"]] = r["diagnosis"]
        diag_counts = Counter(pat_diags.values())
        for diag, count in sorted(diag_counts.items(), key=lambda x: x[1], reverse=True):
            pct = (count / len(patients)) * 100
            print(f"  - {diag:<26}: {count:>5} pacientes ({pct:5.2f}%)")
        print("=" * 65)


if __name__ == "__main__":
    print("Cargando base de datos ICBHI organizada...")
    data = load_icbhi_dataset()
    print_icbhi_summary(data)
