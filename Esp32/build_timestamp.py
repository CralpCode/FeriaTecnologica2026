"""Ancla de tiempo de compilación para TLS mientras se sincroniza NTP.
Se conserva durante 24 h para no recompilar todo en cada carga.
"""
import time
from pathlib import Path
Import('env')
now = int(time.time())
path = Path(env['PROJECT_DIR']) / '.pio' / 'time_anchor.txt'
try:
    anchor = int(path.read_text())
except (OSError, ValueError):
    anchor = 0
if not 0 <= now - anchor < 86400:
    anchor = now
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(anchor))
env.Append(CPPDEFINES=[('SPIROSCAN_BUILD_EPOCH', anchor)])
