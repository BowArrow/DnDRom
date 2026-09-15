import {describe,it,expect} from "vitest";
import {simulateHydraulicErosion} from "./referenceHydrology";
import {atlasGradientNoise} from "./worldLandform";
describe("reference watershed morphology",()=>{
  it("develops connected drainage while settling steep slopes and accounting for outflow",()=>{
    const n=129,cell=8;
    const raw=Array.from({length:n*n},(_,i)=>{let h=0,a=1,f=1/128;for(let o=0;o<7;o++){h+=(atlasGradientNoise(i%n*f,Math.floor(i/n)*f,719+o*101)-.5)*a;a*=.6;f*=2;}return 320+h*480;});
    const result=simulateHydraulicErosion(raw,n,cell,719,1,256);
    expect(Math.abs(result.massError)).toBeLessThan(1e-6);expect(result.exportedSediment).toBeGreaterThan(0);
    const steepness=(h:ArrayLike<number>)=>{let energy=0;for(let z=1;z<n;z++)for(let x=1;x<n;x++){const i=z*n+x;energy+=(h[i]-h[i-1])**2+(h[i]-h[i-n])**2;}return energy;};
    expect(steepness(result.height)).toBeLessThan(steepness(raw)*.8);
    // A one-cell dilation closes subcell particle sampling gaps. Measure the
    // connected stream extent rather than asserting a seed-specific river path.
    const wet=new Uint8Array(n*n);
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++)if(result.discharge[z*n+x]>.4)for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)wet[(z+dz)*n+x+dx]=1;
    let largest=0;
    for(let i=0;i<wet.length;i++)if(wet[i]){const queue=[i];wet[i]=0;for(let k=0;k<queue.length;k++){const p=queue[k],x=p%n,z=Math.floor(p/n);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,j=nz*n+nx;if(nx>=0&&nx<n&&nz>=0&&nz<n&&wet[j]){wet[j]=0;queue.push(j);}}}largest=Math.max(largest,queue.length);}
    expect(largest).toBeGreaterThan(n*3);
  },15_000);
});
