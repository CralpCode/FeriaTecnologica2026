import os
import re
import json
import uuid
import requests
from datetime import datetime

# Cualquier servidor compatible con la API de OpenAI: Ollama nativo (por defecto) o Splash.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3:32b")
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "90"))

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def llm_chat(messages: list[dict], max_tokens: int = 600, temperature: float = 0.4, json_mode: bool = False) -> str:
    """Llama al LLM local. Lanza excepción si no responde; quien llama decide el texto de respaldo."""
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        # Qwen3 razona antes de responder; para textos cortos eso solo agrega latencia.
        "reasoning_effort": "none",
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    res = requests.post(f"{LLM_BASE_URL}/chat/completions", json=payload, timeout=LLM_TIMEOUT_S)
    if res.status_code != 200:
        raise RuntimeError(f"LLM HTTP {res.status_code}: {res.text[:300]}")
    text = res.json()["choices"][0]["message"].get("content") or ""
    text = _THINK_RE.sub("", text).strip()
    if not text:
        raise RuntimeError("Respuesta vacía del LLM")
    return text


def llm_json(messages: list[dict], max_tokens: int = 800) -> dict:
    return json.loads(llm_chat(messages, max_tokens=max_tokens, temperature=0.2, json_mode=True))


def llm_available() -> bool:
    try:
        return requests.get(f"{LLM_BASE_URL}/models", timeout=3).status_code == 200
    except requests.RequestException:
        return False


def analyze_vitals_report(vitals: dict) -> dict:
    """Evaluación por reglas fijas de los valores que el MAX30102 sí mide (pulso y SpO2)."""
    hr = vitals.get("heartRate", 0)
    spo2 = vitals.get("bloodOxygen", 0.0)

    # Modelo base de pulmón (ICBHI): solo si alguien envía las 61 características ya calculadas.
    acoustic = None
    if vitals.get("audio_features"):
        from ml import lung_baseline
        acoustic = lung_baseline.classify_features(vitals["audio_features"])
        if acoustic.get("prediction") == "no_disponible":
            acoustic = None

    if hr == 0 and spo2 == 0.0:
        return {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.now().isoformat(),
            "healthScore": 0,
            "status": "normal",
            "title": "Dispositivo en Reposo",
            "summary": "Esperando lecturas del sensor. Coloca el dedo sobre el MAX30102 o inicia el emulador.",
            "recommendations": ["Coloca el dedo sobre el sensor óptico y mantenlo quieto unos segundos."],
            "anomaliesDetected": [],
            "confidence": 0,
            "method": "reglas",
            "acoustic_analysis": acoustic,
        }

    anomalies = []
    recommendations = []
    status = "normal"
    health_score = 95

    if hr > 120:
        anomalies.append("Frecuencia cardíaca elevada (> 120 BPM)")
        recommendations.append("Reposo de 5 minutos y repetir la medición. Si persiste, consultar a personal de salud.")
        status = "caution"
        health_score -= 20
    elif hr < 45:
        anomalies.append("Frecuencia cardíaca baja (< 45 BPM)")
        recommendations.append("Repetir la medición; si hay mareo o fatiga, consultar a personal de salud.")
        status = "caution"
        health_score -= 15
    else:
        recommendations.append("Frecuencia cardíaca dentro del rango esperado en reposo.")

    if spo2 < 90.0:
        anomalies.append("Saturación de oxígeno baja (< 90 % SpO2)")
        recommendations.append("Verificar la colocación del sensor y buscar valoración médica si se confirma.")
        status = "critical"
        health_score -= 40
    elif spo2 < 94.0:
        anomalies.append("Saturación de oxígeno reducida (90-93 %)")
        recommendations.append("Verificar el ajuste del sensor y repetir la medición.")
        if status != "critical":
            status = "caution"
        health_score -= 10
    else:
        recommendations.append("Saturación de oxígeno en rango normal (≥ 94 %).")

    if acoustic and acoustic.get("is_abnormal") == 1:
        anomalies.append(f"Posibles ruidos respiratorios anormales (modelo base: {acoustic['prediction']})")
        recommendations.append("Es un tamizaje: se sugiere auscultación por personal de salud.")
        if status != "critical":
            status = "caution"
        health_score -= 15

    health_score = max(20, min(100, health_score))
    title = "Monitoreo Estable" if status == "normal" else ("Parámetros Alterados" if status == "caution" else "Alerta")
    summary = f"Lecturas actuales: {hr} BPM, {spo2}% SpO2. Evaluación por reglas; no es un diagnóstico."

    return {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().isoformat(),
        "healthScore": health_score,
        "status": status,
        "title": title,
        "summary": summary,
        "recommendations": recommendations,
        "anomaliesDetected": anomalies,
        # Reglas fijas: no hay un "porcentaje de certeza" que reportar.
        "confidence": 0,
        "method": "reglas",
        "acoustic_analysis": acoustic,
    }
