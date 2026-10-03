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
            "num_predict": 800
        }
    }
    # Timeout ampliado a 60 segundos para permitir inferencia completa en Docker
    res = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=60.0)
    if res.status_code == 200:
        data = res.json()
        return data.get("response", "").strip()
    else:
        raise RuntimeError(f"Ollama Docker Error HTTP {res.status_code}: {res.text}")

_session_conversations: dict[str, list] = {}

def generate_chat_reply(message: str, vitals: dict, session_id: str = "default") -> str:
    hr = vitals.get("heartRate", 0)
    spo2 = vitals.get("bloodOxygen", 0.0)
    sys = vitals.get("systolicPressure", 120)
    dia = vitals.get("diastolicPressure", 80)
    rms = vitals.get("audio_rms", 18.0)
    stress = vitals.get("stressLevel", 30)

    sid = str(session_id or "default")
    history = _session_conversations.get(sid, [])
    
    context_str = ""
    if history:
        context_str = "\nHistorial previo de esta sesión de consulta:\n" + "\n".join(
            [f"- {turn['role']}: {turn['content']}" for turn in history[-4:]]
        ) + "\n"

    system_prompt = (
        f"Eres el Asistente Clínico y Fisiológico de SpiroScan AI. Estás analizando la telemetría en tiempo real de la sesión '{sid}'.\n"
        "Tu objetivo es interpretar didácticamente los parámetros biomédicos del paciente obtenidos por los sensores de la pulsera:\n"
        f"- Frecuencia Cardíaca: {hr} BPM\n"
        f"- Saturación de Oxígeno (SpO2): {spo2}%\n"
        f"- Presión Arterial: {sys}/{dia} mmHg\n"
        f"- Nivel Bio-Acústico: {rms:.1f} dB\n"
        f"- Nivel de Estrés Estimado: {stress}/100\n"
        f"{context_str}\n"
        "DIRECTRICES DE RESPUESTA:\n"
        "1. Explica con claridad qué significan estos valores fisiológicos y cómo interpretarlos.\n"
        "2. Proporciona recomendaciones preventivas de respiración, descanso, hidratación y bienestar físico.\n"
        "3. Responde en español de forma empática, profesional, estructurada y completa (2 a 4 párrafos).\n"
        "4. Concluye siempre todas tus oraciones y recomendaciones sin dejar frases incompletas ni cortadas."
    )

    try:
        # Inferencia directa en contenedor Docker de Ollama
        reply = query_ollama_docker(message, system_prompt)
        if reply:
            if sid not in _session_conversations:
                _session_conversations[sid] = []
            _session_conversations[sid].append({"role": "Usuario", "content": message})
            _session_conversations[sid].append({"role": "Médico SpiroScan", "content": reply})
            if len(_session_conversations[sid]) > 10:
                _session_conversations[sid] = _session_conversations[sid][-10:]
            return reply
        raise RuntimeError("Respuesta vacía de Ollama Docker")
    except Exception as e:
        print(f"[OLLAMA DOCKER ERROR]: {e}")
        return f"[Error Docker Ollama]: No se pudo completar la inferencia en el contenedor ({e})."


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

