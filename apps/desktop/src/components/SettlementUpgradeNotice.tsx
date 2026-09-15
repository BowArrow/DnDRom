import {useState} from 'react';
import {useCampaignStore} from '../state/campaignStore';
import {enterWorldLocation,rebuildCurrentSettlement} from '../state/worldGeneration';
import {sharedSceneMatchesLayout} from '../domain/sharedSceneLayout';

export function SettlementUpgradeNotice(){
 const campaign=useCampaignStore(s=>s.campaign),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const map=campaign.map,m=campaign.world?.manifest,location=m?.locations.find(l=>l.id===map.locationId);
 if(!m||!location?.settlement.buildings.length||map.journey?.level==='travel'||map.world?.environment?.stratum==='underground')return null;
 const legacy=location.settlement.version!==2,stale=!sharedSceneMatchesLayout(map,m);
 if(!legacy&&!stale)return null;
 const upgrade=async()=>{if(busy)return;setBusy(true);setError('');try{if(legacy)await rebuildCurrentSettlement();else await enterWorldLocation(location.id);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <aside className="settlement-upgrade-notice" aria-label="Town layout update">
  <div><strong>{legacy?'This saved town still uses the earlier layout':'This scene contains an older town layout'}</strong><p>{legacy?'Upgrade to terrain-following streets and varied buildings. Your previous scene is retained.':'Open the current town to load its accepted streets and buildings.'}</p>{error&&<p role="alert">{error}</p>}</div>
  <button disabled={busy} onClick={()=>void upgrade()}>{busy?'Preparing town…':legacy?'Upgrade town layout':'Open current town'}</button>
 </aside>;
}
