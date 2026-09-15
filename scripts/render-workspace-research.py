from pathlib import Path
import sys,re,html
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'artifacts/research-tools311'))
from reportlab.platypus import SimpleDocTemplate,Paragraph,PageBreak,Spacer,Table,TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
for name,file in [('Body','arial.ttf'),('Bold','arialbd.ttf')]:pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
body=ParagraphStyle('body',fontName='Body',fontSize=10,leading=14,spaceAfter=10)
heading=ParagraphStyle('heading',parent=body,fontName='Bold',fontSize=17,leading=21,spaceAfter=16)
cell=ParagraphStyle('cell',parent=body,fontSize=8,leading=11,spaceAfter=0)
raw=(root/'docs/research/DnDRom-Workspace-Interaction-and-Loading.md').read_text(encoding='utf-8')
urls={n:url for n,url in re.findall(r'^([0-9]+)\. .*?\[[^\]]+\]\(([^)]+)\)',raw,re.M)}
def rich(s):
 s=html.escape(s)
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:f'<link href="{m[2]}" color="#234d68">{m[1]}</link>',s)
 s=re.sub(r'\[([0-9]+)\]',lambda m:f'<super><link href="{urls[m[1]]}">{m[1]}</link></super>' if m[1] in urls else m[0],s)
 return s.replace('</super><super>', ', ')
story=[]
for i,section in enumerate(raw.split('\n## ')):
 if i>1:story.append(PageBreak())
 for j,para in enumerate(section.strip().split('\n\n')):
  if j==0:story.append(Paragraph(rich(para.removeprefix('# ')),heading));continue
  if para.startswith('|'):
   rows=[[v.strip() for v in line.strip('|').split('|')] for line in para.splitlines() if not re.match(r'^[| -]+$',line)]
   widths=[64,148,133,161] if len(rows[0])==4 else [155,351]
   t=Table([[Paragraph(rich(v),cell) for v in row] for row in rows],colWidths=widths,repeatRows=1)
   t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#bbbbbb')),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.extend([t,Spacer(1,12)])
  elif re.match(r'^1\. ',para):
   for line in para.splitlines():story.append(Paragraph(rich(line),body))
  else:story.append(Paragraph(rich(para),body))
SimpleDocTemplate(str(root/'docs/research/DnDRom-Workspace-Interaction-and-Loading.pdf'),pagesize=(612,792),leftMargin=53,rightMargin=53,topMargin=42,bottomMargin=42,title='DnDRom workspace interaction and loading').build(story)
