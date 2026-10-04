import os
import re
import json
import uuid
import requests
from datetime import datetime

# Cualquier servidor compatible con la API de OpenAI: Ollama nativo (por defecto) o Splash.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
# Qwen3-Next 80B (MoE, ~3B activos por palabra): más capaz y más rápido que qwen3:32b en esta Mac.
# Se crea con Backend/llm/Modelfile.spiroscan (start_server.sh lo hace solo).
LLM_MODEL = os.getenv("LLM_MODEL", "spiroscan-qwen3next")
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


def assessment_to_report(assessment: dict) -> dict:
    status = {"urgent": "critical", "findings": "caution", "no_specific_findings": "normal",
              "insufficient_data": "insufficient_data"}[assessment["status"]]
    return {"id": str(uuid.uuid4())[:8], "timestamp": datetime.now().isoformat(),
            "healthScore": None, "confidence": None, "status": status,
            "title": "Valoración orientativa", "summary": assessment["summary"],
            "recommendations": assessment["next_steps"],
            "anomaliesDetected": [f["label"] for f in assessment["findings"]],
            "method": "reglas_trazables", "acoustic_analysis": None,
            "assessment": assessment}


def analyze_vitals_report(vitals: dict) -> dict:
    """Compatibility for exports. No fabricated health score or default normal."""
    from clinical_assessment import assess
    from measurement_quality import usable_value
    measured = {key: usable_value(vitals, key) for key in ("heartRate", "bloodOxygen")}
    return assessment_to_report(assess({}, measured, []))
