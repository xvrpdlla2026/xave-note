#!/usr/bin/env node
/**
 * browser-check.js — headless-Chromium harness driving the DevTools Protocol.
 *
 * Exists because `--dump-dom` tears the page down as soon as virtual time expires, which
 * kills async work (WASM init, IndexedDB) mid-flight and produces misleading results.
 * Driving real CDP with a real event loop is the only way to get trustworthy answers.
 *
 * Usage:
 *   node tools/browser-check.js <url> [options]
 *
 * Options:
 *   --wait-ms=6000              settle time after navigation
 *   --eval="<expr>"             expression to evaluate (awaited if it is a promise)
 *   --script=<file.js>          use a file's contents as the eval expression
 *   --preload=<file.js>         inject a local script into every new document
 *   --profile=<dir>             user-data-dir to reuse (omit for a throwaway)
 *   --idb-dump=<file.db>        write the persisted snapshot out of IndexedDB
 *   --export-dump=<file.db>     write the live in-memory database
 *   --reload                    re-navigate in the same session and eval again
 *   --restart                   close the browser, relaunch on the same profile, eval again
 *   --keep-profile              do not delete the profile afterwards (for inspection)
 *   --shot=<file.png>           write a screenshot after the eval runs
 *   --shot-clip=<selector>      clip that screenshot to one element (plus a 10px margin)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
if (!url) {
  console.error('usage: node tools/browser-check.js <url> [--eval="expr"] [--preload=file]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const waitMs = Number(opt('wait-ms', 6000));
const scriptFile = opt('script', '');
const preload = opt('preload', '');
const dumpPath = opt('idb-dump', '');
const exportPath = opt('export-dump', '');
const keepProfile = argv.includes('--keep-profile');
const shotPath = opt('shot', '');
const shotClip = opt('shot-clip', '');
const throwawayProfile = path.join(os.tmpdir(), 'dsh-cdp-profile-' + process.pid);
const profileDir = opt('profile', throwawayProfile);

let evalExpr = opt('eval', "document.getElementById('marker') ? document.getElementById('marker').textContent : null");
if (scriptFile) evalExpr = fs.readFileSync(scriptFile, 'utf8');
const eval2Expr = opt('eval2', ''); // expression for session 2 of a --restart run

// ------------------------------------------------- which browser to use
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const browser = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!browser) {
  console.error('no Chromium browser found in the usual Windows locations');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(u, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up: ' + u);
}

// Minimal CDP client over the built-in WebSocket (Node 22+).
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
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
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /**
   * Report the app's localStorage footprint. Used to detect the localStorage fallback path,
   * which is invisible in an IndexedDB dump and would otherwise look like total data loss.
   */
  async localStorageReport() {
    const r = await this.send('Runtime.evaluate', {
      expression: `(function(){
        var keys = [];
        var total = 0;
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          var v = localStorage.getItem(k) || '';
          total += k.length + v.length;
          keys.push({ key: k, chars: v.length });
        }
        return { keys: keys, totalChars: total };
      })()`,
      returnByValue: true,
    });
    return r.result?.value || { keys: [], totalChars: 0 };
  }

  /** Read the persisted SQLite snapshot out of the page's IndexedDB. */
  async idbDump() {
    const r = await this.send('Runtime.evaluate', {
      expression: `(function(){
        return new Promise(function(resolve){
          var req = indexedDB.open('note-app', 1);
          req.onupgradeneeded = function(){ req.result.createObjectStore('kv'); };
          req.onerror = function(){ resolve('ERR open ' + (req.error && req.error.message)); };
          req.onsuccess = function(){
            var get = req.result.transaction('kv','readonly').objectStore('kv').get('sqlite-snapshot-v1');
            get.onsuccess = function(){
              var v = get.result;
              if (!v) { resolve('EMPTY'); return; }
              var b = v instanceof Uint8Array ? v : new Uint8Array(v);
              window.__DUMP_BYTES__ = b;
              window.__DUMP_TAG__ = 'from-page-memory';
              var s = '';
              for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + 0x8000, b.length)));
              resolve('DUMP:' + btoa(s));
            };
            get.onerror = function(){ resolve('ERR get ' + (get.error && get.error.message)); };
          };
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    return String(r.result?.value || '');
  }

  /**
   * Read the snapshot by re-encoding it in the page in fixed-size chunks and pulling the
   * chunks out one at a time. Used to cross-check idbDump().
   */
  async idbDumpChunked() {
    const meta = await this.send('Runtime.evaluate', {
      expression: `(function(){
        return new Promise(function(resolve){
          var req = indexedDB.open('note-app', 1);
          req.onupgradeneeded = function(){ req.result.createObjectStore('kv'); };
          req.onsuccess = function(){
            var get = req.result.transaction('kv','readonly').objectStore('kv').get('sqlite-snapshot-v1');
            get.onsuccess = function(){
              var v = get.result;
              if (!v) { resolve({ ok: false, reason: 'empty' }); return; }
              var b = v instanceof Uint8Array ? v : new Uint8Array(v);
              window.__DUMP_BYTES__ = b;
              resolve({ ok: true, length: b.length });
            };
          };
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const info = meta.result?.value;
    if (!info || !info.ok) return { ok: false, info };

    const CHUNK = 0x8000;
    const pieces = [];
    for (let offset = 0; offset < info.length; offset += CHUNK) {
      const piece = await this.send('Runtime.evaluate', {
        expression: `(function(){
          var s = '';
          var b = window.__DUMP_BYTES__;
          for (var i = ${offset}; i < Math.min(${offset + CHUNK}, b.length); i++) s += String.fromCharCode(b[i]);
          return btoa(s);
        })()`,
        returnByValue: true,
      });
      pieces.push(Buffer.from(String(piece.result?.value || ''), 'base64'));
    }
    return { ok: true, bytes: Buffer.concat(pieces) };
  }
}

const logs = [];
let sessionNumber = 0;

/** Spawn a browser, connect, navigate, run the eval expression, and shut down cleanly. */
async function withBrowser(fn) {
  const port = 9000 + (process.pid % 1000) + Math.floor(Math.random() * 200);
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate,OptimizationHints',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');

    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    cdp.on('Runtime.consoleAPICalled', (p) => {
      logs.push(`[console.${p.type}] ` + p.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      logs.push('[pageerror] ' + (d.exception?.description || d.text));
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry && (p.entry.level === 'error' || p.entry.level === 'warning')) logs.push(`[log.${p.entry.level}] ${p.entry.text}`);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    // --preload injects driver code while the page itself stays a plain file:// document.
    // It runs on EVERY new document, so the injected code must be session-aware.
    if (preload) {
      const source = fs.readFileSync(preload, 'utf8');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__HARNESS_SESSION__ = ${sessionNumber};\n` + source,
      });
    }

    await cdp.send('Page.navigate', { url });
    await sleep(waitMs);
    return await fn(cdp);
  } finally {
    // Shut down gracefully: a hard kill can lose IndexedDB commits that are committed but
    // not yet flushed, which would look like a persistence bug in the app.
    try {
      if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close', params: {} }));
    } catch { /* socket gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      await sleep(600);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await sleep(500); // let the OS settle before the next browser opens this profile
  }
}

/** Export the page's live in-memory database to disk (the "Export .db" path). */
async function writeExportDump(cdp, target) {
  const live = await cdp.send('Runtime.evaluate', {
    expression: `window.NoteApp.db.exportSnapshot().then(function (b) {
      var s = '';
      for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + 0x8000, b.length)));
      return 'DUMP:' + btoa(s);
    }, function (e) { return 'ERR ' + e.message; })`,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = String(live.result?.value || '');
  if (!value.startsWith('DUMP:')) {
    console.log(`--- live export unavailable: ${value} ---`);
    return;
  }
  const bytes = Buffer.from(value.slice(5), 'base64');
  fs.writeFileSync(target, bytes);
  console.log(`--- live in-memory export: ${target} (${bytes.length} bytes) ---`);
}

async function evaluate(cdp, expr) {
  const res = await cdp.send('Runtime.evaluate', { expression: expr || evalExpr, awaitPromise: true, returnByValue: true });
  return res;
}

// ---------------------------------------------------------------- main
(async () => {
  let exitCode = 0;
  try {
    sessionNumber = 1;
    await withBrowser(async (cdp) => {
      console.log('--- session 1 ---');
      if (argv.includes('--reload')) {
        const first = await evaluate(cdp);
        console.log('first eval:', JSON.stringify(first.result?.value ?? null));
        await cdp.send('Page.reload', { ignoreCache: false });
        await sleep(waitMs);
        console.log('after reload:');
      }

      if (exportPath && !argv.includes('--restart')) await writeExportDump(cdp, exportPath);

      if (dumpPath) {
        // Chunked read: re-encodes the blob in the page and pulls it out piece by piece.
        const chunked = await cdp.idbDumpChunked();
        if (chunked.ok) {
          fs.writeFileSync(dumpPath, chunked.bytes);
          console.log(`--- persisted snapshot: ${dumpPath} (${chunked.bytes.length} bytes) ---`);
        } else {
          console.log(`--- persisted snapshot unavailable: ${JSON.stringify(chunked.info)} ---`);
        }
      }

      if (argv.includes('--ls-report')) {
        const report = await cdp.localStorageReport();
        console.log('--- localStorage ---');
        console.log(JSON.stringify(report, null, 1));
      }

      const res = await evaluate(cdp, evalExpr);
      printLogs();
      console.log('--- eval result ---');
      console.log(JSON.stringify(res.result?.value ?? res.result?.description ?? null, null, 2));
      if (res.exceptionDetails) {
        console.log('--- eval exception ---');
        console.log(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        exitCode = 1;
      }

      if (shotPath) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: 1280, height: 820, deviceScaleFactor: 2, mobile: false,
        });
        await sleep(300);
        let clip;
        if (shotClip) {
          const box = await evaluate(cdp, `(function () {
            var n = document.querySelector(${JSON.stringify(shotClip)});
            if (!n) return null;
            var r = n.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          })()`);
          const v = box.result?.value;
          if (v && v.width) {
            clip = { x: Math.max(0, v.x - 10), y: Math.max(0, v.y - 10), width: v.width + 20, height: v.height + 20, scale: 3 };
          }
        }
        const shot = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
        fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
        console.log(`--- screenshot: ${shotPath} ---`);
      }
    });

    // --restart relaunches the browser on the same profile: this is the only way to prove a
    // snapshot is durable rather than merely present in the running process.
    if (argv.includes('--restart')) {
      console.log('\n--- session 2 (browser restarted on the same profile) ---');
      sessionNumber = 2;
      await withBrowser(async (cdp) => {
        const res = await evaluate(cdp, eval2Expr || evalExpr);
        printLogs();
        console.log('--- eval result ---');
        console.log(JSON.stringify(res.result?.value ?? res.result?.description ?? null, null, 2));
        if (res.exceptionDetails) {
          console.log('--- eval exception ---');
          console.log(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
          exitCode = 1;
        }
        // Export after the round has run, so the file reflects what was actually restored.
        if (exportPath) await writeExportDump(cdp, exportPath);
      });
    }
  } catch (err) {
    console.error('HARNESS ERROR:', err.message);
    printLogs();
    exitCode = 1;
  } finally {
    if (!keepProfile) fs.rmSync(profileDir, { recursive: true, force: true });
    else console.log(`profile kept at ${profileDir}`);
  }
  process.exit(exitCode);

  function printLogs() {
    console.log('--- browser logs ---');
    console.log(logs.length ? logs.join('\n') : '(none)');
  }
})();
