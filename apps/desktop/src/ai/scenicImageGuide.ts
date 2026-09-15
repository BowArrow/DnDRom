import type { BasePlateRecipe } from '../domain/types';
import { sceneryHeightRatio } from '../rendering/scenicBaseGeometry';

/** An untextured physical composition guide, not a generated-image resize.
 * Shared orthographic projection preserves the requested height/width ratio. */
export function scenicGuideSvg(recipe: BasePlateRecipe): string {
  const height=sceneryHeightRatio(recipe),tilt=Math.PI/6;
  const project=(x:number,y:number,z:number)=>[512+x*760,550+(z*Math.sin(tilt)-y*Math.cos(tilt))*760];
  const outline=(radius:number,y:number,cx=0,cz=0)=>Array.from({length:64},(_,i)=>{
    const a=i/64*Math.PI*2;return project(cx+Math.cos(a)*radius,y,cz+Math.sin(a)*radius).join(',');
  }).join(' ');
  const baseTop=Math.min(.025,height*.25);
  const relief=Array.from({length:9},(_,i)=>{
    const a=i/9*Math.PI*2,r=.39,x=Math.cos(a)*r,z=Math.sin(a)*r;
    return {z,svg:`<polygon points="${outline(.068,baseTop,x,z)}" fill="#747968"/><polygon points="${outline(.055,height*(.6+.35*(i%3)/2),x,z)}" fill="#b4baa5"/>`};
  }).sort((a,b)=>a.z-b.z).map(p=>p.svg).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#e2e2df"/><polygon points="${outline(.5,0)}" fill="#66685e"/><polygon points="${outline(.5,baseTop)}" fill="#9ba28b"/>${relief}<polygon points="${outline(.275,baseTop)}" fill="#9ba28b"/></svg>`;
}

export async function createScenicImageGuide(recipe: BasePlateRecipe): Promise<File> {
  const url=URL.createObjectURL(new Blob([scenicGuideSvg(recipe)],{type:'image/svg+xml'}));
  try {
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Cannot create the baseplate composition guide');ctx.drawImage(image,0,0);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Cannot encode baseplate guide')),'image/png'));
    return new File([blob],'scenic-height-guide.png',{type:'image/png'});
  } finally {URL.revokeObjectURL(url);}
}

export const SCENIC_IMAGE_NEGATIVE='tall scenery, central flower, central statue, elevated centre, tower, tree trunk, pedestal, tiered display, stacked platform, vertical diorama, upright plants, giant blossom, character, miniature, person, text, labels, cropped base, flat illustration, vector art, cartoon, geometric pattern, smooth featureless plastic';
