import type { BasePlateLayer, BasePlateRecipe } from '../domain/types';
export const sceneryHeightRatio = (recipe: BasePlateRecipe) => Math.min(.4, Math.max(.04, Number.isFinite(recipe.sceneryHeightRatio) ? recipe.sceneryHeightRatio! : .1));
export const isScenicBaseSurface = (layer: BasePlateLayer) => layer.enabled && layer.kind === 'prop' && !!layer.propAssetId && (layer.role === 'base-surface' || layer.name === 'AI scenic mesh');
type Surface = { positions: ArrayLike<number>; indices: ArrayLike<number> };
export type StandingPoint = { x: number; z: number };

/** Preserve proportions. Height is a validation rule, never a mesh deformation.
 * Find a low supported patch instead of the uppermost central decoration. */
export function fitScenicBase(parts: Surface[], diameter: number, heightRatio: number, standingPoint?: StandingPoint) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const part of parts)for(let i=0;i<part.positions.length;i++) {
    const v=part.positions[i];if(!Number.isFinite(v))throw Error('Invalid scenic base geometry');
    min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v);
  }
  const width=Math.max(max[0]-min[0],max[2]-min[2]);
  if(!Number.isFinite(width)||width<=0||!Number.isFinite(diameter)||diameter<=0)throw Error('Scenic base has no usable footprint');
  const cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2,scale=diameter*.98/width;
  // Rasterize upper surfaces once, bounded independently of vertex density.
  const size=49,field=new Float64Array(size*size).fill(-Infinity),step=width/(size-1);
  for(const {positions:p,indices} of parts)for(let i=0;i<indices.length;i+=3) {
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ax=(p[a]-cx+width/2)/step,az=(p[a+2]-cz+width/2)/step;
    const bx=(p[b]-cx+width/2)/step,bz=(p[b+2]-cz+width/2)/step;
    const dx=(p[c]-cx+width/2)/step,dz=(p[c+2]-cz+width/2)/step;
    const det=(bz-dz)*(ax-dx)+(dx-bx)*(az-dz);if(Math.abs(det)<1e-10)continue;
    for(let z=Math.max(0,Math.ceil(Math.min(az,bz,dz)));z<=Math.min(size-1,Math.floor(Math.max(az,bz,dz)));z++)
      for(let x=Math.max(0,Math.ceil(Math.min(ax,bx,dx)));x<=Math.min(size-1,Math.floor(Math.max(ax,bx,dx)));x++) {
        const u=((bz-dz)*(x-dx)+(dx-bx)*(z-dz))/det,v=((dz-az)*(x-dx)+(ax-dx)*(z-dz))/det;
        if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)field[z*size+x]=Math.max(field[z*size+x],u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1]);
      }
  }
  const candidates:{x:number;z:number;y:number;roughness:number;distance:number}[]=[];
  // The foot area must be supported, including the space between feet.
  for(let z=8;z<size-8;z++)for(let x=8;x<size-8;x++) {
    if(Math.hypot(x-24,z-24)>16)continue;
    let low=Infinity,high=-Infinity;
    for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++) {
      if(dx*dx+dz*dz>16)continue;
      const y=field[(z+dz)*size+x+dx];low=Math.min(low,y);high=Math.max(high,y);
    }
    if(!Number.isFinite(low)||high-low>width*.08)continue;
    candidates.push({x:(x-24)*step,z:(z-24)*step,y:high,roughness:high-low,distance:Math.hypot(x-24,z-24)*step});
  }
  const lower=candidates.map(p=>p.y).sort((a,b)=>a-b),ground=lower[Math.floor(lower.length*.2)];
  const lowCandidates=candidates.filter(p=>p.y<=ground+width*.025);
  lowCandidates.sort((a,b)=>a.distance-b.distance||a.roughness-b.roughness||a.z-b.z||a.x-b.x);
  let chosen=lowCandidates[0];
  if(standingPoint&&Number.isFinite(standingPoint.x)&&Number.isFinite(standingPoint.z)) {
    const tx=standingPoint.x*width,tz=standingPoint.z*width;
    chosen=[...candidates].sort((a,b)=>Math.hypot(a.x-tx,a.z-tz)-Math.hypot(b.x-tx,b.z-tz))[0];
  }
  const height=(max[1]-min[1])*scale;
  return {scale:{x:scale,y:scale,z:scale},position:{x:-cx*scale,y:-min[1]*scale,z:-cz*scale},
    anchorTop:((chosen?.y??min[1])-min[1])*scale+.002,anchorOffset:{x:(chosen?.x??0)*scale,z:(chosen?.z??0)*scale},
    hasStandingSurface:!!chosen,supportRoughnessRatio:chosen?chosen.roughness/width:Infinity,height,heightRatio:(max[1]-min[1])/width,
    exceedsHeightBudget:height>diameter*Math.max(.04,Math.min(.4,heightRatio))+diameter*.005};
}
export function validateScenicBase(parts: Surface[], heightRatio: number) {
  const fit=fitScenicBase(parts,1,heightRatio);
  if(fit.exceedsHeightBudget)throw Error(`This mesh is ${Math.round(fit.heightRatio*100)}% as tall as it is wide, above the ${Math.round(heightRatio*100)}% scenery limit. Generate a shallower concept or raise the limit. The mesh has not been squashed or assigned.`);
  if(!fit.hasStandingSurface||fit.supportRoughnessRatio>.025)throw Error('This base has no broad, clear standing area. Regenerate the concept with an open flat centre before assigning it.');
  return fit;
}
