import {useEffect,useRef,useState,type RefObject} from 'react';
import type {SceneViewportProps} from '../components/SceneViewport';
import type {MapEntity,Vec3} from '../domain/types';
import {useCampaignStore} from '../state/campaignStore';
import {nativeCall} from './nativeBridge';
type Point={x:number;y:number;visible:boolean};
type DragAxis='x'|'y'|'z'|'xy'|'yz'|'xz'|'ground';
type Projection={origin:Point;axes:Point[];rings:Point[][];length:number};
const axes=['x','y','z'] as const,colors=['#ff6464','#71e58a','#70a9ff'];
export function NativeEditorOverlay(props:SceneViewportProps&{viewport:RefObject<HTMLDivElement|null>}){
 const [mode,setMode]=useState<'move'|'rotate'|'scale'>('move'),[projection,setProjection]=useState<Projection>();
 const tool=useRef(mode);tool.current=mode;
 const latest=useRef(props);latest.current=props;
 const selected=props.map.entities.find(e=>e.id===props.selectedEntityId);
 const drag=useRef<{entity:MapEntity;axis:DragAxis;x:number;y:number;projection:Projection;mode:typeof mode;pointer:number;patch?:Partial<MapEntity>;streamId:string}|undefined>(undefined);
 useEffect(()=>{
  let stopped=false,busy=false,lastIdle='';
  const poll=async()=>{if(busy||stopped)return;busy=true;try{const p=latest.current,e=p.mode!=='play'&&!p.activeAssetId&&p.selectedEntityId?p.map.entities.find(e=>e.id===p.selectedEntityId):undefined;const idle=JSON.stringify([p.showGrid,p.map.gridSize,p.map.gridShape]);if(!e&&lastIdle===idle)return;lastIdle=e?'':idle;const result=await nativeCall<Projection>('scene.input',{kind:'editor',entityId:p.mode!=='play'&&!p.activeAssetId?e?.id??'':'',tool:tool.current,grid:!!p.showGrid,gridSize:p.map.gridSize??1,gridShape:p.map.gridShape??'square',position:e?.position??{x:0,y:0,z:0}});if(!stopped)setProjection(result);}catch{}finally{busy=false;}};
  let frame=0;const tick=()=>{void poll();frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>{stopped=true;cancelAnimationFrame(frame);void nativeCall('scene.input',{kind:'editor',grid:false,entityId:''}).catch(()=>{});};
 },[]);
 useEffect(()=>{
  const keyboard=(e:KeyboardEvent)=>{if(e.target!==props.viewport.current||latest.current.activeAssetId||!latest.current.selectedEntityId)return;const next={KeyW:'move',KeyE:'rotate',KeyS:'scale'}[e.code] as typeof mode|undefined;if(next){e.preventDefault();setMode(next);}};
  window.addEventListener('keydown',keyboard);return()=>window.removeEventListener('keydown',keyboard);
 },[props.viewport]);
 const preview=useRef<Promise<unknown>>(Promise.resolve()),previewBusy=useRef(false),nextPreview=useRef<{d:NonNullable<typeof drag.current>;patch:Partial<MapEntity>}|undefined>(undefined);
 const flush=()=>{
  if(previewBusy.current||!nextPreview.current)return;
  const {d,patch}=nextPreview.current;nextPreview.current=undefined;previewBusy.current=true;
  const trs=(e:MapEntity)=>({position:e.position,rotation:e.rotation,scale:e.scale});
  preview.current=nativeCall('scene.input',{kind:'entities',streamId:d.streamId,preview:true,transforms:[{id:d.entity.id,before:trs(d.entity),after:trs({...d.entity,...patch})}]}).finally(()=>{previewBusy.current=false;flush();});
 };
 const update=(_entity:MapEntity,patch:Partial<MapEntity>)=>{const d=drag.current;if(!d)return;d.patch=patch;nextPreview.current={d,patch};flush();};
 const begin=(event:React.PointerEvent,axis:DragAxis)=>{
  event.preventDefault();event.stopPropagation();if(!selected||!projection)return;
  event.currentTarget.setPointerCapture(event.pointerId);drag.current={entity:structuredClone(selected),axis,x:event.clientX,y:event.clientY,projection,mode,pointer:event.pointerId,streamId:(window as any).dndromSceneImport?.streamId??''};
 };
 const groundBusy=useRef(false);
 const move=(event:React.PointerEvent)=>{
  const d=drag.current;if(!d||d.pointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();
  if(d.axis==='ground'){
   if(groundBusy.current)return;groundBusy.current=true;
   void nativeCall<{hit:boolean;position?:Vec3}>('scene.input',{kind:'pick',groundOnly:true,planeY:d.entity.position.y,x:event.clientX/innerWidth,y:event.clientY/innerHeight}).then(hit=>{if(drag.current===d&&hit.hit&&hit.position){const position=hit.position;if(event.ctrlKey){const grid=latest.current.map.gridSize||1;position.x=Math.round(position.x/grid)*grid;position.z=Math.round(position.z/grid)*grid;}update(d.entity,{position});}}).finally(()=>{groundBusy.current=false;});return;
  }
  if(d.axis.length===2){
   const i=axes.indexOf(d.axis[0] as typeof axes[number]),j=axes.indexOf(d.axis[1] as typeof axes[number]),o=d.projection.origin;
   const u={x:(d.projection.axes[i].x-o.x)*innerWidth,y:(d.projection.axes[i].y-o.y)*innerHeight},v={x:(d.projection.axes[j].x-o.x)*innerWidth,y:(d.projection.axes[j].y-o.y)*innerHeight};
   const det=u.x*v.y-u.y*v.x;if(Math.abs(det)<20)return;
   const dx=event.clientX-d.x,dy=event.clientY-d.y,position={...d.entity.position};
   let a=(dx*v.y-dy*v.x)/det*d.projection.length,b=(dy*u.x-dx*u.y)/det*d.projection.length;
   if(event.ctrlKey){const g=latest.current.map.gridSize||1;a=Math.round(a/g)*g;b=Math.round(b/g)*g;}
   position[axes[i]]+=a;position[axes[j]]+=b;update(d.entity,{position});return;
  }
  const axis=d.axis as typeof axes[number];
  const a=axes.indexOf(axis),o=d.projection.origin,end=d.projection.axes[a],vx=(end.x-o.x)*innerWidth,vy=(end.y-o.y)*innerHeight;
  const delta=((event.clientX-d.x)*vx+(event.clientY-d.y)*vy)/Math.max(100,vx*vx+vy*vy);
  if(d.mode==='move'){let amount=delta*d.projection.length;if(event.ctrlKey)amount=Math.round(amount/(latest.current.map.gridSize||1))*(latest.current.map.gridSize||1);update(d.entity,{position:{...d.entity.position,[axis]:d.entity.position[axis]+amount}});}
  else if(d.mode==='scale')update(d.entity,{scale:{...d.entity.scale,[axis]:Math.max(.01,d.entity.scale[axis]*(1+delta))}});
  else {const cx=o.x*innerWidth,cy=o.y*innerHeight;let degrees=(Math.atan2(event.clientY-cy,event.clientX-cx)-Math.atan2(d.y-cy,d.x-cx))*180/Math.PI;if(event.ctrlKey)degrees=Math.round(degrees/15)*15;update(d.entity,{rotation:{...d.entity.rotation,[axis]:d.entity.rotation[axis]+degrees}});}
 };
 const end=async(e:React.PointerEvent)=>{
  e.stopPropagation();const d=drag.current;if(!d)return;
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  // Drain the latest preview before one durable edit. Native reconciles from
  // its preview transform, so the final persisted update cannot apply twice.
  while(previewBusy.current||nextPreview.current){await preview.current;}
  drag.current=undefined;
  if(e.type==='pointercancel'){
   const t={position:d.entity.position,rotation:d.entity.rotation,scale:d.entity.scale};
   await nativeCall('scene.input',{kind:'entities',streamId:d.streamId,transforms:[{id:d.entity.id,before:t,after:t}]});return;
  }
  if(d.patch&&useCampaignStore.getState().campaign.map.id===latest.current.map.id)useCampaignStore.getState().updateEntity(d.entity.id,e.type==='pointercancel'?{position:d.entity.position,rotation:d.entity.rotation,scale:d.entity.scale}:d.patch);
 };
 const enabled=props.mode!=='play'&&selected&&!props.activeAssetId&&projection?.origin?.visible;
 if(!enabled)return null;
 const bounds=props.viewport.current?.getBoundingClientRect();
 const point=(p:Point)=>({x:p.x*innerWidth,y:p.y*innerHeight}),o=point(projection.origin);
 return <>
  <div className="native-transform-tools" onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}>
   {(['move','rotate','scale'] as const).map((m,i)=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{m[0].toUpperCase()+m.slice(1)} <kbd>{['W','E','S'][i]}</kbd></button>)}<span>Ctrl: snap</span>
  </div>
  <svg className="native-transform-gizmo" aria-label="Object transform handles" width={innerWidth} height={innerHeight} style={{opacity:0,...(bounds?{clipPath:`inset(${bounds.top}px ${innerWidth-bounds.right}px ${innerHeight-bounds.bottom}px ${bounds.left}px)`}:{})}} onClick={e=>e.stopPropagation()}>
   {axes.map((axis,i)=>{const a=point(projection.axes[i]);return <g key={axis} aria-label={`${mode} ${axis.toUpperCase()}`} style={{pointerEvents:'stroke',cursor:'grab'}} onPointerDown={e=>begin(e,axis)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    {mode==='rotate'?<polyline points={(projection.rings[i]??[]).map(p=>`${p.x*innerWidth},${p.y*innerHeight}`).join(' ')} fill="none" stroke={colors[i]} strokeWidth="5"/>:<><line x1={o.x} y1={o.y} x2={a.x} y2={a.y} stroke="#111" strokeWidth="7"/><line x1={o.x} y1={o.y} x2={a.x} y2={a.y} stroke={colors[i]} strokeWidth="4"/>{mode==='scale'?<rect x={a.x-6} y={a.y-6} width="12" height="12" fill={colors[i]}/>:<circle cx={a.x} cy={a.y} r="7" fill={colors[i]}/>}<text x={a.x+10} y={a.y-8} fill={colors[i]} stroke="#111" strokeWidth=".5" fontSize="16">{axis.toUpperCase()}</text></>}
   </g>;})}
   {mode==='move'&&(['xy','yz','xz'] as const).map(plane=>{const a=point(projection.axes[axes.indexOf(plane[0] as typeof axes[number])]),b=point(projection.axes[axes.indexOf(plane[1] as typeof axes[number])]);const q=(u:number,v:number)=>`${o.x+(a.x-o.x)*u+(b.x-o.x)*v},${o.y+(a.y-o.y)*u+(b.y-o.y)*v}`;return <polygon key={plane} aria-label={`Move ${plane.toUpperCase()} plane`} points={[q(.22,.22),q(.42,.22),q(.42,.42),q(.22,.42)].join(' ')} fill="white" style={{pointerEvents:'all',cursor:'move'}} onPointerDown={e=>begin(e,plane)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>;})}
   <circle aria-label="Move along ground" cx={o.x} cy={o.y} r="9" fill="#f9dc83" stroke="#181818" strokeWidth="2" style={{pointerEvents:'all',cursor:'move'}} onPointerDown={e=>begin(e,'ground')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>
  </svg>
 </>;
}
