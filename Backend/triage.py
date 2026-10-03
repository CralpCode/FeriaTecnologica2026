"""
Triaje combinado (semáforo) de una sesión: junta SpO2, pulso, corazón (CNN) y pulmón (CNN).

Son REGLAS FIJAS escritas por el equipo, no una IA entrenada: ninguna base pública trae audio y
SpO2 del mismo paciente, así que no hay datos para aprender esta combinación. Conviene revisar
estos umbrales con personal de salud antes de la feria.

    rojo     -> referir con prioridad
    amarillo -> referir a evaluación
    verde    -> sin hallazgos según las reglas
    gris     -> aún no hay datos suficientes
"""
from datetime import datetime, timedelta
from statistics import median

import database

RULES_VERSION = "1.0"
VITALS_WINDOW_S = 60

LEVELS = {
    "rojo": ("Prioridad alta: referir pronto a personal de salud", 3),
    "amarillo": ("Referir a evaluación médica", 2),
    "verde": ("Sin hallazgos según las reglas del dispositivo", 1),
    "gris": ("Faltan datos para evaluar", 0),
}


def _recent_vitals(session_id: str) -> dict | None:
    since = (datetime.now() - timedelta(seconds=VITALS_WINDOW_S)).isoformat()
    conn = database.get_db_connection()
    rows = conn.execute(
        "SELECT heartRate, bloodOxygen FROM vitals_log WHERE device_id = ? AND timestamp >= ? "
        "AND heartRate > 0 AND bloodOxygen > 0", (session_id, since)).fetchall()
    conn.close()
    if len(rows) < 3:
        return None
    return {"spo2": float(median(r["bloodOxygen"] for r in rows)),
            "fc": float(median(r["heartRate"] for r in rows)), "lecturas": len(rows)}


def _latest(session_id: str, mode: str) -> dict | None:
    for r in database.list_recordings(session_id, limit=30):
        if (r.get("mode") or "corazon") == mode and r["status"] == "done" \
                and r["result"] in ("normal", "anormal"):
            return r
    return None


def evaluate(session_id: str) -> dict:
    v = _recent_vitals(session_id)
    heart = _latest(session_id, "corazon")
    lungr = _latest(session_id, "pulmon")
    reasons: list[tuple[str, str]] = []   # (nivel, motivo)

    lung_finding = None
    if lungr and lungr["result"] == "anormal":
        det = lungr.get("details") or {}
        ruidos = [n for n, d in (det.get("ruidos") or {}).items() if d.get("presente")]
        patron = (det.get("patron") or {}).get("compatible_con")
        parts = []
        if ruidos:
            parts.append(" y ".join(ruidos) + " detectados")
        if patron and patron != "sano":
            parts.append(f"patrón compatible con {patron}")
        lung_finding = "; ".join(parts) or "hallazgo pulmonar"

    if v:
        if v["spo2"] < 90:
            reasons.append(("rojo", f"SpO2 muy baja ({v['spo2']:.0f} %)"))
        elif v["spo2"] < 94:
            reasons.append(("amarillo", f"SpO2 reducida ({v['spo2']:.0f} %)"))
        if v["fc"] > 120 or v["fc"] < 45:
            reasons.append(("amarillo", f"Frecuencia cardíaca fuera de rango ({v['fc']:.0f} BPM)"))
        if lung_finding and v["spo2"] < 94:
            reasons.append(("rojo", f"Pulmón: {lung_finding}, con SpO2 de {v['spo2']:.0f} %"))

    if lung_finding and not any(r[1].startswith("Pulmón") for r in reasons):
        reasons.append(("amarillo", f"Pulmón: {lung_finding}"))

    if heart and heart["result"] == "anormal":
        car = ((heart.get("details") or {}).get("caracteristicas_soplo") or {})
        extra = ", ".join(c["valor"] for c in car.values())
        reasons.append(("amarillo", f"Corazón: posible soplo{' (' + extra + ')' if extra else ''}; "
                                    "sugerir ecocardiograma"))

    has_data = bool(v or heart or lungr)
    level = max((r[0] for r in reasons), key=lambda n: LEVELS[n][1], default="verde" if has_data else "gris")
    return {
        "session_id": session_id,
        "nivel": level,
        "titulo": LEVELS[level][0],
        "motivos": [r[1] for r in sorted(reasons, key=lambda r: -LEVELS[r[0]][1])],
        "datos_usados": {
            "vitales_ultimo_minuto": v,
            "corazon": heart and {"resultado": heart["result"], "foco": heart["location"]},
            "pulmon": lungr and {"resultado": lungr["result"], "zona": lungr["location"]},
        },
        "reglas_version": RULES_VERSION,
        "aviso": "Reglas de tamizaje definidas por el equipo; no es un diagnóstico.",
    }
