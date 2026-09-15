import {z} from 'zod';
import {smooth01,type SceneEnvironment,type SharedTerrain} from './sharedWorld';

export const sceneEnvironmentSchema=z.object({stratum:z.enum(['surface','underground']),depth:z.number().min(4).max(1000).optional(),overlays:z.array(z.object({kind:z.enum(['volcanic','magical']),name:z.string().min(1).max(120),strength:z.number().min(0).max(1)})).max(8)});
/** Environment layers describe a scene, rather than replacing its climate. */
export function inferSceneEnvironment(text:string):SceneEnvironment{
 const underground=/underground|subterranean|underdark|cavern|\bcrypt\b|\bdungeon\b/i.test(text);
 const overlays:SceneEnvironment['overlays']=[];
 if(/volcan|lava|caldera|basalt/i.test(text))overlays.push({kind:'volcanic',name:'Volcanic habitat',strength:.8});
 if(/enchanted|magical|fey|cursed|corrupt/i.test(text))overlays.push({kind:'magical',name:/cursed|corrupt/i.test(text)?'Corrupted landscape':'Enchanted landscape',strength:.65});
 return {stratum:underground?'underground':'surface',depth:underground?24:undefined,overlays};
}
export function sampleEnvironment(terrain:SharedTerrain,x:number,z:number){
 let volcanic=0;const magic:Array<{name:string;weight:number}>=[];
 for(const r of terrain.environments??[]){const weight=1-smooth01(Math.hypot(x-r.x,z-r.z)/r.radius);for(const overlay of r.overlays){const w=weight*overlay.strength;if(overlay.kind==='volcanic')volcanic=Math.max(volcanic,w);else if(w>.001)magic.push({name:overlay.name,weight:w});}}
 return {volcanic,magic};
}
