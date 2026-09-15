import {spawn} from 'node:child_process';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import assert from 'node:assert/strict';import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.join(root,'artifacts/workspace-0313');await mkdir(profile,{recursive:true});
const app=spawn(path.join(root,'artifacts/unreal-package/Windows/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1280','-ResY=800','-WinX=-20000','-WinY=-20000','-cefdebug=9343','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let c;const results=[];
try{
 for(let i=0;i<90&&!c;i++){try{c=await connectNative(9343);}catch{await pause(1000);}}assert(c);await pause(4000);
 const native=(method,params={})=>c.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
 const shot=async name=>{await native('app.capture');await pause(1000);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,name+'.png'));};
 const tab=async label=>{await c.evaluate(`(()=>{const b=[...document.querySelectorAll('header button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing workspace');b.click();})()`);await pause(1800);};
 await tab('Build');const assets=await c.evaluate(`(()=>{const g=document.querySelector('.asset-grid'),r=g.getBoundingClientRect();return {height:r.height,cards:g.querySelectorAll('button').length,viewport:innerHeight,bottom:r.bottom};})()`);assert(assets.height>200);assert(assets.cards>10);assert(assets.bottom<=assets.viewport);results.push({assets});await shot('build-assets');
 await c.evaluate("document.querySelector('.palette-create-button').click()");await pause(200);const create=await c.evaluate("(()=>{const d=document.querySelector('.palette-create-dialog'),r=d.getBoundingClientRect();return {buttons:d.querySelectorAll('button').length,visible:r.top>=0&&r.bottom<=innerHeight,text:d.innerText};})()");assert.equal(create.buttons,5);assert(create.visible);await shot('create-dialog');
 await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pause(100);assert(await c.evaluate("!document.querySelector('.palette-create-dialog')"));results.push({create});
 for(const label of ['World','Environment','Assets']){await c.evaluate(`document.querySelector('#build-tab-${label.toLowerCase()}').click()`);await pause(100);assert(await c.evaluate(`document.querySelector('#build-tab-${label.toLowerCase()}').getAttribute('aria-selected')==='true'`));}await shot('assets-return');
 for(const label of ['Play','Scene','Prop','Character','Dice']){await tab(label);await shot(label.toLowerCase());results.push({workspace:label,width:await c.evaluate('document.body.scrollWidth'),viewport:await c.evaluate('innerWidth')});}
 await tab('Build');await c.evaluate("document.querySelector('.palette-create-button').click()");await c.evaluate("[...document.querySelectorAll('.palette-create-dialog button')].find(b=>b.innerText.includes('Character')).click()");await pause(1500);assert(await c.evaluate("!!document.querySelector('[aria-label=\"Character Forge\"]')"));
 await writeFile(path.join(profile,'report.json'),JSON.stringify(results,null,2));
}finally{c?.close();const closer=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(app.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>closer.on('exit',r));for(let i=0;i<100&&app.exitCode===null;i++)await pause(100);if(app.exitCode===null)app.kill();}
