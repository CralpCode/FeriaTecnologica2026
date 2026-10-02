"""PDF del informe de sesión (vitales + auscultación + alertas + texto redactado por el LLM)."""
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

REPORT_DIR = Path(__file__).resolve().parent / "reports"
REPORT_DIR.mkdir(exist_ok=True)

DISCLAIMER = ("Prototipo universitario de TAMIZAJE. No diagnostica, no se ha validado en pacientes y no "
              "sustituye la evaluación médica ni el ecocardiograma.")


def build_session_pdf(report_id: int, session_id: str, content: dict, llm_generated: bool) -> Path:
    path = REPORT_DIR / f"informe_{session_id}_{report_id}.pdf"
    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["Normal"], fontSize=9.5, leading=13)
    small = ParagraphStyle("s", parent=body, fontSize=8, textColor=colors.HexColor("#64748B"))
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=17, textColor=colors.HexColor("#1E3A8A"), spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11.5, textColor=colors.HexColor("#1E3A8A"),
                        spaceBefore=10, spaceAfter=4)
    warn = ParagraphStyle("w", parent=body, fontSize=8.5, textColor=colors.HexColor("#92400E"))

    datos = content.get("datos", {})
    s = datos.get("resumen_vitales_sesion", {})
    story = [
        Paragraph("SpiroScan · Informe de sesión de tamizaje", h1),
        Paragraph(f"Sesión <b>{escape(session_id)}</b> · emitido {datetime.now():%d/%m/%Y %H:%M}", small),
        HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB"), spaceBefore=4, spaceAfter=6),
        Table([[Paragraph(DISCLAIMER, warn)]], colWidths=[520],
              style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF3C7")),
                                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#F59E0B")),
                                ("PADDING", (0, 0), (-1, -1), 6)])),
        Paragraph("Resumen", h2),
        Paragraph(escape(content.get("resumen", "")), body),
    ]

    if content.get("hallazgos"):
        story.append(Paragraph("Hallazgos", h2))
        story += [Paragraph(f"• {escape(h)}", body) for h in content["hallazgos"]]

    story += [Paragraph("Recomendación", h2), Paragraph(escape(content.get("recomendacion", "")), body)]

    if content.get("nota_referencia"):
        story += [Paragraph("Nota de referencia para personal de salud", h2),
                  Paragraph(escape(content["nota_referencia"]), body)]

    story.append(Paragraph("Signos vitales medidos (MAX30102)", h2))
    if s.get("n"):
        vt = [["", "Promedio", "Mínimo", "Máximo"],
              ["Frecuencia cardíaca (BPM)", s["hr_prom"], s["hr_min"], s["hr_max"]],
              ["SpO2 (%)", s["spo2_prom"], s["spo2_min"], s["spo2_max"]]]
        story.append(_table(vt, [200, 100, 100, 100]))
        story.append(Paragraph(f"{s['n']} lecturas válidas entre {s['inicio'][:19]} y {s['fin'][:19]}.", small))
    else:
        story.append(Paragraph("Sin lecturas válidas del sensor óptico en esta sesión.", body))

    story.append(Paragraph("Auscultación cardíaca (CNN)", h2))
    grab = datos.get("grabaciones", [])
    if grab:
        rows = [["Hora", "Foco", "Resultado", "Prob. anormal", "Umbral"]]
        for g in grab:
            rows.append([str(g.get("hora", ""))[11:19], g.get("foco", ""), g.get("resultado", ""),
                         g.get("probabilidad_anormal") or "—", g.get("umbral") or "—"])
        story.append(_table(rows, [70, 110, 140, 100, 100]))
    else:
        story.append(Paragraph("No se realizaron grabaciones.", body))

    alerts = datos.get("alertas", [])
    if alerts:
        story.append(Paragraph("Alertas generadas por reglas", h2))
        rows = [["Hora", "Severidad", "Alerta"]] + [
            [str(a.get("hora", ""))[11:19], a.get("severidad", ""), a.get("titulo", "")] for a in alerts]
        story.append(_table(rows, [70, 90, 360]))

    story += [
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")),
        Paragraph(("Texto redactado por un modelo de lenguaje local a partir de los datos anteriores."
                   if llm_generated else "Texto generado con plantilla (modelo de lenguaje no disponible)."), small),
    ]
    SimpleDocTemplate(str(path), pagesize=letter, leftMargin=40, rightMargin=40, topMargin=36, bottomMargin=36).build(story)
    return path


def _table(rows, widths):
    t = Table([[Paragraph(escape(str(c)), ParagraphStyle("c", fontSize=8.5, leading=11)) for c in r] for r in rows],
              colWidths=widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    return t
