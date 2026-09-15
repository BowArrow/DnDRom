import { atlasNoise, atlasLandform, atlasHash } from './worldLandform';
import { BIOME_FAMILIES, smooth01, clamp01, type BiomeFamily, type ClimateReservation, type WorldPoint } from './sharedWorld';
import type {SharedTerrain} from './sharedWorld';
import {sampleEnvironment} from './worldEnvironment';

const targets:Record<BiomeFamily,[number,number,number]>={ice:[-20,150,0],tundra:[-5,350,.03],'boreal-forest':[2,800,.8],'temperate-forest':[12,1000,.82],'temperate-rainforest':[11,2300,.95],steppe:[12,350,.08],mediterranean:[18,600,.22],'hot-desert':[29,80,.005],'cold-desert':[3,90,.005],savanna:[26,650,.2],'tropical-seasonal':[26,1350,.8],'tropical-rainforest':[27,2600,.98]};
/** Canonical candidate identities, shared by playable and streamed forest tiles. */
export function worldForestCandidates(seed:number,minX:number,minZ:number,size:number,stride=1){
  const result:Array<{x:number;z:number;priority:number;rotation:number;scale:number}>=[],spacing=4.5;
  for(let iz=Math.floor(minZ/(spacing*stride))*stride;iz<Math.ceil((minZ+size)/spacing);iz+=stride)for(let ix=Math.floor(minX/(spacing*stride))*stride;ix<Math.ceil((minX+size)/spacing);ix+=stride){
    const x=(ix+atlasHash(ix,iz,seed+107))*spacing,z=(iz+atlasHash(ix,iz,seed+211))*spacing;
    if(x>=minX&&x<minX+size&&z>=minZ&&z<minZ+size)result.push({x,z,priority:atlasHash(ix,iz,seed+311),rotation:atlasHash(ix,iz,seed+421)*360,scale:.8+atlasHash(ix,iz,seed+523)*.65});
  }return result;
}
export interface WorldClimate { temperature:number; precipitation:number; seasonalAmplitude:number; moisture:number; aridity:number; continentality:number; drainage:number; biome:BiomeFamily; weights:Array<{biome:BiomeFamily;weight:number}>; forest:number; snow:number; habitats:string[] }
export function sampleSharedClimate(seed:number,terrain:SharedTerrain,x:number,z:number,height?:number,flow=0,slope=0):WorldClimate{
 const climate=sampleWorldClimate(seed,terrain.climate,x,z,height,flow,slope),environment=sampleEnvironment(terrain,x,z);
 if(environment.volcanic){climate.habitats.push('volcanic');climate.forest*=1-environment.volcanic;climate.moisture*=1-environment.volcanic;climate.aridity=1-climate.moisture;}
 if(environment.magic.length)climate.habitats.push(...environment.magic.map(m=>`magical:${m.name}`));
 return climate;
}
export function orographicPrecipitation(background:number,height:number,upwindHeight:number){return Math.max(40,background+Math.max(0,height-upwindHeight)*1.4-Math.max(0,upwindHeight-height)*2);}
export function climateHabitats(height:number,flow:number,slope:number,drainage:number){const habitats:string[]=[];if(height<=180)habitats.push('aquatic');else if(height<184)habitats.push('coastal');if(flow>.3)habitats.push('riparian');if(flow>.45&&slope<.06&&drainage<.35)habitats.push('wetland');if(height>650)habitats.push('alpine');if(slope>.5)habitats.push('rocky');return habitats;}

/** Reservations have smooth compact support. They are fixed before exploration,
 * and shared across macroregion boundaries rather than normalized per tile. */
export function reserveClimate(seed:number,origin:WorldPoint):ClimateReservation[]{
  return BIOME_FAMILIES.map((biome,i)=>{const a=i/BIOME_FAMILIES.length*Math.PI*2,r=44000;let x=origin.x+Math.cos(a)*r,z=origin.z+Math.sin(a)*r;
    // A coarse dry candidate prevents the entire biome centre being offshore.
    let best=Infinity,bx=x,bz=z;
    for(let dz=-4000;dz<=4000;dz+=1000)for(let dx=-4000;dx<=4000;dx+=1000){const h=atlasLandform(x+dx,z+dz,seed,128),cost=Math.abs(h-280)+Math.hypot(dx,dz)*.02;if(cost<best){best=cost;bx=x+dx;bz=z+dz;}}
    x=bx;z=bz;
    // Climate anchors are independent of subsequent scene reservations.
    x=Math.round(x/128)*128;z=Math.round(z/128)*128;
    return {id:`climate-${biome}`,biome,x,z,radius:14000,temperature:targets[biome][0],precipitation:targets[biome][1]};
  });
}
function climateCell(seed:number,reservations:ClimateReservation[],x:number,z:number){
  const h=atlasLandform(x,z,seed,128),west=atlasLandform(x-2048,z,seed,128),east=atlasLandform(x+2048,z,seed,128);
  const continentality=clamp01((h-180)/500),rainShadow=Math.max(0,west-h),uplift=Math.max(0,h-west);
  let t=19+(atlasNoise(x/42000,z/42000,seed+919)-.5)*28-(h-180)*.0065;
  let p=orographicPrecipitation(900+(atlasNoise(x/17000,z/17000,seed+811)-.5)*1300,h,west);
  let dominant=0;
  for(const r of reservations){const w=1-smooth01((Math.hypot(x-r.x,z-r.z)-r.radius*.22)/(r.radius*.78));if(w>dominant){dominant=w;t=t*(1-w)+(r.temperature-(h-atlasLandform(r.x,r.z,seed,128))*.0065)*w;p=p*(1-w)+r.precipitation*w;}}
  return {t,p,continentality,drainage:clamp01(Math.abs(east-west)/400)};
}
const cache=new WeakMap<ClimateReservation[],Map<string,ReturnType<typeof climateCell>>>();
export function sampleWorldClimate(seed:number,reservations:ClimateReservation[],x:number,z:number,height?:number,flow=0,slope=0):WorldClimate{
  let cells=cache.get(reservations);if(!cells){cells=new Map();cache.set(reservations,cells);}
  const ix=Math.floor(x/128),iz=Math.floor(z/128),tx=x/128-ix,tz=z/128-iz;
  const at=(dx:number,dz:number)=>{const key=`${seed}/${ix+dx}/${iz+dz}`;let cell=cells!.get(key);if(!cell){cell=climateCell(seed,reservations,(ix+dx)*128,(iz+dz)*128);if(cells!.size>8192)cells!.delete(cells!.keys().next().value!);cells!.set(key,cell);}return cell;};
  const a=at(0,0),b=at(1,0),c=at(0,1),d=at(1,1),mix=(key:keyof typeof a)=>(a[key]*(1-tx)+b[key]*tx)*(1-tz)+(c[key]*(1-tx)+d[key]*tx)*tz;
  const temperature=mix('t')-((height??atlasLandform(x,z,seed,128))-atlasLandform(x,z,seed,128))*.0065,precipitation=mix('p');
  const ranked=BIOME_FAMILIES.map(biome=>{const [t,p]=targets[biome];return {biome,cost:((temperature-t)/7)**2+((Math.log(Math.max(20,precipitation))-Math.log(p))/.48)**2};}).sort((a,b)=>a.cost-b.cost);
  const raw=ranked.slice(0,3).map(r=>({biome:r.biome,weight:Math.exp(-(r.cost-ranked[0].cost)*2)})),sum=raw.reduce((n,r)=>n+r.weight,0),weights=raw.map(r=>({...r,weight:r.weight/sum}));
  const moisture=clamp01(precipitation/(900+Math.max(0,temperature)*35)+flow*.5),drainage=mix('drainage'),habitats=climateHabitats(height??atlasLandform(x,z,seed,128),flow,slope,drainage);
  return {temperature,precipitation,seasonalAmplitude:4+mix('continentality')*15,moisture,aridity:1-moisture,continentality:mix('continentality'),drainage,biome:ranked[0].biome,weights,forest:weights.reduce((n,r)=>n+targets[r.biome][2]*r.weight,0)*(1-smooth01((slope-.35)/.4)),snow:1-smooth01((temperature+4)/8),habitats};
}
export function validateBiomeCoverage(seed:number,reservations:ClimateReservation[],origin:WorldPoint,radius:number):string[]{return BIOME_FAMILIES.filter(b=>!reservations.some(r=>r.biome===b&&Math.hypot(r.x-origin.x,r.z-origin.z)<=radius&&sampleWorldClimate(seed,reservations,r.x,r.z).biome===b)).map(b=>`No indexed ${b} biome within ${radius} metres`);}
