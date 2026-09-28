#!/usr/bin/env node
/**
 * order-check.js — behavioural check for sorting and manual ordering.
 *
 *   node tools/order-check.js
 *
 * Drives the real index.html in headless Chromium over the DevTools protocol, in a
 * throwaway profile seeded by tools/shot-seed.js (so the user's own database is never
 * touched), then builds a small fixture of its own: three sibling folders created in an
 * order that is neither alphabetical nor chronological, three notes whose creation order,
 * edit order and titles all disagree, and three files whose names, sizes and arrival order
 * are three different sequences. Every assertion is then a comparison against a literal
 * expectation, which is the only way to catch a list that is sorted by something plausible
 * but wrong.
 *
 * What it asserts, in the order it asserts it:
 *   (a) the control exists in the Contents row and its menu offers exactly the five keys,
 *       one of them marked, plus the direction toggle;
 *   (b) choosing each key reorders the ACTUAL sidebar rows — notes, files and folders —
 *       and the main-pane listing follows the same order;
 *   (c) the direction toggle reverses that order;
 *   (d) the choice survives a page reload, applied before anything is re-rendered;
 *   (e) the move commands are absent under any other key, and under manual order a move
 *       really changes the row order and survives a reload;
 *   (f) moving a note in one folder leaves its sibling folder untouched;
 *   (g) manual order uses the stored position and no other key does;
 * plus the two properties the whole change rests on: that reading a list without a sort
 * argument still returns the order it always did, and that two reads agree.
 *
 * Writes one PNG to tools/shots/.
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
const profile = path.join(os.tmpdir(), 'noteapp-order-profile-' + process.pid);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRELOAD = fs.readFileSync(path.join(__dirname, 'shot-seed.js'), 'utf8');

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
const log = (name, value, expected) => {
  const ok = expected === undefined ? true : JSON.stringify(value) === JSON.stringify(expected);
  results.push({ name, value, expected, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} = ${JSON.stringify(value)}${ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'}`);
};

// ---------------------------------------------------------------- expectations
// The fixture's three orders per list, checked into this file as literals rather than
// derived from the app: a check that asks the app what it did and then agrees with it
// cannot fail.
const KEYS = ['manual', 'name', 'created', 'updated', 'size'];
const KEY_LABELS = {
  manual: 'Manual order',
  name: 'Name',
  created: 'Date created',
  updated: 'Date modified',
  size: 'Size',
};
// The rail's own order per key: three workspaces, named Personal, Field notes and Order check,
// created in that order. Name order is the third sequence the menu can ask for.
const RAIL_ASC = {
  manual: ['Personal', 'Field notes', 'Order check'],
  name: ['Field notes', 'Order check', 'Personal'],
  created: ['Personal', 'Field notes', 'Order check'],
  updated: ['Personal', 'Field notes', 'Order check'],
  size: ['Field notes', 'Order check', 'Personal'],
};
const KEY_ORDER_ASC = {
  // Folder Alpha: created Zulu, Mike, Kilo; Zulu edited last.
  alpha: {
    manual: ['Zulu', 'Mike', 'Kilo'],
    name: ['Kilo', 'Mike', 'Zulu'],
    created: ['Zulu', 'Mike', 'Kilo'],
    updated: ['Mike', 'Kilo', 'Zulu'],
    size: ['Kilo', 'Mike', 'Zulu'],
  },
  // Folder Beta: created Echo, Bravo, never edited.
  beta: {
    manual: ['Echo', 'Bravo'],
    name: ['Bravo', 'Echo'],
    created: ['Echo', 'Bravo'],
    updated: ['Echo', 'Bravo'],
    size: ['Bravo', 'Echo'],
  },
  // Root files: mid.txt (100 B) arrived first, zeta.txt (5 B) second, alpha.txt (2 KB) third.
  files: {
    manual: ['mid.txt', 'zeta.txt', 'alpha.txt'],
    name: ['alpha.txt', 'mid.txt', 'zeta.txt'],
    created: ['mid.txt', 'zeta.txt', 'alpha.txt'],
    updated: ['mid.txt', 'zeta.txt', 'alpha.txt'],
    size: ['zeta.txt', 'mid.txt', 'alpha.txt'],
  },
  // Folders: created Zeta, Alpha, Beta.
  folders: {
    manual: ['Zeta', 'Alpha', 'Beta'],
    name: ['Alpha', 'Beta', 'Zeta'],
    created: ['Zeta', 'Alpha', 'Beta'],
    updated: ['Zeta', 'Alpha', 'Beta'],
    size: ['Alpha', 'Beta', 'Zeta'],
  },
};
const reversed = (list) => list.slice().reverse();

(async () => {
  const port = 9800 + Math.floor(Math.random() * 90);
  const child = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  const shots = [];
  try {
    let targets = null;
    for (let i = 0; i < 80 && !targets; i++) {
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELOAD });
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(6500);

    const shot = async (name, w, h) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(420);
      if (await cdp.evaluate('!!document.querySelector(\'.menu:not(.is-hidden)\')')) await sleep(400);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      shots.push(`${name}.png  ${w}x${h}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    };

    // ------------------------------------------------------------- page helpers
    const openSort = async () => {
      await cdp.evaluate("document.getElementById('sort-menu').click()");
      await sleep(260);
    };
    const readMenu = () => cdp.evaluate(`(function(){
      var menu = document.querySelector('.menu:not(.is-hidden)');
      if (!menu) return null;
      var items = Array.prototype.map.call(menu.querySelectorAll('.menu__item'), function (b) {
        return {
          label: b.querySelector('.menu__label').textContent,
          checked: !!b.querySelector('.menu__check svg'),
          disabled: !!b.disabled
        };
      });
      return {
        title: menu.querySelector('.menu__title') ? menu.querySelector('.menu__title').textContent : null,
        items: items,
        checked: items.filter(function (i) { return i.checked; }).map(function (i) { return i.label; })
      };
    })()`);
    const clickItem = async (label) => {
      const r = await cdp.evaluate(`(function(){
        var menu = document.querySelector('.menu:not(.is-hidden)');
        if (!menu) return 'no-menu';
        var hit = null;
        Array.prototype.forEach.call(menu.querySelectorAll('.menu__item'), function (b) {
          if (b.querySelector('.menu__label').textContent === ${JSON.stringify(label)}) hit = b;
        });
        if (!hit) return 'no-item';
        hit.click();
        return 'clicked';
      })()`);
      await sleep(220);
      return r;
    };
    const menuClosed = () => cdp.evaluate("(function(){ var m = document.querySelector('.menu'); return !m || m.classList.contains('is-hidden'); })()");

    const DIRECTION = /Ascending|Descending|Smallest first|Largest first/;
    const isAscending = (menu) => {
      const item = menu.items.filter((i) => DIRECTION.test(i.label))[0];
      return item ? /Ascending|Smallest first/.test(item.label) : null;
    };
    /** Put the direction toggle where the expectations need it, through the real menu. */
    const setDirection = async (dir) => {
      await openSort();
      const menu = await readMenu();
      if (!menu) throw new Error('the sort menu did not open');
      const item = menu.items.filter((i) => DIRECTION.test(i.label))[0];
      if (!item) throw new Error('the sort menu has no direction toggle');
      if ((dir === 'asc') === isAscending(menu)) {
        // Already the right way round: close the menu rather than press the toggle, which
        // would put it back where it started.
        await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
        await sleep(160);
        return;
      }
      await clickItem(item.label);
    };
    const pickKey = async (key) => {
      await openSort();
      const r = await clickItem(KEY_LABELS[key]);
      if (r !== 'clicked') throw new Error('could not choose ' + key + ': ' + r);
    };

    const readTree = () => cdp.evaluate(`(function(){
      var rows = Array.prototype.slice.call(document.querySelectorAll('#tree .tree__row'));
      var folderOrder = [], groups = {}, notes = [], files = [];
      var current = null;
      rows.forEach(function (row) {
        var label = row.querySelector('.tree__label');
        var text = label ? label.textContent : '';
        if (row.classList.contains('tree__row--folder')) {
          current = text;
          folderOrder.push(text);
          groups[current] = [];
        } else if (row.classList.contains('tree__row--note')) {
          notes.push(text);
          // Root notes are attributed to the last folder by this walk; the fixture has none,
          // and the checks below only ever read a named folder's group.
          if (current) groups[current].push(text);
        } else if (row.classList.contains('tree__row--file')) {
          files.push(text);
        }
      });
      var button = document.getElementById('sort-menu');
      return {
        folderOrder: folderOrder,
        groups: groups,
        notes: notes,
        files: files,
        buttonTitle: button.getAttribute('title'),
        expanded: button.getAttribute('aria-expanded')
      };
    })()`);

    const selectFolder = (id) => cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.activeNoteId = null;
      App.app.state.activeFileId = null;
      App.app.state.selection = { type: 'folder', id: ${JSON.stringify(id)} };
      App.app.render();
      return 'selected';
    })()`);
    const showAll = () => cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.activeNoteId = null;
      App.app.state.activeFileId = null;
      App.app.state.selection = { type: 'all', id: null };
      App.app.render();
      return 'all';
    })()`);
    const readPaneNotes = () => cdp.evaluate(`Array.prototype.map.call(
      document.querySelectorAll('#main .card--note .card__title'),
      function (n) { return n.textContent; }
    )`);
    // The rail is the third list the single choice governs, drawn by the workspace switcher.
    const readRail = () => cdp.evaluate(`Array.prototype.map.call(
      document.querySelectorAll('#workspace-select option'),
      function (o) { return o.textContent; }
    )`);

    const popupFor = (selector) => cdp.evaluate(`(function(){
      var node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return 'missing';
      var box = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(box.left + 50), clientY: Math.round(box.top + 10)
      }));
      return 'fired';
    })()`).then(async (r) => { await sleep(320); return r; });
    const popupForNote = async (label) => popupFor('#tree .tree__row--note[data-ctx-label="' + label + '"]');
    const popupForSwitcher = async () => popupFor('#workspace-select .select__trigger, #workspace-select');

    // ---------------------------------------------------------------- the fixture
    const fixture = await cdp.evaluate(`(async function () {
      var App = window.NoteApp;
      await App.app.ready();
      var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

      var seeded = await window.__SEED__();
      var ws = await App.db.createWorkspace('Order check');
      var rail = App.db.listWorkspaces().map(function (w) { return w.name + '@' + w.position; });
      // Created in an order that is neither alphabetical nor the reverse of it.
      var zeta = await App.db.createFolder(ws.id, 'Zeta', null);
      var alpha = await App.db.createFolder(ws.id, 'Alpha', null);
      var beta = await App.db.createFolder(ws.id, 'Beta', null);

      var zulu = await App.db.createNote(ws.id, alpha.id, 'Zulu');
      await wait(30);
      var mike = await App.db.createNote(ws.id, alpha.id, 'Mike');
      await wait(30);
      var kilo = await App.db.createNote(ws.id, alpha.id, 'Kilo');
      await wait(30);
      var echo = await App.db.createNote(ws.id, beta.id, 'Echo');
      await wait(30);
      var bravo = await App.db.createNote(ws.id, beta.id, 'Bravo');
      await wait(30);
      // The oldest note becomes the most recently edited one, so created order and updated
      // order are two different sequences.
      await App.db.updateNote(zulu.id, 'Zulu', 'Zulu body');

      await App.db.addFile(ws.id, null, 'mid.txt', 'text/plain', new Uint8Array(100));
      await App.db.addFile(ws.id, null, 'zeta.txt', 'text/plain', new Uint8Array(5));
      await App.db.addFile(ws.id, null, 'alpha.txt', 'text/plain', new Uint8Array(2000));

      App.prefs.set('lastWorkspaceId', ws.id);
      App.app.state.workspaceId = ws.id;
      App.app.state.expanded[alpha.id] = true;
      App.app.state.expanded[beta.id] = true;
      App.app.state.selection = { type: 'all', id: null };
      App.app.render();
      return {
        seeded: seeded,
        rail: rail,
        stateRail: App.app.state.workspaces.map(function (w) { return w.name + '@' + w.position; }),
        ws: ws.id, alpha: alpha.id, beta: beta.id, zeta: zeta.id, kilo: kilo.id, zulu: zulu.id
      };
    })()`);
    console.log('     fixture: ' + JSON.stringify(fixture));
    await sleep(400);

    // ------------------------------------------------------------------- (a) the control
    const control = await cdp.evaluate(`(function(){
      var b = document.getElementById('sort-menu');
      if (!b) return { exists: false };
      var row = b.closest('.sidebar__label-row');
      return {
        exists: true,
        inSidebar: !!b.closest('.sidebar'),
        rowLabel: row ? (row.querySelector('.sidebar__label') || {}).textContent : null,
        hasPopUp: b.getAttribute('aria-haspopup'),
        hasIcon: !!b.querySelector('svg.icon'),
        label: b.getAttribute('aria-label')
      };
    })()`);
    log('control.exists', control.exists, true);
    log('control.inContentsRow', control.rowLabel, 'Contents');
    log('control.inSidebar', control.inSidebar, true);
    log('control.hasPopUp', control.hasPopUp, 'menu');
    log('control.hasIcon', control.hasIcon, true);
    console.log('     control label: ' + JSON.stringify(control.label));

    await openSort();
    const firstMenu = await readMenu();
    log('menu.open', !!firstMenu, true);
    log('menu.title', firstMenu && firstMenu.title, 'Sort by');
    log('menu.role', await cdp.evaluate("document.querySelector('.menu:not(.is-hidden)').getAttribute('role')"), 'menu');
    const keyItems = (firstMenu ? firstMenu.items : []).filter((i) => !DIRECTION.test(i.label)).map((i) => i.label);
    log('menu.offersExactlyTheFiveKeys', keyItems, KEYS.map((k) => KEY_LABELS[k]));
    log('menu.marksTheActiveKey', firstMenu && firstMenu.checked, ['Manual order']);
    log('menu.directionToggle', (firstMenu ? firstMenu.items : []).filter((i) => DIRECTION.test(i.label)).map((i) => i.label), ['Ascending']);
    log('menu.buttonSaysOpen', await cdp.evaluate("document.getElementById('sort-menu').getAttribute('aria-expanded')"), 'true');
    // A menu whose labels are clipped to an ellipsis offers the key without naming it, which
    // is why this is asserted as geometry rather than as text: textContent stays correct
    // however narrow the box is.
    log('menu.labelsAreNotClipped', await cdp.evaluate("Array.prototype.filter.call(document.querySelectorAll('.menu:not(.is-hidden) .menu__label'), function (l) { return l.scrollWidth > l.clientWidth + 1; }).map(function (l) { return l.textContent; })"), []);
    log('menu.shortcutStaysTrailing', await cdp.evaluate("(function(){ var item = document.querySelector('.menu:not(.is-hidden) .menu__item:last-child'); var label = item.querySelector('.menu__label'); var short = item.querySelector('.menu__shortcut'); return !!short && short.getBoundingClientRect().left > label.getBoundingClientRect().right; })()"), true);
    await shot('32-sort-menu', 1440, 900);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(200);
    log('menu.escapeCloses', await menuClosed(), true);
    log('menu.buttonSaysClosed', await cdp.evaluate("document.getElementById('sort-menu').getAttribute('aria-expanded')"), 'false');

    // --------------------------------------------------- (b) and (c) order by key
    for (const key of KEYS) {
      await setDirection('asc');
      await pickKey(key);
      const tree = await readTree();
      log(`tree.${key}.folderOrder`, tree.folderOrder, KEY_ORDER_ASC.folders[key]);
      log(`tree.${key}.alphaNotes`, tree.groups['Alpha'], KEY_ORDER_ASC.alpha[key]);
      log(`tree.${key}.betaNotes`, tree.groups['Beta'], KEY_ORDER_ASC.beta[key]);
      log(`tree.${key}.rootFiles`, tree.files, KEY_ORDER_ASC.files[key]);
      log(`rail.${key}.followsTheChoice`, await readRail(), RAIL_ASC[key]);

      // (g) the pane is drawn from the same model as the tree beside it.
      await selectFolder(fixture.alpha);
      const pane = await readPaneNotes();
      log(`pane.${key}.alphaNotes`, pane, KEY_ORDER_ASC.alpha[key]);
      await showAll();

      // Two renders of one key must agree, which is what a tiebreak is for.
      const again = await readTree();
      log(`stable.${key}.twoRendersAgree`,
        JSON.stringify(again.groups['Alpha']) === JSON.stringify(tree.groups['Alpha'])
          && JSON.stringify(again.files) === JSON.stringify(tree.files), true);
      const twice = await cdp.evaluate(`(function(){
        var App = window.NoteApp;
        var sort = { key: ${JSON.stringify(key)}, dir: 'asc' };
        var a = App.db.listAllNotes(${JSON.stringify(fixture.ws)}, sort).map(function (n) { return n.id; }).join(',');
        var b = App.db.listAllNotes(${JSON.stringify(fixture.ws)}, sort).map(function (n) { return n.id; }).join(',');
        return a === b && a.length > 0;
      })()`);
      log(`stable.${key}.twoReadsAgree`, twice, true);
    }

    // (c) the direction toggle reverses every one of those orders.
    await setDirection('desc');
    await openSort();
    log('menu.directionToggleNowSaysDescending', isAscending(await readMenu()), false);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(160);
    for (const key of KEYS) {
      await pickKey(key);
      const tree = await readTree();
      log(`desc.${key}.alphaNotes`, tree.groups['Alpha'], reversed(KEY_ORDER_ASC.alpha[key]));
      log(`desc.${key}.rootFiles`, tree.files, reversed(KEY_ORDER_ASC.files[key]));
      log(`desc.${key}.folderOrder`, tree.folderOrder, reversed(KEY_ORDER_ASC.folders[key]));
      log(`desc.${key}.railReversed`, await readRail(), reversed(RAIL_ASC[key]));
    }

    // ------------------------------------------- no sort argument means no sorting
    const legacy = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = ${JSON.stringify(fixture.ws)};
      var titles = function (rows) { return rows.map(function (r) { return r.title || r.filename; }); };
      return {
        notesInFolder: titles(App.db.listNotesIn(ws, ${JSON.stringify(fixture.alpha)})),
        beta: titles(App.db.listNotesIn(ws, ${JSON.stringify(fixture.beta)})),
        folders: App.db.listFolders(ws).map(function (f) { return f.name; }),
        rootFiles: titles(App.db.listFilesIn(ws, null)),
        workspacesSortedByCreated: (function () {
          var rows = App.db.listWorkspaces();
          var copied = rows.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); });
          return rows.map(function (w) { return w.id; }).join(',') === copied.map(function (w) { return w.id; }).join(',');
        })()
      };
    })()`);
    log('legacy.notesInFolderIsUpdatedDesc', legacy.notesInFolder, ['Zulu', 'Kilo', 'Mike']);
    log('legacy.betaNotesAreUpdatedDesc', legacy.beta, ['Bravo', 'Echo']);
    log('legacy.foldersAreNameOrder', legacy.folders, ['Alpha', 'Beta', 'Zeta']);
    log('legacy.rootFilesAreCreatedDesc', legacy.rootFiles, ['alpha.txt', 'zeta.txt', 'mid.txt']);
    log('legacy.workspacesAreCreatedAsc', legacy.workspacesSortedByCreated, true);

    // (d) the choice survives a reload, applied before anything is re-rendered.
    await setDirection('desc');
    await pickKey('name');
    const stored = await cdp.evaluate(`(function(){
      var keys = Object.keys(window.localStorage).filter(function (k) { return /noteapp\\.pref\\..*sort/i.test(k); });
      return { keys: keys, value: JSON.parse(window.localStorage.getItem('noteapp.pref.sortOrder') || 'null') };
    })()`);
    log('pref.oneKey', stored.keys, ['noteapp.pref.sortOrder']);
    log('pref.shape', stored.value, { key: 'name', direction: 'desc' });

    await cdp.send('Page.reload');
    await sleep(7000);
    await cdp.evaluate('window.NoteApp.app.ready()');
    await sleep(600);
    const afterReload = await readTree();
    // Read before anything re-renders or re-expands: the root file rows are on screen as
    // the app drew them, so their order is the order boot settled on.
    log('reload.rootFilesFollowTheStoredKey', afterReload.files, reversed(KEY_ORDER_ASC.files.name));
    console.log('     sort button after reload: ' + JSON.stringify(afterReload.buttonTitle));
    log('reload.buttonNamesTheKeyAndDirection', /Name/.test(afterReload.buttonTitle || '') && /descending/.test(afterReload.buttonTitle || ''), true);
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.expanded[${JSON.stringify(fixture.alpha)}] = true;
      App.app.state.expanded[${JSON.stringify(fixture.beta)}] = true;
      App.app.render();
      return 'expanded';
    })()`);
    await sleep(300);
    log('reload.notesFollowTheStoredKey', (await readTree()).groups['Alpha'], reversed(KEY_ORDER_ASC.alpha.name));

    // ------------------------------------------- (e) and (f) moving under manual order
    const nameRowMenu = await popupForNote('Kilo');
    log('move.rowMenuOpenedUnderName', nameRowMenu, 'fired');
    const nameMenu = await readMenu();
    const labelsIn = (menu) => (menu ? menu.items.map((i) => i.label) : []);
    log('move.absentUnderName', labelsIn(nameMenu).filter((l) => /^Move (up|down)$/.test(l)), []);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(200);

    // The switcher has to offer the same commands: a workspace is a row in the rail's list.
    const switcherMenu = await popupForSwitcher();
    log('move.switcherMenuOpened', switcherMenu, 'fired');
    const switcherUnderName = await readMenu();
    log('move.absentOnSwitcherUnderName', labelsIn(switcherUnderName).filter((l) => /^Move (up|down)$/.test(l)), []);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(200);

    // Ascending manual order, so the move below has a direction to be one place in.
    await setDirection('asc');
    await pickKey('manual');
    await openSort();
    log('move.sortMenuStillMarksManual', (await readMenu()).checked, ['Manual order']);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(180);
    // Open the note first, so that "the moved row stays selected" is a claim about the
    // selection rather than about a row that was never selected.
    await cdp.evaluate(`window.NoteApp.app.openNote(${JSON.stringify(fixture.kilo)})`);
    await sleep(300);
    const siblingBefore = (await readTree()).groups['Beta'];
    const manualRowMenu = await popupForNote('Kilo');
    log('move.rowMenuOpenedUnderManual', manualRowMenu, 'fired');
    const manualMenu = await readMenu();
    log('move.presentUnderManual', labelsIn(manualMenu).filter((l) => /^Move (up|down)$/.test(l)), ['Move up', 'Move down']);
    await clickItem('Move up');
    await sleep(400);

    // Kilo was third; moving it up has to swap it with Mike and leave Zulu where it is.
    log('move.changedTheOrder', (await readTree()).groups['Alpha'], ['Zulu', 'Kilo', 'Mike']);
    log('move.keptTheMovedRowSelected', await cdp.evaluate(`(function(){
      var row = document.querySelector('#tree .tree__row--note[data-id="${fixture.kilo}"]');
      return !!row && row.classList.contains('is-active');
    })()`), true);
    log('move.keptTheMovedRowFocused', await cdp.evaluate("document.activeElement && document.activeElement.getAttribute('data-id')"), fixture.kilo);

    // (f) the sibling folder is a different scope and must not have moved with it.
    const siblingAfter = (await readTree()).groups['Beta'];
    log('scope.siblingFolderUntouched', siblingAfter, siblingBefore);
    log('scope.siblingFolderStillManual', siblingAfter, KEY_ORDER_ASC.beta.manual);

    // The pane's cards are the same rows drawn a second way, so they open the same menu and
    // must carry the same commands.
    await selectFolder(fixture.alpha);
    await popupFor('#main .card--note[data-ctx-label="Kilo"]');
    log('move.cardOffersTheCommandsUnderManual', labelsIn(await readMenu()).filter((l) => /^Move (up|down)$/.test(l)), ['Move up', 'Move down']);
    await pickKey('name');
    await popupFor('#main .card--note[data-ctx-label="Kilo"]');
    log('move.cardOmitsThemUnderName', labelsIn(await readMenu()).filter((l) => /^Move (up|down)$/.test(l)), []);
    await pickKey('manual');

    // The workspace switcher is the rail's own list, and the rail is the one list whose rows
    // are not rows: the order lives in the widget, so a move has to rebuild it rather than
    // merely repaint the tree.
    const switcherState = () => cdp.evaluate(`(function(){
      var host = document.getElementById('workspace-select');
      return {
        options: Array.prototype.map.call(host.querySelectorAll('option'), function (o) { return o.textContent; }),
        value: host.querySelector('select') ? host.querySelector('select').value : host.value,
        active: !!host.querySelector('.select__option.is-selected')
      };
    })()`);
    const beforeMove = await switcherState();
    console.log('     rail before the move: ' + JSON.stringify(beforeMove));
    await popupForSwitcher();
    const workspaceMenu = await readMenu();
    log('move.switcherNamesTheWorkspace', workspaceMenu && workspaceMenu.title, 'Order check');
    log('move.switcherOffersTheCommandsUnderManual', labelsIn(workspaceMenu).filter((l) => /^Move (up|down)$/.test(l)), ['Move up', 'Move down']);
    await clickItem('Move up');
    await sleep(500);
    const afterMove = await switcherState();
    console.log('     rail after the move: ' + JSON.stringify(afterMove));
    // The move is asserted as a transition rather than against a literal rail order, because
    // which workspaces a profile holds is the seed's business, not this check's.
    const railIndex = beforeMove.options.indexOf('Order check');
    const swapped = beforeMove.options.slice();
    if (railIndex > 0) {
      swapped[railIndex - 1] = beforeMove.options[railIndex];
      swapped[railIndex] = beforeMove.options[railIndex - 1];
    }
    log('move.switcherReordered', afterMove.options, swapped);
    log('move.switcherKeptTheWorkspaceSelected', afterMove.value, fixture.ws);
    log('move.switcherWasRebuilt', JSON.stringify(afterMove.options) !== JSON.stringify(beforeMove.options), true);
    // Put the rail back the way it was so the checks that follow see the profile they seeded.
    await popupForSwitcher();
    await clickItem('Move down');
    await sleep(500);
    await showAll();
    log('move.switcherRestored', (await switcherState()).options, beforeMove.options);

    // And manual order is the only key that follows position: by creation the same three
    // notes still read Zulu, Mike, Kilo.
    await setDirection('asc');
    await pickKey('created');
    log('scope.createdIgnoresPosition', (await readTree()).groups['Alpha'], KEY_ORDER_ASC.alpha.created);
    await pickKey('manual');
    log('scope.manualUsesPosition', (await readTree()).groups['Alpha'], ['Zulu', 'Kilo', 'Mike']);
    await setDirection('desc');
    log('scope.manualDescendingReverses', (await readTree()).groups['Alpha'], ['Mike', 'Kilo', 'Zulu']);
    await setDirection('asc');

    // The move has to be in the database, not merely on screen.
    await cdp.send('Page.reload');
    await sleep(7000);
    await cdp.evaluate('window.NoteApp.app.ready()');
    await sleep(600);
    const reloadedTree = await readTree();
    log('move.survivesReload.rootFiles', reloadedTree.files, KEY_ORDER_ASC.files.manual);
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.expanded[${JSON.stringify(fixture.alpha)}] = true;
      App.app.state.expanded[${JSON.stringify(fixture.beta)}] = true;
      App.app.render();
      return 'expanded';
    })()`);
    await sleep(300);
    log('move.survivesReload.notes', (await readTree()).groups['Alpha'], ['Zulu', 'Kilo', 'Mike']);

    const errs = await cdp.evaluate("window.__SHOT_ERRORS__ ? window.__SHOT_ERRORS__.join(' | ') : 'none captured'");
    console.log('\nscreenshot written to tools/shots/');
    console.log(shots.join('\n'));
    console.log('page errors: ' + errs);

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
    if (failed.length) {
      failed.forEach((f) => console.log(`  FAIL ${f.name}: got ${JSON.stringify(f.value)}, expected ${JSON.stringify(f.expected)}`));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('ORDER CHECK ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close', params: {} })); } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
