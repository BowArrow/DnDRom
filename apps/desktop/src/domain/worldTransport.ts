import { distance, nearestOnSegment, type WorldPosition, type WorldPoint, type TransportEdge, type BridgeSpan } from './sharedWorld';
export interface RoutingTerrain { height:(x:number,z:number)=>number; flow:(x:number,z:number)=>number; level:number; blocked?:(x:number,z:number)=>boolean; coarse?:(x:number,z:number)=>number }
/** Shared berth and sailing clearance: 1.2 m draft over a 6 m-wide footprint. */
export function navigableWater(terrain:RoutingTerrain,p:WorldPoint):boolean {
  return [[0,0],[3,0],[-3,0],[0,3],[0,-3]].every(([dx,dz])=>terrain.height(p.x+dx,p.z+dz)<terrain.level-1.2);
}
export interface RouteOptions { id:string; from:string; to:string; mode:'road'|'ferry'; width?:number; step?:number; maxNodes?:number; existing?:TransportEdge[] }
class Heap<T>{items:Array<{cost:number;value:T}>=[];push(value:T,cost:number){const a=this.items;let i=a.length;a.push({value,cost});while(i>0){const p=(i-1)>>1;if(a[p].cost<=cost)break;a[i]=a[p];i=p;}a[i]={value,cost};}pop(){const a=this.items,first=a[0],last=a.pop()!;if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=last.cost)break;a[i]=a[c];i=c;}a[i]=last;}return first.value;}}
const dirs=Array.from({length:8},(_,i)=>({x:Math.round(Math.cos(i*Math.PI/4)),z:Math.round(Math.sin(i*Math.PI/4))}));
export function routeTransport(start:WorldPosition,end:WorldPosition,terrain:RoutingTerrain,options:RouteOptions):TransportEdge {
  const step=options.step??(options.mode==='ferry'?24:32),extent=distance(start,end),margin=Math.max(256,Math.min(4096,extent*.6));
  const minX=Math.min(start.x,end.x)-margin,maxX=Math.max(start.x,end.x)+margin,minZ=Math.min(start.z,end.z)-margin,maxZ=Math.max(start.z,end.z)+margin;
  const ferry=options.mode==='ferry',width=options.width??(ferry?6:4),sampleCache=new Map<string,number>();
  const roads=new Map<string,Array<[WorldPosition,WorldPosition]>>();
  if(!ferry)for(const r of options.existing??[])if(r.mode==='road')for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],padding=width*2;for(let z=Math.floor((Math.min(a.z,b.z)-padding)/64);z<=Math.floor((Math.max(a.z,b.z)+padding)/64);z++)for(let x=Math.floor((Math.min(a.x,b.x)-padding)/64);x<=Math.floor((Math.max(a.x,b.x)+padding)/64);x++){const key=`${x}/${z}`,segments=roads.get(key)??[];segments.push([a,b]);roads.set(key,segments);}}
  const h=(x:number,z:number)=>{const key=`${x}/${z}`;let y=sampleCache.get(key);if(y===undefined){y=terrain.height(x,z);sampleCache.set(key,y);}return y;};
  const wet=(p:WorldPoint)=>h(p.x,p.z)<terrain.level-.05||terrain.flow(p.x,p.z)>.35;
  const waterHeight=(p:WorldPoint)=>Math.max(terrain.level,h(p.x,p.z)+.15);
  const sailingTerrain={...terrain,height:h},clearWater=(p:WorldPoint)=>navigableWater(sailingTerrain,p);
  const segmentValid=(a:WorldPosition,b:WorldPosition,allowBridge=true)=>{
    const length=distance(a,b);if(!ferry&&Math.abs(a.y-b.y)/Math.max(.1,length)>.16)return false;
    const samples=Math.max(2,Math.ceil(length/4));let submerged=0;
    for(let i=0;i<=samples;i++){const t=i/samples,p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},bed=h(p.x,p.z),deck=a.y+(b.y-a.y)*t;
      if(ferry){if(!clearWater(p))return false;}
      else if(terrain.blocked?.(p.x,p.z))return false;
      else if(wet(p)){submerged++;if(!allowBridge||deck<waterHeight(p)+1.2||length>72)return false;}
      else if(Math.abs(deck-bed)>5)return false;
    }return ferry||submerged===0||(!wet(a)&&!wet(b));
  };
  type Node={x:number;z:number;heading:number;g:number;point:WorldPosition;parent?:Node};
  // Elevation is part of the state: the same hillside cell reached at a
  // different grade can be the only feasible approach to a switchback.
  const open=new Heap<Node>(),scores=new Map<string,number>(),key=(n:Node)=>`${n.x}/${n.z}/${n.heading}/${ferry?0:Math.round(n.point.y)}`;
  const heuristic=(p:WorldPosition)=>Math.max(distance(p,end),ferry?0:Math.abs(p.y-end.y)/.16)*(options.existing?.length?.65:1);
  const first:Node={x:0,z:0,heading:-1,g:0,point:start};open.push(first,extent);scores.set(key(first),0);let last:Node|undefined=extent>200&&segmentValid(start,end)?{...first,point:end,parent:first}:undefined,count=0;
  while(!last&&open.items.length&&count++<(options.maxNodes??45000)){
    const n=open.pop();if(n.g>(scores.get(key(n))??Infinity))continue;
    if(distance(n.point,end)<=step*1.6&&segmentValid(n.point,end)){last={...n,point:end,parent:n};break;}
    for(let heading=0;heading<8;heading++){
      if(n.heading>=0&&Math.min((heading-n.heading+8)%8,(n.heading-heading+8)%8)>2)continue;
      const dir=dirs[heading];
      // A bridge is a bank-to-bank edge, never a road node in the water.
      const adjacent={x:n.point.x+dir.x*step,z:n.point.z+dir.z*step};
      const strides=!ferry&&wet(adjacent)?Array.from({length:Math.max(1,Math.floor(72/(step*Math.hypot(dir.x,dir.z))))},(_,i)=>i+1):[1];
      for(const stride of strides){
      const x=n.x+dir.x*stride,z=n.z+dir.z*stride,px=start.x+x*step,pz=start.z+z*step;
      if(px<minX||px>maxX||pz<minZ||pz>maxZ)continue;
      const bed=h(px,pz),run=distance(n.point,{x:px,z:pz}),graded=n.point.y+Math.max(-run*.145,Math.min(run*.145,bed+.12-n.point.y)),point={x:px,z:pz,y:ferry?terrain.level:graded};if(!ferry&&wet(point))continue;
      if(!segmentValid(n.point,point))continue;
      const length=distance(n.point,point),grade=Math.abs(point.y-n.point.y)/length,turn=n.heading<0?0:Math.min((heading-n.heading+8)%8,(n.heading-heading+8)%8);
      const reuse=roads.get(`${Math.floor(point.x/64)}/${Math.floor(point.z/64)}`)?.some(([a,b])=>distance(point,nearestOnSegment(point,a,b))<width*2);
      const g=n.g+length*(1+grade*20+turn*.22)*(reuse?.65:1),next:Node={x,z,heading,g,point,parent:n};
      if(g>=(scores.get(key(next))??Infinity))continue;scores.set(key(next),g);open.push(next,g+heuristic(point));
      }
    }
  }
  if(!last)throw new Error(`No valid ${options.mode} connection from ${options.from} to ${options.to} within the routing budget`);
  let points:WorldPosition[]=[];for(let n:Node|undefined=last;n;n=n.parent)points.push(n.point);points.reverse();
  // Corner cutting only replaces a segment after its grade, earthworks and
  // water clearance pass the same checks as the original path.
  for(let pass=0;pass<2;pass++){
    const next=[points[0]];
    for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1],p={x:b.x*.75+a.x*.25,z:b.z*.75+a.z*.25,y:b.y*.75+a.y*.25},q={x:b.x*.75+c.x*.25,z:b.z*.75+c.z*.25,y:b.y*.75+c.y*.25};
      if(segmentValid(next[next.length-1],p)&&segmentValid(p,q)&&segmentValid(q,c))next.push(p,q);else next.push(b);
    }next.push(points[points.length-1]);points=next;
  }
  let length=0,maxGrade=0;const bridges:BridgeSpan[]=[];
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=distance(a,b);length+=d;maxGrade=Math.max(maxGrade,Math.abs(b.y-a.y)/Math.max(.01,d));
    if(!ferry){const water=Array.from({length:Math.max(3,Math.ceil(d/4))},(_,j)=>{const t=j/(Math.max(3,Math.ceil(d/4))-1);return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};}).filter(wet);if(water.length)bridges.push({id:`${options.id}-bridge-${i}`,start:a,end:b,family:d<12?'timber':d<32?'stone':'suspension',width,clearance:Math.min(...water.map(p=>nearestOnSegment(p,a,b).y-waterHeight(p)))});}
  }
  return {id:options.id,from:options.from,to:options.to,mode:options.mode,points,width,bridges,length,maxGrade,speed:ferry?3:1.4};
}
export function ferryPosition(route:TransportEdge,time:number,dwell=12):{position:WorldPosition;yaw:number;state:'arrival'|'transit'|'departure'}{
  const leg=route.length/route.speed,cycle=2*(leg+dwell),t=((time%cycle)+cycle)%cycle,reverse=t>=leg+dwell,phase=t%(leg+dwell);
  let remaining=Math.max(0,Math.min(leg,phase-dwell))*route.speed;
  const points=reverse?[...route.points].reverse():route.points;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=distance(a,b);if(remaining<=d||i===points.length-1){const f=Math.min(1,remaining/Math.max(.001,d));return {position:{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f},yaw:Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI,state:phase<dwell*.5?'arrival':phase<dwell?'departure':'transit'};}remaining-=d;}
  return {position:points[0],yaw:0,state:'arrival'};
}


