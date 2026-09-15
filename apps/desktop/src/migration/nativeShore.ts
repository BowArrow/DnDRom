/** Bounded distance to the actual wet/dry contour, rather than water depth.
 * Padded global cells give neighboring tiles the same beach wave phase. */
export function shoreDistanceField(x0:number,z0:number,size:number,step:number,wet:(x:number,z:number)=>number) {
  const range=24,bucket=8,bins=new Map<string,number[]>(),segments:number[][]=[];
  const loX=Math.floor((x0-range-step)/step),loZ=Math.floor((z0-range-step)/step);
  const hiX=Math.ceil((x0+size+range+step)/step),hiZ=Math.ceil((z0+size+range+step)/step),stride=hiX-loX+1;
  const values=new Float32Array(stride*(hiZ-loZ+1));
  for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)values[(z-loZ)*stride+x-loX]=wet(x*step,z*step);
  const triangle=(points:number[][])=>{
    const cross:number[][]=[];
    for(let i=0;i<3;i++){const a=points[i],b=points[(i+1)%3];if((a[2]>0)!==(b[2]>0)){const t=a[2]/(a[2]-b[2]);cross.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
    if(cross.length!==2)return;
    const [a,b]=cross,id=segments.length;segments.push([...a,...b]);
    for(let z=Math.floor(Math.min(a[1],b[1])/bucket);z<=Math.floor(Math.max(a[1],b[1])/bucket);z++)for(let x=Math.floor(Math.min(a[0],b[0])/bucket);x<=Math.floor(Math.max(a[0],b[0])/bucket);x++){const key=`${x}/${z}`;if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push(id);}
  };
  for(let z=loZ;z<hiZ;z++)for(let x=loX;x<hiX;x++){
    const i=(z-loZ)*stride+x-loX,a=[x*step,z*step,values[i]],b=[(x+1)*step,z*step,values[i+1]],c=[x*step,(z+1)*step,values[i+stride]],d=[(x+1)*step,(z+1)*step,values[i+stride+1]];
    triangle([a,c,b]);triangle([b,c,d]);
  }
  return (x:number,z:number)=>{
    let nearest=range*range;
    for(let bz=Math.floor((z-range)/bucket);bz<=Math.floor((z+range)/bucket);bz++)for(let bx=Math.floor((x-range)/bucket);bx<=Math.floor((x+range)/bucket);bx++)for(const id of bins.get(`${bx}/${bz}`)??[]){
      const [ax,az,ex,ez]=segments[id],dx=ex-ax,dz=ez-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/Math.max(1e-12,dx*dx+dz*dz)));
      nearest=Math.min(nearest,(x-ax-t*dx)**2+(z-az-t*dz)**2);
    }
    return Math.sqrt(nearest);
  };
}
