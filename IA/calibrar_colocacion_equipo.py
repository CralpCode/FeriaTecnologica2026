"""
Calibra el control de colocación del corazón con ESTE estetoscopio (Backend/ml/placement.py).

El umbral clínico (calibrar_colocacion.py) sale de estetoscopios de hospital; con el equipo del proyecto casi
ninguna grabación lo pasa. Aquí el umbral sale de grabaciones del propio equipo, hechas en la app:

- Paciente con código CALIBBUENO: grabaciones del corazón en silencio, estetoscopio quieto y presión firme.
- Paciente con código CALIBRUIDO: grabaciones con roce o movimiento del estetoscopio, hablando cerca,
  con música o fuera del pecho.

Se mide la misma periodicidad que usa el servidor (placement.measure). Si los dos grupos se separan, el umbral
queda a la mitad entre la buena más baja y la de ruido más alta, y el control BLOQUEA: sin latidos claros el
servidor no da normal ni anormal. Si se traslapan no se escribe nada (nunca se inventa un umbral).

Uso:  python calibrar_colocacion_equipo.py [--minimo 8] [--solo-mostrar]
Salida: bloque corazon.equipo de Backend/models/colocacion.json (el resto del archivo se conserva).
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT.parent / "Backend"
sys.path.insert(0, str(BACKEND))
from ml import placement  # noqa: E402

DB = BACKEND / "telemetry.db"
OUT = BACKEND / "models" / "colocacion.json"
GROUPS = {"buenas": "calibbueno", "ruido": "calibruido"}   # prefijo del session_id (código del paciente en la app)


def proponer_umbral(buenas: list[float], ruido: list[float], minimo: int) -> tuple[float | None, str]:
    """Umbral a la mitad entre grupos separados; None (con el motivo) si faltan grabaciones o se traslapan."""
    if len(buenas) < minimo or len(ruido) < minimo:
        return None, f"Faltan grabaciones: {len(buenas)} buenas y {len(ruido)} con ruido (mínimo {minimo} de cada una)."
    lo_good, hi_noise = min(buenas), max(ruido)
    if lo_good <= hi_noise:
        return None, (f"Los grupos se traslapan: la buena más baja ({lo_good:.3f}) no supera a la de ruido más alta "
                      f"({hi_noise:.3f}). No se fija umbral; revisa esas grabaciones o repítelas.")
    return round((lo_good + hi_noise) / 2, 4), "Grupos separados."


def leer_grupo(conn, prefix: str) -> list[tuple[str, float]]:
    rows = conn.execute("SELECT id, wav_path FROM recordings WHERE session_id LIKE ? ESCAPE '\\' AND mode = 'corazon' "
                        "AND source = 'real' ORDER BY created_at", (prefix + "\\_%",)).fetchall()
    out = []
    for rec_id, wav in rows:
        if not wav or not Path(wav).exists():
            continue
        y, sr = sf.read(wav, dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = y.mean(1)
        out.append((rec_id, placement.measure(y, sr, "corazon")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minimo", type=int, default=8)
    ap.add_argument("--solo-mostrar", action="store_true")
    args = ap.parse_args()

    conn = sqlite3.connect(str(DB))
    groups = {name: leer_grupo(conn, prefix) for name, prefix in GROUPS.items()}
    conn.close()
    for name, items in groups.items():
        print(f"{name}: {len(items)} grabaciones")
        for rec_id, value in items:
            print(f"   {rec_id}  periodicidad {value:.3f}")

    buenas = [v for _, v in groups["buenas"]]
    ruido = [v for _, v in groups["ruido"]]
    thr, why = proponer_umbral(buenas, ruido, args.minimo)
    print(why)
    if thr is None or args.solo_mostrar:
        return 1 if thr is None else 0

    cfg = json.loads(OUT.read_text())
    cfg.setdefault("corazon", {})["equipo"] = {
        "umbral": thr, "n_buenas": len(buenas), "n_ruido": len(ruido),
        "min_buenas": round(min(buenas), 4), "max_ruido": round(max(ruido), 4),
        "generado": datetime.now().isoformat(timespec="seconds"),
        "nota": "Calibrado con el estetoscopio del proyecto: sin latidos claros el corazón pide repetir.",
    }
    OUT.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    print(f"Umbral del equipo: {thr:.3f} (buena más baja {min(buenas):.3f}, ruido más alto {max(ruido):.3f}). "
          f"Guardado en {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
