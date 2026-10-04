"""
Mapa de hallazgos para el informe PDF: el mismo torso de la app (App Movil/src/components/body/bodyArt.json)
dibujado con reportlab, con cada foco coloreado según su último resultado.
"""
import json
import os
import re
from pathlib import Path

from reportlab.graphics.shapes import Circle, Drawing, Group, Path as RLPath, String
from reportlab.lib import colors

ART_PATH = Path(os.getenv("SPIROSCAN_BODY_ART", Path(__file__).resolve().parents[1] / "App Movil" / "src" / "components"
                          / "body" / "bodyArt.json"))
HEART = ["AV", "PV", "TV", "MV"]
LUNG = ["TC", "AL", "AR", "LL", "LR", "PL", "PR"]
NAMES = {
    "AV": "Foco aórtico", "PV": "Foco pulmonar", "TV": "Foco tricuspídeo", "MV": "Foco mitral", "TC": "Tráquea",
    "AL": "Tórax anterior izquierdo", "AR": "Tórax anterior derecho", "PL": "Espalda izquierda", "PR": "Espalda derecha",
    "LL": "Costado izquierdo", "LR": "Costado derecho",
}

SKIN, STROKE, BONE = colors.HexColor("#F3F5F8"), colors.HexColor("#B8C2CF"), colors.HexColor("#D5DCE5")
STATE = {
    "normal": (colors.HexColor("#047857"), colors.white),
    "anormal": (colors.HexColor("#B91C1C"), colors.white),
    "pendiente": (colors.white, colors.HexColor("#1D4ED8")),
}
_TOKEN = re.compile(r"[MLCQZ]|-?\d*\.?\d+")


def load_art() -> dict | None:
    try:
        return json.loads(ART_PATH.read_text())
    except (OSError, ValueError):
        return None


def svg_path(d: str, **style) -> RLPath:
    """Trazo SVG con comandos absolutos M, L, C, Q y Z -> reportlab (Q se convierte a cúbica)."""
    p = RLPath(**style)
    tokens = _TOKEN.findall(d)
    i, cmd, cur = 0, None, (0.0, 0.0)

    def nums(n):
        nonlocal i
        vals = [float(t) for t in tokens[i:i + n]]
        i += n
        return vals

    while i < len(tokens):
        if tokens[i] in "MLCQZ":
            cmd = tokens[i]
            i += 1
            if cmd == "Z":
                p.closePath()
                continue
        if cmd == "M":
            x, y = nums(2); p.moveTo(x, y); cur = (x, y); cmd = "L"
        elif cmd == "L":
            x, y = nums(2); p.lineTo(x, y); cur = (x, y)
        elif cmd == "C":
            x1, y1, x2, y2, x, y = nums(6); p.curveTo(x1, y1, x2, y2, x, y); cur = (x, y)
        elif cmd == "Q":
            qx, qy, x, y = nums(4)
            c1 = (cur[0] + 2 / 3 * (qx - cur[0]), cur[1] + 2 / 3 * (qy - cur[1]))
            c2 = (x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y))
            p.curveTo(c1[0], c1[1], c2[0], c2[1], x, y); cur = (x, y)
        else:
            raise ValueError(f"Comando SVG no soportado en: {d[:40]}")
    return p


def torso(art: dict, mode: str, view: str, states: dict, width: float, title: str) -> Drawing:
    w, h = art["vb"]["w"], art["vb"]["h"]
    k = width / w
    title_h = 14
    d = Drawing(width, h * k + title_h)
    g = Group()
    g.transform = (k, 0, 0, -k, 0, h * k)   # eje Y hacia abajo, como en SVG
    g.add(svg_path(art["silhouette"], fillColor=SKIN, strokeColor=STROKE, strokeWidth=1.4))
    for c in art["contours"]:
        g.add(svg_path(c, fillColor=None, strokeColor=STROKE, strokeWidth=1))
    heart = mode == "corazon"
    lung_fill = colors.Color(3 / 255, 105 / 255, 161 / 255, alpha=0.10)
    lung_stroke = colors.Color(3 / 255, 105 / 255, 161 / 255, alpha=0.45)
    if view == "front":
        f = art["front"]
        if not heart:
            for p in f["lungs"]:
                g.add(svg_path(p, fillColor=lung_fill, strokeColor=lung_stroke, strokeWidth=1))
        for p in f["ribs"] + f["costalMargin"]:
            g.add(svg_path(p, fillColor=None, strokeColor=BONE, strokeWidth=1.1))
        if heart:
            g.add(svg_path(f["heart"], fillColor=colors.Color(190 / 255, 18 / 255, 60 / 255, alpha=0.12),
                           strokeColor=colors.Color(190 / 255, 18 / 255, 60 / 255, alpha=0.5), strokeWidth=1.1))
        for p in f["sternum"]:
            g.add(svg_path(p, fillColor=colors.HexColor("#E9EDF2"), strokeColor=STROKE, strokeWidth=0.9))
        for p in f["clavicles"]:
            g.add(svg_path(p, fillColor=None, strokeColor=STROKE, strokeWidth=2))
    else:
        b = art["back"]
        for p in b["lungs"]:
            g.add(svg_path(p, fillColor=lung_fill, strokeColor=lung_stroke, strokeWidth=1))
        for p in b["scapulae"]:
            g.add(svg_path(p, fillColor=colors.HexColor("#E9EDF2"), strokeColor=STROKE, strokeWidth=1))
        for p in b["scapulaSpines"]:
            g.add(svg_path(p, fillColor=None, strokeColor=STROKE, strokeWidth=1.5))
        for y in b["vertebrae"]:
            g.add(Circle(120, y, 2.4, fillColor=colors.HexColor("#E2E7EE"), strokeColor=STROKE, strokeWidth=0.6))
    d.add(g)
    for code in (HEART if heart else LUNG):
        pt = art["points"][code]
        if pt["view"] != view:
            continue
        fill, fg = STATE[states.get(code, "pendiente")]
        x, y = pt["x"] * k, (h - pt["y"]) * k
        d.add(Circle(x, y, 10.5 * k + 3, fillColor=fill, strokeColor=STATE["anormal"][0] if states.get(code) == "anormal"
                     else STATE["normal"][0] if states.get(code) == "normal" else colors.HexColor("#1D4ED8"), strokeWidth=1.2))
        d.add(String(x, y - 2.6, code, fontName="Helvetica-Bold", fontSize=7, fillColor=fg, textAnchor="middle"))
    # Lado del paciente en los hombros: de frente la derecha queda a la izquierda del dibujo
    left, right = ("D", "I") if view == "front" else ("I", "D")
    for x, letter in ((26 * k, left), (214 * k, right)):
        d.add(String(x, (h - 40) * k - 3, letter, fontName="Helvetica-Bold", fontSize=8,
                     fillColor=colors.HexColor("#64748B"), textAnchor="middle"))
    d.add(String(width / 2, h * k + 3, title, fontName="Helvetica-Bold", fontSize=8,
                 fillColor=colors.HexColor("#475569"), textAnchor="middle"))
    return d


def findings_maps(states_heart: dict, states_lung: dict, width_each: float = 165) -> list[Drawing] | None:
    """Tres mapas (corazón de frente, pulmón de frente y de espalda) o None si no se encontró el dibujo."""
    art = load_art()
    if not art:
        return None
    return [torso(art, "corazon", "front", states_heart, width_each, "CORAZÓN"),
            torso(art, "pulmon", "front", states_lung, width_each, "PULMÓN · FRENTE"),
            torso(art, "pulmon", "back", states_lung, width_each, "PULMÓN · ESPALDA")]
