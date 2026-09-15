import {useEffect,useRef,useState} from 'react';
import {useCampaignStore} from '../state/campaignStore';
import {enterWorldLocation,useWorldGeneration} from '../state/worldGeneration';
import {sharedSceneMatchesLayout} from '../domain/sharedSceneLayout';

export function WorldScenesDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  const campaign=useCampaignStore(s=>s.campaign),pending=useWorldGeneration();
  const dialog=useRef<HTMLDialogElement>(null),abort=useRef<AbortController|null>(null);
  const [query,setQuery]=useState(''),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const manifest=campaign.world?.manifest;
  const requests=pending?.campaignId===campaign.id&&pending.status!=='complete'?pending.requests:manifest?.requests??[];
  const entries=[...(manifest?.locations??[]).map(location=>({id:location.id,name:location.name,location,request:requests.find(r=>r.id===location.requestId)})),
    ...requests.filter(r=>!manifest?.locations.some(l=>l.requestId===r.id)).map(request=>({id:request.id,name:request.name,location:undefined,request}))];
  const jump=async(id?:string)=>{
    if(busy)return;const controller=new AbortController();abort.current=controller;setBusy(id??'travel');setError('');
    try{await enterWorldLocation(id,controller.signal);if(!controller.signal.aborted)onClose();}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(null);abort.current=null;}
  };
  return <dialog className="world-scenes-dialog" ref={dialog} onCancel={e=>{e.preventDefault();onClose();}}>
    <header><div><h2>World scenes</h2><p>{campaign.world?.name??'Your world'} · {manifest?.locations.length??0} accepted locations</p></div><button aria-label="Close world scenes" onClick={onClose}>Close</button></header>
    <label>Find a scene<input autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, biome or purpose"/></label>
    <button disabled={!!busy||!manifest} onClick={()=>void jump()}>Open travel view</button>
    <div className="world-scene-list">{entries.filter(e=>`${e.name} ${e.location?.biome??''} ${e.request?.purpose??''}`.toLowerCase().includes(query.toLowerCase())).map(({id,name,location,request})=>{
      const current=!!location&&campaign.map.locationId===id&&campaign.map.journey?.level!=='travel';
      const cached=campaign.scenes?.some(s=>s.map.locationId===id&&!s.map.sharedCacheOmitted&&s.map.world?.sharedWorld?.revision===manifest?.revision&&!!manifest&&sharedSceneMatchesLayout(s.map,manifest));
      const connections=manifest?.transport.filter(e=>e.from===id||e.to===id)??[];
      return <article key={id}><div><h3>{name}</h3><small>{current?'Current scene':location?cached?'Ready to open':'Accepted · details build on first visit':request?.status==='failed'?'Needs attention':'Planning'}</small></div>
        <p>{request?.purpose??request?.description}</p>
        {location&&<p>{location.biome.replaceAll('-',' ')} · {location.settlement.buildings.length} buildings · elevation {Math.round(location.position.y)} m</p>}
        {connections.length>0&&<ul>{connections.map(edge=><li key={edge.id}>{edge.mode==='ferry'?'Ferry':'Road'} to {manifest?.locations.find(l=>l.id===(edge.from===id?edge.to:edge.from))?.name??'connected location'} · {(edge.length/1000).toFixed(1)} km{edge.bridges.length?` · ${edge.bridges.length} bridge(s)`:''}</li>)}</ul>}
        <button disabled={!!busy||!location||current} onClick={()=>void jump(id)}>{busy===id?'Preparing scene…':current?'You are here':location?'Open scene':'Awaiting accepted geography'}</button>
      </article>;
    })}</div>
    {!entries.length&&<p>Generate a connected world to plan gameplay locations here.</p>}
    {busy&&<p role="status">Preparing shared geography. Your current scene stays available. <button onClick={()=>abort.current?.abort()}>Cancel</button></p>}
    {error&&<p role="alert">{error}</p>}
  </dialog>;
}
