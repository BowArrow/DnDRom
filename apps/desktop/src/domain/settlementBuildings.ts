import type {ScenePart} from './sceneGrammar';
import type {RegionalStyle,SceneRequest} from './sharedWorld';
import {worldHash} from './sharedWorld';

export const variation=(key:string,salt:string)=>worldHash(`${key}/${salt}`)/4294967296;
export function settlementStyle(style:RegionalStyle,request:SceneRequest):RegionalStyle {
  const text=`${style.name} ${request.name} ${request.description}`.toLowerCase();
  const family=style.family??(/chinese|anhui|ping.?yao|courtyard|japanese|pagoda/.test(text)?'courtyard':/earthen|adobe|hadram|shibam/.test(text)?'earthen':/castle|fortress|citadel|stronghold/.test(text)?'fortress':'timber');
  return {...style,family,floorHeight:style.floorHeight??3.1,roofPitch:style.roofPitch??(family==='earthen'?.25:family==='courtyard'?1.6:2.5),roofCurve:family==='courtyard'?Math.max(.25,style.roofCurve):style.roofCurve};
}
export function buildingProgram(key:string,role:string,style:RegionalStyle){
  const v=(s:string)=>variation(key,s),publicRole=/inn|hall|shrine|temple|keep/.test(role),work=/warehouse|workshop|smith|repair|cooper/.test(role);
  const family=role==='market'?'arcade':role==='keep'?'keep':work?(role==='warehouse'?'warehouse':'workshop'):style.family==='courtyard'?'courtyard':style.family==='earthen'?'tower-house':publicRole?'hall-with-wing':v('family')<.42?'street-house':v('family')<.76?'wing-house':'yard-house';
  const width=(work?11:publicRole?12:family==='courtyard'?13:7)+v('width')*(work?4:publicRole?5:4);
  const depth=(work?12:publicRole?13:family==='courtyard'?14:8)+v('depth')*5;
  const floors=role==='keep'?3:role==='market'||role==='warehouse'||role==='workshop'||family==='courtyard'?1:family==='tower-house'?3:publicRole?2:v('floors')<.5?1:2;
  return {family,width,depth,floors,height:floors*(style.floorHeight??3.1),rooms:role==='inn'?['common room','kitchen','guest rooms']:role==='keep'?['guard hall','great hall','private chamber']:work?['work floor','storage']:role==='shrine'?['sanctuary']:['entry room','private room'],style:style.family??'timber'};
}
export const structuralPart=(shape:ScenePart['shape'],x:number,y:number,z:number,w:number,h:number,d:number,material:ScenePart['material'],color:string):ScenePart=>({shape,position:{x,y,z},size:{x:w,y:h,z:d},rotation:{x:0,y:0,z:0},material,color});
function tint(hex:string,amount:number){return '#'+[1,3,5].map(i=>Math.round(Math.max(0,Math.min(255,parseInt(hex.slice(i,i+2),16)*amount))).toString(16).padStart(2,'0')).join('');}
export function compileBuildingProgram(key:string,p:ReturnType<typeof buildingProgram>,style:RegionalStyle):ScenePart[]{
  const parts:ScenePart[]=[],w=p.width,d=p.depth,wall=tint(style.wallColor,.84+variation(key,'plaster')*.25),roof=tint(style.roofColor,.82+variation(key,'roof')*.3);
  const mass=(x:number,z:number,mw:number,md:number,floors=p.floors,open=false)=>{
    const h=floors*(style.floorHeight??3.1);
    parts.push({...structuralPart(open?'frame':'house',x,h/2,z,mw,h,md,style.material,wall),levels:floors,bays:{x:Math.max(2,Math.min(5,Math.round(mw/2.7))),z:2},openness:open?.9:0});
    if(style.family==='earthen'||p.family==='keep'){
      parts.push(structuralPart('box',x,h+.12,z,mw+.4,.24,md+.4,'roof',roof));
      for(const side of [-1,1])parts.push(structuralPart('box',x+side*mw/2,h+.5,z,.24,.9,md,'masonry',wall));
      parts.push(structuralPart('box',x,h+.5,z+md/2,mw,.9,.24,'masonry',wall));
      if(p.family==='keep')for(let bay=0;bay<Math.ceil(mw/1.6);bay++)parts.push(structuralPart('box',x-mw/2+(bay+.5)*mw/Math.ceil(mw/1.6),h+.65,z-md/2,.7,1.3,.6,'masonry',wall));
    }else parts.push({...structuralPart('roof',x,h+(style.roofPitch??2.4)/2,z,mw+1,(style.roofPitch??2.4),md+1,'roof',roof),curve:style.roofCurve,roofProfile:p.family==='warehouse'?'gable':p.family==='courtyard'||variation(key,'hip')>.6?'hip':'gable'});
  };
  if(p.family==='courtyard'){
    mass(0,d*.28,w,d*.44);mass(-w*.34,-d*.15,w*.32,d*.42);mass(w*.34,-d*.15,w*.32,d*.42);
    parts.push(structuralPart('box',0,.08,-d*.13,w*.35,.16,d*.5,'ground','#938575'));
    // Open gate in a front wall, with a covered entrance. The courtyard is real empty space.
    for(const side of [-1,1])parts.push(structuralPart('box',side*(w+2)/4,1.05,-d/2,(w-2)/2,2.1,.24,'masonry',wall));
    parts.push({...structuralPart('roof',0,2.65,-d/2,3.3,1.1,2,'roof',roof),curve:style.roofCurve,roofProfile:'hip'});
  }else if(p.family==='wing-house'||p.family==='hall-with-wing'||p.family==='yard-house'){
    mass(-w*.17,0,w*.64,d);
    // A service range with its own entrance avoids intersecting closed shells.
    mass(w*.34,d*.25,w*.28,d*.46,1);
    parts.push(structuralPart('box',w*.33,.1,-d*.22,w*.28,.2,d*.45,'ground','#958779'));
  }else mass(0,0,w,d,p.floors,p.family==='arcade');
  if(style.family==='timber'&&p.family!=='arcade'){
    parts.push(structuralPart('box',-w*.32,p.height+.6,d*.28,.75,2.5,.8,'masonry','#81776b'));
    if(p.family==='street-house')parts.push({...structuralPart('roof',0,2.45,-d/2-1,w*.7,.55,2,'roof',roof),curve:0});
  }
  return parts;
}

/** Closed facades with actual openings and stairwell cutouts. All floors share
 * one architectural envelope; no solid box is used as an occupied interior. */
export function expandHouse(p:ScenePart):ScenePart[]{
  const out:ScenePart[]=[],w=p.size.x,d=p.size.z,levels=p.levels??1,h=p.size.y/levels,base=-p.size.y/2,a=p.rotation.y*Math.PI/180;
  const add=(x:number,y:number,z:number,sx:number,sy:number,sz:number,material=p.material,color=p.color,yaw=0)=>{
    if(Math.min(sx,sy,sz)<=.01)return;
    out.push({...structuralPart('box',p.position.x+x*Math.cos(a)+z*Math.sin(a),p.position.y+y,p.position.z-x*Math.sin(a)+z*Math.cos(a),sx,sy,sz,material,color),rotation:{x:0,y:p.rotation.y+yaw,z:0}});
  };
  const run=Math.min(d-2,h/.19*.27),stairX=w/2-1.25,stairZ=d/2-run-1;
  for(let level=0;level<levels;level++){
    const y=base+level*h;
    if(level===0)add(0,y+.08,0,w,.16,d,'timber','#8b7150');
    else{
      add(-1.1,y+.08,0,w-2.2,.16,d,'timber','#8b7150');
      add(w/2-1.1,y+.08,-d/2+(d-run-1)/2,2.2,.16,d-run-1,'timber','#8b7150');
      add(w/2-1.1,y+.08,d/2-.45,2.2,.16,.9,'timber','#8b7150');
    }
    if(w>=5&&d>=6){
      const end=levels>1?w/2-2.25:w/2-.12,begin=-w/2+.12,door=Math.min(1.5,(end-begin)*.35),center=(begin+end)/2;
      const length=(end-begin-door)/2;
      add(begin+length/2,y+h/2,d*.1,length,h,.15,'masonry',p.color);
      add(end-length/2,y+h/2,d*.1,length,h,.15,'masonry',p.color);
      add(center,y+2.3+(h-2.3)/2,d*.1,door,h-2.3,.15,'masonry',p.color);
    }
    // Each facade is split around windows or a front/back door. No decorative
    // black rectangle substitutes for a doorway through collision geometry.
    for(let edge=0;edge<4;edge++){
      const length=edge%2?d:w,bays=edge%2?2:p.bays?.x??3,bay=length/bays;
      for(let i=0;i<bays;i++){
        const at=-length/2+(i+.5)*bay,door=level===0&&edge%2===0&&i===Math.floor(bays/2),opening=Math.min(bay-.5,door?1.65:1.05),sill=door?0:1.05,top=door?2.35:2.05;
        const wall=(u:number,yy:number,ww:number,hh:number)=>edge%2?add((edge===1?1:-1)*w/2,yy,u,.22,hh,ww,'masonry',p.color):add(u,yy,(edge===0?-1:1)*d/2,ww,hh,.22,'masonry',p.color);
        const ox=edge%2?(edge===1?1:-1)*w/2:at,oz=edge%2?at:(edge===0?-1:1)*d/2,yaw=[0,-90,180,90][edge];
        out.push({...structuralPart(door?'doorway':'window-frame',p.position.x+ox*Math.cos(a)+oz*Math.sin(a),p.position.y+y+(top+sill)/2,p.position.z-ox*Math.sin(a)+oz*Math.cos(a),opening,top-sill,.22,'timber','#b5a080'),rotation:{x:0,y:p.rotation.y+yaw,z:0}});
        const jamb=(bay-opening)/2;
        wall(at-(opening+jamb)/2,y+h/2,jamb,h);wall(at+(opening+jamb)/2,y+h/2,jamb,h);
        wall(at,y+sill/2,opening,sill);wall(at,y+top+(h-top)/2,opening,h-top);
      }
    }
    for(const side of [-1,1]){add(side*w/2,y+h/2,0,.15,h,.15,'timber','#594533');add(0,y+h-.14,side*d/2,w+.15,.18,.3,'timber','#594533');}
    if(level<levels-1){
      const count=Math.ceil(h/.19);
      for(let i=0;i<count;i++)add(stairX,y+(i+1)*h/count/2,stairZ+(i+.5)*run/count,1.55,(i+1)*h/count,run/count+.02,'timber','#8b7150');
    }
  }
  return out;
}
