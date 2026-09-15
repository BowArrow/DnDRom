/** Adapted from Nicholas McDonald's SimpleHydrology (MIT), water.h/world.h,
 * revision 2709726934f0a02ceacdb7ee07d17785c344d244, and the 2023 article.
 * See docs/third-party/SimpleHydrology.txt. Heights use physical cell units;
 * transported sediment is mass, including sediment exported at open boundaries.
 */
export function simulateHydraulicErosion(source:ArrayLike<number>,resolution:number,cellSize:number,seed:number,strength=1,batches=256,rainfall=1/256) {
  const count=resolution*resolution;
  if(source.length!==count||resolution<8||!Number.isFinite(cellSize)||cellSize<=0)throw new Error("Invalid erosion grid");
  strength=Math.max(0,Math.min(1,strength));
  const height=Float64Array.from(source,h=>h/cellSize),flow=new Float64Array(count),mx=new Float64Array(count),mz=new Float64Array(count);
  const track=new Float64Array(count),tx=new Float64Array(count),tz=new Float64Array(count),deposits=new Float32Array(count);
  let state=seed>>>0,exportedSediment=0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const erf=(x:number)=>{const t=1/(1+.3275911*x);return 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);};
  const neighbours=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const neighbourDistances=neighbours.map(([x,z])=>Math.hypot(x,z));
  const entrainment=new Float64Array(count),flowSpeed=new Float64Array(count),flowBatch=new Uint32Array(count);
  const offsets=new Int32Array(8),distances=new Float64Array(8);
  // Settle at every particle step, in increasing neighbour-height order.
  const cascade=(x:number,z:number)=>{
    const i=z*resolution+x;let n=0;
    for(let neighbour=0;neighbour<8;neighbour++){const nx=x+neighbours[neighbour][0],nz=z+neighbours[neighbour][1];if(nx<0||nz<0||nx>=resolution||nz>=resolution)continue;
      const j=nz*resolution+nx;let k=n++;
      while(k>0&&height[offsets[k-1]]>height[j]){offsets[k]=offsets[k-1];distances[k]=distances[k-1];k--;}
      offsets[k]=j;distances[k]=neighbourDistances[neighbour];
    }
    for(let k=0;k<n;k++){
      const j=offsets[k],diff=height[i]-height[j],excess=Math.max(0,Math.abs(diff)-.8*distances[k]);
      const transfer=Math.sign(diff)*excess*.4*strength;height[i]-=transfer;height[j]+=transfer;
    }
  };
  const drops=Math.max(32,Math.ceil(count*rainfall));
  for(let batch=0;batch<batches;batch++){
    track.fill(0);tx.fill(0);tz.fill(0);
    for(let drop=0;drop<drops;drop++){
      let x=random()*(resolution-1),z=random()*(resolution-1),vx=0,vz=0,volume=1,sediment=0;
      for(let age=0;age<=500;age++){
        const ix=Math.floor(x),iz=Math.floor(z),i=iz*resolution+ix;
        if(age===500||volume<.01){height[i]+=sediment;deposits[i]+=sediment*cellSize;cascade(ix,iz);break;}
        // Time-averaged flow is immutable within a batch. Lazily cache only
        // visited cells, retaining the reference's exact arithmetic.
        if(flowBatch[i]!==batch+1){flowBatch[i]=batch+1;entrainment[i]=1+10*erf(.4*flow[i]);flowSpeed[i]=Math.hypot(mx[i],mz[i]);}
        const left=Math.max(0,ix-1),right=Math.min(resolution-1,ix+1),top=Math.max(0,iz-1),bottom=Math.min(resolution-1,iz+1);
        const gx=(height[iz*resolution+right]-height[iz*resolution+left])/(right-left),gz=(height[bottom*resolution+ix]-height[top*resolution+ix])/(bottom-top);
        const normal=1/Math.sqrt(1+gx*gx+gz*gz);
        vx-=gx*normal/volume;vz-=gz*normal/volume;
        const fs=flowSpeed[i],speed=Math.hypot(vx,vz);
        if(fs>1e-10&&speed>1e-10){const transfer=(mx[i]*vx+mz[i]*vz)/(fs*speed*(volume+flow[i]));vx+=mx[i]*transfer;vz+=mz[i]*transfer;}
        const length=Math.hypot(vx,vz);
        if(length<1e-10){height[i]+=sediment;deposits[i]+=sediment*cellSize;break;}
        // Keep normalized displacement as inertia, as in the reference.
        vx=vx/length*Math.SQRT2;vz=vz/length*Math.SQRT2;
        const nx=x+vx,nz=z+vz,out=nx<0||nz<0||nx>=resolution||nz>=resolution;
        track[i]+=volume;tx[i]+=volume*vx;tz[i]+=volume*vz;
        const dh=out?.16:height[i]-height[Math.floor(nz)*resolution+Math.floor(nx)];
        const capacity=Math.max(0,entrainment[i]*dh)*volume;
        // Mass form: evaporation changes concentration, not sediment mass.
        const exchange=(capacity-sediment)*.1*strength;
        const transfer=exchange>0?Math.min(exchange,Math.max(0,dh)*.5):exchange;
        height[i]-=transfer;sediment+=transfer;if(transfer<0)deposits[i]-=transfer*cellSize;
        volume*=.999;
        if(out){exportedSediment+=sediment*cellSize;break;}
        x=nx;z=nz;cascade(Math.floor(x),Math.floor(z));
      }
    }
    for(let i=0;i<count;i++){flow[i]=flow[i]*.9+track[i]*.1;mx[i]=mx[i]*.9+tx[i]*.1;mz[i]=mz[i]*.9+tz[i]*.1;}
  }
  const delta=new Float32Array(count),discharge=new Float32Array(count);let massError=exportedSediment;
  for(let i=0;i<count;i++){height[i]*=cellSize;delta[i]=height[i]-source[i];massError+=height[i]-source[i];discharge[i]=erf(.4*flow[i]);}
  return {height,delta,discharge,sediment:deposits,momentumX:mx,momentumZ:mz,massError,exportedSediment};
}
