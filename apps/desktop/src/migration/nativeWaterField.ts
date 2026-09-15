/** World-space metres, Y-up. Geometry and simulation consume the same bed.
 * Optional v1 extension: old scene readers safely ignore these fields. */
export interface NativeWaterField {
  originX:number; originZ:number; size:number; resolution:number;
  depths:number[]; distances:number[]; heights:number[];
}
export function nativeWaterField(originX:number,originZ:number,size:number,resolution:number,
  depth:(x:number,z:number)=>number,distance:(x:number,z:number)=>number,height:(x:number,z:number)=>number):NativeWaterField {
  resolution=Math.max(1,Math.min(64,Math.round(resolution)));
  const field:NativeWaterField={originX,originZ,size,resolution,depths:[],distances:[],heights:[]};
  for(let z=0;z<=resolution;z++)for(let x=0;x<=resolution;x++){
    const wx=originX+x*size/resolution,wz=originZ+z*size/resolution,d=depth(wx,wz);
    field.depths.push(Math.max(-32,Math.min(32,d)));
    field.distances.push(Math.max(-24,Math.min(24,distance(wx,wz)*(d<0?-1:1))));
    field.heights.push(height(wx,wz));
  }
  return field;
}
