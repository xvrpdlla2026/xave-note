#!/usr/bin/env node
/**
 * spawner-check.js - acceptance check for the Spawner view.
 *
 *   node tools/spawner-check.js [--keep]
 *
 * Drives the real index.html in a throwaway Chrome profile, exactly like the other tools
 * here: the sample notebook is created through the app's own db API, the view is reached
 * the way a reader reaches it (a click on the top bar button), and a question is sent to
 * the local model for real. It prints one line per assertion and exits non-zero if any
 * of them fails.
 *
 * It answers the two questions a screenshot cannot: does the page reach Ollama from a
 * file: address at all, and does an answer come back with the notebook in it.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const SEED = path.join(__dirname, 'shot-seed.js');
const OUT = path.join(__dirname, 'shots');
const KEEP = process.argv.includes('--keep');
const ANSWER_TIMEOUT_MS = 180000;

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const browser = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

(async () => {
  if (!browser) { console.error('no Chrome or Edge found'); process.exit(2); }
  if (!fs.existsSync(APP)) { console.error('index.html not found, run tools/build.js first'); process.exit(2); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spawner-check-'));
  const port = 9900 + Math.floor(Math.random() * 90);
  // Served over loopback, which is how Spawner is meant to be reached: a page opened from a
  // file: address sends Origin: null and Ollama refuses it without allowing every origin.
  // Two ways in, and they are not the same notebook: IndexedDB is scoped to the address, so a
  // served page starts empty. --file tests the address the notebook normally lives at.
  const useFile = process.argv.includes('--file');
  const servePort = 8300 + Math.floor(Math.random() * 200);
  const server = useFile ? null : spawn(process.execPath, [path.join(__dirname, 'serve.js'), '--port', String(servePort), '--no-open'], { stdio: 'ignore' });
  const appUrl = useFile ? require('url').pathToFileURL(APP).href : 'http://127.0.0.1:' + servePort + '/index.html';
  for (let i = 0; i < 40 && !useFile; i++) {
    try { const res = await fetch('http://127.0.0.1:' + servePort + '/index.html'); if (res.ok) break; } catch { /* starting */ }
    await sleep(150);
  }
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  let failed = false;
  try {
    let targets = null;
    for (let i = 0; i < 80 && !targets; i++) {
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/json/list');
        if (res.ok) targets = await res.json();
      } catch { /* not up yet */ }
      if (!targets) await sleep(250);
    }
    const page = (targets || []).find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const preload = fs.readFileSync(SEED, 'utf8');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(7000);

    const seeded = await cdp.evaluate('window.NoteApp.app.ready().then(function(){ return window.__SEED__(); })');
    await sleep(800);
    // The seed selects its workspace through the app's own preference, which is read at boot.
    // An older build stored a model name under this key. The locked model must ignore it.
    await cdp.evaluate('localStorage.setItem("noteapp.spawner.settings", JSON.stringify({ model: "qwen3:4b" }))');
    await cdp.send('Page.reload');
    await sleep(7000);

    const button = await cdp.evaluate('(function(){ var b = document.querySelector(\'[data-action="view-spawner"]\'); return b ? b.textContent.trim() : null; })()');
    check('the top bar offers a Spawner view', button === 'Spawner', JSON.stringify(button) + ' seed=' + seeded);

    await cdp.evaluate('document.querySelector(\'[data-action="view-spawner"]\').click()');
    await sleep(600);
    const pane = await cdp.evaluate('!!document.querySelector(".spawner")');
    check('clicking it opens the pane', pane === true);

    const modelState = await cdp.evaluate('(function(){ var s = window.NoteApp.spawner.state; var b = document.querySelectorAll(".spawner__seg-model .spawner__seg-btn"); return { model: s.model, labels: [].map.call(b, function (x) { return x.textContent; }) }; })()');
    check('the model stays on the instruct build, not the thinking one', modelState.model === 'qwen3:4b-instruct-2507-q4_K_M' && modelState.labels.join('|') === 'Best (4B)|Fast (1.5B)', JSON.stringify(modelState));

    // Wait for the index to finish: it is built in the background when the view opens.
    let counts = null;
    for (let i = 0; i < 40; i++) {
      counts = await cdp.evaluate('(function(){ var s = window.NoteApp.spawner.state; return s.index ? { notes: s.index.notes, chunks: s.index.count, files: s.index.files } : null; })()');
      if (counts && counts.chunks > 0) break;
      await sleep(300);
    }
    check('every note in the workspace is indexed', !!counts && counts.notes >= 3, JSON.stringify(counts));

    const status = await cdp.evaluate('(function(){ var s = document.querySelector(".spawner__status"); return s ? s.textContent.trim() : null; })()');
    check('the pane states what it read', /^Read: \d+ note/.test(String(status)), status);

    const shape = await cdp.evaluate('(function(){ var c = window.NoteApp.spawner.state.index.chunks; return { bodies: c.filter(function(x){ return x.text.length > 200; }).length, longest: Math.max.apply(null, c.map(function(x){ return x.text.length; })), lens: c.map(function(x){ return x.title + ":" + x.text.length; }) }; })()');
    check('note bodies, not just titles, are in the index', shape.bodies > 0, JSON.stringify({ bodies: shape.bodies, longest: shape.longest, first: shape.lens.slice(0, 12) }));

    const hit = await cdp.evaluate('(function(){ var r = window.NoteApp.spawner.__retrieve("clients invoice"); return { n: r.chunks.length, titles: r.chunks.slice(0,3).map(function(c){ return c.title; }) }; })()');
    check('retrieval finds the passages that carry the words', hit && hit.n > 0, JSON.stringify(hit));

    const warmState = await cdp.evaluate('(function(){ var s = window.NoteApp.spawner.state; return { warming: !!s.warming, ready: !!s.modelReady, error: s.warmError || "" }; })()');
    check('opening the pane starts loading the model', !!(warmState.warming || warmState.ready), JSON.stringify(warmState));

    // A real answer, through the real UI. The depth is cut down so the check stays quick:
    // the point is the round trip, not the essay.
    const question = 'In one short sentence, what do my notes say about the clients folder?';
    await cdp.evaluate('(function(){ window.NoteApp.spawner.state.maxTokens = 40; var t = document.querySelector(".spawner__ask"); t.value = ' + JSON.stringify(question) + '; t.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await sleep(200);
    await cdp.evaluate('document.querySelector(".spawner__composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))');

    // A cold model leaves the bubble holding a live waiting line for a while. Photograph it,
    // so "still loading" and "nothing happened" can be told apart.
    await sleep(6000);
    const shotWait = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'spawner-waiting.png'), Buffer.from(shotWait.data, 'base64'));

    let answer = null;
    const deadline = Date.now() + ANSWER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      answer = await cdp.evaluate('(function(){ var n = document.querySelectorAll(".spawner__msg.is-bot .spawner__text"); var last = n[n.length-1]; var s = window.NoteApp.spawner.state; var m = s.messages[s.messages.length-1]; return { text: last ? last.textContent : "", error: m && m.error ? m.error : "", stats: m && m.stats ? m.stats : "", busy: s.busy }; })()');
      if (answer && (answer.error || (!answer.busy && answer.text))) break;
      await sleep(2000);
    }
    check('the local model answers from the notebook', !!answer && !!answer.text && !answer.error, answer ? (answer.error || answer.text.slice(0, 200)) : 'no answer');
    // Switching model must stick, and only a listed build may be picked.
    const picked = await cdp.evaluate('(function(){ var b = document.querySelectorAll(".spawner__seg-model .spawner__seg-btn"); for (var i = 0; i < b.length; i++) { if (b[i].textContent === "Fast (1.5B)") b[i].click(); } return window.NoteApp.spawner.state.model; })()');
    check('the fast model can be picked', picked === 'qwen2.5:1.5b-instruct-q4_K_M', JSON.stringify(picked));
    const storedPick = await cdp.evaluate('JSON.parse(localStorage.getItem("noteapp.spawner.settings")).model');
    check('the choice is remembered', storedPick === 'qwen2.5:1.5b-instruct-q4_K_M', JSON.stringify(storedPick));
    const back = await cdp.evaluate('(function(){ var b = document.querySelectorAll(".spawner__seg-model .spawner__seg-btn"); for (var i = 0; i < b.length; i++) { if (b[i].textContent === "Best (4B)") b[i].click(); } return window.NoteApp.spawner.state.model; })()');
    check('and it can be switched back', back === 'qwen3:4b-instruct-2507-q4_K_M', JSON.stringify(back));
    console.log('  answer: ' + JSON.stringify(answer && answer.text));
    console.log('  stats:  ' + JSON.stringify(answer && answer.stats));

    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'spawner.png'), Buffer.from(shot.data, 'base64'));
    console.log('  wrote tools/shots/spawner.png');

    failed = results.some((r) => !r.ok);
  } catch (error) {
    console.error('  FAIL harness: ' + (error && error.message));
    failed = true;
  } finally {
    if (cdp) { try { await cdp.send('Browser.close'); } catch { /* already gone */ } }
    child.kill();
    try { if (server) server.kill(); } catch { /* already gone */ }
    await sleep(400);
    if (!KEEP) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked, harmless */ } }
  }
  console.log('=== ' + (failed ? 'FAIL' : 'PASS') + ' ===');
  process.exit(failed ? 1 : 0);
})();
