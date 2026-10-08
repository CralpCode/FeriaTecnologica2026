"""PDF del informe de sesión (vitales + auscultación + alertas + valoración por reglas + resumen del LLM)."""
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

    import database  # aquí para no crear dependencias circulares al importar el módulo
    notes = (database.get_clinical_context(session_id) or {}).get("notes")
    if notes:
        story += [Paragraph("Notas del médico", h2), Paragraph(escape(notes).replace("\n", "<br/>"), body),
                  Paragraph("Texto libre del médico; el sistema no lo verifica ni lo usa en sus reglas.", small)]

    external = datos["oximetria_externa"] if "oximetria_externa" in datos else database.get_external_spo2(session_id)
    if external:
        status = "Reciente para la valoración" if external["active"] else "Lectura anterior; fuera de la valoración actual"
        story += [Paragraph("SpO2 de oxímetro externo · ingreso manual", h2),
                  Paragraph(escape(f"{external['value']:g} % · {external['device_name']} · {external['measured_at']}"), body),
                  Paragraph(escape(status + ". No es una medición del MAX30102."), small)]
    story.append(Paragraph("Signos vitales medidos (MAX30102)", h2))
    if s.get("n") or s.get("n_spo2"):
        vt = [["", "Promedio", "Mínimo", "Máximo"],
              ["Frecuencia cardíaca (BPM)", s["hr_prom"], s["hr_min"], s["hr_max"]],
              ["SpO2 (%)", s["spo2_prom"], s["spo2_min"], s["spo2_max"]]]
        story.append(_table(vt, [200, 100, 100, 100]))
        story.append(Paragraph(f"{s['n']} lecturas válidas entre {s['inicio'][:19]} y {s['fin'][:19]}.", small))
    else:
        story.append(Paragraph("Sin lecturas válidas del sensor óptico en esta sesión.", body))

    story += _findings_section(session_id, h2, body, small)

    story.append(Paragraph("Auscultación (redes neuronales)", h2))
    grab = datos.get("grabaciones", [])
    if grab:
        rows = [["Hora", "Tipo", "Foco / zona", "Resultado", "Puntaje", "Detalle"]]
        for g in grab:
            rows.append([str(g.get("hora", ""))[11:19], g.get("tipo", ""), g.get("foco", ""), g.get("resultado", ""),
                         g.get("puntuacion_modelo") or "—", _detail_text(g.get("detalles") or {})])
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
        out += [Spacer(1, 4), _table(rows, [150, 60, 100, 90, 60])]
    return out


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
