'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const url = require('url');
const APP = path.join(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'shots');
const CANDIDATES = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', path.join(os.homedir(),'AppData','Local','Google','Chrome','Application','chrome.exe')];
const browser = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
const profile = path.join(os.tmpdir(), 'noteapp-verify-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP { constructor(ws){ this.ws=ws; this.id=0; this.pending=new Map(); ws.addEventListener('message',(ev)=>{const m=JSON.parse(ev.data); if(m.id!=null&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id); this.pending.delete(m.id); m.error?reject(new Error(m.error.message)):resolve(m.result);}}); }
  static async connect(u){ const ws=new WebSocket(u); await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true}); ws.addEventListener('error',()=>rej(new Error('ws error')),{once:true});}); return new CDP(ws); }
  send(m,p={}){ const id=++this.id; this.ws.send(JSON.stringify({id,method:m,params:p})); return new Promise((res,rej)=>this.pending.set(id,{resolve:res,reject:rej})); }
  async evaluate(e){ const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) return 'EXC: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; }
  async shot(file){ const r = await this.send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(OUT,file), Buffer.from(r.data,'base64')); }
  async size(w,h){ await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false}); await sleep(350); } }
const TOP = "Array.prototype.filter.call(document.querySelectorAll('dialog[open]'), function(d){ return d.id !== 'settings-dialog'; }).pop()";
const FILL = (v) => "(function(){ var d = " + TOP + "; if(!d) return 'no dialog'; var ins = d.querySelectorAll('input[type=password]'); for (var i=0;i<ins.length;i++){ ins[i].value = " + JSON.stringify(v) + "; ins[i].dispatchEvent(new Event('input',{bubbles:true})); } return 'filled ' + ins.length; })()";
const SUBMIT = "(function(){ var d = " + TOP + "; if(!d) return 'no dialog'; var b = d.querySelector('.dialog__footer button[type=submit]'); if(!b) return 'no submit'; if (b.disabled) return 'disabled'; b.click(); return 'submitted'; })()";
const VS = "(function(){ var A=window.NoteApp; return A.db.vaultState() + '/' + (A.crypto.status?A.crypto.status():'?'); })()";
const BADGE = "(function(){ var f=document.getElementById('workspace-trash'); return JSON.stringify({ hidden: f.hasAttribute('hidden'), badge: (f.querySelector('.trash-fab__badge')||{}).textContent||null }); })()";
const OPEN_TASK = "(function(){ var A=window.NoteApp; var t=A.db.listAllNotes(A.app.state.workspaceId).filter(function(n){return n.title==='Task';})[0]; if(!t) return 'no note'; A.app.state.view='notes'; A.app.state.activeNoteId=t.id; A.app.state.activeFileId=null; A.app.render(); var ta=document.getElementById('note-body'); return ta ? ('text len='+ta.value.length) : ('LOCKED notice='+!!document.querySelector('.lock-notice')); })()";
const LAYOUT = `(function(){
  var main=document.getElementById('main'); var ta=document.getElementById('note-body'); var tb=document.querySelector('.editor__toolbar'); var ed=document.querySelector('.editor');
  if(!ta||!tb) return 'missing editor parts';
  var a=ta.getBoundingClientRect(), b=tb.getBoundingClientRect(), m=main.getBoundingClientRect();
  return JSON.stringify({
    bodyBottom: Math.round(a.bottom), footerTop: Math.round(b.top), footerBottom: Math.round(b.bottom),
    paneBottom: Math.round(m.bottom), bodyOverlapsFooter: a.bottom > b.top + 1,
    footerInsidePane: b.bottom <= m.bottom + 0.5,
    bodyScrolls: ta.scrollHeight > ta.clientHeight + 1,
    paneScrolls: main.scrollHeight > main.clientHeight + 1,
    hasInlineHeight: !!ta.style.height,
    footerPosition: getComputedStyle(tb).position
  });
})()`;

(async () => {
  const port = 9700 + Math.floor(Math.random()*90);
  const child = spawn(browser, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-extensions',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'about:blank'], { stdio: 'ignore' });
  let cdp=null;
  try {
    let targets=null;
    for (let i=0;i<80&&!targets;i++){ try { const r=await fetch(`http://127.0.0.1:${port}/json/list`); if(r.ok) targets=await r.json(); } catch {} if(!targets) await sleep(250); }
    cdp = await CDP.connect((targets||[]).find((t)=>t.type==='page').webSocketDebuggerUrl);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.size(1280,900);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source: fs.readFileSync(path.join(__dirname,'shot-seed.js'),'utf8')});
    await cdp.send('Page.navigate',{url: url.pathToFileURL(APP).href});
    await sleep(7000);
    await cdp.evaluate('window.NoteApp.app.ready().then(function(){ window.__SEED__(); return 1; })');
    await sleep(2500);
    await cdp.evaluate(`(function(){ var A=window.NoteApp; var ws=A.app.state.workspaceId; var text=["Task","","Thanks for your application. We’d like to move you through to the next stage of our recruitment process.","","Technical Assessment","","Build a small module with full CRUD operations backed by a database.","","You can choose the module — bookings, inventory, tasks, expenses, or anything else. We’re assessing your","implementation, not the idea.","","Requirements:","","Laravel backend","MySQL, PostgreSQL, or SQLite database","React or Next.js frontend","Full CRUD functionality","","Time limit: Maximum 4 hours. This is a ceiling, not a target. We are not measuring how much time you","spend.","","AI usage is allowed and expected. You can use Claude, ChatGPT, Copilot, Cursor, or any other AI","development tools you normally use.","","What to Submit","","GitHub repository link","Keep your full commit history.","Short README"].join(String.fromCharCode(10)); return A.db.createNote(ws,null,'Task').then(function(n){ return A.db.updateNote(n.id,'Task',text); }); })()`);
    await sleep(600);

    console.log('== 5. header ==');
    console.log('tasks button: ' + await cdp.evaluate("JSON.stringify({ inHeader: !!document.querySelector('.topbar__actions #topbar-views .view-btn'), sidebarViewsGone: !document.querySelector('.sidebar__views'), label: (document.querySelector('.view-btn__label')||{}).textContent, badge: (document.querySelector('.view-btn .tree__badge')||{}).textContent, aria: (document.querySelector('.view-btn')||{}).getAttribute ? document.querySelector('.view-btn').getAttribute('aria-label') : null })"));
    console.log('click tasks: ' + await cdp.evaluate("(function(){ document.querySelector('.view-btn').click(); return 'clicked'; })()"));
    await sleep(500);
    console.log('tasks pane: ' + await cdp.evaluate("JSON.stringify({ view: window.NoteApp.app.state.view, title: (document.querySelector('#main .pane-head__title')||{}).textContent, active: !!document.querySelector('.view-btn.is-active'), focus: document.activeElement.getAttribute('data-action') })"));
    await cdp.shot('_after-tasks-header.png');
    await cdp.evaluate("(function(){ document.querySelector('.view-btn').click(); return 1; })()");
    await sleep(400);

    console.log('== 4. editor layout ==');
    console.log('open: ' + await cdp.evaluate(OPEN_TASK));
    await sleep(300);
    console.log('layout 1280x900: ' + await cdp.evaluate(LAYOUT));
    await cdp.shot('_after-editor-1280.png');
    await cdp.size(827,873);
    await sleep(400);
    console.log('layout 827x873: ' + await cdp.evaluate(LAYOUT));
    await cdp.shot('_after-editor-827.png');
    console.log('scroll body to end: ' + await cdp.evaluate("(function(){ var ta=document.getElementById('note-body'); ta.scrollTop = ta.scrollHeight; return 'top=' + ta.scrollTop; })()"));
    await sleep(300);
    console.log('layout after scroll: ' + await cdp.evaluate(LAYOUT));
    await cdp.shot('_after-editor-827-scrolled.png');
    await cdp.size(1280,900);

    console.log('== 3. trash badge ==');
    console.log('base: ' + await cdp.evaluate(BADGE));
    console.log('delete a note in ws A: ' + await cdp.evaluate("(function(){ var A=window.NoteApp; var n=A.db.listAllNotes(A.app.state.workspaceId).filter(function(x){return x.title==='Reading list';})[0]; A.app.openNote(n.id); return 'opened'; })()"));
    await sleep(300);
    await cdp.evaluate("document.querySelector('[data-action=delete-note]').click()");
    await sleep(400);
    await cdp.evaluate(SUBMIT);
    await sleep(1200);
    console.log('after delete: ' + await cdp.evaluate(BADGE));
    console.log('add a second workspace: ' + await cdp.evaluate("window.NoteApp.db.createWorkspace('Second').then(function(w){ return w.name; })"));
    await sleep(600);
    console.log('switch to the second workspace: ' + await cdp.evaluate("(function(){ var A=window.NoteApp; var w=A.db.listWorkspaces().filter(function(x){return x.name==='Second';})[0]; A.app.state.workspaceId=w.id; A.app.render(); return w.name; })()"));
    await sleep(500);
    console.log('badge in the empty workspace (want hidden/0): ' + await cdp.evaluate(BADGE));
    console.log('badge in ws A again: ' + await cdp.evaluate("(function(){ var A=window.NoteApp; var w=A.db.listWorkspaces().filter(function(x){return x.name==='Field notes';})[0]; A.app.state.workspaceId=w.id; A.app.render(); return 'switched'; })()"));
    await sleep(500);
    console.log('  -> ' + await cdp.evaluate(BADGE));
    console.log('open trash panel: ' + await cdp.evaluate("(function(){ document.getElementById('workspace-trash').click(); return 'opened'; })()"));
    await sleep(900);
    console.log('panel chips: ' + await cdp.evaluate("JSON.stringify(Array.prototype.map.call(document.querySelectorAll('dialog[open] .segmented__item'), function(i){ return i.textContent.trim(); }))"));
    console.log('restore the first row: ' + await cdp.evaluate("(function(){ var d=document.querySelector('dialog[open]'); var b=Array.prototype.filter.call(d.querySelectorAll('button'), function(x){ return /^restore$/i.test((x.textContent||'').trim()); }); if(!b.length) return 'no restore'; b[0].click(); return 'clicked'; })()"));
    await sleep(2500);
    console.log('panel chips after restore (want All 0): ' + await cdp.evaluate("JSON.stringify(Array.prototype.map.call(document.querySelectorAll('dialog[open] .segmented__item'), function(i){ return i.textContent.trim(); }))"));
    console.log('badge with the panel open (want hidden/0): ' + await cdp.evaluate(BADGE));
    await cdp.evaluate("(function(){ var d=document.querySelector('dialog[open]'); var b=Array.prototype.filter.call(d.querySelectorAll('button'), function(x){ return /back to workspace/i.test(x.textContent||''); }); if(b.length) b[0].click(); return 1; })()");
    await sleep(900);

    console.log('== 1. enabling encryption locks at once ==');
    await cdp.evaluate("document.getElementById('settings-open').click()");
    await sleep(400);
    await cdp.evaluate("document.querySelector('[data-action=vault-enable]').click()");
    await sleep(400);
    console.log('fill: ' + await cdp.evaluate(FILL('password123')));
    console.log('submit: ' + await cdp.evaluate(SUBMIT));
    await sleep(5000);
    console.log('state right after enabling (want locked): ' + await cdp.evaluate(VS));
    console.log('note right after enabling (want LOCKED, no reload): ' + await cdp.evaluate(OPEN_TASK));
    await cdp.shot('_after-enable-locked.png');
    console.log('vault section: ' + await cdp.evaluate("document.getElementById('vault-info').textContent.slice(0,60) + ' || ' + Array.prototype.map.call(document.getElementById('vault-actions').querySelectorAll('button'), function(b){return b.getAttribute('data-action');}).join(',')"));

    console.log('== 2. unlock then reload ==');
    await cdp.evaluate("document.getElementById('settings-open').click()");
    await sleep(400);
    await cdp.evaluate("document.querySelector('[data-action=vault-unlock]').click()");
    await sleep(500);
    console.log('fill: ' + await cdp.evaluate(FILL('password123')));
    console.log('submit: ' + await cdp.evaluate(SUBMIT));
    await sleep(6000);
    console.log('state after unlock (want unlocked): ' + await cdp.evaluate(VS));
    console.log('remembered record: ' + await cdp.evaluate("window.NoteApp.storage.loadVaultKey().then(function(r){ return r ? ('id=' + r.id + ' keyType=' + (r.key && r.key.constructor ? r.key.constructor.name : typeof r.key) + ' extractable=' + (r.key && typeof r.key.extractable === 'boolean' ? r.key.extractable : 'n/a')) : 'none'; })"));
    console.log('session id present: ' + await cdp.evaluate("'sid=' + !!sessionStorage.getItem('noteapp.session.id')"));
    await cdp.send('Page.navigate',{url: url.pathToFileURL(APP).href});
    await sleep(7000);
    console.log('state after reload (want unlocked): ' + await cdp.evaluate("window.NoteApp.app.ready().then(function(){ return " + VS + "; })"));
    console.log('note after reload (want text): ' + await cdp.evaluate(OPEN_TASK));
    await cdp.shot('_after-reload-unlocked.png');
    console.log('lock now: ' + await cdp.evaluate("(function(){ document.getElementById('settings-open').click(); return 'settings'; })()"));
    await sleep(400);
    console.log('  ' + await cdp.evaluate("(function(){ var b=document.querySelector('[data-action=vault-lock]'); if(!b) return 'no lock button'; b.click(); return 'clicked'; })()"));
    await sleep(800);
    console.log('state after lock now: ' + await cdp.evaluate(VS));
    console.log('record after lock (want none): ' + await cdp.evaluate("window.NoteApp.storage.loadVaultKey().then(function(r){ return r ? 'still there' : 'none'; })"));
    await cdp.send('Page.navigate',{url: url.pathToFileURL(APP).href});
    await sleep(7000);
    console.log('state after reload post-lock (want locked): ' + await cdp.evaluate("window.NoteApp.app.ready().then(function(){ return " + VS + "; })"));
  } catch (e) { console.log('PROBE ERROR ' + e.message + '\\n' + (e.stack||'')); }
  finally { try { if (cdp) cdp.ws.send(JSON.stringify({id:999999,method:'Browser.close',params:{}})); } catch {} for(let i=0;i<40&&child.exitCode===null;i++) await sleep(200); if(child.exitCode===null){try{child.kill('SIGKILL');}catch{}} fs.rmSync(profile,{recursive:true,force:true}); }
})();
