"""The same assessment powers the semaphore and the explanatory panel."""
import clinical_assessment

RULES_VERSION = clinical_assessment.RULES_VERSION


def _symptom_reasons(a: dict) -> list[str]:
    """Amarillo solo por síntomas comunicados: el motivo es el síntoma, no un dato pendiente."""
    names = [clinical_assessment.SYMPTOM_NAMES.get(k, k)
             for k, v in ((a.get("context") or {}).get("symptoms") or {}).items() if v is True]
    return [f"Síntomas que reporta: {', '.join(names)}"] if names and a["status"] == "findings" else []


def evaluate(session_id: str) -> dict:
    a = clinical_assessment.evaluate_session(session_id)
    level = {"urgent": "rojo", "findings": "amarillo", "insufficient_data": "gris",
             "no_specific_findings": "verde"}[a["status"]]
    v = a["vitals_used"]
    return {"session_id": session_id, "nivel": level, "titulo": a["summary"],
            "motivos": [("DEMO · " if clinical_assessment.DEMO_NOTICE in f["evidence"] else "") + f["label"]
                        for f in a["findings"]] or _symptom_reasons(a) or a["missing_data"][:2],
            "datos_usados": {"vitales_ultimo_minuto": {
                "spo2": v["bloodOxygen"], "fc": v["heartRate"],
                "lecturas": max(v.get("counts", {}).values(), default=0),
            } if v["bloodOxygen"] is not None or v["heartRate"] is not None else None,
                "corazon": None, "pulmon": None},
            "reglas_version": RULES_VERSION,
            "demo": a["demo"],
            "aviso": ((clinical_assessment.DEMO_NOTICE + " ") if a["demo"] else "")
            + "Orientación experimental; faltantes y resultados negativos no descartan enfermedad."}
