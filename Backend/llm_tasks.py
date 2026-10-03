"""
Tareas del LLM local. Regla central: el LLM REDACTA, no decide.
Las alertas vienen del motor de reglas y los resultados de audio de la CNN; aquí solo se
convierten en texto claro. Cada función tiene un texto de respaldo si el LLM no responde.
"""
import json
from pathlib import Path

import ai_engine
import database
import triage

BASE_RULES = (
    "Eres el asistente de comunicación de SpiroScan, un prototipo universitario de TAMIZAJE "
    "cardiorrespiratorio (sensor MAX30102 para pulso y SpO2; estetoscopio digital con redes neuronales "
    "que estiman si un sonido cardíaco o pulmonar es anormal; un semáforo de triaje por reglas fijas).\n"
    "REGLAS OBLIGATORIAS:\n"
    "1. Nunca diagnostiques ni afirmes que la persona tiene una enfermedad. Habla de 'hallazgos' o 'resultados'.\n"
    "2. Usa SOLO los datos que se te entregan. Si falta un dato, dilo. No inventes valores.\n"
    "3. El dispositivo NO mide presión arterial ni temperatura corporal; no las menciones como medidas.\n"
    "4. Ante cualquier alerta o resultado anormal, recomienda valoración por personal de salud.\n"
    "5. No recomiendes medicamentos, dosis ni tratamientos.\n"
    "6. Español claro y sin jerga, para un promotor de salud o una persona sin formación médica.\n"
    "7. Si hay 'patrón compatible con' una enfermedad, dilo SIEMPRE como sugerencia a confirmar por un médico, "
    "nunca como diagnóstico. Las características del soplo describen cómo suena, no su causa.\n"
)

KNOWLEDGE_PATH = Path(__file__).resolve().parent / "knowledge" / "proyecto.md"


def project_knowledge() -> str:
    """Base de conocimiento revisada por el equipo; se relee en cada uso para que editarla tenga efecto inmediato."""
    try:
        return KNOWLEDGE_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""


SEVERITY_NAMES = {"critical": "crítica", "caution": "precaución", "info": "informativa"}
LOCATION_NAMES = {
    "AV": "aórtico", "PV": "pulmonar", "TV": "tricuspídeo", "MV": "mitral",
    "TC": "tráquea", "AL": "tórax anterior izquierdo", "AR": "tórax anterior derecho",
    "PL": "espalda izquierda", "PR": "espalda derecha", "LL": "costado izquierdo", "LR": "costado derecho",
}

GUIDE = {
    "AV": {"nombre": "Foco aórtico", "posicion": "Segundo espacio intercostal, a la DERECHA del esternón, pegado a su borde."},
    "PV": {"nombre": "Foco pulmonar", "posicion": "Segundo espacio intercostal, a la IZQUIERDA del esternón, pegado a su borde."},
    "TV": {"nombre": "Foco tricuspídeo", "posicion": "Cuarto o quinto espacio intercostal, a la izquierda, en el borde inferior del esternón."},
    "MV": {"nombre": "Foco mitral", "posicion": "Quinto espacio intercostal izquierdo, en la línea que baja desde la mitad de la clavícula (punta del corazón)."},
}
GUIDE.update({
    "TC": {"nombre": "Tráquea", "posicion": "En el cuello, sobre la tráquea, justo encima del esternón."},
    "AL": {"nombre": "Tórax anterior izquierdo", "posicion": "Segundo espacio intercostal izquierdo, en la línea media de la clavícula."},
    "AR": {"nombre": "Tórax anterior derecho", "posicion": "Segundo espacio intercostal derecho, en la línea media de la clavícula."},
    "PL": {"nombre": "Espalda izquierda", "posicion": "Entre la columna y el borde de la escápula izquierda, a media altura."},
    "PR": {"nombre": "Espalda derecha", "posicion": "Entre la columna y el borde de la escápula derecha, a media altura."},
    "LL": {"nombre": "Costado izquierdo", "posicion": "Línea axilar media izquierda, a la altura del quinto espacio intercostal."},
    "LR": {"nombre": "Costado derecho", "posicion": "Línea axilar media derecha, a la altura del quinto espacio intercostal."},
})
GUIDE_LUNG_EXTRA = "Pulmón: pedir a la persona que respire hondo por la boca durante toda la grabación."

GUIDE_COMMON = [
    "Ambiente en silencio; pedir a la persona que no hable durante la grabación.",
    "Contacto directo con la piel, sin ropa de por medio, con presión firme pero sin hundir.",
    "No mover el estetoscopio ni rozar el cable durante los 15 segundos.",
    "Presionar el botón del dispositivo para iniciar; los LEDs indican grabando, enviando y resultado.",
    "Si el resultado dice 'calidad insuficiente', revisar el contacto y repetir.",
]


def _session_context(session_id: str) -> dict:
    recs = database.list_recordings(session_id, limit=10)
    return {
        "vitales_ultimas_lecturas": database.get_latest_reading(session_id=session_id),
        "resumen_vitales_sesion": database.get_vitals_summary(session_id),
        "grabaciones": [
            {"tipo": "pulmón" if r.get("mode") == "pulmon" else "corazón",
             "foco": LOCATION_NAMES.get(r["location"], r["location"] or "sin especificar"),
             "resultado": r["result"],
             "detalles": r.get("details") or {},
             "probabilidad_anormal": f"{r['probability']:.0%}" if r["probability"] is not None else None,
             "umbral": f"{r['threshold']:.0%}" if r["threshold"] is not None else None,
             "hora": r["created_at"]}
            for r in recs
        ],
        "alertas": [
            {"tipo": a["type"], "severidad": SEVERITY_NAMES.get(a["severity"], a["severity"]),
             "titulo": a["title"], "hora": a["created_at"]}
            for a in database.list_alerts(session_id, limit=10)
        ],
        "triaje": {k: v for k, v in triage.evaluate(session_id).items() if k in ("nivel", "titulo", "motivos")},
    }


def _clean_vitals(v: dict) -> dict:
    keep = ("heartRate", "bloodOxygen", "hrv", "timestamp", "device_connected")
    return {k: v.get(k) for k in keep if k in v}


# ---------------------------------------------------------------------------
# 1. Alertas
# ---------------------------------------------------------------------------

def alert_text(alert: dict) -> dict | None:
    """Reescribe una alerta en lenguaje claro. Devuelve None si el LLM falla (queda la plantilla)."""
    prompt = (
        "Reescribe esta alerta generada por reglas para quien está usando el dispositivo.\n"
        f"Alerta: {json.dumps({k: alert[k] for k in ('type', 'severity', 'title', 'message', 'action', 'data')}, ensure_ascii=False)}\n"
        'Responde JSON: {"mensaje": "máximo 2 oraciones: qué pasó", "accion": "máximo 2 oraciones: qué hacer ahora"}'
    )
    try:
        out = ai_engine.llm_json([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}], max_tokens=250)
        msg, act = str(out.get("mensaje", "")).strip(), str(out.get("accion", "")).strip()
        return {"message": msg, "action": act} if msg and act else None
    except Exception as e:
        print(f"[LLM alerta] {e}")
        return None


# ---------------------------------------------------------------------------
# 2. Informe de sesión
# ---------------------------------------------------------------------------

def session_report(session_id: str) -> tuple[dict, bool]:
    """Devuelve (contenido, generado_por_llm)."""
    ctx = _session_context(session_id)
    ctx["vitales_ultimas_lecturas"] = _clean_vitals(ctx["vitales_ultimas_lecturas"])
    prompt = (
        "Redacta el informe de esta sesión de tamizaje a partir de estos datos:\n"
        f"{json.dumps(ctx, ensure_ascii=False, default=str)}\n"
        "Responde JSON con estas claves:\n"
        '{"resumen": "3-4 oraciones", "hallazgos": ["lista corta, uno por dato relevante"], '
        '"recomendacion": "1-2 oraciones", '
        '"nota_referencia": "si hubo alerta o grabación anormal: nota breve dirigida a personal de salud con los datos objetivos; si no, cadena vacía"}'
    )
    try:
        out = ai_engine.llm_json([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}], max_tokens=900)
        content = {
            "resumen": str(out.get("resumen", "")),
            "hallazgos": [str(h) for h in out.get("hallazgos", [])],
            "recomendacion": str(out.get("recomendacion", "")),
            "nota_referencia": str(out.get("nota_referencia", "")),
        }
        llm = True
    except Exception as e:
        print(f"[LLM informe] {e}")
        content = _fallback_report(ctx)
        llm = False
    content["datos"] = ctx
    return content, llm


def _fallback_report(ctx: dict) -> dict:
    s = ctx["resumen_vitales_sesion"]
    hallazgos = []
    if s.get("n"):
        hallazgos.append(f"Pulso promedio {s['hr_prom']} BPM (rango {s['hr_min']}-{s['hr_max']}).")
        hallazgos.append(f"SpO2 promedio {s['spo2_prom']} % (mínimo {s['spo2_min']} %).")
    anormales = [g for g in ctx["grabaciones"] if g["resultado"] == "anormal"]
    for g in ctx["grabaciones"]:
        p = f" ({g['probabilidad_anormal']})" if g["probabilidad_anormal"] else ""
        hallazgos.append(f"Foco {g['foco']}: {g['resultado']}{p}.")
    alerta = bool(anormales or any(a["severidad"] == "crítica" for a in ctx["alertas"]))
    return {
        "resumen": f"Sesión con {s.get('n', 0)} lecturas válidas y {len(ctx['grabaciones'])} grabaciones cardíacas.",
        "hallazgos": hallazgos,
        "recomendacion": ("Se recomienda valoración por personal de salud." if alerta
                          else "Sin hallazgos que requieran referencia según las reglas del dispositivo."),
        "nota_referencia": ("Tamizaje con hallazgos: ver datos adjuntos. No es un diagnóstico." if alerta else ""),
    }


# ---------------------------------------------------------------------------
# 3. Chat sobre los datos reales
# ---------------------------------------------------------------------------

_history: dict[str, list[dict]] = {}


def chat(session_id: str, message: str) -> str:
    ctx = _session_context(session_id)
    ctx["vitales_ultimas_lecturas"] = _clean_vitals(ctx["vitales_ultimas_lecturas"])
    system = (
        BASE_RULES
        + "Respondes dos tipos de preguntas, siempre breve (máximo 2 párrafos cortos):\n"
        + "a) Sobre los datos de ESTA sesión: usa solo DATOS DE LA SESIÓN.\n"
        + "b) Sobre qué es SpiroScan y cómo funciona (visitantes de la feria, jurado): usa solo la BASE DE CONOCIMIENTO.\n"
        + "Si la respuesta no está en ninguna de las dos fuentes, dilo y no inventes.\n"
        + "Si preguntan algo que el dispositivo no mide o que requiere diagnóstico, explícalo con amabilidad.\n"
        + f"BASE DE CONOCIMIENTO DEL PROYECTO:\n{project_knowledge()}\n"
        + f"DATOS DE LA SESIÓN (fuente única de verdad):\n{json.dumps(ctx, ensure_ascii=False, default=str)}"
    )
    hist = _history.setdefault(session_id, [])
    messages = [{"role": "system", "content": system}, *hist[-6:], {"role": "user", "content": message}]
    try:
        reply = ai_engine.llm_chat(messages, max_tokens=450, temperature=0.4)
    except Exception as e:
        print(f"[LLM chat] {e}")
        return ("El asistente no está disponible en este momento. Los datos de la sesión siguen "
                "visibles en el panel principal.")
    hist += [{"role": "user", "content": message}, {"role": "assistant", "content": reply}]
    _history[session_id] = hist[-10:]
    return reply


# ---------------------------------------------------------------------------
# 4. Guía de uso
# ---------------------------------------------------------------------------

def guide(location: str) -> dict:
    loc = location.upper()
    if loc not in GUIDE:
        raise KeyError(loc)
    pasos = GUIDE_COMMON + ([GUIDE_LUNG_EXTRA] if loc in ("TC", "AL", "AR", "PL", "PR", "LL", "LR") else [])
    return {**GUIDE[loc], "foco": loc, "pasos": pasos}


def guide_answer(question: str, location: str | None, last_quality: dict | None) -> str:
    """Responde dudas del operador usando SOLO la guía fija como referencia."""
    ref = {"focos": GUIDE, "pasos_generales": GUIDE_COMMON}
    extra = f"\nÚltima grabación, calidad: {json.dumps(last_quality, ensure_ascii=False)}" if last_quality else ""
    system = (
        BASE_RULES
        + "Ayudas al operador a USAR el dispositivo (colocación, ruido, repetir grabaciones). "
        + "No interpretes resultados clínicos. Usa como referencia esta guía y nada más:\n"
        + json.dumps(ref, ensure_ascii=False)
        + (f"\nFoco actual: {location}" if location else "") + extra
    )
    try:
        return ai_engine.llm_chat([{"role": "system", "content": system}, {"role": "user", "content": question}],
                                  max_tokens=300, temperature=0.3)
    except Exception as e:
        print(f"[LLM guía] {e}")
        g = GUIDE.get((location or "").upper())
        return (f"{g['nombre']}: {g['posicion']} " if g else "") + " ".join(GUIDE_COMMON)
