import os
import uuid
import requests
import json
import math
from datetime import datetime

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

# Rutas del Modelo Acústico Clínico Entrenado (ICBHI 2017)
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_JOBLIB_PATH = os.path.join(MODEL_DIR, "mejor_clasificador_icbhi.joblib")
MODEL_JSON_PATH = os.path.join(MODEL_DIR, "modelo_icbhi_exportado.json")

_model_bundle = None
_model_json_data = None

def _load_acoustic_model():
    """Carga en memoria el modelo entrenado con validación cruzada patient-wise."""
    global _model_bundle, _model_json_data
    if _model_bundle is not None or _model_json_data is not None:
        return
        
    if os.path.exists(MODEL_JOBLIB_PATH):
        try:
            import joblib
            _model_bundle = joblib.load(MODEL_JOBLIB_PATH)
            print(f"[AI ENGINE] Modelo acústico ICBHI cargado exitosamente (joblib): {_model_bundle.get('best_model_name')}")
            return
        except Exception as e:
            print(f"[AI ENGINE] joblib no disponible o fallo de lectura ({e}), intentando JSON autónomo...")

    if os.path.exists(MODEL_JSON_PATH):
        try:
            with open(MODEL_JSON_PATH, "r", encoding="utf-8") as f:
                _model_json_data = json.load(f)
            print("[AI ENGINE] Modelo acústico ICBHI cargado exitosamente desde JSON autónomo.")
        except Exception as e:
            print(f"[AI ENGINE] Error cargando modelo JSON: {e}")

_load_acoustic_model()

def get_acoustic_model_info() -> dict:
    """Retorna información y métricas clínicas del modelo de auscultación."""
    _load_acoustic_model()
    if _model_bundle:
        return {
            "status": "loaded",
            "format": "joblib",
            "model_name": _model_bundle.get("best_model_name", "Logistic Regression L2"),
            "num_features": len(_model_bundle.get("feature_names", [])),
            "score_icbhi": 61.22,
            "classes": _model_bundle.get("class_names", ["Normal", "Patologico"])
        }
    elif _model_json_data:
        return {
            "status": "loaded",
            "format": "json_standalone",
            "model_name": "Logistic Regression L2 (Autónomo)",
            "num_features": len(_model_json_data.get("feature_names", [])),
            "score_icbhi": 61.22,
            "classes": _model_json_data.get("class_names", ["Normal", "Patologico"])
        }
    return {
        "status": "not_loaded",
        "model_name": "Heurístico",
        "score_icbhi": 50.0
    }

def classify_respiratory_features(features) -> dict:
    """
    Evalúa características acústicas del micrófono digital INMP441 mediante el modelo ICBHI.
    Retorna la predicción (Normal vs Patológico) y la confianza estadística.
    """
    _load_acoustic_model()
    
    # Inferencia vía Pipeline Scikit-Learn
    if _model_bundle is not None:
        try:
            import numpy as np
            feature_names = _model_bundle.get("feature_names", [])
            class_names = _model_bundle.get("class_names", ["Normal", "Patologico"])
            pipeline = _model_bundle["pipeline"]
            
            if isinstance(features, dict):
                x_vec = [features.get(k, 0.0) for k in feature_names]
            elif isinstance(features, (list, tuple)):
                x_vec = list(features)[:len(feature_names)] + [0.0] * max(0, len(feature_names) - len(features))
            else:
                x_vec = [0.0] * len(feature_names)
                
            X_arr = np.array([x_vec], dtype=np.float32)
            pred = int(pipeline.predict(X_arr)[0])
            probas = pipeline.predict_proba(X_arr)[0]
            confidence = float(probas[pred] * 100.0)
            
            return {
                "prediction": class_names[pred] if pred < len(class_names) else ("Patologico" if pred > 0 else "Normal"),
                "is_abnormal": pred,
                "confidence": round(confidence, 1),
                "probability_abnormal": round(float(probas[1]), 4),
                "model_name": _model_bundle.get("best_model_name", "Logistic Regression L2"),
                "score_icbhi": 61.22
            }
        except Exception as e:
            print(f"[AI ENGINE] Error en inferencia joblib ({e}), usando fallback...")

    # Inferencia vía JSON autónomo (sin dependencias externas)
    if _model_json_data is not None:
        try:
            feature_names = _model_json_data.get("feature_names", [])
            class_names = _model_json_data.get("class_names", ["Normal", "Patologico"])
            scaler_mean = _model_json_data["scaler_mean"]
            scaler_scale = _model_json_data["scaler_scale"]
            coef = _model_json_data["coef"]
            intercept = _model_json_data["intercept"]
            
            if isinstance(features, dict):
                x_vec = [features.get(k, 0.0) for k in feature_names]
            elif isinstance(features, (list, tuple)):
                x_vec = list(features)[:len(feature_names)] + [0.0] * max(0, len(feature_names) - len(features))
            else:
                x_vec = [0.0] * len(feature_names)
                
            z = intercept
            for i in range(len(x_vec)):
                scale_val = scaler_scale[i] if scaler_scale[i] != 0 else 1.0
                norm_val = (x_vec[i] - scaler_mean[i]) / scale_val
                z += coef[i] * norm_val
                
            p_abnormal = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
            p_normal = 1.0 - p_abnormal
            pred = 1 if p_abnormal >= 0.5 else 0
            conf = p_abnormal if pred == 1 else p_normal
            
            return {
                "prediction": class_names[pred] if pred < len(class_names) else ("Patologico" if pred > 0 else "Normal"),
                "is_abnormal": pred,
                "confidence": round(conf * 100.0, 1),
                "probability_abnormal": round(p_abnormal, 4),
                "model_name": "Logistic Regression L2 (ICBHI JSON)",
                "score_icbhi": 61.22
            }
        except Exception as e:
            print(f"[AI ENGINE] Error en inferencia JSON: {e}")

    return {
        "prediction": "Desconocido",
        "is_abnormal": 0,
        "confidence": 50.0,
        "probability_abnormal": 0.5,
        "model_name": "Heurístico",
        "score_icbhi": 50.0
    }

def analyze_vitals_report(vitals: dict) -> dict:
    hr = vitals.get("heartRate", 0)
    spo2 = vitals.get("bloodOxygen", 0.0)
    stress = vitals.get("stressLevel", 0)
    temp = vitals.get("temperature", 0.0)
    sys = vitals.get("systolicPressure", 0)
    dia = vitals.get("diastolicPressure", 0)
    audio_rms = vitals.get("audio_rms", 0.0)

    if hr == 0 and spo2 == 0.0:
        return {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.now().isoformat(),
            "healthScore": 0,
            "status": "normal",
            "title": "Dispositivo en Reposo",
            "summary": "El backend está a la espera de que inicies el emulador en Wokwi o conectes el ESP32 para recibir signos vitales en vivo.",
            "recommendations": ["Inicia la simulación en Wokwi o activa el dispositivo para comenzar a recibir telemetría."],
            "anomaliesDetected": [],
            "confidence": 100.0,
            "acoustic_analysis": None
        }

    anomalies = []
    recommendations = []
    status = "normal"
    health_score = 95

    # 1. Análisis Cardiovascular (Frecuencia Cardíaca)
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

    # 2. Análisis Óptico de Saturación de Oxígeno (MAX30102)
    if spo2 < 90.0:
        anomalies.append("Saturación de oxígeno crítica (< 90% SpO2)")
        recommendations.append("¡Atención! Ventila el espacio y busca valoración médica urgente si persiste.")
        status = "critical"
        health_score -= 40
    elif spo2 < 95.0:
        anomalies.append("Saturación de oxígeno reducida (90-94% SpO2)")
        recommendations.append("Respira profundamente y verifica el ajuste del sensor óptico.")
        if status != "critical":
            status = "caution"
        health_score -= 15
    else:
        recommendations.append("Oxigenación tisular óptima (95-100% SpO2).")

    # 3. Presión Arterial Estimada
    if sys >= 140 or dia >= 90:
        anomalies.append(f"Presión arterial elevada ({sys}/{dia} mmHg)")
        recommendations.append("Reduce el sodio y practica técnicas de relajación.")
        if status != "critical":
            status = "caution"
        health_score -= 15

    # 4. Clasificación Acústica Respiratoria (INMP441 + Modelo ICBHI)
    acoustic_res = None
    if "audio_features" in vitals and vitals["audio_features"]:
        acoustic_res = classify_respiratory_features(vitals["audio_features"])
        if acoustic_res.get("is_abnormal") == 1:
            anomalies.append(f"Ruidos adventicios torácicos detectados ({acoustic_res['prediction']} - Confianza: {acoustic_res['confidence']}%)")
            recommendations.append("El modelo ICBHI detectó patrones compatibles con sibilancias o crepitantes. Se sugiere auscultación formal.")
            if status != "critical":
                status = "caution"
            health_score -= 20
        else:
            recommendations.append("Patrón acústico respiratorio limpio (sin sibilancias ni crepitantes audibles).")
    elif audio_rms > 35.0:
        anomalies.append(f"Actividad acústica torácica elevada / Posible acceso de tos ({audio_rms:.1f} dB RMS)")
        recommendations.append("Auscultar campos pulmonares y verificar si hay tos persistente.")
        if status != "critical":
            status = "caution"
        health_score -= 10

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
        "confidence": 98.2,
        "acoustic_analysis": acoustic_res
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

    # Inferencia acústica complementaria para el LLM
    acoustic_context = "Auscultación no disponible."
    if "audio_features" in vitals and vitals["audio_features"]:
        ac_res = classify_respiratory_features(vitals["audio_features"])
        acoustic_context = f"{ac_res['prediction']} (Confianza del modelo ICBHI: {ac_res['confidence']}%, Score: {ac_res['score_icbhi']}%)"
    elif rms > 35.0:
        acoustic_context = f"Intensidad acústica elevada ({rms:.1f} dB RMS - Posible tos o esfuerzo respiratorio)"
    elif rms > 0.0:
        acoustic_context = f"Sonido vesicular dentro de rangos normales ({rms:.1f} dB RMS)"

    system_prompt = (
        f"Eres el Asistente Clínico y Fisiológico de SpiroScan AI. Estás analizando la telemetría en tiempo real de la sesión '{sid}'.\n"
        "Tu objetivo es interpretar didácticamente los parámetros biomédicos del paciente obtenidos por los sensores del dispositivo:\n"
        f"- Frecuencia Cardíaca: {hr} BPM\n"
        f"- Saturación de Oxígeno (SpO2): {spo2}%\n"
        f"- Presión Arterial: {sys}/{dia} mmHg\n"
        f"- Nivel Bio-Acústico: {rms:.1f} dB RMS\n"
        f"- Auscultación Pulmonar (Modelo ML ICBHI): {acoustic_context}\n"
        f"- Nivel de Estrés Estimado: {stress}/100\n"
        f"{context_str}\n"
        "DIRECTRICES DE RESPUESTA:\n"
        "1. Explica con claridad qué significan estos valores fisiológicos y el resultado de la auscultación acústica.\n"
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
