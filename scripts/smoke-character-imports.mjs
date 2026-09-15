import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),archive=path.resolve(process.argv[2]??'artifacts/unreal-package/Windows'),profile=path.resolve(process.argv[3]??'artifacts/character-039'),port=9341;
await mkdir(profile,{recursive:true});
// A small, local PDF form exercises the actual bundled PDF module worker.
const objects=['<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [4 0 R] >>','<< /Type /Annot /Subtype /Widget /FT /Tx /T (CharacterName) /V (Rowan Test Ranger) /Rect [10 700 250 730] /P 3 0 R >>'];
let pdf='%PDF-1.4\n',offsets=[0];for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdfFile=path.join(profile,'character-sheet.pdf'),drawing=path.join(profile,'character-drawing.png');await writeFile(pdfFile,pdf);await copyFile(path.join(root,'apps/desktop/src-tauri/icons/128x128.png'),drawing);
const run=(file,args)=>new Promise((resolve,reject)=>{const p=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('exit',code=>code===0?resolve(out):reject(Error(out)));});
const app=spawn(path.join(archive,'DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1600','-ResY=1000','-WinX=-20000','-WinY=-20000',`-cefdebug=${port}`,'-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let c;const checks={};
const wait=async(fn,label)=>{for(let i=0;i<120;i++){if(await fn())return;await pause(500);}throw Error('Timed out: '+label);};
const heartbeat=setInterval(()=>console.log('Checking character drawing, PDF selection and sidebar layout.'),30000);
try{
 await wait(async()=>{try{c??=await connectNative(port);return await c.evaluate("!!window.ue?.dndrom && !!document.querySelector('.native-scene-viewport')");}catch{return false;}},'startup');
 await c.evaluate("window.importTestMessages=[];new MutationObserver(()=>{for(const e of document.querySelectorAll('[role=alert],.toast'))if(e.textContent&&!window.importTestMessages.includes(e.textContent))window.importTestMessages.push(e.textContent);}).observe(document.body,{childList:true,subtree:true});for(const name of ['warn','error']){const original=console[name];console[name]=(...args)=>{window.importTestMessages.push(args.map(String).join(' '));original(...args);};}");
 const native=(method,params={})=>c.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
 const capture=async(name)=>{await native('app.capture');await pause(1200);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,name+'.png'));};
 const click=async(selector)=>{const r=await c.evaluate(`(()=>{const e=${selector};if(!e)throw Error('Missing button');e.scrollIntoView({block:'center'});return e.getBoundingClientRect().toJSON();})()`);await c.call('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});};
 const dialog=async(action,file)=>run('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/native-file-dialog.ps1'),'-AppProcessId',String(app.pid),'-Action',action,...(file?['-FilePath',file]:[])]);
 await click("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Character')");await wait(()=>c.evaluate("!!document.querySelector('.token-dropzone')"),'Character studio');
 await click("document.querySelector('.token-dropzone')");console.log(await dialog('cancel'));checks.cancelDrawingDialog=true;
 await click("document.querySelector('.token-dropzone')");console.log(await dialog('select',drawing));await wait(()=>c.evaluate("document.querySelector('.token-dropzone strong')?.textContent==='character-drawing.png'&&document.querySelector('.token-dropzone img')?.naturalWidth>0"),'drawing preview');checks.nativeDrawingPickerAndPreview=true;
 await click("[...document.querySelectorAll('.sheet-attachment-box button')].find(b=>b.textContent.includes('Import PDF/JSON'))");console.log(await dialog('select',pdfFile));await wait(()=>c.evaluate("document.querySelector('.inline-sheet-review')?.textContent.includes('Rowan Test Ranger')"),'PDF review');checks.nativePdfPickerAndWorker=true;
 await click("[...document.querySelectorAll('.inline-sheet-review button')].find(b=>b.textContent.includes('Accept & attach'))");await wait(()=>c.evaluate("document.querySelector('.sheet-attachment-box select')?.selectedOptions[0]?.textContent.includes('Rowan Test Ranger')"),'sheet attachment');checks.attachReviewedPdf=true;
 const layout=[];for(const width of [300,240]){const boxes=await c.evaluate(`(()=>{const e=document.querySelector('.mesh-target-field');e.style.width='${width}px';e.scrollIntoView({block:'center'});return [...e.children].map(c=>({tag:c.tagName,...c.getBoundingClientRect().toJSON()}));})()`);for(let i=1;i<boxes.length;i++)assert(boxes[i].top>=boxes[i-1].bottom,JSON.stringify(boxes));layout.push({width,boxes});}checks.noMeshTargetOverlap=true;
 await c.evaluate("document.querySelector('.mesh-target-field').style.width='';document.querySelector('.mesh-target-field').scrollIntoView({block:'center'})");
 console.log(await dialog('apostrophe'));await pause(500);await capture('character-imported');
 const logs=await readFile(path.join(profile,'runtime.log'),'utf8');assert(!/FileDialogs are prevented|Fatal error:|Unhandled Exception:|Ensure condition failed:/.test(logs));checks.noDialogBlockOrNativeErrors=true;
 await writeFile(path.join(profile,'report.json'),JSON.stringify({checks,layout},null,2));console.log(checks);
}catch(error){if(c){await writeFile(path.join(profile,'error.json'),JSON.stringify({error:String(error),messages:await c.evaluate('window.importTestMessages'),ui:await c.evaluate('document.body.innerText')},null,2));}throw error;}finally{clearInterval(heartbeat);c?.close();await run('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(app.pid)]);for(let i=0;i<150&&app.exitCode===null;i++)await pause(100);if(app.exitCode===null)app.kill();}
