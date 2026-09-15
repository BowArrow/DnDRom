import type { MapEntity,Vec3 } from "./types";

const transform=(entity:MapEntity,point:Vec3):Vec3=>{
  const angle=entity.rotation.y*Math.PI/180,x=point.x*entity.scale.x,z=point.z*entity.scale.z;
  return {x:entity.position.x+x*Math.cos(angle)+z*Math.sin(angle),y:entity.position.y+point.y*entity.scale.y,z:entity.position.z-x*Math.sin(angle)+z*Math.cos(angle)};
};
/** Ground-floor access is derived from the same openings used by the mesh.
 * Decorative assemblies without a floor are not advertised as buildings. */
export function buildingAccess(entity:MapEntity):{entrance:Vec3;anchor:Vec3}|undefined {
  if(entity.worldAccess)return entity.worldAccess;
  const geometry=entity.worldGeometry;
  if(geometry?.kind==="cga-building") {
    const door=geometry.facadeTiles.find(tile=>tile.floor===0&&tile.kind==="door");
    if(!door)return;
    const a=geometry.footprint[door.edge],b=geometry.footprint[(door.edge+1)%geometry.footprint.length];
    const length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.001)return;
    const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    const entrance={x:a.x+dx*door.offset,y:.3,z:a.z+dz*door.offset};
    // Footprints are counterclockwise in X/Z; the left normal is inward.
    const anchor={x:entrance.x-dz*.85,y:.32,z:entrance.z+dx*.85};
    return {entrance:transform(entity,entrance),anchor:transform(entity,anchor)};
  }
  if(geometry?.kind!=="assembly")return;
  const floor=geometry.parts.filter(part=>part.shape==="box"&&part.size.y<=.6&&part.size.x>=2&&part.size.z>=2).sort((a,b)=>a.position.y-b.position.y||b.size.x*b.size.z-a.size.x*a.size.z)[0];
  if(!floor || !geometry.parts.some(p=>p.material==="roof"))return;
  const angle=floor.rotation.y*Math.PI/180,depth=floor.size.z/2;
  const y=floor.position.y+floor.size.y/2+.02;
  return {entrance:transform(entity,{x:floor.position.x-Math.sin(angle)*depth,y,z:floor.position.z-Math.cos(angle)*depth}),anchor:transform(entity,{x:floor.position.x,y,z:floor.position.z})};
}
