"""
Carga de ICBHI 2017 (sonidos respiratorios).

Busca los audios en CUALQUIER subcarpeta de data/ que siga el nombre oficial:
    <paciente>_<grabación>_<zona>_<modo>_<equipo>.wav   (p. ej. 101_1b1_Al_sc_Meditron.wav)
junto con su .txt de ciclos:  inicio  fin  crepitantes(0/1)  sibilancias(0/1)

Diagnóstico y partición train/test por paciente se leen de:
  1. data/ICBHI_organizado - .../paciente_<id>/datos_paciente_<id>.csv  (fichas del equipo), o
  2. patient_diagnosis.csv (Kaggle) / ICBHI_Challenge_diagnosis.txt (oficial), si existen.
"""
import csv
import re
from dataclasses import dataclass, field
from pathlib import Path


def rglob(root: Path, pattern: str):
    """Como Path.glob('**/patron'), pero entrando también en carpetas que son enlaces simbólicos."""
    import fnmatch
    import os
    for dirpath, _, files in os.walk(root, followlinks=True):
        for name in fnmatch.filter(files, pattern):
            yield Path(dirpath) / name

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
FILE_RE = re.compile(r"^(\d{3})_([0-9a-zA-Z]+)_(Tc|Al|Ar|Pl|Pr|Ll|Lr)_(sc|mc)_([A-Za-z0-9]+)\.wav$")

# Agrupación de diagnósticos (asma: 1 solo paciente -> se descarta)
DISEASE_GROUPS = {
    "Healthy": "sano",
    "COPD": "EPOC",
    "Pneumonia": "neumonía",
    "Bronchiectasis": "bronquiectasia",
    "Bronchiolitis": "bronquiolitis",
    "URTI": "infección respiratoria",
    "LRTI": "infección respiratoria",
}

CHEST_ZONES = {
    "Tc": "tráquea", "Al": "anterior izquierda", "Ar": "anterior derecha",
    "Pl": "posterior izquierda", "Pr": "posterior derecha", "Ll": "lateral izquierda", "Lr": "lateral derecha",
}


@dataclass
class LungRecording:
    path: Path
    patient: str
    zone: str
    device: str
    diagnosis: str                      # diagnóstico original (inglés)
    split: str                          # "train" | "test" (partición oficial por paciente)
    cycles: list[tuple[float, float, int, int]] = field(default_factory=list)  # (ini, fin, crep, sib)


def _diagnoses(data_dir: Path) -> dict[str, tuple[str, str]]:
    """paciente -> (diagnóstico, partición)"""
    out: dict[str, tuple[str, str]] = {}
    for f in rglob(data_dir, "datos_paciente_*.csv"):
        with open(f, newline="", encoding="utf-8") as fh:
            d = {r[0]: r[1] for r in csv.reader(fh) if len(r) >= 2}
        pid = d.get("ID Paciente", "").strip()
        part = d.get("Particion sugerida (train/validation)", "")
        out[pid] = (d.get("Diagnostico", "").strip(), "train" if part.lower().startswith("entren") else "test")
    for name in ("patient_diagnosis.csv", "ICBHI_Challenge_diagnosis.txt"):
        for f in rglob(data_dir, f"{name}"):
            with open(f, encoding="utf-8") as fh:
                for line in fh:
                    parts = re.split(r"[,\t]", line.strip())
                    if len(parts) >= 2 and parts[0].isdigit():
                        out.setdefault(parts[0], (parts[1].strip(), ""))
    return out


def _official_split(data_dir: Path) -> dict[str, str]:
    """grabación -> train/test si existe el archivo oficial de partición."""
    out = {}
    for f in rglob(data_dir, "ICBHI_challenge_train_test.txt"):
        for line in open(f, encoding="utf-8"):
            parts = line.split()
            if len(parts) == 2:
                out[parts[0]] = "train" if parts[1].startswith("train") else "test"
    return out


def _cycles(txt: Path) -> list[tuple[float, float, int, int]]:
    cyc = []
    if txt.exists():
        for line in open(txt, encoding="utf-8"):
            p = line.split()
            if len(p) >= 4:
                cyc.append((float(p[0]), float(p[1]), int(p[2]), int(p[3])))
    return cyc


def load_icbhi(data_dir: Path = DATA_DIR) -> list[LungRecording]:
    diag = _diagnoses(data_dir)
    official = _official_split(data_dir)
    seen, recs = set(), []
    for wav in sorted(rglob(data_dir, "*.wav")):
        m = FILE_RE.match(wav.name)
        if not m or wav.name in seen:
            continue  # ignora audios que no son de ICBHI (p. ej. PhysioNet) y duplicados
        seen.add(wav.name)
        pid, _, zone, _, device = m.groups()
        d, part = diag.get(pid, ("", ""))
        split = official.get(wav.stem) or part or ("train" if int(pid) % 10 < 6 else "test")
        recs.append(LungRecording(wav, pid, zone, device, d, split, _cycles(wav.with_suffix(".txt"))))
    return recs
