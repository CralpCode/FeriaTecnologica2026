"""
Tareas del LLM local. Regla central: el LLM REDACTA, no decide.
Las alertas vienen del motor de reglas y los resultados de audio de la CNN; aquí solo se
convierten en texto claro. Cada función tiene un texto de respaldo si el LLM no responde.
"""
import json
import re
from datetime import datetime
from pathlib import Path

import ai_engine
import database
import triage
import clinical_assessment
from measurement_quality import usable_value, normalize_measurements, number

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
    "8. Nunca inventes cifras, umbrales ni porcentajes: si mencionas un número, debe aparecer tal cual en los datos.\n"
    "9. Nunca digas que un valor es normal, estable, sano o 'dentro del rango': el prototipo no puede concluir "
    "normalidad. Tampoco supongas reposo, edad ni ausencia de síntomas si no están en los datos.\n"
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
    recs = clinical_assessment.recent_recordings(session_id)
    return {
        "vitales_ultimas_lecturas": database.get_latest_reading(session_id=session_id),
        "resumen_vitales_sesion": database.get_vitals_summary(session_id),
        "grabaciones": [
            {"tipo": "pulmón" if r.get("mode") == "pulmon" else "corazón",
             "foco": LOCATION_NAMES.get(r["location"], r["location"] or "sin especificar"),
             "resultado": r["result"],
             "detalles": r.get("details") or {},
             "puntuacion_modelo": f"{r['probability']:.0%}" if r["probability"] is not None else None,
             "umbral": f"{r['threshold']:.0%}" if r["threshold"] is not None else None,
             "hora": r["created_at"]}
            for r in recs
        ],
        "alertas": [
            {"tipo": a["type"], "severidad": SEVERITY_NAMES.get(a["severity"], a["severity"]),
             "titulo": a["title"], "hora": a["created_at"]}
            for a in database.list_alerts(session_id, limit=10)
        ],
        "valoracion": clinical_assessment.evaluate_session(session_id),
        "triaje": {k: v for k, v in triage.evaluate(session_id).items() if k in ("nivel", "titulo", "motivos")},
    }


def _reading_time(v: dict) -> datetime | None:
    try:
        timestamp = datetime.fromisoformat(v['timestamp'].replace('Z', '+00:00'))
        age = (datetime.now(timestamp.tzinfo) - timestamp).total_seconds()
        sample_age = number(v.get('sampleAgeMs', 0))
        if sample_age is not None and sample_age >= 0 and -1 <= age and max(0, age) + sample_age / 1000 <= 10:
            return timestamp
    except (KeyError, TypeError, ValueError, AttributeError):
        pass
    return None


def _clean_vitals(v: dict) -> dict:
    """Keep clinical eligibility separate from device estimates in the LLM context."""
    normalized = normalize_measurements(v)
    fresh = _reading_time(v) is not None and v.get('device_connected') is not False
    fresh = fresh and normalized['source'] == 'real' and v.get('power') != 'standby'
    readings = {}
    for metric, unit in (('heartRate', 'BPM'), ('bloodOxygen', '%'), ('hrv', 'ms'),
                         ('audio_rms', normalized['audioUnit']), ('experimentalStressScore', '/100')):
        flag = 'hrv' if metric == 'experimentalStressScore' else metric
        value = normalized.get(metric)
        available = fresh and normalized['validity'][flag] and number(value) is not None
        if metric != 'audio_rms' and v.get('finger') is False:
            available = False
        readings[metric] = {'value': value if available else None, 'unit': unit,
                            'timestamp': v.get('timestamp') if available else None,
                            'status': 'actual' if available else 'sin_lectura_valida'}
    readings['bloodOxygen']['calibrated'] = normalized['spo2Calibrated']
    readings['bloodOxygen']['limitation'] = 'Estimación del sensor; sin calibrar se excluye del triaje.'
    readings['hrv']['limitation'] = 'PRV: RMSSD de intervalos ópticos, no HRV medida por ECG.'
    readings['experimentalStressScore']['limitation'] = 'Heurística enviada por el firmware; no mide estrés clínico, fuera del triaje.'
    readings['audio_rms']['limitation'] = 'Nivel digital o relativo; no es presión sonora ni un resultado de auscultación.'
    return {'heartRate': usable_value(v, 'heartRate'), 'bloodOxygen': usable_value(v, 'bloodOxygen'),
            'timestamp': v.get('timestamp'), 'source': v.get('source'), 'lecturas_dispositivo': readings}


def _chat_vitals(session_id: str, latest: dict, app_vitals: dict | None) -> dict:
    # Recent values retain their own timestamps. A gap never becomes a new valid sample.
    candidates = database.get_recent_readings(session_id, seconds=10)
    candidates.append(latest)
    if app_vitals and app_vitals.get('session_id', session_id) == session_id and _reading_time(app_vitals):
        candidates.append(app_vitals)
    dated = [(timestamp.timestamp(), v) for v in candidates if (timestamp := _reading_time(v)) is not None]
    candidates = [v for _, v in sorted(dated, key=lambda item: item[0])]
    current = candidates[-1] if candidates else latest
    clean = _clean_vitals(current)
    retained = {}
    for v in candidates:
        if v.get('source') == 'simulated' or v.get('power') == 'standby' or v.get('device_connected') is False:
            retained.clear()
        if v.get('finger') is False:
            retained = {k: r for k, r in retained.items() if k == 'audio_rms'}
        for key, reading in _clean_vitals(v)['lecturas_dispositivo'].items():
            if reading['value'] is not None:
                retained[key] = reading
    for key, reading in retained.items():
        if clean['lecturas_dispositivo'][key]['value'] is None:
            clean['lecturas_dispositivo'][key] = {**reading, 'status': 'ultima_valida_esperando_senal'}
    return clean


_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def _numbers(text: str) -> list[float]:
    return [float(n.replace(",", ".")) for n in _NUMBER.findall(text)]


def numbers_ok(text: str, data) -> bool:
    """Candado de cifras: cada número del texto debe estar en los datos (se acepta redondeado)."""
    source = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, default=str)
    allowed = set()
    for v in _numbers(source):
        allowed.update({v, round(v), round(v, 1)})
        if v <= 1:  # probabilidades guardadas como fracción (0.91 -> 91 %)
            allowed.update({round(v * 100), round(v * 100, 1)})
    return all(n in allowed for n in _numbers(text))



# ---------------------------------------------------------------------------
# 1. Alertas
# ---------------------------------------------------------------------------

def alert_text(alert: dict) -> dict | None:
    """Reescribe una alerta en lenguaje claro. Devuelve None si el LLM falla o inventa cifras (queda la plantilla)."""
    prompt = (
        "Reescribe esta alerta generada por reglas para quien está usando el dispositivo.\n"
        f"Alerta: {json.dumps({k: alert[k] for k in ('type', 'severity', 'title', 'message', 'action', 'data')}, ensure_ascii=False)}\n"
        "Usa solo los números que aparecen en la alerta (si no hay umbral en los datos, no menciones ninguno).\n"
        'Responde JSON: {"mensaje": "máximo 2 oraciones: qué pasó", "accion": "máximo 2 oraciones: qué hacer ahora"}'
    )
    try:
        out = ai_engine.llm_json([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}], max_tokens=250)
        msg, act = str(out.get("mensaje", "")).strip(), str(out.get("accion", "")).strip()
    except Exception as e:
        print(f"[LLM alerta] {e}")
        return None
    if not msg or not act:
        return None
    # Candado de cifras: si el texto trae un número que no está en la alerta, se queda la plantilla.
    if not numbers_ok(f"{msg} {act}", {k: alert[k] for k in ("title", "message", "action", "data")}):
        print("[LLM alerta] texto descartado: cifras que no están en la alerta")
        return None
    if (alert.get("data") or {}).get("demo") and clinical_assessment.DEMO_NOTICE not in msg:
        msg = clinical_assessment.DEMO_NOTICE + " " + msg
    return {"message": msg, "action": act}


# ---------------------------------------------------------------------------
# 2. Informe de sesión
# ---------------------------------------------------------------------------

def session_report(session_id: str) -> tuple[dict, bool]:
    """Devuelve (contenido, generado_por_llm)."""
    ctx = _session_context(session_id)
    ctx["vitales_ultimas_lecturas"] = _clean_vitals(ctx["vitales_ultimas_lecturas"])
    assessment = ctx["valoracion"]
    content = {
        "resumen": assessment["summary"],
        "hallazgos": [f["label"] + ": " + " ".join(f["evidence"]) for f in assessment["findings"]],
        "recomendacion": " ".join(assessment["next_steps"]),
        "nota_referencia": "Posibilidades a confirmar, no diagnósticos: " + "; ".join(p["condition"] for p in assessment["possibilities"]) if assessment["possibilities"] else "",
        "datos": ctx,
    }
    # Las secciones clínicas son fijas (reglas). El LLM solo agrega un resumen en lenguaje sencillo,
    # que se descarta si menciona una cifra que no está en los datos.
    summary = _llm_summary(ctx)
    if summary:
        content["resumen_llm"] = summary
    return content, bool(summary)


def _llm_summary(ctx: dict) -> str | None:
    data = json.dumps(ctx, ensure_ascii=False, default=str)
    prompt = (
        "Resume en lenguaje sencillo esta sesión de tamizaje para la persona y su familia, en 3 o 4 oraciones.\n"
        "Básate en la 'valoracion' (motor de reglas): no agregues enfermedades, probabilidades ni recomendaciones "
        "que no estén ahí. Si faltan datos, dilo.\n"
        f"DATOS DE LA SESIÓN:\n{data}\n"
        'Responde JSON: {"resumen": "..."}'
    )
    try:
        out = ai_engine.llm_json([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}],
                                 max_tokens=400)
        text = str(out.get("resumen", "")).strip()
    except Exception as e:
        print(f"[LLM informe] {e}")
        return None
    if not text or not numbers_ok(text, data):
        print("[LLM informe] resumen descartado: vacío o con cifras que no están en los datos")
        return None
    if ctx["valoracion"].get("demo") and "demostraci" not in text.lower():
        text = clinical_assessment.DEMO_NOTICE + " " + text
    return text


def _fallback_report(ctx: dict) -> dict:
    s = ctx["resumen_vitales_sesion"]
    hallazgos = []
    if s.get("n"):
        hallazgos.append(f"Pulso promedio {s['hr_prom']} BPM (rango {s['hr_min']}-{s['hr_max']}).")
        hallazgos.append(f"SpO2 promedio {s['spo2_prom']} % (mínimo {s['spo2_min']} %).")
    anormales = [g for g in ctx["grabaciones"] if g["resultado"] == "anormal"]
    for g in ctx["grabaciones"]:
        p = f" ({g['puntuacion_modelo']})" if g["puntuacion_modelo"] else ""
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


def chat(session_id: str, message: str, app_vitals: dict | None = None) -> str:
    ctx = _session_context(session_id)
    ctx["vitales_ultimas_lecturas"] = _chat_vitals(session_id, ctx["vitales_ultimas_lecturas"], app_vitals)
    system = (
        BASE_RULES
        + "Respondes dos tipos de preguntas, siempre breve (máximo 2 párrafos cortos):\n"
        + "a) Sobre los datos de ESTA sesión: usa solo DATOS DE LA SESIÓN. La 'valoracion' es el resultado del "
        + "motor de reglas: preséntala tal cual, sin agregar enfermedades, probabilidades ni signos vitales.\n"
        + "b) Sobre qué es SpiroScan y cómo funciona (visitantes de la feria, jurado): usa solo la BASE DE CONOCIMIENTO.\n"
        + "Si la respuesta no está en ninguna de las dos fuentes, dilo y no inventes.\n"
        + "Si preguntan algo que el dispositivo no mide o que requiere diagnóstico, explícalo con amabilidad.\n"
        + "Si la persona cuenta síntomas en el chat, pídele que los registre en la valoración de Auscultación.\n"
        + "La 'puntuacion_modelo' es la puntuación de la red neuronal, no una probabilidad ni una certeza clínica.\n"
        + "En 'lecturas_dispositivo' puedes describir los valores y sus unidades, indicando sus limitaciones. "
        + "SpO2 sin calibrar es una estimación disponible, no un dato clínico validado. PRV y estrés experimental "
        + "no permiten diagnosticar estrés. Un nivel de micrófono no detecta enfermedades. "
        + "Si el estado dice 'ultima_valida_esperando_senal', aclara que es la última lectura, no una muestra actual. "
        + "Para conclusiones clínicas utiliza exclusivamente 'valoracion' y 'triaje'.\n"
        + f"BASE DE CONOCIMIENTO DEL PROYECTO:\n{project_knowledge()}\n"
        + f"DATOS DE LA SESIÓN (fuente única de verdad):\n{json.dumps(ctx, ensure_ascii=False, default=str)}"
    )
    hist = _history.setdefault(session_id, [])
    messages = [{"role": "system", "content": system}, *hist[-6:], {"role": "user", "content": message}]
    try:
        reply = ai_engine.llm_chat(messages, max_tokens=450, temperature=0.4)
    except Exception as e:
        print(f"[LLM chat] {e}")
        return _chat_fallback(ctx["valoracion"], ctx['vitales_ultimas_lecturas'])
    hist += [{"role": "user", "content": message}, {"role": "assistant", "content": reply}]
    _history[session_id] = hist[-10:]
    return reply


def _chat_fallback(assessment: dict, vitals: dict | None = None) -> str:
    """Respuesta fija por reglas cuando el modelo de lenguaje no está disponible."""
    lines = []
    if vitals:
        readings = vitals.get('lecturas_dispositivo', {})
        labels = {'heartRate': 'Pulso', 'bloodOxygen': 'Oxígeno SpO2', 'hrv': 'Variabilidad PRV',
                  'experimentalStressScore': 'Estrés experimental', 'audio_rms': 'Micrófono'}
        values = []
        for key, label in labels.items():
            reading = readings.get(key, {})
            if reading.get('value') is None:
                values.append(f'{label}: sin lectura válida.')
                continue
            note = ' (última lectura válida; esperando señal)' if reading.get('status') == 'ultima_valida_esperando_senal' else ''
            limitation = (' Estimación sin calibrar, fuera del triaje.' if key == 'bloodOxygen' and not reading.get('calibrated')
                          else ' Estimación experimental, no validada clínicamente.' if key == 'experimentalStressScore'
                          else ' Intervalos ópticos; no es ECG.' if key == 'hrv'
                          else ' Nivel relativo sin calibrar.' if key == 'audio_rms' and reading.get('unit') != 'dBFS' else '')
            values.append(f"{label}: {reading['value']:g} {reading.get('unit') or ''}{note}.{limitation}")
        lines.append('El modelo de lenguaje no pudo responder; este resumen usa las lecturas recibidas al enviar la pregunta.\n' + '\n'.join(values))
    lines.append(assessment["summary"])
    lines += [f["label"] + ": " + " ".join(f["evidence"]) for f in assessment["findings"]]
    for possibility in assessment["possibilities"]:
        lines.append("Posibilidad a confirmar: " + possibility["condition"] + ". " + " ".join(possibility["why"]) + " Confirmación: " + " ".join(possibility["confirmation"]))
    lines += assessment["next_steps"]
    if assessment["missing_data"]:
        lines.append("Datos pendientes: " + " ".join(assessment["missing_data"]))
    lines.append("Esta respuesta resume la sesión con reglas y resultados acústicos. No interpreta síntomas escritos en el chat: regístralos en la valoración de Auscultación. La guía de uso está en esa misma pantalla.")
    return "\n\n".join(lines)


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
