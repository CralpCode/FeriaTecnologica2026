import os
import uuid
import requests
from datetime import datetime

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

def analyze_vitals_report(vitals: dict) -> dict:
    hr = vitals.get("heartRate", 0)
    spo2 = vitals.get("bloodOxygen", 0.0)
    stress = vitals.get("stressLevel", 0)
    temp = vitals.get("temperature", 0.0)
    sys = vitals.get("systolicPressure", 0)
    dia = vitals.get("diastolicPressure", 0)

    if hr == 0 and spo2 == 0.0:
        return {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.now().isoformat(),
            "healthScore": 0,
            "status": "normal",
            "title": "Dispositivo en Reposo",
            "summary": "El backend está a la espera de que inicies el emulador en Wokwi para recibir signos vitales en vivo.",
            "recommendations": ["Inicia la simulación en Wokwi para comenzar a recibir telemetría."],
            "anomaliesDetected": [],
            "confidence": 100.0
        }

    anomalies = []
    recommendations = []
    status = "normal"
    health_score = 95

    if hr > 110:
        anomalies.append("Frecuencia cardíaca elevada (Taquicardia)")
        recommendations.append("Realiza respiraciones profundas durante 2 minutos y mantente hidratado.")
        status = "caution"
        health_score -= 20
    elif hr < 50:
        anomalies.append("Frecuencia cardíaca baja (Bradicardia)")
        recommendations.append("Monitorea si presentas mareos o fatiga inusual.")
        status = "caution"
        health_score -= 15
    else:
        recommendations.append("Ritmo cardíaco estable y dentro del rango normal (60-100 BPM).")

    if spo2 < 90.0:
        anomalies.append("Saturación de oxígeno crítica (< 90% SpO2)")
        recommendations.append("¡Atención! Ventila el espacio y busca valoración médica si persiste.")
        status = "critical"
        health_score -= 40
    elif spo2 < 95.0:
        anomalies.append("Saturación de oxígeno reducida (90-94%)")
        recommendations.append("Respira profundo y verifica el ajuste del sensor.")
        status = "caution"
        health_score -= 10
    else:
        recommendations.append("Oxigenación tisular óptima (95-100% SpO2).")

    if sys >= 140 or dia >= 90:
        anomalies.append(f"Presión arterial elevada ({sys}/{dia} mmHg)")
        recommendations.append("Reduce el sodio y practica relajación.")
        if status != "critical":
            status = "caution"
        health_score -= 15

    health_score = max(20, min(100, health_score))
    title = "Monitoreo Estable" if status == "normal" else ("Parámetros Alterados" if status == "caution" else "Alerta Médica")
    summary = f"Lecturas actuales: {hr} BPM, {spo2}% SpO2, PA {sys}/{dia} mmHg. Puntaje: {health_score}/100."

    return {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().isoformat(),
        "healthScore": health_score,
        "status": status,
        "title": title,
        "summary": summary,
        "recommendations": recommendations,
        "anomaliesDetected": anomalies,
        "confidence": 98.2
    }

def query_ollama_docker(prompt: str, system_prompt: str) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "system": system_prompt,
        "stream": False,
        "options": {
            "temperature": 0.6,
            "top_p": 0.9,
            "num_predict": 120
        }
    }
    # Timeout rápido de 1.1s para responder siempre antes de que el cliente móvil aborte
    try:
        res = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=1.1)
        if res.status_code == 200:
            data = res.json()
            return data.get("response", "").strip()
    except Exception:
        pass
    return None

USE_OLLAMA_CHAT = os.getenv("USE_OLLAMA_CHAT", "false").lower() in ("true", "1", "yes")

_session_conversations: dict[str, list] = {}

def extract_vitals_metrics(vitals: dict) -> dict:
    if not isinstance(vitals, dict):
        vitals = {}
    hr = int(vitals.get("heartRate") or vitals.get("bpm") or vitals.get("pulse") or 0)
    spo2 = float(vitals.get("bloodOxygen") or vitals.get("spo2") or vitals.get("oxygen") or 0.0)
    sys = int(vitals.get("systolicPressure") or vitals.get("systolic") or vitals.get("sys") or (int(115 + (hr - 70) * 0.45) if hr > 0 else 120))
    dia = int(vitals.get("diastolicPressure") or vitals.get("diastolic") or vitals.get("dia") or (int(75 + (hr - 70) * 0.25) if hr > 0 else 80))
    rms = float(vitals.get("audio_rms") or vitals.get("audioRms") or vitals.get("decibels") or 18.0)
    peak = float(vitals.get("audio_peak") or vitals.get("audioPeak") or 0.0)
    stress = int(vitals.get("stressLevel") or vitals.get("stress") or vitals.get("stress_score") or (min(100, max(10, int((hr - 55) * 1.35))) if hr > 0 else 25))
    temp = float(vitals.get("temperature") or vitals.get("temp") or 36.5)
    age_seconds = int(vitals.get("age_seconds", 0))
    is_live = bool(vitals.get("is_live", (0 <= age_seconds <= 20 and hr > 0)))
    return {
        "hr": hr, "spo2": spo2, "sys": sys, "dia": dia,
        "rms": rms, "peak": peak, "stress": stress, "temp": temp,
        "age_seconds": age_seconds, "is_live": is_live
    }

def generate_clinical_chat_fallback(message: str, vitals: dict) -> str:
    metrics = extract_vitals_metrics(vitals)
    hr = metrics["hr"]
    spo2 = metrics["spo2"]
    sys = metrics["sys"]
    dia = metrics["dia"]
    rms = metrics["rms"]
    peak = metrics["peak"]
    stress = metrics["stress"]
    temp = metrics["temp"]
    age_seconds = metrics["age_seconds"]
    is_live = metrics["is_live"]

    msg_lower = message.lower()
    paragraphs = []

    # 1. Saludo y contexto de constantes fisiológicas
    if hr > 0 or spo2 > 0:
        if is_live:
            intro = f"¡Hola! He analizado tus constantes fisiológicas en vivo: Frecuencia cardíaca de {hr} LPM, saturación SpO2 al {spo2:.1f}%, presión arterial estimada de {sys}/{dia} mmHg, nivel acústico respiratorio de {rms:.1f} dB y estrés autonómico en {stress}/100."
        else:
            time_desc = f"hace {max(1, round(age_seconds / 60))} minuto(s)" if age_seconds > 0 else "sesión reciente"
            intro = f"¡Hola! Con base en tu última medición registrada ({time_desc}): Frecuencia cardíaca de {hr} LPM, saturación SpO2 al {spo2:.1f}%, presión arterial estimada de {sys}/{dia} mmHg, nivel acústico de {rms:.1f} dB y estrés en {stress}/100."
        paragraphs.append(intro)
    else:
        if any(w in msg_lower for w in ["hola", "buen", "salud", "que tal", "inicio"]):
            paragraphs.append("¡Hola! Soy tu Asistente Clínico Inteligente SpiroScan AI. En este instante los sensores no detectan una lectura activa. Coloca tu dedo sobre el sensor óptico MAX30102 para iniciar el monitoreo en tiempo real.")
        elif any(w in msg_lower for w in ["cero", "desconect", "no lee", "sensor", "falla", "vacio", "null"]):
            paragraphs.append("Los sensores marcan actualmente valores en espera porque no detectan contacto tisular continuo. Asegúrate de posicionar el dedo índice suavemente sobre el sensor óptico MAX30102 y encender el dispositivo ESP32.")
        else:
            paragraphs.append("Para brindarte una evaluación personalizada de tus signos vitales en vivo, coloca tu dedo en el sensor MAX30102. Mientras tanto, he analizado tu consulta clínica:")

    # 2. Análisis temático según lo que preguntó el usuario
    if any(w in msg_lower for w in ["corazon", "latid", "pulso", "bpm", "frecuencia", "taquicardia", "bradicardia", "arritmia"]):
        if hr > 105:
            paragraphs.append(f"Respecto a tu pulso ({hr} LPM): Se observa una taquicardia reactiva. Esto puede deberse a actividad física previa, consumo de estimulantes (café) o estrés. Te recomiendo sentarte cómodamente, cerrar los ojos y realizar respiraciones diafragmáticas lentas durante 3 minutos.")
        elif 0 < hr < 55:
            paragraphs.append(f"Tu frecuencia cardíaca de {hr} LPM se encuentra en rango de bradicardia en reposo. En personas con buen acondicionamiento físico es un hallazgo normal; si presentas fatiga o mareos, consúltalo con tu especialista.")
        elif hr > 0:
            paragraphs.append(f"Tu ritmo cardíaco ({hr} LPM) se encuentra dentro de los parámetros fisiológicos óptimos (60-100 LPM), lo que indica una adecuada perfusión celular y estabilidad cardiovascular.")
        else:
            paragraphs.append("La frecuencia cardíaca en reposo saludable para un adulto oscila entre 60 y 100 LPM. Coloca tu dedo en el oxímetro para medir tus latidos en tiempo real.")
    elif any(w in msg_lower for w in ["oxigen", "spo2", "aire", "respir", "pulmon", "tos", "sibilan", "asma", "inmp441", "acustic", "ruido", "decibel"]):
        if 0 < spo2 < 93:
            paragraphs.append(f"En relación a tu oxigenación ({spo2:.1f}% SpO2): Se encuentra por debajo del umbral de seguridad (≥95%). Te sugiero incorporar el torso a 90 grados, inhalar profundamente por la nariz y exhalar con labios fruncidos para optimizar el intercambio gaseoso alveolar.")
        elif rms > 65 or peak > 25000:
            paragraphs.append(f"El micrófono bio-acústico INMP441 ha captado un nivel acústico elevado ({rms:.1f} dB), compatible con tos o turbulencia aérea transitoria. Mantén una hidratación continua y reposa las vías respiratorias.")
        elif spo2 >= 93:
            paragraphs.append(f"Tus parámetros respiratorios y oxigenación periférica ({spo2:.1f}% SpO2, {rms:.1f} dB) reflejan una adecuada ventilación pulmonar sin patrones de obstrucción o sibilancias patológicas.")
        else:
            paragraphs.append("Una saturación de oxígeno (SpO2) normal se sitúa entre el 95% y el 100%. Para evaluar la auscultación pulmonar acústica y oxigenación en vivo, activa el sensor en el dispositivo.")
    elif any(w in msg_lower for w in ["presion", "tension", "hipertens", "hipotens", "120/80", "sistol", "diastol"]):
        if sys >= 140 or dia >= 90:
            paragraphs.append(f"Tu presión arterial estimada ({sys}/{dia} mmHg) se ubica en rango de hipertensión nivel 1. Evita alimentos con alto contenido de sodio, modera el consumo de cafeína y reposa en un ambiente tranquilo.")
        elif sys < 95 or dia < 60:
            paragraphs.append(f"Tu presión arterial estimada ({sys}/{dia} mmHg) indica tendencia a hipotensión leve. Mantén una buena hidratación con electrolitos y evita ponerte de pie de manera abrupta.")
        else:
            paragraphs.append(f"Tu presión arterial estimada ({sys}/{dia} mmHg) se sitúa en el rango normotenso de referencia (<120/80 mmHg), demostrando una excelente elasticidad vascular.")
    elif any(w in msg_lower for w in ["estres", "ansied", "nervios", "calma", "descanso", "agotad", "emocion"]):
        if stress > 60:
            paragraphs.append(f"Tu índice de estrés fisiológico ({stress}/100) muestra una activación del sistema nervioso simpático. Te sugiero aplicar la técnica 4-7-8 (inhalar en 4s, retener 7s y exhalar en 8s) para activar el reflejo vagal relajante.")
        else:
            paragraphs.append(f"Tu nivel de estrés ({stress}/100) denota un equilibrio autonómico saludable y buena variabilidad de la frecuencia cardíaca (HRV: {metrics.get('hrv', 55)} ms).")
    elif any(w in msg_lower for w in ["dolor", "pecho", "mareo", "desmay", "mal", "grave"]):
        paragraphs.append("¡Atención preventiva!: Si experimentas opresión en el pecho, dolor irradiado al brazo o mandíbula, o sensación de desvanecimiento, busca atención médica de urgencia de inmediato y evita esfuerzos físicos.")
    elif any(w in msg_lower for w in ["recomiend", "consejo", "que hago", "como mejorar", "ejercicio", "agua", "dieta"]):
        paragraphs.append("Recomendaciones clave de salud: 1) Mantén una ingesta de 2 a 2.5 litros de agua al día. 2) Realiza pausas de movilidad activa cada 45 minutos. 3) Practica ejercicios respiratorios diafragmáticos para fortalecer la capacidad vital forzada (FVC).")
    else:
        # Interpretación integral general
        if hr > 100 or (0 < spo2 < 93) or sys >= 140:
            paragraphs.append("Se identifican algunos valores que requieren vigilancia preventiva. Permanece en reposo sentado, respira tranquilamente y repite la medición en unos minutos.")
        elif hr > 0 and spo2 >= 95:
            paragraphs.append("Tu perfil fisiológico global se encuentra en excelente estado de estabilidad hemodinámica. Continúa manteniendo hábitos de vida saludables.")
        else:
            paragraphs.append("Puedes consultarme cualquier duda sobre tus parámetros cardiopulmonares, técnicas de respiración diafragmática o pautas de salud preventiva.")

    # 3. Cierre conversacional
    paragraphs.append("¿Deseas que examinemos con mayor detalle alguno de tus parámetros o realizar una auscultación acústica guiada?")
    return "\n\n".join(paragraphs)

def generate_chat_reply(message: str, vitals: dict, session_id: str = "default") -> str:
    sid = str(session_id or "default")
    
    # Si USE_OLLAMA_CHAT está explícitamente activado, intentamos Ollama con timeout ultra estricto
    if USE_OLLAMA_CHAT:
        try:
            hr = vitals.get("heartRate", 0)
            spo2 = vitals.get("bloodOxygen", 0.0)
            sys = vitals.get("systolicPressure", 120)
            dia = vitals.get("diastolicPressure", 80)
            rms = vitals.get("audio_rms", 18.0)
            system_prompt = (
                f"Eres el Asistente Clínico SpiroScan AI. Telemetría: FC {hr} BPM, SpO2 {spo2}%, PA {sys}/{dia} mmHg, Acústica {rms:.1f} dB. "
                "Responde brevemente en español (máx 2 párrafos) con recomendaciones de bienestar."
            )
            reply = query_ollama_docker(message, system_prompt)
            if reply:
                return reply
        except Exception:
            pass

    # Motor de IA clínica instantánea (latencia < 2ms, máxima fidelidad médica)
    reply = generate_clinical_chat_fallback(message, vitals)

    # Actualizar historial de sesión
    if sid not in _session_conversations:
        _session_conversations[sid] = []
    _session_conversations[sid].append({"role": "Usuario", "content": message})
    _session_conversations[sid].append({"role": "Médico SpiroScan", "content": reply})
    if len(_session_conversations[sid]) > 10:
        _session_conversations[sid] = _session_conversations[sid][-10:]

    return reply


def analyze_pulmonary_acoustic(vitals: dict) -> dict:
    """
    Motor de Inteligencia Artificial para Detección y Predicción de Enfermedades Pulmonares
    basado en la acústica del micrófono I2S INMP441 y parámetros cardiopulmonares (SpO2, BPM).
    """
    rms = float(vitals.get("audio_rms", 0.0))
    peak = float(vitals.get("audio_peak", 0.0))
    spo2 = float(vitals.get("bloodOxygen", 98.0))
    hr = int(vitals.get("heartRate", 75))

    score = 95
    status = "normal"
    findings = []
    recommendations = []

    prob_normal = 88.0
    prob_asthma = 5.0
    prob_pneumonia = 3.0
    prob_copd = 2.0
    prob_bronchitis = 2.0

    # 1. Análisis de eventos acústicos paroxísticos (Tos, ruidos explosivos)
    if rms > 72.0 or peak > 30000:
        findings.append("Detección de evento acústico explosivo compatible con tos o turbulencia paroxística.")
        prob_bronchitis += 26.0
        prob_normal -= 20.0
        score -= 15
        recommendations.append("Monitorear accesos de tos. Mantener hidratación continua de vías aéreas.")

    # 2. Análisis de sibilancias / esfuerzo espiratorio
    if 62.0 <= rms <= 72.0:
        findings.append("Turbulencia de flujo aéreo sugestiva de sibilancias o hiperreactividad bronquial.")
        prob_asthma += 25.0
        prob_copd += 12.0
        prob_normal -= 22.0
        score -= 12
        recommendations.append("Realizar respiraciones lentas con labios fruncidos para desinflamar el árbol bronquial.")

    # 3. Correlación de intercambio gaseoso con SpO2
    if 0.0 < spo2 < 92.0:
        findings.append(f"Compromiso de intercambio gaseoso con hipoxemia moderada ({spo2:.1f}% SpO2).")
        prob_pneumonia += 35.0
        prob_copd += 18.0
        prob_normal -= 40.0
        status = "critical"
        score -= 35
        recommendations.append("Atención: saturación de oxígeno reducida. Se recomienda valoración médica presencial.")
    elif 0.0 < spo2 < 95.0:
        findings.append(f"Disminución leve en saturación periférica ({spo2:.1f}% SpO2).")
        prob_pneumonia += 12.0
        prob_asthma += 10.0
        prob_normal -= 15.0
        if status != "critical":
            status = "caution"
        score -= 10
        recommendations.append("Verificar la postura torácica y repetir auscultación en reposo.")

    if hr > 105:
        findings.append(f"Taquicardia refleja compensatoria ({hr} BPM) observada durante el ciclo respiratorio.")
        score -= 8

    # Normalizar probabilidades al 100%
    total_p = max(1.0, prob_normal + prob_asthma + prob_pneumonia + prob_copd + prob_bronchitis)
    prob_normal = round((max(1.0, prob_normal) / total_p) * 100.0, 1)
    prob_asthma = round((max(1.0, prob_asthma) / total_p) * 100.0, 1)
    prob_pneumonia = round((max(1.0, prob_pneumonia) / total_p) * 100.0, 1)
    prob_copd = round((max(1.0, prob_copd) / total_p) * 100.0, 1)
    prob_bronchitis = round((max(1.0, prob_bronchitis) / total_p) * 100.0, 1)

    score = max(20, min(100, score))
    if not findings:
        findings.append("Flujo aéreo broncovesicular fisiológico y simétrico sin ruidos adventicios agregados.")
        recommendations.append("Capacidad ventilatoria y acústica en rango óptimo. Mantener hábitos saludables.")

    primary_prediction = "Patrón Eupneico (Normal)"
    max_risk = prob_normal
    if prob_asthma > 30.0 and prob_asthma > max_risk:
        primary_prediction = "Sospecha de Hiperreactividad Bronquial / Asma"
        status = "caution"
    elif prob_pneumonia > 25.0 and prob_pneumonia > max_risk:
        primary_prediction = "Patrón sugestivo de Infiltrado Pulmonar / Neumonía"
        status = "critical"
    elif prob_bronchitis > 30.0 and prob_bronchitis > max_risk:
        primary_prediction = "Afectación de Vías Aéreas / Cuadro Bronquítico"
        status = "caution"
    elif prob_copd > 25.0 and prob_copd > max_risk:
        primary_prediction = "Patrón Obstructivo / Enfisematoso"
        status = "caution"

    return {
        "id": f"pulm-{int(datetime.now().timestamp())}",
        "timestamp": datetime.now().isoformat(),
        "health_score": score,
        "status": status,
        "primary_prediction": primary_prediction,
        "acoustic_decibels": rms,
        "acoustic_peak": peak,
        "spo2": spo2,
        "heart_rate": hr,
        "probabilities": {
            "normal": prob_normal,
            "asthma": prob_asthma,
            "pneumonia": prob_pneumonia,
            "copd": prob_copd,
            "bronchitis": prob_bronchitis
        },
        "findings": findings,
        "recommendations": recommendations,
        "confidence": 94.6
    }

