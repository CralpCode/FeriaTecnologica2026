"""
Motor de alertas por REGLAS FIJAS. El LLM nunca decide si hay alerta: solo reescribe el texto
después (ver llm_tasks.alert_text). Si el LLM no responde, queda el texto de plantilla.
"""
import time

import database

SUSTAIN_S = {"spo2_critica": 10, "spo2_baja": 30, "fc_alta": 10, "fc_baja": 10, "sin_dedo": 15}
COOLDOWN_S = 120  # no repetir el mismo tipo de alerta en la misma sesión antes de esto

TEMPLATES = {
    "spo2_critica": ("critical", "Saturación de oxígeno muy baja",
                     "La SpO2 se mantuvo por debajo de 90 % durante {sustain} s (mínimo {spo2:.0f} %).",
                     "Verificar la colocación del sensor. Si se confirma, buscar valoración médica de inmediato."),
    "spo2_baja": ("caution", "Saturación de oxígeno reducida",
                  "La SpO2 se mantuvo entre 90 y 93 % durante {sustain} s.",
                  "Repetir la medición en reposo y con el dedo quieto."),
    "fc_alta": ("caution", "Frecuencia cardíaca elevada",
                "El pulso se mantuvo por encima de 120 BPM durante {sustain} s (actual {hr} BPM).",
                "Reposo de 5 minutos y repetir. Si persiste, consultar a personal de salud."),
    "fc_baja": ("caution", "Frecuencia cardíaca baja",
                "El pulso se mantuvo por debajo de 45 BPM durante {sustain} s (actual {hr} BPM).",
                "Repetir la medición. Si hay mareo o fatiga, consultar a personal de salud."),
    "sin_dedo": ("info", "Sensor sin lectura",
                 "El dispositivo está conectado pero no detecta pulso desde hace {sustain} s.",
                 "Colocar el dedo sobre el sensor óptico sin presionar demasiado."),
    "soplo": ("critical", "Posible soplo cardíaco",
              "La grabación del foco {location} tuvo probabilidad de anormalidad {prob:.0%} (umbral {thr:.0%}).",
              "Esto es un tamizaje, no un diagnóstico: referir a evaluación médica y ecocardiograma."),
    "hallazgo_pulmonar": ("caution", "Posible hallazgo pulmonar",
                          "La grabación de la zona {location} mostró: {finding}.",
                          "Es un tamizaje, no un diagnóstico: referir a evaluación médica."),
    "calidad_audio": ("info", "Grabación con calidad insuficiente",
                      "La grabación del foco {location} no se pudo analizar: {reason}.",
                      "Repetir la grabación con buen contacto del estetoscopio y en silencio."),
}

# Estado en memoria por sesión: desde cuándo se cumple cada condición y cuándo se alertó por última vez.
_since: dict[tuple[str, str], float] = {}
_last_alert: dict[tuple[str, str], float] = {}


def _fire(session_id: str, type_: str, **fmt) -> dict | None:
    key = (session_id, type_)
    now = time.time()
    if now - _last_alert.get(key, 0) < COOLDOWN_S:
        return None
    _last_alert[key] = now
    severity, title, message, action = TEMPLATES[type_]
    return database.create_alert(session_id, type_, severity, title, message.format(**fmt), action, fmt)


def _sustained(session_id: str, type_: str, active: bool) -> bool:
    key = (session_id, type_)
    if not active:
        _since.pop(key, None)
        return False
    start = _since.setdefault(key, time.time())
    return time.time() - start >= SUSTAIN_S[type_]


def evaluate_vitals(session_id: str, vitals: dict) -> list[dict]:
    hr = vitals.get("heartRate", 0) or 0
    spo2 = vitals.get("bloodOxygen", 0.0) or 0.0
    valid = hr > 0 and spo2 > 0
    fired = []

    checks = [
        ("spo2_critica", valid and spo2 < 90),
        ("spo2_baja", valid and 90 <= spo2 < 94),
        ("fc_alta", valid and hr > 120),
        ("fc_baja", valid and 0 < hr < 45),
        ("sin_dedo", not valid),
    ]
    for type_, cond in checks:
        if _sustained(session_id, type_, cond):
            a = _fire(session_id, type_, sustain=SUSTAIN_S[type_], hr=hr, spo2=spo2)
            if a:
                fired.append(a)
    return fired


def evaluate_recording(result: dict) -> list[dict]:
    sid = result["session_id"]
    loc = result.get("location") or "sin especificar"
    if result["result"] == "anormal" and result.get("mode") == "pulmon":
        det = result.get("details") or {}
        parts = [f"{n} detectados" for n, d in (det.get("ruidos") or {}).items() if d.get("presente")]
        patron = (det.get("patron") or {}).get("compatible_con")
        if patron and patron != "sano":
            parts.append(f"patrón compatible con {patron}")
        _last_alert.pop((sid, "hallazgo_pulmonar"), None)
        a = _fire(sid, "hallazgo_pulmonar", location=loc, finding="; ".join(parts) or "sonido anormal",
                  recording_id=result["recording_id"], details=det)
        return [a] if a else []
    if result["result"] == "anormal":
        # Cada grabación anormal es un hallazgo independiente: sin enfriamiento.
        _last_alert.pop((sid, "soplo"), None)
        a = _fire(sid, "soplo", location=loc, prob=result["probability"], thr=result["threshold"],
                  recording_id=result["recording_id"],
                  caracteristicas=(result.get("details") or {}).get("caracteristicas_soplo", {}))
        return [a] if a else []
    if result["result"] == "calidad_insuficiente":
        _last_alert.pop((sid, "calidad_audio"), None)
        a = _fire(sid, "calidad_audio", location=loc, reason=result.get("reason") or "señal inválida",
                  recording_id=result["recording_id"])
        return [a] if a else []
    return []
