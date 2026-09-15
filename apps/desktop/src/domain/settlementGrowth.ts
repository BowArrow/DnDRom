import type {ScenePart} from './sceneGrammar';
import type {SettlementSurface} from './settlementSurfaces';
import {worldHash} from './sharedWorld';
export interface GrowthPoint {x:number;y:number;z:number}
export interface HerbPlacement extends GrowthPoint {kind:0|1|2;scale:number;rotation:number}
export interface VineShoot {points:GrowthPoint[];normal:GrowthPoint;seed:number}
export interface SettlementGrowth {herbs:HerbPlacement[];vines:VineShoot[]}
/** A bounded, seeded developmental pass over actual facade support. Door and
 * window operators supply exclusion zones; plants are never camera-seeded. */
export function settlementGrowth(id:string,parts:ScenePart[],profile:SettlementSurface,height:(x:number,z:number)=>number|undefined,blocked:(p:GrowthPoint)=>boolean=()=>false):SettlementGrowth {
  const random=(s:string)=>worldHash(`${id}/growth-1/${s}`)/4294967296,herbs:HerbPlacement[]=[],vines:VineShoot[]=[];
  const doors=parts.filter(p=>p.shape==='doorway'),openings=parts.filter(p=>p.shape==='doorway'||p.shape==='window-frame');
  const clearDoor=(p:GrowthPoint)=>!doors.some(d=>{const a=d.rotation.y*Math.PI/180,dx=p.x-d.position.x,dz=p.z-d.position.z;return Math.abs(dx*Math.cos(a)-dz*Math.sin(a))<d.size.x/2+.55&&Math.abs(dx*Math.sin(a)+dz*Math.cos(a))<2.2;});
  const supports=parts.filter(p=>p.shape==='box'&&p.material==='masonry'&&p.position.y-p.size.y/2<.2&&p.size.y>.3&&Math.min(p.size.x,p.size.z)<.3);
  const density=(.12+profile.moisture*.8)*(.35+profile.age*.65);
  for(const [index,p] of supports.entries()){
    // Match the panel to an outward-facing facade, excluding room partitions.
    const facade=openings.find(o=>{const a=o.rotation.y*Math.PI/180;return Math.abs((p.position.x-o.position.x)*Math.sin(a)+(p.position.z-o.position.z)*Math.cos(a))<.13;});
    if(!facade)continue;
    const a=facade.rotation.y*Math.PI/180,n={x:-Math.sin(a),y:0,z:-Math.cos(a)},t={x:Math.cos(a),z:-Math.sin(a)},width=Math.abs(t.x)*p.size.x+Math.abs(t.z)*p.size.z;
    const key=`${index}`,root={x:p.position.x+n.x*.17,y:0,z:p.position.z+n.z*.17};
    // Cluster centres, then individual offsets. There is no regular grass grid.
    for(let cluster=0;cluster<Math.min(4,Math.ceil(width*1.8));cluster++){
      if(herbs.length>=96||random(`${key}/${cluster}/accept`)>density)continue;
      const along=(random(`${key}/${cluster}/along`)-.5)*Math.max(0,width-.3),out=.18+random(`${key}/${cluster}/out`)*.5;
      for(let j=0;j<3;j++){
        const jitter=(random(`${key}/${cluster}/${j}/jitter`)-.5)*.28;
        const point={x:root.x+t.x*(along+jitter)+n.x*out,y:0,z:root.z+t.z*(along+jitter)+n.z*out},y=height(point.x,point.z);
        if(y===undefined||!Number.isFinite(y)||!clearDoor(point)||blocked({...point,y}))continue;
        if(herbs.some(q=>Math.hypot(q.x-point.x,q.z-point.z)<.16))continue;
        herbs.push({...point,y:y-.025,kind:profile.moisture>.7?1:random(`${key}/${cluster}/${j}/species`)<.3?2:0,rotation:random(`${key}/${cluster}/${j}/rotation`)*360,scale:(.55+random(`${key}/${cluster}/${j}/size`)*.65)*(.7+profile.moisture*.4)});
      }
    }
    if(vines.length>=6||profile.moisture<.25||random(`${key}/vine`)>profile.age*profile.moisture*.45||width<.5||!clearDoor(root))continue;
    const points:GrowthPoint[]=[],top=p.position.y+p.size.y/2-.18,base=p.position.y-p.size.y/2;
    if(top-base<.6)continue;
    let lateral=(random(`${key}/start`)-.5)*width*.35;
    const end=Math.min(top,base+.7+(profile.age*2.7+random(`${key}/height`)));
    for(let y=base+.02,step=0;y<end;y+=.18,step++){
      lateral=Math.max(-width/2+.16,Math.min(width/2-.16,lateral+(random(`${key}/${step}/bend`)-.5)*.24));
      points.push({x:root.x+t.x*lateral,y,z:root.z+t.z*lateral});
    }
    if(points.length>2)vines.push({points,normal:n,seed:worldHash(`${id}/${key}`)});
  }
  return {herbs:herbs.slice(0,96),vines};
}
