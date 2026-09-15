const smooth = (x:number) => {x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export const atlasHash = (x: number, z: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295;
};
export function atlasNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(x-ix), v = smooth(z-iz);
  return (atlasHash(ix,iz,seed)*(1-u)+atlasHash(ix+1,iz,seed)*u)*(1-v)+(atlasHash(ix,iz+1,seed)*(1-u)+atlasHash(ix+1,iz+1,seed)*u)*v;
}
/** Isotropic simplex gradients avoid the rectangular ridge outlines produced
 * by ridging interpolated lattice values. Noise is only the initial geology. */
export function atlasGradientNoise(x:number,z:number,seed:number):number {
  const f=(Math.sqrt(3)-1)/2,g=(3-Math.sqrt(3))/6,s=(x+z)*f;
  const i=Math.floor(x+s),j=Math.floor(z+s),t=(i+j)*g;
  const x0=x-i+t,z0=z-j+t,ix=x0>z0?1:0,iz=1-ix;
  let value=0;
  const gradients=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  for(const [dx,dz,cx,cz] of [[x0,z0,i,j],[x0-ix+g,z0-iz+g,i+ix,j+iz],[x0-1+2*g,z0-1+2*g,i+1,j+1]]) {
    const a=.5-dx*dx-dz*dz;if(a<=0)continue;
    const grad=gradients[Math.floor(atlasHash(cx,cz,seed)*8)%8];
    value+=a*a*a*a*(grad[0]*dx+grad[1]*dz);
  }
  return Math.max(0,Math.min(1,.5+value*35));
}
export function atlasClimate(x: number, z: number, seed: number) {
  const moisture = atlasNoise(x/2300, z/2300, seed+811), temperature = atlasNoise(x/4100,z/4100,seed+919);
  const mountain = smooth((atlasNoise(x/1700,z/1700,seed+41)-.37)/.33);
  return { moisture, temperature, mountain };
}
export function atlasLandform(x: number, z: number, seed: number, cellSize=1): number {
  // Fractal initial geology, as in SimpleHydrology. Transport forms the ridges.
  let terrain=0,amplitude=1,frequency=1/2048;
  for(let octave=0;octave<8;octave++){
    if(frequency*cellSize>.5)break;
    terrain+=(atlasGradientNoise(x*frequency,z*frequency,seed+octave*101)-.5)*amplitude;
    amplitude*=.6;frequency*=2;
  }
  const elevation=320+terrain*1050+(atlasGradientNoise(x/12000,z/12000,seed+43)-.5)*380;
  return 14+(elevation-14)*smooth((elevation+50)/220);
}
