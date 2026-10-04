"""
Respaldo automático de los datos del servidor (fuera del repositorio).

- La base SQLite se copia con su API de respaldo (consistente aunque el servidor esté escribiendo, con WAL)
  a <destino>/db/telemetry_AAAAMMDD_HHMMSS.db; se conservan las últimas KEEP copias.
- Las grabaciones y los informes se reflejan en <destino>/recordings y <destino>/reports agregando solo
  los archivos nuevos o cambiados: el respaldo nunca borra nada de esas carpetas.
- <destino>/ultimo_respaldo.json guarda la hora, el tamaño y cuántos archivos se copiaron.

Variables: SPIROSCAN_BACKUP_DIR (por defecto ~/Documents/spirosan/respaldos) y
SPIROSCAN_BACKUP_MIN (minutos entre respaldos, por defecto 60; 0 lo apaga).
"""
import json
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import database

KEEP = 48
DEFAULT_DIR = Path.home() / "Documents" / "spirosan" / "respaldos"
_last_error: dict | None = None


def backup_dir() -> Path:
    return Path(os.getenv("SPIROSCAN_BACKUP_DIR", str(DEFAULT_DIR))).expanduser()


def interval_min() -> float:
    try:
        return max(0.0, float(os.getenv("SPIROSCAN_BACKUP_MIN", "60")))
    except ValueError:
        return 60.0


def _mirror(src: Path, dst: Path) -> int:
    """Copia a dst los archivos de src que falten o hayan cambiado de tamaño. Nunca borra."""
    if not src.is_dir():
        return 0
    copied = 0
    for f in src.rglob("*"):
        if not f.is_file():
            continue
        target = dst / f.relative_to(src)
        if target.exists() and target.stat().st_size == f.stat().st_size:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
        copied += 1
    return copied


def run_backup(dest: Path | None = None, keep: int = KEEP, folders: list[Path] | None = None) -> dict:
    """Hace un respaldo completo y devuelve su resumen (también queda en ultimo_respaldo.json)."""
    global _last_error
    dest = Path(dest or backup_dir())
    (dest / "db").mkdir(parents=True, exist_ok=True)
    started = datetime.now()
    target = dest / "db" / f"telemetry_{started:%Y%m%d_%H%M%S}.db"
    n = 1
    while target.exists():  # dos respaldos en el mismo segundo no se pisan
        target = dest / "db" / f"telemetry_{started:%Y%m%d_%H%M%S}_{n}.db"
        n += 1

    src = sqlite3.connect(database.DB_PATH)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    # Rotación por antigüedad; la copia recién hecha nunca se borra
    older = sorted((f for f in (dest / "db").glob("telemetry_*.db") if f != target), key=lambda f: f.stat().st_mtime)
    for old in older[:max(0, len(older) - (keep - 1))] if keep > 0 else []:
        old.unlink()

    if folders is None:
        import audio_service
        import reports
        folders = [Path(audio_service.REC_DIR), Path(reports.REPORT_DIR)]
    copied = {f.name: _mirror(Path(f), dest / Path(f).name) for f in folders}

    info = {
        "hora": started.isoformat(timespec="seconds"),
        "duracion_s": round((datetime.now() - started).total_seconds(), 2),
        "base": target.name,
        "base_bytes": target.stat().st_size,
        "copias_guardadas": len(list((dest / "db").glob("telemetry_*.db"))),
        "archivos_copiados": copied,
        "destino": str(dest),
    }
    (dest / "ultimo_respaldo.json").write_text(json.dumps(info, indent=2, ensure_ascii=False))
    _last_error = None
    return info


def record_error(error: Exception) -> None:
    global _last_error
    _last_error = {"hora": datetime.now().isoformat(timespec="seconds"), "error": str(error)}


def status() -> dict:
    dest = backup_dir()
    last = None
    f = dest / "ultimo_respaldo.json"
    if f.exists():
        try:
            last = json.loads(f.read_text())
        except (OSError, ValueError):
            last = None
    return {"activo": interval_min() > 0, "cada_min": interval_min(), "destino": str(dest),
            "ultimo": last, "error": _last_error}
