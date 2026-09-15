import * as pc from 'playcanvas';
import type {AssemblyBuffers} from './sceneAssemblyMesh';
import type {GrowthPoint,VineShoot} from '../domain/settlementGrowth';
const empty=():AssemblyBuffers=>({positions:[],normals:[],uvs:[],colors:[],indices:[]});
const v=(p:GrowthPoint)=>new pc.Vec3(p.x,p.y,p.z);
function leaf(out:AssemblyBuffers,base:pc.Vec3,tip:pc.Vec3,width:number,side:pc.Vec3,color:number[]){
 const direction=tip.clone().sub(base).normalize();
 side=side.clone().sub(direction.clone().mulScalar(side.dot(direction)));
 if(side.lengthSq()<1e-8)side=new pc.Vec3().cross(direction,Math.abs(direction.x)<.9?pc.Vec3.RIGHT:pc.Vec3.FORWARD);
 side.normalize();const normal=new pc.Vec3().cross(direction,side).normalize(),segments=width<.012?2:6;
 const offset=out.positions.length/3;
 for(let j=0;j<=segments;j++){
  const t=j/segments,mid=base.clone().lerp(base,tip,t),radius=width*Math.pow(Math.sin(Math.PI*t),.8),bend=Math.sin(Math.PI*t)*width*.25;
  for(const edge of [-1,0,1]){const p=mid.clone().add(side.clone().mulScalar(edge*radius)).add(normal.clone().mulScalar(edge===0?bend:0));out.positions.push(p.x,p.y,p.z);out.uvs.push((edge+1)/2,t);out.colors.push(...color,255);}
 }
 const tri=(a:number,b:number,c:number)=>{const point=(i:number)=>new pc.Vec3(...out.positions.slice(i*3,i*3+3) as [number,number,number]);if(new pc.Vec3().cross(point(b).sub(point(a)),point(c).sub(point(a))).lengthSq()>1e-16)out.indices.push(a,b,c);};
 for(let j=0;j<segments;j++)for(let k=0;k<2;k++){const a=offset+j*3+k,b=a+3;tri(a,b,a+1);tri(a+1,b,b+1);}

}
const finish=(out:AssemblyBuffers)=>{ // Remove unused coincident tip vertices before normal generation.
 const used=new Set(out.indices),remap=new Map<number,number>(),positions:number[]=[],uvs:number[]=[],colors:number[]=[];
 for(let i=0;i<out.positions.length/3;i++)if(used.has(i)){remap.set(i,positions.length/3);positions.push(...out.positions.slice(i*3,i*3+3));uvs.push(...out.uvs.slice(i*2,i*2+2));colors.push(...out.colors.slice(i*4,i*4+4));}
 out.positions=positions;out.uvs=uvs;out.colors=colors;out.indices=out.indices.map(i=>remap.get(i)!);
out.normals=Array.from(pc.calculateNormals(out.positions,out.indices));return out;};
/** Folded leaves supply a changing silhouette and lit normals from every angle,
 * without alpha cards or per-leaf objects. Three small reusable prototypes. */
export function settlementHerbMesh(kind:number,lod=0):AssemblyBuffers{
 const out=empty(),count=lod===2?4:lod===1?6:9;
 for(let i=0;i<count;i++){
  const a=i*2.399963+.31*kind,rad=.19+(i%3)*.055,height=kind===1?.3+(i%4)*.08:.09+(i%4)*.035;
  const base=new pc.Vec3(0,0,0),tip=new pc.Vec3(Math.cos(a)*rad,height,Math.sin(a)*rad),side=new pc.Vec3(-Math.sin(a),0,Math.cos(a));
  if(kind===1){
   const at=(t:number)=>new pc.Vec3(tip.x*t*1.2,Math.sin(t*Math.PI)*height*.7+height*t*.16,tip.z*t*1.2);
   for(let j=1;j<=5;j++)leaf(out,at((j-1)/5),at(j/5),.004,side,[14,30,7]);
   for(let j=1;j<(lod===2?4:6);j++)for(const sign of [-1,1]){const t=j/6,b=at(t),end=b.clone().add(side.clone().mulScalar(sign*(.095-j*.009))).add(new pc.Vec3(tip.x*.12,.016,tip.z*.12));leaf(out,b,end,.018,tip.clone().normalize(),[13+i%3*3,31+i%4*4,6+i%3*2]);}
  }else leaf(out,base,tip,.045+(i%2)*.02,side,[14+i%3*3,32+i%4*4,7+i%3*2]);
 }
 if(kind===2)for(let i=0;i<(lod===2?1:3);i++){
  const top=new pc.Vec3(Math.cos(i*2.4)*.09,.31+i*.035,Math.sin(i*2.4)*.09);
  leaf(out,new pc.Vec3(top.x,0,top.z),top,.006,new pc.Vec3(1,0,0),[25,49,12]);
  for(let j=0;j<5;j++){const a=j*Math.PI*2/5;leaf(out,top,top.clone().add(new pc.Vec3(Math.cos(a)*.045,.013,Math.sin(a)*.045)),.018,new pc.Vec3(-Math.sin(a),0,Math.cos(a)),[180,160,83]);}
 }
 return finish(out);
}
export function settlementVineMesh(shoots:VineShoot[],lod=0):AssemblyBuffers{
 const out=empty();
 for(const shoot of shoots){const side=new pc.Vec3(shoot.normal.z,0,-shoot.normal.x);
  for(let i=1;i<shoot.points.length;i++){
   const p=v(shoot.points[i]),before=v(shoot.points[i-1]);leaf(out,before,p,.009,side,[43,37,15]);
   if(i%(lod===2?3:lod===1?2:1))continue;
   for(const sign of [-1,1]){const tip=p.clone().add(side.clone().mulScalar(sign*(.1+((i+shoot.seed)%5)*.012))).add(new pc.Vec3(shoot.normal.x*.045,.11,shoot.normal.z*.045));
    leaf(out,p,tip,.065,new pc.Vec3(0,1,0),[17+i%3*4,43+i%4*6,9+i%3*3]);}
  }
 }
 return finish(out);
}
