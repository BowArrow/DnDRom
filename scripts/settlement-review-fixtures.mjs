import{readFileSync,writeFileSync}from'node:fs';import{createRequire}from'node:module';
const out='artifacts/settlement-034',require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
await require('esbuild').build({stdin:{contents:'export {createStarterCampaign} from "./apps/desktop/src/domain/seed";export * from "./apps/desktop/src/domain/settlementBuildings";export {planSettlement} from "./apps/desktop/src/domain/settlementPlanner";export {sharedWorldEntities} from "./apps/desktop/src/domain/sharedWorldScene";',resolveDir:process.cwd()},outfile:`${out}/gallery.mjs`,bundle:true,platform:'node',format:'esm'});
const p=await import(`../${out}/gallery.mjs`),world=JSON.parse(readFileSync(`${out}/world.json`)),m=world.manifest,r={...m.requests[0],name:'Castle',description:'A defensive stone castle',purpose:'castle',intent:{landform:'any',water:'none',forest:0},roles:{keep:1,hall:1,workshop:2,home:4,shrine:1}};
const ground=(size)=>({id:'floor',assetId:'house-large',name:'Review ground',position:{x:0,y:-.2,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},worldGeometry:{kind:'assembly',recipeId:'floor',parts:[p.structuralPart('box',0,0,0,size,.3,size,'ground','#6e7154')]}});
const map=p.createStarterCampaign().map;map.entities=[];map.name='Castle structure review';map.id='castle-review';map.width=40;map.height=40;map.pointsOfInterest=[];delete map.world;delete map.journey;
const review={...m,authoredEntities:[],removedEntityIds:[],transport:[],requests:[r],locations:[]};review.locations=[{...m.locations[0],position:{x:0,y:0,z:0},settlement:p.planSettlement(review,r,{x:0,y:0,z:0},{height:()=>0,flow:()=>0,level:-10},[])}];
map.entities=[ground(210),...p.sharedWorldEntities(review,{x:0,y:0,z:0},{minX:-500,minZ:-500,maxX:500,maxZ:500})];writeFileSync(`${out}/castle-map.json`,JSON.stringify(map));
map.id='architecture-review';map.name='Regional architecture review';map.entities=[ground(160)];
for(const [i,family] of ['timber','courtyard','earthen','fortress'].entries())for(const [j,role] of ['home','inn','warehouse'].entries()){
 const style=p.settlementStyle({...m.styles[0],family},r),id=`${family}-${role}`,program=p.buildingProgram(id,role,style),recipe=p.compileBuildingProgram(id,program,style);
 review.locations=[{...m.locations[0],settlement:{id:'gallery',docks:[],streets:[],buildings:[{id,role,position:{x:(i-1.5)*33,y:0,z:(j-1)*32},yaw:0,width:program.width,depth:program.depth,height:program.height,entrance:{x:0,y:0,z:0},recipe}]}}];map.entities.push(...p.sharedWorldEntities(review,{x:0,y:0,z:0},{minX:-500,minZ:-500,maxX:500,maxZ:500}));
}
writeFileSync(`${out}/architecture-map.json`,JSON.stringify(map));
