import type {BuildingPlan,DockPlan,LocatedScene,RegionalStyle,SceneRequest,SettlementPlan,WorldManifest,WorldPoint,WorldPosition} from './sharedWorld';
import {distance,worldStableId,nearestOnSegment} from './sharedWorld';
import {routeTransport,type RoutingTerrain} from './worldTransport';
import {buildingProgram,compileBuildingProgram,settlementStyle,structuralPart,variation} from './settlementBuildings';
import {buildingFootprint,rectangle,polygonsOverlap,polygonDistance,convexHull} from './settlementSpatial';
import {sceneRecipeBounds} from './sceneGrammar';

export function planSettlement(m:WorldManifest,r:SceneRequest,position:WorldPosition,t:RoutingTerrain,docks:DockPlan[],progress?:(n:number)=>void):SettlementPlan {
  const style=settlementStyle(m.styles.find(s=>s.id===r.styleId)??m.styles[0],r),key=`${m.seed}/${r.id}`;
  const castle=/castle|fortress|citadel|stronghold/.test(`${r.purpose} ${r.description} ${r.name}`.toLowerCase());
  const plan:SettlementPlan={id:`${r.id}-settlement`,version:2,morphology:castle?'fortified-compound':docks.length?'waterfront':style.family==='courtyard'?'courtyard-districts':'market-growth',buildings:[],streets:[],docks,nodes:[],parcels:[],districts:[],publicSpaces:[],structures:[]};
  const id=(kind:string,name:string)=>worldStableId(m.id,kind,`${r.id}/${name}`);
  const root={...position,id:id('junction','market'),y:t.height(position.x,position.z)+.12};plan.nodes!.push(root);
  const demand=Object.values(r.roles).reduce((a,b)=>a+b,0);
  if(!demand)return plan;
  const squareSize=castle?12:Math.min(22,12+demand*.15);
  plan.publicSpaces!.push({id:id('space','market'),kind:castle?'court':'market',position:root,polygon:rectangle(root,squareSize,squareSize,0)});
  const district=(name:string,p:WorldPosition)=>{const d={id:id('district',name),name,position:p};plan.districts!.push(d);return d;};
  district(castle?'Inner court':'Market quarter',root);
  if(docks.length)district('Waterfront',docks[0].land);
  district('Residential lanes',root);
  const grade=(p:WorldPoint)=>Math.hypot(t.height(p.x+2,p.z)-t.height(p.x-2,p.z),t.height(p.x,p.z+2)-t.height(p.x,p.z-2))/4;
  const dry=(p:WorldPoint)=>t.height(p.x,p.z)>t.level+.6&&t.flow(p.x,p.z)<.22;
  const edges=new Set<string>();
  // Every intermediate road junction is explicit, so frontage accesses can
  // connect at their actual position instead of inventing graph connectivity.
  const addRoute=(from:typeof root,to:typeof root,label:string,width:number)=>{
    from=plan.nodes!.find(n=>distance(n,from)<.01)??from;
    to=plan.nodes!.find(n=>distance(n,to)<.01)??to;
    let route:ReturnType<typeof routeTransport>|undefined,lastError:unknown;
    // A coarse eight-metre lattice can miss a narrow dry approach entirely.
    // Refine only failed connections, keeping grade/water validation intact.
    for(const step of label==='quay'?[8,4,2]:[8])try{route=routeTransport(from,to,t,{id:id('street',label),from:from.id,to:to.id,mode:'road',step,maxNodes:step===8?6000:18000,width,existing:plan.streets});break;}catch(error){lastError=error;}
    if(!route)throw lastError;
    if(route.points.length===2){const a=route.points[0],b=route.points[1],count=Math.max(1,Math.ceil(distance(a,b)/8));route.points=Array.from({length:count+1},(_,i)=>({x:a.x+(b.x-a.x)*i/count,y:a.y+(b.y-a.y)*i/count,z:a.z+(b.z-a.z)*i/count}));}
    let previous=from,travel=0;
    const points=route.points.filter((p,i)=>{travel+=i?distance(p,route.points[i-1]):0;if(travel<10&&i<route.points.length-1)return false;travel=0;return true;});
    if(!points.length||distance(points.at(-1)!,to)>.01)points.push(to);
    for(let i=0;i<points.length;i++){
      const p=points[i];if(distance(previous,p)<.01)continue;
      const proposed=i===points.length-1?to:{...p,id:id('junction',`${label}/${i}`)};
      const node=plan.nodes!.find(n=>distance(n,proposed)<.01)??proposed;
      if(!plan.nodes!.some(n=>n.id===node.id))plan.nodes!.push(node);
      const edgeKey=[`${previous.x.toFixed(2)},${previous.z.toFixed(2)}`,`${node.x.toFixed(2)},${node.z.toFixed(2)}`].sort().join('/');
      if(!edges.has(edgeKey)){
        edges.add(edgeKey);
        // Keep the original sampled route between selected nodes, preserving
        // the solver's terrain checks after simplification.
        const start=route.points.findIndex(p=>distance(p,previous)<.01),end=route.points.findIndex(p=>distance(p,node)<.01);
        const path=start>=0&&end>start?route.points.slice(start,end+1):[previous,node];
        plan.streets.push({...route,id:id('street',`${label}/${i}`),from:previous.id,to:node.id,points:path,length:path.slice(1).reduce((s,p,j)=>s+distance(p,path[j]),0)});
      }
      previous=node;
    }
  };
  for(const dock of docks){
    const berth={...dock.land,id:dock.id};addRoute(root,berth,'quay',5);
    plan.publicSpaces!.push({id:id('space','quay'),kind:'waterfront',position:berth,polygon:rectangle(berth,8,8,0)});
  }
  const base=docks.length?Math.atan2(position.z-docks[0].land.z,position.x-docks[0].land.x):variation(key,'orientation')*Math.PI*2;
  const arms=castle?5:Math.max(4,Math.min(8,Math.ceil(demand/8))),extent=castle?64:Math.min(r.scale==='city'?290:190,70+demand*1.5),ends:Array<typeof root>=[];
  for(let arm=0;arm<arms;arm++){
    const angle=base+arm*Math.PI*2/arms+(variation(key,`angle${arm}`)-.5)*.5;
    for(const factor of [1,.75,.5]){
      const length=extent*factor*(.8+variation(key,`length${arm}`)*.4),p={x:position.x+Math.cos(angle)*length,z:position.z+Math.sin(angle)*length};
      if(!dry(p)||grade(p)>.25)continue;
      const end={...p,y:t.height(p.x,p.z)+.12,id:id('junction',`arm${arm}`)};
      try{addRoute(root,end,`arm${arm}`,castle?4:arm<2?5:3.5);ends.push(end);break;}catch{/* Shorten this arm or try another direction. */}
    }
  }
  for(let i=1;i<ends.length;i++)try{addRoute(ends[i-1],ends[i],`link${i}`,3);}catch{/* The trunk already provides access; no fake connection is emitted. */}
  if(plan.streets.length===0)throw new Error('No dry settlement street frontage');
  const frontages=plan.nodes!.filter(n=>distance(n,root)>squareSize*.7&&n.id!==docks[0]?.id).flatMap(n=>{
    const road=plan.streets.find(s=>s.to===n.id)??plan.streets.find(s=>s.from===n.id)!;
    if(!road)return [];
    const a=road.points[0],b=road.points.at(-1)!,yaw=Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI;
    return [-1,1].map(side=>({node:n,yaw:yaw+side*90,road}));
  });
  const roleEntries=Object.entries(r.roles).sort(([a],[b])=>{
    const priority=(v:string)=>/keep|hall|shrine|inn|market/.test(v)?0:/warehouse|workshop/.test(v)?1:2;
    return priority(a)-priority(b)||a.localeCompare(b);
  });
  for(const [role,count] of roleEntries)for(let ordinal=0;ordinal<count;ordinal++){
    const buildingId=id('building',`${role}/${ordinal}`),program=buildingProgram(buildingId,role,style),recipe=compileBuildingProgram(buildingId,program,style);
    // Explicit authored structural recipes remain authoritative when supplied.
    const source=r.recipes?.[role]??recipe,sourceBounds=sceneRecipeBounds(source);
    const parts=r.recipes?.[role]?source.map(p=>({...p,position:{x:p.position.x-(sourceBounds.min.x+sourceBounds.max.x)/2,y:p.position.y-sourceBounds.min.y,z:p.position.z-(sourceBounds.min.z+sourceBounds.max.z)/2}})):source,bounds=sceneRecipeBounds(parts),width=bounds.max.x-bounds.min.x,depth=bounds.max.z-bounds.min.z;
    const candidates=frontages.map(f=>{
      const a=f.yaw*Math.PI/180,setback=depth/2+f.road.width/2+2.5;
      const p={x:f.node.x+Math.sin(a)*setback,z:f.node.z+Math.cos(a)*setback};
      const waterfront=/warehouse|workshop/.test(role)&&docks.length;
      return {...f,p,cost:distance(p,waterfront?docks[0].land:root)*(role==='home'?.3:1)+variation(buildingId,f.node.id)*12};
    }).sort((a,b)=>a.cost-b.cost);
    let accepted=false;
    for(const c of candidates){
      const {p,yaw,node}=c,y=t.height(p.x,p.z),poly=rectangle(p,width+1.5,depth+1.5,yaw);
      if(!dry(p)||grade(p)>.3||poly.some(v=>!dry(v)||Math.abs(t.height(v.x,v.z)-y)>2.4))continue;
      if(plan.publicSpaces!.some(s=>polygonsOverlap(poly,s.polygon,1))||plan.parcels!.some(q=>polygonsOverlap(poly,q.polygon,1.4)))continue;
      if(plan.streets.some(s=>s.points.slice(1).some((b,i)=>{const a=s.points[i],steps=Math.max(1,Math.ceil(distance(a,b)));for(let j=0;j<=steps;j++)if(polygonDistance(poly,{x:a.x+(b.x-a.x)*j/steps,z:a.z+(b.z-a.z)*j/steps})<s.width/2+.6)return true;return false;})))continue;
      const ownEdits=(m.authoredEntities??[]).some(e=>distance(p,e.position)<Math.max(width,depth)+8);
      if(ownEdits)continue;
      const a=yaw*Math.PI/180,doorPart=parts.find(s=>s.shape==='house'||s.shape==='frame');
      if(!doorPart)throw new Error(`${role}: a structural recipe needs an accessible house or frame`);
      const localX=-doorPart.size.x/2+(Math.floor((doorPart.bays?.x??3)/2)+.5)*doorPart.size.x/(doorPart.bays?.x??3),localZ=-doorPart.size.z/2-1,doorAngle=doorPart.rotation.y*Math.PI/180;
      let dx=doorPart.position.x+localX*Math.cos(doorAngle)+localZ*Math.sin(doorAngle),dz=doorPart.position.z-localX*Math.sin(doorAngle)+localZ*Math.cos(doorAngle);
      if(program.family==='courtyard'&&!r.recipes?.[role]){dx=0;dz=-program.depth/2-1;}
      const entrance={x:p.x+dx*Math.cos(a)+dz*Math.sin(a),y:y+.16,z:p.z-dx*Math.sin(a)+dz*Math.cos(a)};
      const footprint=rectangle(p,r.recipes?.[role]?width:program.width,r.recipes?.[role]?depth:program.depth,yaw),accessTerrain={...t,height:(x:number,z:number)=>polygonDistance(poly,{x,z})<=0?y:t.height(x,z),blocked:(x:number,z:number)=>polygonDistance(footprint,{x,z})<.1||plan.buildings.some(b=>polygonDistance(buildingFootprint(b),{x,z})<.4)};
      let access;
      try{access=routeTransport(entrance,node,accessTerrain,{id:id('access',buildingId),from:buildingId,to:node.id,mode:'road',width:2,step:2,maxNodes:1200});}catch{continue;}
      if(access.points.some(v=>plan.buildings.some(b=>polygonDistance(buildingFootprint(b),v)<.4)))continue;
      const parcelId=id('parcel',buildingId),districtId=plan.districts![role==='home'?plan.districts!.length-1:/warehouse|workshop/.test(role)&&docks.length?1:0].id;
      const building:BuildingPlan={id:buildingId,role,position:{...p,y},yaw,width,depth,height:bounds.max.y,entrance,recipe:parts,parcelId,program,footprint};
      plan.buildings.push(building);plan.streets.push(access);plan.parcels!.push({id:parcelId,polygon:poly,frontage:node,districtId,buildingId});
      if(plan.buildings.length%6===0)progress?.(plan.buildings.length);
      accepted=true;break;
    }
    if(!accepted)throw new Error(`${r.name}: insufficient dry frontage for required ${role} ${ordinal+1}/${count} (${plan.buildings.length}/${demand} fitted)`);
  }
  if(castle)addCastleEnclosure(plan,position,t,style);
  return plan;
}

function addCastleEnclosure(plan:SettlementPlan,center:WorldPosition,t:RoutingTerrain,style:RegionalStyle){
  const hull=convexHull(plan.parcels!.flatMap(p=>p.polygon)).map(p=>{const d=distance(p,center);return {x:p.x+(p.x-center.x)/d*9,z:p.z+(p.z-center.z)/d*9};});
  const structures=plan.structures!,material='masonry',color=style.wallColor;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],len=distance(a,b),yaw=Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI,count=Math.ceil(len/4);
    for(let j=0;j<count;j++){
      const p={x:a.x+(b.x-a.x)*(j+.5)/count,z:a.z+(b.z-a.z)*(j+.5)/count},y=t.height(p.x,p.z);
      if(y<t.level+.5)throw new Error('Castle enclosure reaches unsupported shoreline');
      const gate=plan.streets.some(s=>s.points.slice(1).some((v,k)=>distance(p,nearestOnSegment(p,s.points[k],v))<6));
      const recipe=gate?[structuralPart('box',0,7.5,0,2,1,len/count,material,color)]:[structuralPart('box',0,3.5,0,2,7,len/count+.1,material,color),structuralPart('box',-.85,7.5,0,.3,1,len/count,material,color)];
      for(const z of [-1,1])recipe.push(structuralPart('box',-.85,8.3,z*.8,.5,.9,.8,material,color));
      structures.push({id:`${plan.id}-wall-${i}-${j}`,position:{...p,y},yaw,recipe});
    }
    const y=t.height(a.x,a.z),recipe=[{...structuralPart('house',0,6,0,6,12,6,material,color),levels:3,bays:{x:2,z:2}},structuralPart('box',0,12.1,0,6.5,.2,6.5,material,color)];
    structures.push({id:`${plan.id}-tower-${i}`,position:{...a,y},yaw,recipe});
  }
}
