"""PDF del informe de sesión (vitales + auscultación + alertas + valoración por reglas + resumen del LLM)."""
from datetime import datetime
import hashlib
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
    safe_session = hashlib.sha256(session_id.encode()).hexdigest()[:16]
    path = REPORT_DIR / f"informe_{safe_session}_{report_id}.pdf"
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
    if content.get("resumen_llm"):
        story += [Paragraph("Resumen en lenguaje sencillo", h2),
                  Paragraph(escape(content["resumen_llm"]), body),
                  Paragraph("Redactado por un modelo de lenguaje local a partir de los datos de esta sesión; "
                            "sus cifras se verificaron contra esos datos. Las demás secciones salen de reglas fijas.",
                            small)]

    if content.get("hallazgos"):
        story.append(Paragraph("Hallazgos", h2))
        story += [Paragraph(f"• {escape(h)}", body) for h in content["hallazgos"]]

    tri = datos.get("triaje") or {}
    if tri:
        colors_map = {"rojo": "#DC2626", "amarillo": "#D97706", "verde": "#059669", "gris": "#64748B"}
        story.append(Paragraph("Triaje (reglas fijas)", h2))
        story.append(Paragraph(f"<font color='{colors_map.get(tri.get('nivel'), '#64748B')}'><b>"
                               f"{escape(str(tri.get('nivel', '')).upper())}</b></font> · {escape(tri.get('titulo', ''))}", body))
        story += [Paragraph(f"• {escape(m)}", body) for m in tri.get("motivos", [])]

    story += [Paragraph("Recomendación", h2), Paragraph(escape(content.get("recomendacion", "")), body)]

    if content.get("nota_referencia"):
        story += [Paragraph("Nota de referencia para personal de salud", h2),
                  Paragraph(escape(content["nota_referencia"]), body)]

    story.append(Paragraph("Signos vitales medidos (MAX30102)", h2))
    if s.get("n") or s.get("n_spo2"):
        vt = [["", "Promedio", "Mínimo", "Máximo"],
              ["Frecuencia cardíaca (BPM)", s["hr_prom"], s["hr_min"], s["hr_max"]],
              ["SpO2 (%)", s["spo2_prom"], s["spo2_min"], s["spo2_max"]]]
        story.append(_table(vt, [200, 100, 100, 100]))
        story.append(Paragraph(f"{s['n']} lecturas válidas entre {s['inicio'][:19]} y {s['fin'][:19]}.", small))
    else:
        story.append(Paragraph("Sin lecturas válidas del sensor óptico en esta sesión.", body))

    story.append(Paragraph("Auscultación (redes neuronales)", h2))
    grab = datos.get("grabaciones", [])
    if grab:
        rows = [["Hora", "Tipo", "Foco / zona", "Resultado", "Puntaje", "Detalle"]]
        for g in grab:
            rows.append([str(g.get("hora", ""))[11:19], g.get("tipo", ""), g.get("foco", ""), g.get("resultado", ""),
                         g.get("probabilidad_anormal") or "—", _detail_text(g.get("detalles") or {})])
        story.append(_table(rows, [50, 50, 95, 80, 45, 200]))
    else:
        story.append(Paragraph("No se realizaron grabaciones.", body))

    alerts = datos.get("alertas", [])
    if alerts:
        story.append(Paragraph("Alertas generadas por reglas", h2))
        rows = [["Hora", "Severidad", "Alerta"]] + [
            [str(a.get("hora", ""))[11:19], a.get("severidad", ""), a.get("titulo", "")] for a in alerts]
        story.append(_table(rows, [70, 90, 360]))

    a = datos.get("valoracion", {})
    for title, key in (("Datos pendientes", "missing_data"), ("Limitaciones", "limitations")):
        if a.get(key):
            story.append(Paragraph(title, h2))
            story += [Paragraph(escape(line), body) for line in a[key]]
    if a.get("sources"):
        story.append(Paragraph("Fuentes de la orientación", h2))
        story += [Paragraph(escape(source["title"] + ": " + source["url"]), small) for source in a["sources"]]
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(40, 20, "Orientación experimental. Los puntajes acústicos no son certeza clínica.")
        canvas.drawRightString(572, 20, str(doc.page))
        canvas.restoreState()

    SimpleDocTemplate(str(path), pagesize=letter, leftMargin=40, rightMargin=40,
                      topMargin=36, bottomMargin=36).build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def _detail_text(det: dict) -> str:
    parts = [f"{k}: {v['valor']}" for k, v in (det.get("caracteristicas_soplo") or {}).items()]
    parts += [f"{k} {'sí' if v.get('presente') else 'no'}" for k, v in (det.get("ruidos") or {}).items()]
    if det.get("patron"):
        parts.append(f"compatible con {det['patron']['compatible_con']}")
    return "; ".join(parts) or "—"


def _table(rows, widths):
    t = Table([[Paragraph(escape(str(c) if c is not None else "Sin dato"), ParagraphStyle("c", fontSize=8.5, leading=11)) for c in r] for r in rows],
              colWidths=widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    return t
