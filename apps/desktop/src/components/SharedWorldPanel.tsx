import {useEffect,useState} from 'react';
import {useCampaignStore} from '../state/campaignStore';
import {useWorldGeneration,restoreWorldGeneration,editPendingScene,cancelWorldGeneration,resumeWorldGeneration,generateWorld,worldFromBlueprint,rebuildCurrentSettlement} from '../state/worldGeneration';
import {createFallbackWorldBlueprints} from '../domain/worldForge';

export function SharedWorldPanel(){
  const pending=useWorldGeneration(),campaign=useCampaignStore(s=>s.campaign),[description,setDescription]=useState(''),[error,setError]=useState('');
  useEffect(()=>{void restoreWorldGeneration().catch(e=>setError(String(e)));},[]);
  const run=(task:Promise<unknown>)=>{setError('');void task.catch(e=>setError(String(e)));};
  const add=()=>{if(!description.trim())return;const [bp]=createFallbackWorldBlueprints({description,kind:'auto',size:'large',gridShape:'square',seed:Date.now()%2147483647,background:'none'});run(generateWorld(worldFromBlueprint(bp)));};
  const active=pending?.campaignId===campaign.id&&pending.status!=='complete';
  return <section className="world-locations shared-world-panel" aria-label="Connected world generation">
    <strong>Connected world</strong>
    {active?<><p role="status">{pending.stage}</p>{pending.requests.map(r=><label key={r.id}>{r.name}<textarea aria-label={`${r.name} requirements`} disabled={pending.world.manifest?.locations.some(l=>l.id===r.id)} defaultValue={r.description} onBlur={e=>{if(e.target.value!==r.description)editPendingScene(r.id,e.target.value);}}/><small>{r.status}</small></label>)}{pending.error&&<p role="alert">{pending.error}</p>}{pending.status==='running'?<button onClick={cancelWorldGeneration}>Pause generation</button>:<button onClick={()=>run(resumeWorldGeneration())}>Resume generation</button>}</>:<>
      <label>{campaign.world?.manifest?'Add a scene to this world':'Create a connected world'}<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="An island harbor town with a ferry to the mainland"/></label>
      <button disabled={!description.trim()} onClick={add}>{campaign.world?.manifest?'Generate connected scene':'Generate world'}</button>
      {campaign.world?.manifest&&campaign.map.locationId&&<><button onClick={()=>run(rebuildCurrentSettlement())}>Rebuild this settlement</button><small>Creates a new layout on the same land. The previous scene is retained.</small></>}
      {campaign.world&&<button onClick={()=>{const world=structuredClone(campaign.world!);world.id=crypto.randomUUID();delete world.manifest;run(generateWorld(world));}}>Rebuild geography as a separate world</button>}
      {campaign.world?.manifest&&<small>{campaign.world.manifest.locations.length} locations · {campaign.world.manifest.transport.length} connections · shared geography</small>}
    </>}{error&&<p role="alert">{error}</p>}
  </section>;
}


