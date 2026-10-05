"""Traceable differential suggestions, not a trained disease classifier.

Rules are a research prototype. Symptoms are reported by the user; measurements
are taken only from this session. No disease probabilities are manufactured.
"""
from datetime import datetime, timedelta
from statistics import median

from pydantic import BaseModel, ConfigDict, Field, StrictBool

import database
from measurement_quality import usable_value

RULES_VERSION = "2026-10-03.1"
SOURCES = [
    {"id": "fda_oximetry", "title": "FDA: Pulse Oximeters", "url": "https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters"},
    {"id": "nhlbi_valves", "title": "NHLBI: Heart Valve Diseases - Diagnosis", "url": "https://www.nhlbi.nih.gov/health/heart-valve-diseases/diagnosis"},
    {"id": "nice_asthma", "title": "NICE NG245: Asthma diagnosis", "url": "https://www.nice.org.uk/guidance/ng245/chapter/recommendations"},
    {"id": "nice_copd", "title": "NICE NG115: COPD diagnosis", "url": "https://www.nice.org.uk/guidance/ng115/chapter/recommendations"},
    {"id": "nhlbi_pneumonia", "title": "NHLBI: Pneumonia - Diagnosis", "url": "https://www.nhlbi.nih.gov/health/pneumonia/diagnosis"},
    {"id": "nhlbi_failure", "title": "NHLBI: Heart Failure - Diagnosis", "url": "https://www.nhlbi.nih.gov/health/heart-failure/diagnosis"},
    {"id": "nhs_dyspnea", "title": "NHS: Shortness of breath", "url": "https://www.nhs.uk/conditions/shortness-of-breath/"},
    {"id": "circor_sites", "title": "PhysioNet: The CirCor DigiScope Phonocardiogram Dataset (puntos de auscultación por válvula)",
     "url": "https://physionet.org/content/circor-heart-sound/1.0.3/"},
]


class ContextModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Symptoms(ContextModel):
    dyspnea: StrictBool | None = None
    chest_pain: StrictBool | None = None
    syncope: StrictBool | None = None
    cyanosis: StrictBool | None = None
    confusion: StrictBool | None = None
    severe_breathlessness: StrictBool | None = None
    cough: StrictBool | None = None
    fever: StrictBool | None = None
    wheeze: StrictBool | None = None
    orthopnea: StrictBool | None = None
    edema: StrictBool | None = None


class History(ContextModel):
    asthma: StrictBool | None = None
    copd: StrictBool | None = None
    smoking: StrictBool | None = None


class ClinicalContext(ContextModel):
    age_years: float | None = Field(None, ge=0, le=120)
    at_rest: StrictBool | None = None
    altitude_m: float | None = Field(None, ge=-500, le=9000)
    symptoms: Symptoms = Field(default_factory=Symptoms)
    history: History = Field(default_factory=History)
    # Notas libres del médico: van al informe, pero nunca a las reglas ni al modelo de lenguaje
    notes: str | None = Field(None, max_length=2000)


def recent_vitals(session_id: str) -> dict:
    rows = database.get_recent_readings(session_id, seconds=60)
    latest = rows[-1] if rows else {}
    out = {"heartRate": None, "bloodOxygen": None, "counts": {}, "latest_metadata": {
        k: latest.get(k) for k in ("source", "signalQuality", "spo2Calibrated")}}
    for channel in ("heartRate", "bloodOxygen"):
        values = [v for row in rows if (v := usable_value(row, channel, check_timestamp=False)) is not None]
        # An invalid latest packet invalidates older good readings, too.
        if usable_value(latest, channel) is not None and len(values) >= 3:
            out[channel] = round(median(values), 1)
        out["counts"][channel] = len(values)
    return out


DEMO_NOTICE = "Caso de demostración ICBHI, no es de esta persona."


def is_demo(rec: dict) -> bool:
    return bool((rec.get("details") or {}).get("demo"))


def _evidence(rec: dict, text: str) -> list[str]:
    return [DEMO_NOTICE, text] if is_demo(rec) else [text]


# Punto de auscultación de cada válvula (mismos focos que CirCor, la base con la que se entrenó la red del corazón)
VALVE_BY_FOCUS = {
    "AV": ("foco aórtico", "la válvula aórtica"),
    "PV": ("foco pulmonar", "la válvula pulmonar"),
    "TV": ("foco tricuspídeo", "la válvula tricúspide"),
    "MV": ("foco mitral", "la válvula mitral (punta del corazón)"),
}


def _focus_lines(heart: list[dict]) -> list[str]:
    """Descripción orientativa por foco: dónde salió anormal y qué válvula se ausculta mejor ahí.
    Usa solo el foco y el resultado; la caracterización del soplo no se usa porque no pasó la validación."""
    recorded = [f for f in VALVE_BY_FOCUS if any(r.get("location") == f for r in heart)]
    abnormal = [f for f in VALVE_BY_FOCUS if any(r.get("location") == f and r.get("result") == "anormal" for r in heart)]
    if not abnormal:
        return []
    lines = [f"Anormal en {VALVE_BY_FOCUS[f][0]} ({f}): es el punto donde mejor se ausculta {VALVE_BY_FOCUS[f][1]}."
             for f in abnormal]
    if len(abnormal) == 1:
        lines.append(f"Solo en 1 de {len(recorded)} focos grabados.")
    else:
        lines.append(f"En {len(abnormal)} de {len(recorded)} focos grabados: un soplo fuerte puede oírse en varios focos; "
                     "también puede deberse a ruido, por lo que conviene repetir.")
    missing = [f for f in VALVE_BY_FOCUS if f not in recorded]
    if missing:
        lines.append("Focos sin grabar: " + ", ".join(missing) + ".")
    lines.append("Orientativo: el foco no identifica qué válvula ni qué soplo; se requiere ecocardiograma.")
    return lines


def recent_recordings(session_id: str) -> list[dict]:
    cutoff = datetime.now() - timedelta(minutes=30)
    records = []
    seen = set()
    for rec in database.list_recordings(session_id, limit=100):
        key = (rec.get("mode"), rec.get("location"))
        if key in seen:
            continue
        seen.add(key)  # a failed repeat supersedes the previous result for that site
        try:
            if datetime.fromisoformat(rec["created_at"]) < cutoff:
                continue
        except (ValueError, KeyError):
            continue
        # Cuentan las grabaciones reales y los casos demo ICBHI (marcados); lo simulado no.
        if rec.get("source") != "real" and not is_demo(rec):
            continue
        if rec.get("status") == "done" and rec.get("result") in ("normal", "anormal"):
            records.append(rec)
    return records


def assess(context: dict, vitals: dict, recordings: list[dict]) -> dict:
    ctx = ClinicalContext.model_validate(context).model_dump()
    symptoms, history = ctx["symptoms"], ctx["history"]
    findings, possibilities, missing = [], [], []
    steps = []
    limitations = [
        "Orientación experimental por reglas y modelos acústicos; no es un diagnóstico ni una lista exhaustiva de causas.",
        "No hay un modelo validado aquí que combine audio, pulso, SpO2 y síntomas para estimar probabilidades de enfermedades.",
        "Una salida acústica negativa o una SpO2 normal no descartan enfermedad; el prototipo no está validado en pacientes con este hardware.",
        "La puntuación de una CNN no equivale a certeza clínica. No se calcula un porcentaje de salud.",
    ]

    def finding(code, label, evidence):
        findings.append({"code": code, "label": label, "evidence": evidence})

    def possibility(condition, why, confirmation, refs):
        possibilities.append({"condition": condition, "why": why, "confirmation": confirmation, "source_ids": refs})

    red_flags = {"severe_breathlessness": "Dificultad respiratoria intensa", "cyanosis": "Labios o piel azulados",
                 "confusion": "Confusión nueva", "syncope": "Desmayo", "chest_pain": "Dolor en el pecho"}
    urgent = any(symptoms[k] is True for k in red_flags)
    for key, label in red_flags.items():
        if symptoms[key] is True:
            finding(key, label, ["Síntoma actual comunicado por la persona; no medido por el dispositivo."])
    if urgent:
        steps.append("Buscar atención médica urgente ahora. No esperar al resultado de IA ni a repetir los sensores si hay síntomas graves.")
    if any(symptoms[k] is None for k in red_flags):
        missing.append("Completar preguntas sobre síntomas de alarma; no contestado no significa ausente.")

    age = ctx["age_years"]
    adult = age is not None and age >= 18
    if age is None:
        missing.append("Edad: necesaria para interpretar pulso y aplicabilidad de los modelos.")
    elif not adult:
        limitations.append("Menor de 18 años: no se aplican umbrales de pulso de adultos ni sugerencias respiratorias de adultos; requiere valoración pediátrica.")
    if ctx["at_rest"] is not True:
        missing.append("Confirmar medición en reposo; el pulso cambia con actividad.")
    if ctx["altitude_m"] is None:
        missing.append("Altitud y saturación habitual: influyen en la interpretación de SpO2; no se infiere la ubicación.")
    elif ctx["altitude_m"] >= 1500:
        limitations.append("La altitud puede modificar la SpO2 basal; no se aplica una corrección numérica inventada.")

    hr, spo2 = vitals.get("heartRate"), vitals.get("bloodOxygen")
    if hr is None:
        missing.append("Pulso real válido y reciente: al menos 3 lecturas y buena señal.")
    elif adult and ctx["at_rest"] is True and (hr < 45 or hr > 120):
        finding("pulse_outside_screening_range", "Pulso fuera de los límites de aviso del prototipo", [f"Mediana de pulso válido: {hr:g} BPM."])
        steps.append("Consultar si el pulso alterado persiste. No permite diagnosticar arritmias: para eso se requiere evaluación y ECG.")
    if spo2 is None:
        missing.append("SpO2 válida, reciente y calibrada: el MAX30102 sin calibración no aporta oxígeno clínicamente interpretable.")
    elif spo2 < 94:
        finding("low_oxygen", "SpO2 reducida: confirmar con equipo clínico", [f"Mediana válida: {spo2:g} %; considerar altitud y valor habitual."])
        if spo2 < 90:
            urgent = True
            steps.insert(0, "SpO2 por debajo de 90 %: buscar valoración médica inmediata y confirmar con equipo clínico, sin demorar atención por síntomas.")
        else:
            steps.append("Repetir correctamente la oximetría y solicitar valoración médica si persiste o hay síntomas.")
        limitations.append("Los límites 90/94 % son avisos conservadores del prototipo, no un protocolo clínico validado ni una meta de tratamiento.")

    heart = [r for r in recordings if r.get("mode", "corazon") == "corazon"]
    lungs = [r for r in recordings if r.get("mode") == "pulmon"]
    sites = {r.get("location") for r in heart}
    absent_sites = {"AV", "PV", "TV", "MV"} - sites
    if absent_sites:
        missing.append("Auscultación cardíaca válida pendiente en focos: " + ", ".join(sorted(absent_sites)) + ".")
    if not lungs:
        missing.append("Grabación pulmonar real reciente con calidad suficiente y modelo disponible.")
    for r in heart:
        if r.get("result") == "anormal":
            finding("abnormal_heart_sound", "Sonido cardíaco anormal según modelo experimental", _evidence(r, f"Grabación {r.get('id', '')}, foco {r.get('location')}; puede corresponder a soplo u otra anormalidad acústica."))
    if any(r.get("result") == "anormal" for r in heart):
        possibility("Soplo a evaluar: puede ser inocente o asociarse a alteración estructural o valvular",
                    ["Clasificador cardíaco con hallazgo acústico anormal; no identifica la causa."] + _focus_lines(heart),
                    ["Auscultación por personal de salud y ecocardiograma si está indicado."], ["nhlbi_valves", "circor_sites"])
        steps.append("Solicitar valoración médica del hallazgo cardíaco; la red no distingue una valvulopatía específica.")
    for r in heart + lungs:
        col = (r.get("details") or {}).get("colocacion") or {}
        if col.get("ok") is False:
            steps.append(f"Repetir {r.get('location')}: no se detectaron {col.get('que', 'ritmos')} claros en la grabación; "
                         "revisar la colocación del estetoscopio.")

    wheeze = symptoms["wheeze"] is True
    crackles = False
    for r in lungs:
        details = r.get("details") or {}
        sounds = details.get("ruidos") or {}
        wheeze |= (sounds.get("sibilancias") or {}).get("presente") is True
        crackles |= (sounds.get("crepitantes") or {}).get("presente") is True
        if r.get("result") == "anormal":
            finding("abnormal_lung_sound", "Sonido pulmonar anormal según modelo experimental", _evidence(r, f"Grabación {r.get('id', '')}, zona {r.get('location')}. No identifica por sí sola una enfermedad."))
    # Named diseases require context; a binary acoustic label never becomes a disease label.
    if adult and wheeze:
        possibility("Asma u otras causas de sibilancias",
                    ["Sibilancias comunicadas o detectadas en una grabación válida; no son específicas de asma."],
                    ["Historia clínica y pruebas objetivas: FeNO/eosinófilos y/o espirometría con reversibilidad según valoración médica."], ["nice_asthma"])
    if adult and age >= 35 and history["smoking"] is True and (symptoms["cough"] is True or symptoms["dyspnea"] is True):
        possibility("EPOC como posibilidad a investigar",
                    ["Antecedente de tabaquismo y tos o falta de aire comunicados; falta establecer duración y otras causas."],
                    ["Historia de exposición y espirometría posterior a broncodilatador."], ["nice_copd"])
    if adult and symptoms["cough"] is True and symptoms["fever"] is True:
        possibility("Infección respiratoria, incluida neumonía como posibilidad",
                    ["Tos y fiebre comunicadas; la temperatura no fue medida por este dispositivo."] + (["Además hay crepitantes acústicos."] if crackles else []),
                    ["Exploración médica y radiografía de tórax si se sospecha neumonía; el sonido no distingue microorganismos."], ["nhlbi_pneumonia"])
    if adult and symptoms["dyspnea"] is True and (symptoms["orthopnea"] is True or symptoms["edema"] is True):
        possibility("Insuficiencia cardíaca u otras causas de congestión a descartar",
                    ["Falta de aire con dificultad al acostarse o hinchazón comunicadas."],
                    ["Evaluación médica; pueden requerirse ECG, péptidos natriuréticos y ecocardiograma."], ["nhlbi_failure"])
    if any(v is True for v in symptoms.values()) and not steps:
        steps.append("Consultar a personal de salud por los síntomas; las lecturas del prototipo no descartan sus causas.")
    if not steps:
        steps.append("Completar los datos faltantes y repetir mediciones válidas. Si aparecen síntomas, buscar valoración médica.")
    has_symptoms = any(v is True for v in symptoms.values())
    status = "urgent" if urgent else "findings" if findings or possibilities or has_symptoms else "insufficient_data" if missing else "no_specific_findings"
    summary = {"urgent": "Hay señales que requieren atención médica urgente; no espere a la IA.",
               "findings": "Hay hallazgos o síntomas que requieren valoración. Estas posibilidades no son diagnósticos ni están ordenadas por probabilidad.",
               "insufficient_data": "Faltan datos válidos para orientar la valoración; no se puede concluir que todo esté normal.",
               "no_specific_findings": "Sin hallazgos específicos en los datos disponibles. Esto no descarta enfermedad."}[status]
    return {"status": status, "summary": summary, "findings": findings, "possibilities": possibilities,
            "missing_data": missing, "limitations": limitations, "next_steps": list(dict.fromkeys(steps)),
            "urgent": urgent, "sources": SOURCES, "disease_probabilities": None,
            "rules_version": RULES_VERSION, "vitals_used": vitals,
            "context": {k: v for k, v in ctx.items() if k != "notes"},
            "recording_ids": [r.get("id") for r in recordings],
            "demo": any(is_demo(r) for r in recordings)}


def evaluate_session(session_id: str) -> dict:
    return {"session_id": session_id, **assess(database.get_clinical_context(session_id),
                                              recent_vitals(session_id), recent_recordings(session_id))}
