"""Scientific heightfield comparison; no generated or retouched scene imagery."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw

field = json.loads(Path('artifacts/hydrology-reference-field.json').read_text())
n, cell = field['resolution'], field['cellSize']
panels = []
for key in ['raw', 'heights', 'flow']:
    values = field[key]; pixels = []
    for z in range(n):
        for x in range(n):
            i = z*n+x
            h = field['heights'] if key == 'flow' else values
            gx = (h[z*n+min(n-1,x+1)]-h[z*n+max(0,x-1)])/(2*cell)
            gz = (h[min(n-1,z+1)*n+x]-h[max(0,z-1)*n+x])/(2*cell)
            norm = math.sqrt(1+gx*gx+gz*gz)
            light = .35+.65*max(0,(-gx*.5+.7-gz*.5)/norm)
            color = [round(230*light)]*3
            if key == 'flow':
                t = max(0,min(1,(values[i]-.2)/.7))
                color = [round(a*(1-t)+b*t) for a,b in zip(color,[34,115,160])]
            pixels.append(tuple(color))
    panel = Image.new('RGB',(n,n));panel.putdata(pixels)
    panels.append(panel.resize((514,514)))
image=Image.new('RGB',(1542,550),'#202428');draw=ImageDraw.Draw(image)
for i,(panel,title) in enumerate(zip(panels,['Initial fractal terrain','Hydraulic erosion + avalanching','Simulated discharge'])):
    image.paste(panel,(i*514,36));draw.text((i*514+12,10),title,fill='white')
image.save('artifacts/hydrology-reference-relief.png')
