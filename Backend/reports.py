"""PDF del informe de sesión: resultado de la evaluación, mapa de hallazgos y notas del médico (una página)."""
from datetime import datetime
import hashlib
import os
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

REPORT_DIR = Path(os.getenv("SPIROSCAN_REPORT_DIR", Path(__file__).resolve().parent / "reports"))
REPORT_DIR.mkdir(exist_ok=True)

DISCLAIMER = ("Prototipo universitario de TAMIZAJE. No diagnostica, no se ha validado en pacientes y no "
              "sustituye la evaluación médica ni el ecocardiograma.")


LEVEL = {"rojo": ("#DC2626", "ROJO · requiere atención"), "amarillo": ("#D97706", "AMARILLO · requiere valoración"),
         "verde": ("#059669", "VERDE · sin hallazgos"), "gris": ("#64748B", "GRIS · faltan datos")}


def _zone_lines(recs: list[dict]) -> list[str]:
    """Una línea por sistema con lo encontrado en las zonas evaluadas (último resultado válido de cada una)."""
    import clinical_assessment
    import report_body
    name = lambda loc: report_body.NAMES.get(loc, loc).replace("Foco ", "").lower()
    heart = [r for r in recs if (r.get("mode") or "corazon") == "corazon"]
    lung = [r for r in recs if r.get("mode") == "pulmon"]
    lines = []
    if heart:
        bad = [r for r in heart if r.get("result") == "anormal"]
        ok = [r for r in heart if r.get("result") != "anormal"]
        if bad:
            for r in bad:
                valve = clinical_assessment.VALVE_BY_FOCUS.get(r.get("location"), ("", ""))[1]
                lines.append(f"<b>Corazón:</b> posible sonido anormal en foco {name(r.get('location'))}"
                             + (f" (se ausculta mejor {valve})" if valve else "") + ".")
        if ok:
            lines.append(f"<b>Corazón:</b> sin hallazgos en {', '.join(name(r.get('location')) for r in ok)}.")
    if lung:
        found = {}
        for r in lung:
            for sound, v in ((r.get("details") or {}).get("ruidos") or {}).items():
                if v.get("presente"):
                    found.setdefault(sound, []).append(name(r.get("location")))
        for sound, zones in found.items():
            lines.append(f"<b>Pulmón:</b> {sound} en {', '.join(zones)}.")
        clean = [r for r in lung if r.get("result") != "anormal"]
        if clean:
            lines.append(f"<b>Pulmón:</b> sin ruidos anormales en {len(clean)} "
                         f"{'zona' if len(clean) == 1 else 'zonas'} ({', '.join(name(r.get('location')) for r in clean)}).")
    return lines


def build_session_pdf(report_id: int, session_id: str, content: dict, llm_generated: bool) -> Path:
    """Informe de una página: resultado de la evaluación (lo encontrado), mapa de hallazgos y notas.
    Decisión del usuario (2026-10-08): solo información útil; sin alertas por reglas, pendientes, fuentes ni tablas repetidas."""
    import clinical_assessment
    import database
    safe_session = hashlib.sha256(session_id.encode()).hexdigest()[:16]
    path = REPORT_DIR / f"informe_{safe_session}_{report_id}.pdf"
    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["Normal"], fontSize=10, leading=14)
    small = ParagraphStyle("s", parent=body, fontSize=8, leading=10.5, textColor=colors.HexColor("#64748B"))
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=17, textColor=colors.HexColor("#1E3A8A"), spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11.5, textColor=colors.HexColor("#1E3A8A"),
                        spaceBefore=10, spaceAfter=4)

    datos = content.get("datos", {})
    context = database.get_clinical_context(session_id) or {}
    story = [
        Paragraph("SpiroScan · Informe de evaluación", h1),
        Paragraph(f"Paciente <b>{escape(session_id)}</b> · {datetime.now():%d/%m/%Y %H:%M} · "
                  "Orientación de tamizaje; no reemplaza la valoración médica.", small),
        HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB"), spaceBefore=4, spaceAfter=4),
        Paragraph("Resultado de la evaluación", h2),
    ]
    tri = datos.get("triaje") or {}
    if tri.get("nivel"):
        color, label = LEVEL.get(tri["nivel"], ("#64748B", str(tri["nivel"]).upper()))
        story.append(Paragraph(f"<font color='{color}'><b>{label}</b></font>", body))

    recs = [r for r in clinical_assessment.recent_recordings(session_id) if not clinical_assessment.is_demo(r)]
    lines = _zone_lines(recs)
    pulse = (database.get_captured_pulse(session_id) or {}).get("captured")
    if pulse:
        vit = f"<b>Pulso:</b> {pulse['heartRate']:g} BPM (toma de {pulse['segundos']} s)"
        if pulse.get("bloodOxygen") is not None:
            vit += f" · oxígeno {pulse['bloodOxygen']:g} %"
        if pulse.get("hrv"):
            vit += f" · variabilidad {pulse['hrv']} ms (estimada)"
        if pulse.get("stressLevel"):
            vit += f" · índice de estrés {pulse['stressLevel']}/100 (estimado)"
        lines.append(vit + ".")
    symptoms = [clinical_assessment.SYMPTOM_NAMES.get(k, k) for k, v in (context.get("symptoms") or {}).items() if v is True]
    if symptoms:
        lines.append("<b>Síntomas que reporta:</b> " + ", ".join(symptoms) + ".")
    if not lines:
        lines.append("Sin grabaciones ni lecturas válidas en esta evaluación.")
    story += [Paragraph("• " + line, body) for line in lines]

    steps = (datos.get("valoracion") or {}).get("next_steps") or []
    recommendation = " ".join(steps[:2]) if steps else content.get("recomendacion", "")
    if recommendation:
        story.append(Paragraph(f"<b>Recomendación:</b> {escape(recommendation)}", body))

    if content.get("resumen_llm"):
        story += [Paragraph("En palabras sencillas", h2), Paragraph(escape(content["resumen_llm"]), body),
                  Paragraph("Redactado por el asistente local a partir de estos datos; sus cifras se verificaron.", small)]

    story += _findings_section(session_id, h2, body, small)

    notes = context.get("notes")
    if notes:
        story += [Paragraph("Notas del médico", h2), Paragraph(escape(notes).replace("\n", "<br/>"), body)]

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(40, 20, "Prototipo de tamizaje. Los resultados acústicos y las estimaciones no son certeza clínica.")
        canvas.drawRightString(572, 20, str(doc.page))
        canvas.restoreState()

    SimpleDocTemplate(str(path), pagesize=letter, leftMargin=40, rightMargin=40,
                      topMargin=36, bottomMargin=36).build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def _findings_section(session_id: str, h2, body, small) -> list:
    """Mapa de hallazgos: torso con el último resultado de cada foco (últimos 30 min, sin casos demo) y tabla."""
    import clinical_assessment
    import report_body
    recs = [r for r in clinical_assessment.recent_recordings(session_id) if not clinical_assessment.is_demo(r)]
    heart = {r["location"]: r["result"] for r in recs if (r.get("mode") or "corazon") == "corazon"}
    lung = {r["location"]: r["result"] for r in recs if r.get("mode") == "pulmon"}
    maps = report_body.findings_maps(heart, lung)
    if maps is None:
        return []
    out = [Paragraph("Mapa de hallazgos", h2),
           Table([maps], colWidths=[177, 177, 177], style=TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"),
                                                                     ("VALIGN", (0, 0), (-1, -1), "TOP")])),
           Paragraph("<font color='#047857'>●</font> Sin hallazgos &nbsp;&nbsp; <font color='#B91C1C'>●</font> Posible "
                     "anormal &nbsp;&nbsp; Blanco: sin grabación válida reciente. Último resultado de cada foco en los últimos "
                     "30 minutos. Frente: la derecha del paciente queda a la izquierda del dibujo.", small)]
    if recs:
        rows = [["Foco / zona", "Tipo", "Resultado", "Salida / umbral", "Hora"]]
        for r in sorted(recs, key=lambda r: ((r.get("mode") or "corazon") != "corazon", r.get("location") or "")):
            p, t = r.get("probability"), r.get("threshold")
            rows.append([report_body.NAMES.get(r.get("location"), r.get("location") or "—"),
                         "Pulmón" if r.get("mode") == "pulmon" else "Corazón",
                         "Posible anormal" if r.get("result") == "anormal" else "Sin hallazgos",
                         f"{p:.0%} / {t:.0%}" if p is not None and t is not None else "—",
                         str(r.get("created_at", ""))[11:19]])
        out += [Spacer(1, 4), _table(rows, [150, 60, 100, 90, 60], compact=True)]
    return out


def _table(rows, widths, compact=False):
    style = ParagraphStyle("c", fontSize=7.5 if compact else 8.5, leading=9 if compact else 11)
    t = Table([[Paragraph(escape(str(c) if c is not None else "Sin dato"), style) for c in r] for r in rows],
              colWidths=widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("PADDING", (0, 0), (-1, -1), 1.5 if compact else 4),
    ]))
    return t
