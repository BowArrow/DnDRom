"""Render the reviewed canonical biome and world report; never generate/rewrite its text."""
from pathlib import Path
import hashlib
import html
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/research-tools311"))
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak, Spacer
import pypdfium2 as pdfium

work = ROOT / "artifacts/biome-world-research"
canonical = work / "report-source.md"
source_bytes = canonical.read_bytes()
source = source_bytes.decode("utf-8")
styles = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=26, leading=30, spaceAfter=17, textColor=colors.HexColor("#163e49")),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=16, leading=20, spaceBefore=13, spaceAfter=9, keepWithNext=True, textColor=colors.HexColor("#226b73")),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=14.4, spaceAfter=10, textColor=colors.HexColor("#26363e")),
}

def rich(value):
    escaped = html.escape(value)
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: f'<link href="{m[2]}" color="#247888">{m[1]}</link>', escaped)

story = []
for paragraph in source.strip().split("\n\n"):
    if paragraph == "---":
        story.append(PageBreak())
    elif paragraph.startswith("# "):
        story.append(Paragraph(rich(paragraph[2:]), styles["title"]))
    elif paragraph.startswith("## "):
        story.append(Paragraph(rich(paragraph[3:]), styles["section"]))
    else:
        story.append(Paragraph(rich(paragraph), styles["body"]))

def furniture(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#226b73"))
    canvas.rect(0, 824, 595, 18, fill=1, stroke=0)
    canvas.setStrokeColor(colors.HexColor("#c5d5d7"))
    canvas.line(46, 43, 549, 43)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#536f78"))
    canvas.drawString(46, 30, "DnDRom | Biomes and connected worlds | Research and implementation design")
    canvas.drawRightString(549, 30, str(doc.page))
    canvas.restoreState()

output = ROOT / "docs/research/DnDRom-Biomes-and-Connected-Worlds.pdf"
SimpleDocTemplate(str(output), pagesize=(595, 842), leftMargin=46, rightMargin=46, topMargin=43, bottomMargin=59,
                  title="One world, many playable places", author="DnDRom engineering").build(story, onFirstPage=furniture, onLaterPages=furniture)
assert canonical.read_bytes() == source_bytes, "Canonical research text changed during rendering"
pdf = pdfium.PdfDocument(str(output))
pages = []
for i in range(len(pdf)):
    page = pdf[i]
    page.render(scale=1.35).to_pil().save(work / f"page-{i+1}.png")
    text = page.get_textpage().get_text_range()
    assert len(text) > 150, f"Unexpected nearly empty page {i+1}"
    pages.append({"page": i+1, "characters": len(text)})
result = {"file": str(output), "pages": pages, "bytes": output.stat().st_size,
          "sourceSha256": hashlib.sha256(source_bytes).hexdigest(), "pdfSha256": hashlib.sha256(output.read_bytes()).hexdigest()}
(work / "artifact-verification.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
