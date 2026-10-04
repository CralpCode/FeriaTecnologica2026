"""
Activa (o apaga) el ecualizador del servidor con una medición del fantoma.

Pasos previos (manual, sección 7.2):
    python fantoma/generar_barrido.py                       # barrido 20 Hz - 2 kHz para el parlante del fantoma
    (grabar el barrido con el estetoscopio desde la app, varias tomas)
    python fantoma/calcular_respuesta.py --nombre tpu_membrana --id rec_... rec_...

Luego:
    python fantoma/activar_ecualizador.py --nombre tpu_membrana              # corazón y pulmón
    python fantoma/activar_ecualizador.py --nombre tpu_membrana --modos corazon
    python fantoma/activar_ecualizador.py --apagar

Escribe Backend/models/ecualizador.json; el servidor lo relee solo (no hace falta reiniciarlo).
Solo se corrigen las bandas con coherencia >= 0.8, con un refuerzo máximo (12 dB por defecto).
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Backend"))
from ml import equalizer  # noqa: E402

SALIDA = Path(__file__).resolve().parent / "salida"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nombre", help="variante medida (archivo salida/<nombre>_resumen.json)")
    ap.add_argument("--modos", nargs="+", default=["corazon", "pulmon"], choices=["corazon", "pulmon"])
    ap.add_argument("--max-refuerzo", type=float, default=equalizer.DEFAULT_MAX_BOOST_DB)
    ap.add_argument("--apagar", action="store_true", help="desactiva el ecualizador")
    args = ap.parse_args()

    if args.apagar:
        equalizer.CONFIG_PATH.unlink(missing_ok=True)
        print("Ecualizador apagado.")
        return
    if not args.nombre:
        raise SystemExit("Indica --nombre (o --apagar).")
    resumen = json.loads((SALIDA / f"{args.nombre}_resumen.json").read_text(encoding="utf-8"))
    profile = equalizer.build_profile(resumen, max_boost_db=args.max_refuerzo)
    cfg = json.loads(equalizer.CONFIG_PATH.read_text(encoding="utf-8")) if equalizer.CONFIG_PATH.exists() else {}
    cfg.setdefault("perfiles", {}).update({m: profile for m in args.modos})
    equalizer.CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(profile, ensure_ascii=False, indent=2))
    if not profile["relativa_a_referencia"]:
        print("\nAviso: la medición no es relativa a una referencia; incluye la respuesta del parlante del fantoma.")
    print(f"\nEcualizador activo para: {', '.join(args.modos)} ({equalizer.CONFIG_PATH})")


if __name__ == "__main__":
    main()
