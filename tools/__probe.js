'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const url = require('url');
const APP = path.join(__dirname, '..', 'index.html');
const CANDIDATES = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', path.join(os.homedir(),'AppData','Local','Google','Chrome','Application','chrome.exe')];
const browser = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
const profile = path.join(os.tmpdir(), 'noteapp-probe4-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP { constructor(ws){ this.ws=ws; this.id=0; this.pending=new Map(); ws.addEventListener('message',(ev)=>{const m=JSON.parse(ev.data); if(m.id!=null&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id); this.pending.delete(m.id); m.error?reject(new Error(m.error.message)):resolve(m.result);}}); }
  static async connect(u){ const ws=new WebSocket(u); await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true}); ws.addEventListener('error',()=>rej(new Error('ws error')),{once:true});}); return new CDP(ws); }
  send(m,p={}){ const id=++this.id; this.ws.send(JSON.stringify({id,method:m,params:p})); return new Promise((res,rej)=>this.pending.set(id,{resolve:res,reject:rej})); }
  async evaluate(e){ const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) return 'EXC: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; } }
(async () => {
  const port = 9700 + Math.floor(Math.random()*90);
  const child = spawn(browser, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-extensions',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'about:blank'], { stdio: 'ignore' });
  let cdp=null;
  try {
    let targets=null;
    for (let i=0;i<80&&!targets;i++){ try { const r=await fetch(`http://127.0.0.1:${port}/json/list`); if(r.ok) targets=await r.json(); } catch {} if(!targets) await sleep(250); }
    cdp = await CDP.connect((targets||[]).find((t)=>t.type==='page').webSocketDebuggerUrl);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source: fs.readFileSync(path.join(__dirname,'shot-seed.js'),'utf8')});
    await cdp.send('Page.navigate',{url: url.pathToFileURL(APP).href});
    await sleep(7000);
    console.log('seed result: ' + await cdp.evaluate('window.NoteApp.app.ready().then(function(){ return String(window.__SEED__()); })'));
    await sleep(1500);
    console.log('workspaces: ' + await cdp.evaluate('JSON.stringify(window.NoteApp.db.listWorkspaces().map(function(w){ return w.name; }))'));
    console.log('appWorkspace: ' + await cdp.evaluate('(function(){ var ws = window.NoteApp.app.state.workspaceId; return ws + " | " + JSON.stringify(window.NoteApp.app.state.workspaces.map(function(w){return w.name;})); })()'));
    console.log('tree rows: ' + await cdp.evaluate('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#tree .tree__row"), function(r){ return r.className.split(" ").slice(0,2).join(".") + ":" + (r.querySelector(".tree__label")||{}).textContent; }))'));
    console.log('menu labels: ' + await cdp.evaluate('(function(){ var node = document.querySelector("#tree .tree__row--folder"); if (!node) return "no folder row"; var box = node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(box.left + 60), clientY: Math.round(box.top + 12) })); var m = document.querySelector(".menu:not(.is-hidden)"); return m ? Array.prototype.map.call(m.querySelectorAll(".menu__label"), function(x){return x.textContent;}).join(" / ") : "no menu"; })()'));
  } catch (e) { console.log('PROBE ERROR ' + e.message); }
  finally { try { if (cdp) cdp.ws.send(JSON.stringify({id:999999,method:'Browser.close',params:{}})); } catch {} for(let i=0;i<40&&child.exitCode===null;i++) await sleep(200); if(child.exitCode===null){try{child.kill('SIGKILL');}catch{}} fs.rmSync(profile,{recursive:true,force:true}); }
})();