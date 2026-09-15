"""Render the canonical settlement research into a linked, inspectable PDF."""
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
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak, Spacer, Table, TableStyle, Flowable
import pypdfium2 as pdfium

source_path = ROOT / "docs/research/DnDRom-Procedural-Settlements.md"
raw = source_path.read_bytes()
source = raw.decode("utf-8")
work = ROOT / "artifacts/settlement-research"
work.mkdir(parents=True, exist_ok=True)
for name, file in [("Body", "arial.ttf"), ("Bold", "arialbd.ttf"), ("Italic", "ariali.ttf")]:
    pdfmetrics.registerFont(TTFont(name, "C:/Windows/Fonts/" + file))
styles = {
    "title": ParagraphStyle("title", fontName="Bold", fontSize=25, leading=29, spaceAfter=18),
    "section": ParagraphStyle("section", fontName="Bold", fontSize=16, leading=20, spaceAfter=14, keepWithNext=True),
    "body": ParagraphStyle("body", fontName="Body", fontSize=10, leading=14, spaceAfter=10),
    "note": ParagraphStyle("note", fontName="Body", fontSize=7.4, leading=10, spaceAfter=5, textColor=colors.HexColor("#444444")),
    "source": ParagraphStyle("source", fontName="Body", fontSize=9.1, leading=12.5, spaceAfter=12),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=8.6, leading=11.5),
}
refs = {m[1]: m[2] for m in re.finditer(r"^\[\^(\d+)\]: (.+)$", source, re.M)}
urls = {n: re.search(r"\[[^\]]+\]\(([^)]+)\)", value)[1] for n, value in refs.items()}
short_sources = {"1":"Emilien et al., 2012", "2":"Chen et al., 2008", "3":"Vanegas et al., 2012", "4":"Müller et al., 2006", "5":"Merrell et al., 2010", "6":"Gumin, living repository", "7":"UNESCO, property 812", "8":"UNESCO, property 1002", "9":"UNESCO, property 192", "10":"UNESCO, property 661", "11":"English Heritage, undated", "12":"Dusterwald, 2015", "19":"Liu et al., 2026"}
short_sources.update({str(n):"Epic Games, UE 5.8 documentation" for n in range(13,19)})

def rich(value):
    value = html.escape(value)
    value = re.sub(r"`([^`]+)`", r'<font name="Body">\1</font>', value)
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: f'<link href="{m[2]}" color="#234d68">{m[1]}</link>', value)
    value = re.sub(r"\[\^(\d+)\]", lambda m: f'<super><link href="{urls[m[1]]}" color="#234d68">{m[1]}</link></super>', value)
    return value.replace('</super><super>', ', ')

class HarborSketch(Flowable):
    """Relationship sketch only; deliberately not presented as generated geometry."""
    def __init__(self):
        super().__init__()
        self.width, self.height = 506, 156

    def draw(self):
        c = self.canv
        c.setLineWidth(1.2)
        c.setStrokeColor(colors.HexColor("#727272"))
        # Connections are semantic adjacency, not actual road centerlines.
        for a, b in [((66,118),(225,118)), ((225,118),(403,118)), ((225,118),(225,47)), ((225,47),(66,47)), ((225,47),(403,47))]:
            c.line(*a, *b)
        nodes = [(66,118,"Ferry / berth","Water access"),(225,118,"Dock + cargo yard","Reserved waterfront"),(403,118,"Warehouses / repair","Service frontage"),(66,47,"Inn + public buildings","Town landmarks"),(225,47,"Market + main route","Public center"),(403,47,"Housing clusters","Lanes + shared yards")]
        for x,y,title,detail in nodes:
            c.setFillColor(colors.white)
            c.rect(x-65,y-21,130,42,fill=1,stroke=0)
            c.setFillColor(colors.HexColor("#222222"))
            c.setFont("Bold",8.5)
            c.drawCentredString(x,y+4,title)
            c.setFont("Body",7.7)
            c.drawCentredString(x,y-10,detail)

story = []
sections = source.strip().split("\n\n---\n\n")
for page_index, section in enumerate(sections):
    if page_index:
        story.append(PageBreak())
    for paragraph in section.strip().split("\n\n"):
        if paragraph.startswith("# "):
            story.append(Paragraph(rich(paragraph[2:]), styles["title"]))
        elif paragraph.startswith("## "):
            story.append(Paragraph(rich(paragraph[3:]), styles["section"]))
        elif paragraph == "@harbor-diagram":
            story.append(HarborSketch())
        elif paragraph.startswith("|"):
            rows = [[v.strip() for v in row.strip().strip("|").split("|")] for row in paragraph.splitlines()]
            rows = [row for row in rows if not all(re.fullmatch(r"[-:]+", v) for v in row)]
            cells = [[Paragraph(rich(v),styles["cell"]) for v in row] for row in rows]
            widths = [120,190,196] if len(rows[0]) == 3 else [120,386]
            table = Table(cells, colWidths=widths, hAlign="LEFT")
            table.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(0,0),(-1,0),colors.HexColor("#ededed")),("LINEBELOW",(0,0),(-1,0),.5,colors.HexColor("#888888")),("LINEBELOW",(0,1),(-1,-1),.3,colors.HexColor("#dddddd")),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
            story.extend([table,Spacer(1,12)])
        elif re.match(r"\[\^\d+\]:",paragraph):
            n, value = re.match(r"\[\^(\d+)\]: (.+)",paragraph).groups()
            story.append(Paragraph(f"{n}. "+rich(value),styles["source"]))
        else:
            story.append(Paragraph(rich(paragraph),styles["body"]))
    if page_index < len(sections)-2:
        cited = sorted(set(re.findall(r"\[\^(\d+)\]",section)),key=int)
        if cited:
            story.append(Spacer(1,9))
        for n in cited:
            title = re.search(r"\[([^\]]+)\]\(([^)]+)\)",refs[n])[1]
            story.append(Paragraph(f'{n}. {short_sources[n]}. <link href="{urls[n]}" color="#234d68">{html.escape(title)}</link>.',styles["note"]))

output = ROOT / "docs/research/DnDRom-Procedural-Settlements.pdf"
SimpleDocTemplate(str(output), pagesize=(595,842), leftMargin=44.5, rightMargin=44.5, topMargin=42, bottomMargin=42, title="Procedural settlements for DnDRom").build(story)
assert source_path.read_bytes() == raw
pdf = pdfium.PdfDocument(str(output))
pages = []
for i in range(len(pdf)):
    page = pdf[i]
    text = page.get_textpage().get_text_range()
    assert len(text)>150, f"Nearly blank page {i+1}"
    page.render(scale=1.3).to_pil().save(work/f"page-{i+1}.png")
    pages.append({"page":i+1,"characters":len(text),"opening":text[:95]})
assert len(pdf)==len(sections), f"Unexpected page overflow: {len(pdf)} pages for {len(sections)} sections"
report = {"file":str(output),"pages":pages,"sourceSha256":hashlib.sha256(raw).hexdigest(),"pdfSha256":hashlib.sha256(output.read_bytes()).hexdigest(),"bytes":output.stat().st_size}
(work/"artifact-verification.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
