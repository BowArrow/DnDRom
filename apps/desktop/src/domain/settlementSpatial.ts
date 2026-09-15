import type {WorldPoint,BuildingPlan} from './sharedWorld';

export function polygonContains(poly:WorldPoint[],p:WorldPoint):boolean {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}
export function polygonDistance(poly:WorldPoint[],p:WorldPoint):number {
  let d=Infinity;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
    d=Math.min(d,Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz));
  }
  return polygonContains(poly,p)?-d:d;
}
export function rectangle(p:WorldPoint,width:number,depth:number,yaw:number):WorldPoint[]{
  const a=yaw*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>({x:p.x+x*width/2*c+z*depth/2*s,z:p.z-x*width/2*s+z*depth/2*c}));
}
export function polygonsOverlap(a:WorldPoint[],b:WorldPoint[],gap=0):boolean {
  for(const p of [a,b])for(let i=0;i<p.length;i++){
    const x=-(p[(i+1)%p.length].z-p[i].z),z=p[(i+1)%p.length].x-p[i].x;
    const project=(v:WorldPoint)=>v.x*x+v.z*z,aa=a.map(project),bb=b.map(project),margin=gap*Math.hypot(x,z);
    if(Math.max(...aa)+margin<=Math.min(...bb)||Math.max(...bb)+margin<=Math.min(...aa))return false;
  }
  return true;
}
export const buildingFootprint=(b:BuildingPlan)=>b.footprint??rectangle(b.position,b.width,b.depth,b.yaw);
export function convexHull(points:WorldPoint[]):WorldPoint[]{
  const p=[...points].sort((a,b)=>a.x-b.x||a.z-b.z),cross=(a:WorldPoint,b:WorldPoint,c:WorldPoint)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  const half=(list:WorldPoint[])=>{const h:WorldPoint[]=[];for(const x of list){while(h.length>1&&cross(h.at(-2)!,h.at(-1)!,x)<=0)h.pop();h.push(x);}return h;};
  return [...half(p).slice(0,-1),...half(p.reverse()).slice(0,-1)];
}
