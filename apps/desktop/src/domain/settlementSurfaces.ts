import type {ScenePart} from './sceneGrammar';
import type {WorldManifest} from './sharedWorld';
import {worldHash} from './sharedWorld';
import {sampleSharedClimate} from './worldClimate';

export interface SettlementSurface {version:1;seed:number;age:number;moisture:number;wall:0|1|2;wood:0|1;roof:0|1}
export function settlementSurface(m:WorldManifest,locationId:string,id:string):SettlementSurface {
  const l=m.locations.find(l=>l.id===locationId)!,request=m.requests.find(r=>r.id===l.requestId||r.id===l.id),style=m.styles.find(s=>s.id===request?.styleId)??m.styles[0];
  const building=l.settlement.buildings.find(b=>b.id===id),b=building??l.settlement.structures?.find(b=>b.id===id),p=b?.position??l.position;
  const random=(salt:string)=>worldHash(`${m.seed}/${id}/${salt}`)/4294967296;
  const climate=sampleSharedClimate(m.seed,m.terrain,p.x,p.z,p.y),family=building?.program?.style??style?.family??'timber';
  return {version:1,seed:Math.floor(random('surface')*4095),age:Math.max(0,Math.min(1,(style?.age??.4)*(.65+random('age')*.7))),moisture:climate.moisture*(1-climate.snow),wall:family==='earthen'?2:family==='fortress'?0:family==='courtyard'?random('finish')<.7?1:0:random('finish')<.35?0:random('finish')<.85?1:2,wood:random('wood')<.5?0:1,roof:family==='earthen'?1:random('roof')<.65?0:1};
}
export function dressSettlementSurfaces(parts:ScenePart[],surface:SettlementSurface):ScenePart[]{
  return parts.map(p=>({...p,settlementSurface:surface}));
}
export function settlementMaterial(role:string,p?:SettlementSurface){
  return p&&['masonry','timber','roof'].includes(role)?`${role}-aged-${role==='masonry'?p.wall:role==='timber'?p.wood:p.roof}`:role;
}
