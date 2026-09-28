#!/usr/bin/env node
/**
 * shots.js — visual check for the redesigned UI.
 *
 *   node tools/shots.js [--keep]
 *
 * Seeds a throwaway browser profile with realistic notes and folders (through the app's
 * own db API, so the seeded page is exercising the real render path), then captures the
 * states a design review actually needs: tree with nesting open, the note editor, the
 * folder listing, search results, settings, and a narrow viewport — each in light and
 * dark. Writes PNGs to tools/shots/.
 *
 * Nothing here touches the user's database: the profile is temporary and deleted after.
 * Screenshots are written to the workspace, never to IndexedDB.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const OUT = path.join(__dirname, 'shots');

if (!fs.existsSync(APP)) {
  console.error('index.html not found — run `node tools/build.js` first');
  process.exit(2);
}

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const browser = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!browser) {
  console.error('no Chromium browser found');
  process.exit(2);
}

const appUrl = url.pathToFileURL(APP).href;
const profile = path.join(os.tmpdir(), 'noteapp-shots-profile-' + process.pid);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The sample notebook lives beside this file; it defines window.__SEED__. */
const PRELOAD = fs.readFileSync(path.join(__dirname, 'shot-seed.js'), 'utf8');

/** Small CDP client (mirrors tools/browser-check.js). */
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

(async () => {
  const port = 9500 + Math.floor(Math.random() * 400);
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  const notes = [];
  try {
    let targets = null;
    for (let i = 0; i < 60 && !targets; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) targets = await res.json();
      } catch { /* not up yet */ }
      if (!targets) await sleep(250);
    }
    const page = (targets || []).find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');

    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELOAD });
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(6500);

    await cdp.evaluate(`window.NoteApp.app.ready().then(function(){ return window.__SEED__(); })`);
    await sleep(1200);

    /**
     * Set the theme through the app's own path, and assert it took. Headless Chromium
     * reports prefers-color-scheme: dark, so the app boots dark unless told otherwise —
     * which is correct behaviour, but it means every screenshot must state its theme.
     */
    const setTheme = async (theme) => {
      const applied = await cdp.evaluate(`(function(){
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        window.NoteApp.prefs.set('theme', ${JSON.stringify(theme)});
        return document.documentElement.getAttribute('data-theme');
      })()`);
      if (applied !== theme) throw new Error(`theme ${theme} did not apply (got ${applied})`);
    };

    const shot = async (name, w, h, theme) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(450);
      // Recorded alongside each file: a saved screenshot whose name claims one theme
      // while the page is in the other is worse than no screenshot at all.
      const live = await cdp.evaluate(`document.documentElement.getAttribute('data-theme')`);
      if (theme && live !== theme) throw new Error(`${name}: page is ${live}, expected ${theme}`);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      notes.push(`${name}.png  ${w}x${h}  ${live}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    };

    await setTheme('light');

    // --geo: print the rail's box geometry instead of capturing. Used to check that the
    // grid tracks leave the label enough room at every indent level.
    if (process.argv.includes('--geo')) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      const geo = await cdp.evaluate(`(function(){
        var tree = document.getElementById('tree');
        var rows = Array.prototype.slice.call(document.querySelectorAll('#tree .tree__row'));
        return JSON.stringify({
          viewport: window.innerWidth,
          sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
          tree: Math.round(tree.getBoundingClientRect().width),
          rows: rows.slice(0, 6).map(function(r){
            var lb = r.querySelector('.tree__label');
            var tw = r.querySelector('.tree__twisty');
            var gl = r.querySelector('svg.tree__glyph, .tree__glyph');
            var box = function (n) { var b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
            return {
              indent: r.style.getPropertyValue('--indent') || '0',
              row: box(r),
              twisty: tw ? box(tw) : null,
              glyph: gl ? box(gl) : null,
              label: lb ? box(lb) : null,
              labelBoxW: lb ? Math.round(lb.getBoundingClientRect().width) : null,
              labelScrollW: lb ? lb.scrollWidth : null,
              text: lb ? lb.textContent.slice(0, 22) : null,
              clipped: lb ? lb.scrollWidth > Math.ceil(lb.getBoundingClientRect().width) + 1 : null
            };
          })
        }, null, 0);
      })()`);
      console.log('--- rail geometry at 1440px ---');
      console.log(geo);
      return;
    }

    // Icon sheet: every glyph at 44px, so the set can be reviewed as a set. Debug only.
    if (process.argv.includes('--icons')) {
      await cdp.evaluate(`(function(){
        var d = document.createElement('div');
        d.id = 'icon-sheet';
        d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#ffffff;padding:28px;display:flex;flex-wrap:wrap;gap:26px;align-items:center;align-content:flex-start';
        Object.keys(window.NoteApp.ui.ICONS).forEach(function(name){
          var cell = document.createElement('div');
          cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;width:78px';
          var holder = document.createElement('span');
          holder.style.color = '#1a1d23';
          holder.appendChild(window.NoteApp.ui.icon(name, 44));
          var cap = document.createElement('span');
          cap.textContent = name;
          cap.style.cssText = 'font:11px system-ui;color:#5d6470';
          cell.appendChild(holder); cell.appendChild(cap);
          d.appendChild(cell);
        });
        document.body.appendChild(d);
        return 'sheet';
      })()`);
      await shot('99-icon-sheet', 1200, 640, 'light');
      await cdp.evaluate(`(function(){ var d = document.getElementById('icon-sheet'); if (d) d.remove(); return 'gone'; })()`);
    }

    /** Open a dialog by triggering the app's real handler, then shoot it. */
    const openDialog = async (expr) => {
      await cdp.evaluate(expr);
      await sleep(560);
    };
    const closeDialog = async () => {
      await cdp.evaluate(`(function(){
        var d = document.querySelector('dialog[open]');
        if (!d) return 'none';
        var cancel = d.querySelector('.dialog__footer .btn');
        if (cancel) cancel.click();
        return 'dismissed';
      })()`);
      await sleep(440);
    };
    /** Fire a [data-action] through the app's delegated listener, as a click would. */
    const clickAction = (action, html) => `(function(){
      var b = document.createElement('button');
      b.setAttribute('data-action', ${JSON.stringify(action)});
      ${html ? `b.innerHTML = ${JSON.stringify(html)};` : ''}
      document.body.appendChild(b);
      b.click();
      b.remove();
      return 'clicked';
    })()`;

    // A note is open at this point (the seed selected one), so the tree, the editor and
    // its sticky footer are all on screen together.
    await shot('01-editor-light', 1440, 900, 'light');

    // The custom select, open: styled listbox over the real <select>.
    await cdp.evaluate(`(function(){
      document.querySelector('#workspace-select .select__trigger').click();
      return 'menu';
    })()`);
    await shot('02-workspace-menu', 1440, 900, 'light');
    await cdp.evaluate(`(function(){
      document.querySelector('#workspace-select .select__trigger').click();
      return 'closed';
    })()`);
    await sleep(300);

    // The destructive confirm, with the consequences named and focus parked on Cancel.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var f = App.db.listFolders(App.app.state.workspaceId).filter(function(x){ return x.name === 'Aurora Labs'; })[0];
      App.app.state.selection = { type: 'folder', id: f.id };
      App.app.state.activeNoteId = null;
      App.app.render();
      return 'folder selected';
    })()`);
    await openDialog(clickAction('delete-folder'));
    await shot('03-confirm-destructive', 1440, 900, 'light');
    await closeDialog();

    // The rename prompt: label above the field, helper text below.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var all = App.db.listAllNotes(App.app.state.workspaceId);
      var n = all.filter(function(x){ return x.title === 'Kickoff call agenda'; })[0];
      if (n) App.app.openNote(n.id);
      return 'note open';
    })()`);
    await sleep(300);
    await openDialog(clickAction('rename-note'));
    await shot('04-prompt-rename', 1440, 900, 'light');
    await closeDialog();

    // Type-to-confirm gate, locked.
    await openDialog(`(function(){
      var App = window.NoteApp;
      var ws = App.db.listWorkspaces().filter(function(w){ return w.name === 'Field notes'; })[0];
      App.ui.dialog({
        title: 'Delete \\u201c' + ws.name + '\\u201d?',
        icon: 'warning',
        danger: true,
        message: 'This erases the workspace and everything in it. It cannot be undone.',
        consequences: [
          '9 notes in this workspace.',
          '7 folders and everything nested inside them.',
          '1 stored attachment.',
          'Other workspaces are not affected.'
        ],
        gate: { label: 'Type the workspace name to confirm:', phrase: ws.name },
        confirmLabel: 'Delete workspace'
      });
      return 'gate';
    })()`);
    await shot('05-gate-locked', 1440, 900, 'light');
    await cdp.evaluate(`(function(){
      var d = document.querySelector('dialog[open]');
      var f = d.querySelector('.field__input');
      f.value = 'Field notes';
      f.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
    await shot('06-gate-unlocked', 1440, 900, 'light');
    await closeDialog();

    // Folder listing: the multi-section card view.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.db.listWorkspaces().filter(function(w){ return w.name === 'Field notes'; })[0];
      var f = App.db.listFolders(ws.id).filter(function(x){ return x.name === 'Aurora Labs'; })[0];
      App.app.state.activeNoteId = null;
      App.app.state.selection = { type: 'folder', id: f.id };
      App.app.render();
      return 'folder view';
    })()`);
    await shot('07-folder-light', 1440, 900, 'light');

    // Search results in the rail.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.activeNoteId = null;
      document.getElementById('search').value = 'e';
      document.getElementById('search').dispatchEvent(new Event('input', { bubbles: true }));
      return 'search';
    })()`);
    await sleep(400);
    await shot('08-search-light', 1440, 900, 'light');

    await cdp.evaluate(`(function(){
      document.getElementById('search').value = '';
      document.getElementById('search').dispatchEvent(new Event('input', { bubbles: true }));
      return 'cleared';
    })()`);
    await sleep(300);

    // Settings dialog.
    await cdp.evaluate(`(function(){ document.getElementById('settings-open').click(); return 'settings'; })()`);
    await sleep(700);
    await shot('09-settings-light', 1440, 900, 'light');
    await cdp.evaluate(`(function(){ document.getElementById('settings-close').click(); return 'closed'; })()`);
    await sleep(300);

    // Narrow viewport: list home, then the canvas for an open note.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.selection = { type: 'all', id: null };
      App.app.state.activeNoteId = null;
      App.app.render();
      return 'list';
    })()`);
    await shot('10-mobile-list', 414, 800, 'light');

    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var all = App.db.listAllNotes(App.app.state.workspaceId);
      var n = all.filter(function(x){ return x.title === 'Kickoff call agenda'; })[0];
      App.app.openNote(n.id);
      return 'note';
    })()`);
    await sleep(400);
    await shot('11-mobile-note', 414, 800, 'light');

    // A dialog on a phone: the confirm has to stay usable at 414px wide.
    await openDialog(clickAction('delete-note'));
    await shot('12-mobile-confirm', 414, 800, 'light');
    await closeDialog();

    // Back to desktop, and explicitly dark (not toggled — a toggle would flip back to
    // light on the second call and quietly mislabel the screenshot).
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await setTheme('dark');
    await sleep(300);
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var all = App.db.listAllNotes(App.app.state.workspaceId);
      var n = all.filter(function(x){ return x.title === 'Kickoff call agenda'; })[0];
      if (n) App.app.openNote(n.id);
      return 'note';
    })()`);
    await sleep(400);
    await shot('13-editor-dark', 1440, 900, 'dark');

    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var f = App.db.listFolders(App.app.state.workspaceId).filter(function(x){ return x.name === 'Aurora Labs'; })[0];
      App.app.state.activeNoteId = null;
      App.app.state.selection = { type: 'folder', id: f.id };
      App.app.render();
      return 'folder';
    })()`);
    await shot('14-folder-dark', 1440, 900, 'dark');

    // A destructive confirm in dark mode: the danger tokens have to hold up.
    await openDialog(`(function(){
      window.NoteApp.ui.dialog({
        title: 'Delete \\u201cField notes\\u201d?',
        icon: 'warning',
        danger: true,
        message: 'This erases the workspace and everything in it. It cannot be undone.',
        consequences: ['9 notes.', '7 folders and their contents.', 'Other workspaces are not affected.'],
        gate: { label: 'Type the workspace name to confirm:', phrase: 'Field notes' },
        confirmLabel: 'Delete workspace'
      });
      return 'gate';
    })()`);
    await shot('15-gate-dark', 1440, 900, 'dark');
    await closeDialog();

    // A 2x close-up of the rail. The viewport stays at full desktop width (so the sidebar
    // keeps its real 296px) and the capture is clipped to it, instead of squeezing the
    // viewport narrow - which silently squeezed the sidebar and truncated every label.
    await setTheme('light');
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var all = App.db.listAllNotes(App.app.state.workspaceId);
      var n = all.filter(function(x){ return x.title === 'Kickoff call agenda'; })[0];
      App.app.state.selection = { type: 'all', id: null };
      App.app.state.activeNoteId = n ? n.id : null;
      App.app.render();
      return 'rail';
    })()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 780, deviceScaleFactor: 2, mobile: false });
    await sleep(500);
    let r = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 320, height: 780, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, '16-rail-zoom.png'), Buffer.from(r.data, 'base64'));
    notes.push('16-rail-zoom.png  rail clipped from a 1440x780 viewport @2x  light');

    // The same view with the first folder's hover state applied by hand. Chromium's CDP
    // pseudo-state did not take here, and the subtree highlight is a spacing-sensitive
    // effect, so it gets an image. Applying the rule explicitly also proves the selectors
    // parsed — an invalid one would silently render nothing.
    // NOTE: no screenshot of the folder-hover state. Chromium's CDP pseudo-state did not
    // take, and this harness cannot observe a live style mutation at all: an inline
    // `row.style.background` set immediately before `getComputedStyle(row)` still reads
    // as transparent (the tree is re-rendered underneath the reference). The hover rules
    // are therefore verified at the CSSOM level in tools/shot-interact.js — the rules
    // exist, parse, and match the rows they are meant to match — and the visual result
    // needs a human eye in a real browser.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);

    // Console errors are as much a part of "does it work" as the pixels.
    const errs = await cdp.evaluate(`(function(){
      return window.__SHOT_ERRORS__ ? window.__SHOT_ERRORS__.join(' | ') : 'none captured';
    })()`);
    console.log('screenshots written to tools/shots/');
    console.log(notes.join('\n'));
    console.log('page errors: ' + errs);
  } catch (err) {
    console.error('SHOT ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close', params: {} })); } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    if (!process.argv.includes('--keep')) fs.rmSync(profile, { recursive: true, force: true });
    else console.log('profile kept at ' + profile);
  }
})();
