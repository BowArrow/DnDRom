import { spawn } from 'node:child_process';
import { cp,link,mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
const root=process.cwd(), profile=await mkdtemp(path.join(os.tmpdir(),'dndrom-journey-')),port=9347;
const source=path.join(process.env.LOCALAPPDATA,'ai.dndrom.desktop/runtime/language-b10516'),target=path.join(profile,'ai.dndrom.desktop/runtime/language-b10516');
await mkdir(target,{recursive:true});await cp(path.join(source,'bin'),path.join(target,'bin'),{recursive:true});
for(const shard of ['qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf','qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf'])await link(path.join(source,shard),path.join(target,shard));
const child=spawn(path.join(root,'target/release/dndrom-desktop.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,LOCALAPPDATA:profile,APPDATA:profile,DNDROM_SKIP_RUNTIME_BOOTSTRAP:'1',WEBVIEW2_USER_DATA_FOLDER:path.join(profile,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+port}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
 let page;for(let i=0;i<100&&!page;i++){try{page=(await(await fetch('http://127.0.0.1:'+port+'/json')).json()).find(p=>p.type==='page');}catch{}if(!page)await delay(200);}
 if(!page)throw Error('Native window did not start');socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let id=0;const pending=new Map(),errors=[];
 socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Timeout '+method));},240000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.exception?.value??JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const waitFor=async expression=>{for(let i=0;i<180;i++){if(await evaluate(expression))return;await delay(500);}throw Error('Condition timed out '+expression);};
 await call('Runtime.enable');await call('Page.enable');await delay(5000);
 const runtime=await evaluate("window.__TAURI_INTERNALS__.invoke('ensure_local_runtime',{feature:'languageModel',vramReserveGb:2})");console.log('Managed runtime '+JSON.stringify(runtime));
 const answer=await evaluate("(async()=>{const r=await fetch('http://127.0.0.1:8190/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'dndrom-director',messages:[{role:'user',content:'Return JSON with ready set to true.'}],max_tokens:40,temperature:0,response_format:{type:'json_object'}})});return await r.json()})()");
 if(!answer.choices?.[0]?.message?.content?.includes('true'))throw Error('Managed model did not respond');console.log('App-owned inference passed');
 await call('Page.navigate',{url:'http://127.0.0.1:1420'});await delay(5000);
 await evaluate(`(async()=>{const source=await(await fetch('/src/App.tsx')).text();const spec=source.match(/from\\s+["']([^"']*campaignStore[^"']*)["']/)?.[1];const {useCampaignStore}=await import(spec);globalThis.__store=useCampaignStore;const fixture=await(await fetch('/@fs/${root.replaceAll('\\','/')}/artifacts/travel-world.json')).json();const s=__store.getState();__store.setState({campaign:{...s.campaign,settings:{...s.campaign.settings,localAiRuntime:'disabled'},world:fixture.world,map:fixture.map,scenes:[],activeSceneId:undefined}})})()`);
 await waitFor("document.querySelector('canvas')?.dataset.worldHorizon === 'regional-ridges-and-story-locations'");await delay(5000);console.log('Travel world rendered');
 await evaluate(`(async()=>{const source=await(await fetch('/src/components/SceneViewport.tsx')).text();const spec=source.match(/from\\s+["']([^"']*playcanvas[^"']*)["']/)?.[1];const pc=await import(spec);globalThis.__app=pc.Application.getApplication();const camera=__app.root.findComponents('camera')[0].entity;camera.setPosition(0,18,115);camera.lookAt(0,22,-180)})()`);
 await delay(1000);await writeFile(path.join(root,'artifacts/travel-horizon.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const choose="(()=>{const s=document.querySelector('[aria-label=\"World travel\"] select');s.value='hollow';s.dispatchEvent(new Event('change',{bubbles:true}))})()";
 await evaluate(choose);await waitFor("__store.getState().campaign.map.journey?.level === 'settlement'");await waitFor("__store.getState().campaign.map.journey?.interiors?.length > 0");
 await evaluate("(()=>{const s=__store.getState();s.selectEntity(s.campaign.map.journey.interiors[0].entityId)})()");await delay(700);
 await evaluate("(()=>{const b=[...document.querySelectorAll('[aria-label=\"World travel\"] button')].find(b=>b.textContent.startsWith('Enter ')&&!b.textContent.includes('selected'));if(!b)throw Error('Building entry missing');b.click()})()");
 await waitFor("Boolean(__store.getState().campaign.map.journey?.activeBuildingId)");await delay(2000);
 await writeFile(path.join(root,'artifacts/settlement-interior.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const inspect="({id:__store.getState().campaign.map.id,building:__store.getState().campaign.map.journey.activeBuildingId})",settlement=await evaluate(inspect);
 await evaluate("[...document.querySelectorAll('[aria-label=\"World travel\"] button')].find(b=>b.textContent.includes('Return to travel')).click()");await waitFor("__store.getState().campaign.map.journey?.level === 'travel'");await evaluate(choose);await waitFor("__store.getState().campaign.map.journey?.level === 'settlement'");
 if(JSON.stringify(settlement)!==JSON.stringify(await evaluate(inspect)))throw Error('Settlement changed on return');if(errors.length)throw Error(errors.join('\n'));
 console.log('Travel -> settlement -> building -> travel -> same settlement passed');
}finally{socket?.close();child.kill();await delay(1000);console.log('Review profile '+profile);}

