"""The same assessment powers the semaphore and the explanatory panel."""
import clinical_assessment

RULES_VERSION = clinical_assessment.RULES_VERSION


def evaluate(session_id: str) -> dict:
    a = clinical_assessment.evaluate_session(session_id)
    level = {"urgent": "rojo", "findings": "amarillo", "insufficient_data": "gris",
             "no_specific_findings": "verde"}[a["status"]]
    v = a["vitals_used"]
    return {"session_id": session_id, "nivel": level, "titulo": a["summary"],
            "motivos": [f["label"] for f in a["findings"]] or a["missing_data"][:2],
            "datos_usados": {"vitales_ultimo_minuto": {
                "spo2": v["bloodOxygen"], "fc": v["heartRate"],
                "lecturas": max(v.get("counts", {}).values(), default=0),
            } if v["bloodOxygen"] is not None or v["heartRate"] is not None else None,
                "corazon": None, "pulmon": None},
            "reglas_version": RULES_VERSION,
            "aviso": "Orientación experimental; faltantes y resultados negativos no descartan enfermedad."}
