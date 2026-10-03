"""
Carga de los datasets cardíacos con su etiqueta y su GRUPO (paciente) para particionar sin fugas.

- PhysioNet 2016: data/training/training-{a..f}/  (REFERENCE.csv: 1 = anormal, -1 = normal)
  No publica ID de paciente, así que el grupo es el propio registro.
  OJO: la carpeta "validation - pruebas realizadas" es una COPIA de 301 registros de training;
  nunca debe usarse como conjunto de prueba.
- CirCor DigiScope 2022: data/circor/.../training_data.csv + training_data/*.wav
  Etiqueta por grabación: 1 si el foco está en "Murmur locations"; 0 si el paciente no tiene
  soplo. Se descartan pacientes "Unknown" y los focos sin soplo de pacientes con soplo
  (etiqueta ambigua).
"""
from dataclasses import dataclass
from pathlib import Path
import csv

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@dataclass
class Recording:
    path: Path
    label: int          # 1 = anormal / soplo, 0 = normal
    group: str          # paciente (o registro si no hay ID de paciente)
    source: str         # physionet-a..f | circor
    location: str = ""  # foco de auscultación (AV, PV, TV, MV) si se conoce


def load_physionet() -> list[Recording]:
    recs = []
    for sub in sorted((DATA_DIR / "training").glob("training-*")):
        with open(sub / "REFERENCE.csv") as f:
            for rid, lab in csv.reader(f):
                wav = sub / f"{rid}.wav"
                if wav.exists():
                    recs.append(Recording(wav, int(lab == "1"), f"pn_{rid}", f"physionet-{sub.name[-1]}"))
    return recs


def _circor_root() -> Path | None:
    hits = list((DATA_DIR / "circor").glob("**/training_data.csv"))
    return hits[0].parent if hits else None


def load_circor() -> list[Recording]:
    root = _circor_root()
    if root is None:
        return []
    recs = []
    with open(root / "training_data.csv", newline="") as f:
        for row in csv.DictReader(f):
            pid = row["Patient ID"]
            murmur = row["Murmur"]
            if murmur == "Unknown":
                continue
            murmur_locs = set(filter(None, (row.get("Murmur locations") or "").split("+")))
            for wav in sorted((root / "training_data").glob(f"{pid}_*.wav")):
                loc = wav.stem.split("_")[1]
                if murmur == "Present":
                    if loc not in murmur_locs:
                        continue
                    label = 1
                else:
                    label = 0
                recs.append(Recording(wav, label, f"cc_{pid}", "circor", loc))
    return recs


def load(dataset: str) -> list[Recording]:
    if dataset == "physionet":
        return load_physionet()
    if dataset == "circor":
        return load_circor()
    if dataset == "both":
        return load_physionet() + load_circor()
    raise ValueError(f"dataset desconocido: {dataset}")
