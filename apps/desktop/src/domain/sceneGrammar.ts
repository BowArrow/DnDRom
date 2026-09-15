import { z } from "zod";
import {expandHouse} from './settlementBuildings';
import type { GameMap, MapEntity, WorldMaterialRole } from "./types";

const vector = (min: number, max: number) => z.object({ x: z.number().min(min).max(max), y: z.number().min(min).max(max), z: z.number().min(min).max(max) });
export const worldMaterialRoleSchema = z.enum(["ground", "masonry", "timber", "roof", "foliage"]);
export const scenePartSchema = z.object({
  shape: z.enum(["box", "sphere", "cylinder", "cone", "roof", "roof-wall", "window-frame", "doorway", "frame", "house", "arch", "bridge-deck", "suspension"]),
  position: vector(-32, 32), size: vector(.02, 48), rotation: vector(-360, 360),
  material: worldMaterialRoleSchema, color: z.string().regex(/^#[0-9a-f]{6}$/i),
  // Roof is a curved surface, not a scaled triangle or a texture illusion.
  curve: z.number().min(-1).max(1).optional(),
  roofProfile: z.enum(['gable','hip']).optional(),
  roofSpan: z.object({x:z.number().positive().max(100),z:z.number().positive().max(100)}).optional(),
  settlementSurface:z.object({version:z.literal(1),seed:z.number().int().min(0).max(4095),age:z.number().min(0).max(1),moisture:z.number().min(0).max(1),wall:z.union([z.literal(0),z.literal(1),z.literal(2)]),wood:z.union([z.literal(0),z.literal(1)]),roof:z.union([z.literal(0),z.literal(1)])}).optional(),
  bays: z.object({ x: z.number().int().min(1).max(6), z: z.number().int().min(1).max(6) }).optional(),
  levels: z.number().int().min(1).max(3).optional(),
  openness: z.number().min(0).max(1).optional(),
  repeat: z.object({ count: z.number().int().min(1).max(24), step: vector(-20, 20), yaw: z.number().min(-360).max(360) }).optional(),
});
export type ScenePart = z.infer<typeof scenePartSchema>;
export const sceneCompositionSchema = z.object({
  design: z.string().min(1).max(1500),
  recipes: z.array(z.object({ id: z.string().min(1).max(60), name: z.string().min(1).max(100), parts: z.array(scenePartSchema).min(1).max(48) })).min(1).max(12),
  buildingRecipeId: z.string().max(60).optional(),
  placements: z.array(z.object({ recipeId: z.string().max(60), x: z.number().min(-120).max(120), z: z.number().min(-120).max(120), elevation: z.number().min(0).max(48), yaw: z.number().min(-360).max(360), scale: z.number().min(.1).max(3) })).max(48),
}).superRefine((value, ctx) => {
  const ids = new Set(value.recipes.map((r) => r.id));
  if (ids.size !== value.recipes.length) ctx.addIssue({ code: "custom", message: "Recipe IDs must be unique" });
  if (value.buildingRecipeId && !ids.has(value.buildingRecipeId)) ctx.addIssue({ code: "custom", message: "Unknown building recipe" });
  for (const placement of value.placements) if (!ids.has(placement.recipeId)) ctx.addIssue({ code: "custom", message: "Unknown placement recipe" });
  for (const recipe of value.recipes) if (expandSceneRecipe(recipe.parts).length > 384) ctx.addIssue({ code: "custom", message: "Each recipe is limited to 384 expanded parts" });
});
export type SceneComposition = z.infer<typeof sceneCompositionSchema>;

export function expandSceneRecipe(parts: ScenePart[]): ScenePart[] {
  const repeated = parts.flatMap(({ repeat, ...part }) => Array.from({ length: repeat?.count ?? 1 }, (_, index) => ({ ...part,
    position: { x: part.position.x + (repeat?.step.x ?? 0) * index, y: part.position.y + (repeat?.step.y ?? 0) * index, z: part.position.z + (repeat?.step.z ?? 0) * index },
    rotation: { ...part.rotation, y: part.rotation.y + (repeat?.yaw ?? 0) * index },
  })));
  const enclosures:ScenePart[]=repeated.filter(p=>p.shape==='house').flatMap(h=>{
    const roof=repeated.find(p=>p.shape==='roof'&&Math.abs(p.position.x-h.position.x)<.01&&Math.abs(p.position.z-h.position.z)<.01&&Math.abs(p.rotation.y-h.rotation.y)<.01&&Math.abs(p.position.y-p.size.y/2-h.position.y-h.size.y/2)<.25&&p.size.x>=h.size.x&&p.size.z>=h.size.z);
    return roof?[{...roof,shape:'roof-wall' as const,material:'masonry' as const,color:h.color,size:{x:h.size.x,y:roof.size.y,z:h.size.z},roofSpan:{x:roof.size.x,z:roof.size.z}}]:[];
  });
  return [...repeated,...enclosures].flatMap((part) => part.shape === 'house'?expandHouse(part):part.shape === "frame" ? expandFrame(part) : ['arch','bridge-deck','suspension'].includes(part.shape)?expandInfrastructure(part):[part]);
}

/** Structural operators expand into the existing mesh primitives, so editing,
 * bounds, native export and every LOD use the same construction recipe. */
function expandInfrastructure(p:ScenePart):ScenePart[]{
  const out:ScenePart[]=[],add=(shape:ScenePart['shape'],x:number,y:number,z:number,w:number,h:number,d:number,rz=0)=>{const a=p.rotation.y*Math.PI/180;out.push({...p,shape,repeat:undefined,position:{x:p.position.x+x*Math.cos(a)+z*Math.sin(a),y:p.position.y+y,z:p.position.z-x*Math.sin(a)+z*Math.cos(a)},rotation:{...p.rotation,z:p.rotation.z+rz},size:{x:w,y:h,z:d}});};
  if(p.shape==='arch'){const count=18,rx=p.size.x/2,ry=p.size.y,thickness=Math.max(.3,p.size.x*.065);for(let i=0;i<count;i++){const a=(i+.5)*Math.PI/count;add('box',Math.cos(a)*rx,Math.sin(a)*ry,0,Math.PI*rx/count*1.08,thickness,p.size.z,a*180/Math.PI-90);}return out;}
  const width=p.size.x,length=p.size.z;add('box',0,0,0,width,.35,length);
  for(const side of [-1,1]){add('box',side*width/2,1,0,.14,.14,length);for(let z=-length/2;z<=length/2;z+=3)add('cylinder',side*width/2,.5,z,.14,1.3,.14);}
  if(p.shape==='suspension')for(const side of [-1,1]){for(const end of [-1,1])add('box',side*width/2,p.size.y/2,end*length/2,.45,p.size.y,.45);for(let i=0;i<20;i++){const z=-length/2+length*i/19,y=1+(p.size.y-1)*(z/(length/2))**2;add('cylinder',side*width/2,y/2,z,.08,y,.08);const nextZ=Math.min(length/2,z+length/19),nextY=1+(p.size.y-1)*(nextZ/(length/2))**2;if(nextZ-z<.001)continue;const last=out.length;add('box',side*width/2,(y+nextY)/2,(z+nextZ)/2,.13,.13,Math.hypot(nextZ-z,nextY-y));out[last].rotation.x=-Math.atan2(nextY-y,nextZ-z)*180/Math.PI;}}
  return out;
}

function rotatePoint(point: { x: number; y: number; z: number }, rotation: ScenePart["rotation"]): ScenePart["position"] {
  const [ax, ay, az] = [rotation.x, rotation.y, rotation.z].map((degrees) => degrees * Math.PI / 180);
  const y = point.y * Math.cos(ax) - point.z * Math.sin(ax), z = point.y * Math.sin(ax) + point.z * Math.cos(ax);
  const x = point.x * Math.cos(ay) + z * Math.sin(ay);
  return { x: x * Math.cos(az) - y * Math.sin(az), y: x * Math.sin(az) + y * Math.cos(az), z: -point.x * Math.sin(ay) + z * Math.cos(ay) };
}

/** A load-bearing frame is a procedural operator, with no culture or era
 * presets. The director controls dimensions, bays, stories and enclosure;
 * separate roof operators and repeated/rotated frames define the silhouette. */
function expandFrame(frame: ScenePart): ScenePart[] {
  const output: ScenePart[] = [], { x: width, y: height, z: depth } = frame.size;
  const bays = frame.bays ?? { x: 3, z: 2 }, levels = frame.levels ?? 1;
  const post = Math.max(.1, Math.min(.32, Math.min(width, depth) * .04)), story = height / levels;
  const add = (position: ScenePart["position"], size: ScenePart["size"], material = frame.material, color = frame.color) => {
    const rotated = rotatePoint(position, frame.rotation);
    output.push({ shape: "box", position: { x: frame.position.x + rotated.x, y: frame.position.y + rotated.y, z: frame.position.z + rotated.z }, size, rotation: { ...frame.rotation }, material, color });
  };
  for (let level = 0; level < levels; level++) {
    const bottom = -height / 2 + level * story;
    add({ x: 0, y: bottom + .1, z: 0 }, { x: width + .35, y: .2, z: depth + .35 }, "masonry", "#929185");
    for (let x = 0; x <= bays.x; x++) for (let z = 0; z <= bays.z; z++) {
      if (x && x < bays.x && z && z < bays.z) continue;
      add({ x: -width / 2 + x * width / bays.x, y: bottom + story / 2, z: -depth / 2 + z * depth / bays.z }, { x: post, y: story, z: post });
    }
    for (const side of [-1, 1]) {
      add({ x: 0, y: bottom + story - post / 2, z: side * depth / 2 }, { x: width + post, y: post, z: post });
      add({ x: side * width / 2, y: bottom + story - post / 2, z: 0 }, { x: post, y: post, z: depth + post });
    }
    const wallHeight = (story - post) * (1 - (frame.openness ?? .5));
    if (wallHeight > .1) {
      for (let bay = 0; bay < bays.x; bay++) for (const side of [-1, 1]) {
        if (side < 0 && bay === Math.floor(bays.x / 2)) continue; // Front entrance.
        add({ x: -width / 2 + (bay + .5) * width / bays.x, y: bottom + wallHeight / 2, z: side * depth / 2 }, { x: width / bays.x - post, y: wallHeight, z: post * .55 }, "masonry", "#c3bba1");
      }
      for (const side of [-1, 1]) add({ x: side * width / 2, y: bottom + wallHeight / 2, z: 0 }, { x: post * .55, y: wallHeight, z: depth - post }, "masonry", "#c3bba1");
    }
  }
  return output;
}

/** Local bounds include rotated and repeated parts, for parcel fitting and
 * vegetation clearance. This is also the authority for assembly placement. */
export function sceneRecipeBounds(parts: ScenePart[]): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const part of expandSceneRecipe(parts)) {
    const [ax, ay, az] = [part.rotation.x, part.rotation.y, part.rotation.z].map((degrees) => degrees * Math.PI / 180);
    for (const sx of [-.5, .5]) for (const sy of [-.5, .5]) for (const sz of [-.5, .5]) {
      const x = sx * part.size.x, y = sy * part.size.y, z = sz * part.size.z;
      const y1 = y * Math.cos(ax) - z * Math.sin(ax), z1 = y * Math.sin(ax) + z * Math.cos(ax);
      const x2 = x * Math.cos(ay) + z1 * Math.sin(ay), z2 = -x * Math.sin(ay) + z1 * Math.cos(ay);
      const point = { x: part.position.x + x2 * Math.cos(az) - y1 * Math.sin(az), y: part.position.y + x2 * Math.sin(az) + y1 * Math.cos(az), z: part.position.z + z2 };
      for (const axis of ["x", "y", "z"] as const) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
    }
  }
  return { min, max };
}

export function sceneMaterialRole(entity: MapEntity): WorldMaterialRole | undefined {
  if (entity.worldGeometry?.kind === "water" || entity.worldGeometry?.kind === "river-ribbon" || entity.tags?.includes("world:light") || entity.assetId.startsWith("token-")) return undefined;
  if (entity.worldGeometry?.kind === "terrain" || entity.assetId.startsWith("floor-") || entity.worldGeometry?.kind === "road-ribbon") return "ground";
  if (entity.worldGeometry?.kind === "ground-cover" || /shrub|reeds/.test(entity.assetId)) return "foliage";
  if (/wood|barrel|crate|chest|table|chair|fence/.test(entity.assetId)) return "timber";
  if (/rock|stone|pillar/.test(entity.assetId)) return "masonry";
  return undefined;
}

export function applySceneMaterials(map: GameMap, materials: Partial<Record<WorldMaterialRole, string>>): GameMap {
  return { ...map, entities: map.entities.map((entity) => {
    if (["cga-building", "assembly", "space-colonized-tree"].includes(entity.worldGeometry?.kind ?? "")) {
      const roles = entity.worldGeometry?.kind === "assembly" ? new Set(entity.worldGeometry.parts.map((part) => part.material)) : new Set(entity.worldGeometry?.kind === "space-colonized-tree" ? ["timber", "foliage"] : ["masonry", "timber", "roof"]);
      const slots = Object.fromEntries(Object.entries(materials).filter(([role]) => roles.has(role as WorldMaterialRole)));
      return { ...entity, materialAssetId: undefined, materialSlots: { ...entity.materialSlots, ...slots } };
    }
    const role = sceneMaterialRole(entity);
    return role && materials[role] ? { ...entity, materialAssetId: materials[role] } : entity;
  }) };
}

