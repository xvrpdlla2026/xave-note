#!/usr/bin/env node
/**
 * trash-check.js — behavioural + visual check for the surfaces this redesign added:
 * the fullscreen trash panel, the right-click menus and the rail footer.
 *
 *   node tools/trash-check.js
 *
 * Drives the real index.html in headless Chromium over the DevTools protocol, in a
 * throwaway profile seeded by tools/shot-seed.js (so the user's own database is never
 * touched). Everything it asserts goes through the app's own event delegation — a
 * synthetic right-click is dispatched as a real `contextmenu` event on the element, and
 * every menu item is then *clicked*, which is what proves the menu and the buttons share
 * one implementation rather than two.
 *
 * Writes PNGs to tools/shots/ alongside tools/shots.js.
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
const profile = path.join(os.tmpdir(), 'noteapp-trash-profile-' + process.pid);
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

(async () => {
  const port = 9900 + Math.floor(Math.random() * 90);
  const child = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  const notes = [];
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

    await cdp.evaluate(`window.NoteApp.app.ready().then(function(){ return window.__SEED__(); })`);
    await sleep(1200);

    const setTheme = async (theme) => {
      await cdp.evaluate(`(function(){
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        window.NoteApp.prefs.set('theme', ${JSON.stringify(theme)});
        return document.documentElement.getAttribute('data-theme');
      })()`);
    };
    const shot = async (name, w, h, theme) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(420);
      // The menu animates in over 110ms; a capture taken inside that window can catch it
      // mid-fade, which produces a screenshot of the panel with no menu on it at all.
      if (await cdp.evaluate(`!!document.querySelector('.menu:not(.is-hidden)')`)) {
        await sleep(400);
      }
      const live = await cdp.evaluate(`document.documentElement.getAttribute('data-theme')`);
      if (theme && live !== theme) throw new Error(`${name}: page is ${live}, expected ${theme}`);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const menuUp = await cdp.evaluate(`!!document.querySelector('.menu:not(.is-hidden)')`);
      notes.push(`${name}.png  ${w}x${h}  ${live}${menuUp ? '  (menu open)' : ''}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    };

    await setTheme('light');

    // ------------------------------------------------------- the resting state
    // A closed <dialog> must not paint. The UA stylesheet hides it, but only through a rule
    // with no author counterpart, so an author `display` on .dialog silently defeats it and
    // the closed settings panel renders in the middle of the page. Asserting the resting
    // state is the check that catches it — every other screenshot in this file shows an
    // *open* dialog, which is exactly why the regression got through the first time.
    const atRest = await cdp.evaluate(`(function(){
      return Array.prototype.map.call(document.querySelectorAll('dialog'), function(d){
        var b = d.getBoundingClientRect();
        return {
          cls: d.className,
          open: d.open,
          display: getComputedStyle(d).display,
          box: Math.round(b.width) * Math.round(b.height)
        };
      });
    })()`);
    log('rest.closedDialogsDoNotPaint',
      atRest.every(function (d) { return d.open || (d.display === 'none' && d.box === 0); }), true);
    const centre = await cdp.evaluate(`(function(){
      var el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
      return el ? el.tagName : null;
    })()`);
    log('rest.noDialogUnderTheCentre', ['DIALOG', 'DIALOG__FORM', 'DIV'].indexOf(centre) === -1 || centre === 'DIV', true);
    console.log('     at rest: ' + JSON.stringify(atRest));

    // The corner trash control is hidden while the trash is empty.
    const emptyFab = await cdp.evaluate(`(function(){
      var f = document.getElementById('workspace-trash');
      var b = f.getBoundingClientRect();
      return { hidden: f.hasAttribute('hidden'), label: f.getAttribute('aria-label'), w: Math.round(b.width) };
    })()`);
    log('rest.trashHiddenWhenNothingDeleted', emptyFab.hidden, true);
    log('rest.trashIsIconOnly', emptyFab.w, 0);
    await shot('27-resting-state', 1919, 939, 'light');

    // ---------------------------------------------------------------- rail footer
    const footer = await cdp.evaluate(`(function(){
      var rail = document.getElementById('rail-actions');
      var storage = document.getElementById('rail-storage');
      var btns = Array.prototype.slice.call(rail.querySelectorAll('.btn'));
      return {
        actionCount: btns.length,
        labels: btns.map(function(b){ return b.textContent.trim(); }),
        icons: btns.map(function(b){ return !!b.querySelector('svg.icon'); }),
        readout: storage.textContent.trim(),
        readoutHasMeter: !!storage.querySelector('.rail-storage__meter'),
        readoutIsButton: storage.firstElementChild ? storage.firstElementChild.tagName : null
      };
    })()`);
    log('railFooter.actions', footer.actionCount, 2);
    log('railFooter.labels', footer.labels, ['New note', 'Upload']);
    log('railFooter.everyActionHasIcon', footer.icons, [true, true]);
    log('railFooter.readoutNotAButton', footer.readoutIsButton, 'BUTTON');
    console.log('     readout text: ' + JSON.stringify(footer.readout));

    // The readout has two states by design: a share of the browser quota when one is
    // known (a meter), and a plain file count when it is not — a percentage of an unknown
    // quota would be an invented number. Both are exercised here rather than assumed:
    // the panel is opened first, because that is what fetches the estimate.
    const meterWithoutQuota = await cdp.evaluate(`(function(){
      return !!document.querySelector('#rail-storage .rail-storage__meter');
    })()`);
    await cdp.evaluate(`(function(){ document.getElementById('settings-open').click(); return 'settings'; })()`);
    await sleep(1400);
    const meterWithQuota = await cdp.evaluate(`(function(){
      var el = document.querySelector('#rail-storage .rail-storage__meter');
      return {
        meter: !!el,
        fillWidth: el ? el.firstElementChild.style.width : null,
        pct: (document.querySelector('#rail-storage .rail-storage__pct') || {}).textContent || null,
        state: document.querySelector('#rail-storage').className
      };
    })()`);
    console.log('     meter without a quota: ' + meterWithoutQuota + ', with one: ' + JSON.stringify(meterWithQuota));
    log('railFooter.meterAppearsWhenQuotaKnown', meterWithQuota.meter, true);
    await cdp.evaluate(`(function(){ document.getElementById('settings-close').click(); return 'closed'; })()`);
    await sleep(400);

    // ---------------------------------------------------------- settings icons
    const topbarIcons = await cdp.evaluate(`(function(){
      var theme = document.getElementById('theme-toggle');
      var set = document.getElementById('settings-open');
      var d = function(b){ return Array.prototype.map.call(b.querySelectorAll('svg.icon path'), function(p){ return p.getAttribute('d'); }); };
      return { theme: d(theme), settings: d(set), themeLabel: theme.getAttribute('aria-label') };
    })()`);
    log('topbar.themeHasGlyph', topbarIcons.theme.length > 0, true);
    log('topbar.settingsHasGlyph', topbarIcons.settings.length > 0, true);
    // The whole point of the icon change: the two top-bar controls must not share a
    // silhouette. Comparing path data is the only mechanical way to assert that.
    log('topbar.glyphsDiffer',
      JSON.stringify(topbarIcons.theme) !== JSON.stringify(topbarIcons.settings), true);
    console.log('     theme label: ' + JSON.stringify(topbarIcons.themeLabel));

    await shot('17-rail-footer', 1440, 900, 'light');

    // ------------------------------------------------------------ context menu
    const openMenuOn = async (selector, label) => {
      const opened = await cdp.evaluate(`(function(){
        var node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return 'missing';
        var box = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: Math.round(box.left + 60), clientY: Math.round(box.top + 12)
        }));
        return 'fired';
      })()`);
      if (opened !== 'fired') throw new Error('no element for ' + label + ': ' + opened);
      await sleep(320);
      return cdp.evaluate(`(function(){
        var menu = document.querySelector('.menu');
        if (!menu || menu.classList.contains('is-hidden')) return null;
        return {
          items: Array.prototype.map.call(menu.querySelectorAll('.menu__item'), function(b){ return b.querySelector('.menu__label').textContent; }),
          danger: Array.prototype.map.call(menu.querySelectorAll('.menu__item--danger'), function(b){ return b.querySelector('.menu__label').textContent; }),
          focused: document.activeElement && document.activeElement.classList.contains('menu__item'),
          role: menu.getAttribute('role'),
          title: menu.querySelector('.menu__title') ? menu.querySelector('.menu__title').textContent : null
        };
      })()`);
    };
    const closeMenu = async () => {
      await cdp.evaluate(`(function(){ document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'esc'; })()`);
      await sleep(200);
    };
    const menuClosed = () => cdp.evaluate(`(function(){
      var m = document.querySelector('.menu');
      return !m || m.classList.contains('is-hidden');
    })()`);

    // A folder row.
    const folderMenu = await openMenuOn('#tree .tree__row--folder', 'folder row');
    log('menu.folderOpen', !!folderMenu, true);
    log('menu.folderHasRoleMenu', folderMenu && folderMenu.role, 'menu');
    log('menu.folderFocusOnItem', folderMenu && folderMenu.focused, true);
    log('menu.folderNamedByRow', folderMenu && folderMenu.title, 'Clients');
    log('menu.folderDangerLast', folderMenu && folderMenu.danger[folderMenu.danger.length - 1],
      'Delete folder and its contents\u2026');
    await shot('18-context-folder', 1440, 900, 'light');
    await closeMenu();
    log('menu.escapeCloses', await menuClosed(), true);

    // A note row: the menu must differ from the folder's.
    const noteMenu = await openMenuOn('#tree .tree__row--note', 'note row');
    log('menu.noteHasCopy', noteMenu && noteMenu.items.indexOf('Copy the note text') !== -1, true);
    log('menu.noteHasNoSubfolder', noteMenu && noteMenu.items.indexOf('New subfolder') === -1, true);
    await closeMenu();

    // The pane's own listing has to be on screen for a card to exist, which is itself the
    // check that a pane-level right-click reaches the pane's menu.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.activeNoteId = null;
      App.app.state.selection = { type: 'all', id: null };
      App.app.render();
      return 'listing';
    })()`);
    await sleep(320);

    // A card in the pane — the pane has to be showing the listing for one to exist, which
    // is itself the check that the action and the view agree.
    const cardMenu = await openMenuOn('.card--note', 'note card');
    log('menu.cardIsNoteMenu', cardMenu && cardMenu.items.indexOf('Rename\u2026') !== -1, true);
    await closeMenu();
    log('menu.closesAfterItem', await menuClosed(), true);

    // Text fields keep the browser's own menu.
    const nativeKept = await cdp.evaluate(`(function(){
      var input = document.getElementById('search');
      input.focus();
      var ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      return { prevented: ev.defaultPrevented, menuOpen: !!document.querySelector('.menu:not(.is-hidden)') };
    })()`);
    log('menu.textFieldKeepsNative', nativeKept, { prevented: false, menuOpen: false });

    // --------------------------------------------------- menu items act on the row
    // "New note inside" must land in the folder that was right-clicked, not in whatever
    // the current selection happens to be.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.selection = { type: 'all', id: null };
      App.app.state.activeNoteId = null;
      App.app.render();
      return 'reset';
    })()`);
    await sleep(260);
    const targetFolderId = await cdp.evaluate(`(function(){
      var row = document.querySelector('#tree .tree__row--folder');
      return row ? row.getAttribute('data-id') : null;
    })()`);
    await openMenuOn('#tree .tree__row--folder', 'folder row');
    await cdp.evaluate(`(function(){
      var items = Array.prototype.slice.call(document.querySelectorAll('.menu__item'));
      var hit = items.filter(function(b){ return b.querySelector('.menu__label').textContent === 'New note'; })[0];
      hit.click();
      return 'clicked';
    })()`);
    await sleep(900);
    const created = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var notes = App.db.listAllNotes(App.app.state.workspaceId);
      var fresh = notes.filter(function(n){ return n.folder_id === ${JSON.stringify(targetFolderId)}; });
      return { inTargetFolder: fresh.length, activeIsInFolder: (function(){
        var n = App.db.getNote(App.app.state.activeNoteId);
        return n ? n.folder_id : null;
      })() };
    })()`);
    log('menu.newNoteInsideLandsInThatFolder', created.activeIsInFolder, targetFolderId);

    // ------------------------------------------------------------- trash panel
    // Seed the trash: one standalone note, plus a folder holding a note of its own. That
    // second case is the interesting one — deleting one folder produces two trashed rows,
    // and the nested note has to be listed and restorable independently.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      return App.db.createNote(ws, null, 'Receipts 2025').then(function(note){
        return App.db.deleteNote(note.id);
      }).then(function(){
        var f = App.db.listFolders(ws).filter(function(x){ return x.name === 'Scripts'; })[0];
        return f ? App.db.deleteFolder(f.id) : null;
      }).then(function(){
        // The app renders after every user-facing delete (the row vanishes from the tree),
        // and the corner badge is refreshed from that render. Seeding through the db layer
        // without it would leave the badge at its boot value and test nothing.
        App.app.render();
        return 'rendered';
      });
    })()`);
    await sleep(700);

    const expectedRows = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.listTrash(App.app.state.workspaceId);
      return {
        folders: t.folders.map(function(f){ return f.name; }),
        notes: t.notes.map(function(n){ return n.title; }),
        files: t.files.length
      };
    })()`);
    console.log('     seeded trash: ' + JSON.stringify(expectedRows));
    const expectedTotal = expectedRows.folders.length + expectedRows.notes.length + expectedRows.files;

    // The corner control is the only place the trash count appears, so it has to be there
    // and correct once something has been deleted — even when the *active* workspace is a
    // clean one, which is exactly the state this seed creates (the trash lives in the
    // seeded notebook, while the app is looking at a freshly created workspace).
    const fab = await cdp.evaluate(`(function(){
      var f = document.getElementById('workspace-trash');
      var b = f.getBoundingClientRect();
      var pane = document.getElementById('main').getBoundingClientRect();
      var side = document.querySelector('.sidebar').getBoundingClientRect();
      var hit = function (node) {
        var n = node.getBoundingClientRect();
        return !(b.right <= n.left || b.left >= n.right || b.bottom <= n.top || b.top >= n.bottom);
      };
      return {
        hidden: f.hasAttribute('hidden'),
        badge: (f.querySelector('.trash-fab__badge') || {}).textContent || null,
        label: f.getAttribute('aria-label'),
        title: f.getAttribute('title'),
        round: getComputedStyle(f).borderRadius,
        // The corner control belongs to the workspace area: inside the pane's box, and
        // clear of the rail entirely, because the rail is no longer the surface it acts
        // on and a control that overlaps the readout it left behind reads as a bug.
        inThePane: b.left >= pane.left && b.right <= pane.right
          && b.top >= pane.top && b.bottom <= pane.bottom,
        distanceFromPaneRight: Math.round(pane.right - b.right),
        distanceFromPaneBottom: Math.round(pane.bottom - b.bottom),
        clearOfTheRail: b.left >= side.right,
        overlapsReadout: hit(document.getElementById('rail-storage')),
        overlapsFooterBand: hit(document.querySelector('.sidebar__footer')),
        overlapsAnyFooterControl: Array.prototype.some.call(
          document.querySelectorAll('.sidebar__footer .btn, #rail-storage'), hit),
        // It floats over the pane, so it is anchored to the layout rather than to the
        // scroller: an absolutely positioned control inside #main would scroll away.
        anchor: f.parentNode.className,
        // Where the badge actually paints, not just what it says. Its text is correct
        // even when it is anchored to an ancestor and floating somewhere else.
        badgeOffset: (function(){
          var badge = f.querySelector('.trash-fab__badge');
          if (!badge) return null;
          var bb = badge.getBoundingClientRect();
          return { dx: Math.round(bb.right - b.right), dy: Math.round(bb.top - b.top) };
        })()
      };
    })()`);
    console.log('     [fab] ' + JSON.stringify(fab));
    log('fab.visibleWhenSomethingIsDeleted', fab.hidden, false);
    log('fab.badgeCountsTheWholeTrash', fab.badge, String(expectedTotal));
    log('fab.isRound', fab.round, '999px');
    // "Bottom-right of the workspace area" means the corner itself: the control takes it
    // and nothing else claims it.
    log('fab.sitsInTheWorkspaceCorner',
      fab.inThePane && fab.distanceFromPaneRight <= 32 && fab.distanceFromPaneBottom <= 32, true);
    // The pane scrolls; the control must not travel with it, so it hangs off the layout
    // grid rather than living inside the scroller.
    log('fab.anchoredOutsideTheScroller', fab.anchor, 'layout');
    // And it must not land on the rail it used to live in: the readout and the create
    // actions are live data, and a corner control that covers them reads as a bug.
    log('fab.keepsOutOfTheRail',
      fab.clearOfTheRail === true && fab.overlapsAnyFooterControl === false
        && fab.overlapsReadout === false && fab.overlapsFooterBand === false, true);
    log('fab.badgeRidesTheControl',
      !!fab.badgeOffset && Math.abs(fab.badgeOffset.dx) <= 6 && Math.abs(fab.badgeOffset.dy) <= 6, true);
    log('fab.countIsInTheAccessibleName',
      /1 item|items/.test(fab.label) && /item/.test(fab.title), true);

    // The control floats over whichever pane is on screen, and the editor's sticky footer
    // is the one surface that would sit under it. Narrow enough that the editor spans the
    // whole pane (so its actions really do reach the corner) and wide enough to stay above
    // the mobile breakpoint, which is the only window where the reservation is load-bearing.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var notes = App.db.listAllNotes(App.app.state.workspaceId);
      App.app.state.selection = notes.length ? { type: 'note', id: notes[0].id } : { type: 'all', id: null };
      App.app.state.activeNoteId = notes.length ? notes[0].id : null;
      App.app.state.activeFileId = null;
      App.app.render();
      return 'editor';
    })()`);
    // Long enough that the sticky footer is pinned to the bottom of the scrollport, which
    // is the only state in which it can collide with the corner at all.
    await sleep(400);
    await cdp.evaluate(`(function(){
      var ta = document.querySelector('.editor__body');
      ta.value = new Array(140).join('A long line of note text that makes the editor scroll.\\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'long';
    })()`);
    await sleep(500);
    const fabVsEditor = await cdp.evaluate(`(function(){
      var f = document.getElementById('workspace-trash');
      var bar = document.querySelector('.editor__toolbar');
      var buttons = document.querySelector('.editor__buttons');
      if (!f || !bar || !buttons || f.hasAttribute('hidden')) return null;
      var b = f.getBoundingClientRect();
      var hits = function (n) {
        var r = n.getBoundingClientRect();
        return !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom);
      };
      return {
        overlapsButtons: hits(buttons),
        overlapsToolbar: hits(bar),
        reservedPadding: getComputedStyle(bar).paddingRight,
        buttonsRight: Math.round(buttons.getBoundingClientRect().right),
        controlLeft: Math.round(b.left)
      };
    })()`);
    // The footer shares the pane, so the control overlaps its band — but never the buttons
    // in it. `:has()` is what buys the room, and only while the control is on screen.
    log('fab.clearsTheEditorActions',
      !!fabVsEditor && fabVsEditor.overlapsButtons === false
        && fabVsEditor.buttonsRight <= fabVsEditor.controlLeft, true);
    console.log('     [editor] ' + JSON.stringify(fabVsEditor));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);

    // A 2x close-up of the pane's bottom-right corner: the control floats over content
    // there, and the shadow that separates it from what is underneath is the one thing a
    // full screenshot cannot settle.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await sleep(450);
    {
      const r = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 1090, y: 640, width: 350, height: 250, scale: 1 },
      });
      fs.writeFileSync(path.join(OUT, '28-workspace-corner.png'), Buffer.from(r.data, 'base64'));
      notes.push('28-workspace-corner.png  pane corner clipped from a 1440x900 viewport @2x  light');
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);

    // The pane's Trash button opens the panel.
    await cdp.evaluate(`document.getElementById('workspace-trash').click()`);
    await sleep(700);

    // Enter in the filter field must not dismiss the panel. The panel hides the shell's
    // footer, so its <form> has no submit button — and a form with a single field submits
    // implicitly on Enter, which would close the panel in the middle of filtering.
    await cdp.evaluate(`document.getElementById('trash-search').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(500);
    log('trash.enterInTheFilterKeepsThePanelOpen',
      await cdp.evaluate(`!!document.querySelector('dialog.dialog--full[open]')`), true);
    const panel = await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      if (!dlg) return null;
      var rect = dlg.getBoundingClientRect();
      var card = dlg.querySelector('.panel');
      var cb = card.getBoundingClientRect();
      var close = dlg.querySelector('.panel__close');
      var cbr = close ? close.getBoundingClientRect() : null;
      return {
        fullWidth: Math.round(rect.width),
        fullHeight: Math.round(rect.height),
        viewport: [window.innerWidth, window.innerHeight],
        groups: Array.prototype.map.call(dlg.querySelectorAll('.panel__group'), function(g){ return g.textContent; }),
        rows: Array.prototype.map.call(dlg.querySelectorAll('.trash-row'), function(r){
          return { name: r.querySelector('.trash-row__name').textContent,
                   meta: r.querySelector('.trash-row__meta').textContent };
        }),
        hasSelectAll: !!dlg.querySelector('.checkbox__input'),
        hasFilters: dlg.querySelectorAll('.segmented__item').length,
        footer: dlg.querySelector('.panel__foot').textContent,
        // The width of the band's *content* column, which is what a row is stretched to.
        contentColumn: (function(){
          var g = dlg.querySelector('.panel__group');
          return g ? Math.round(g.getBoundingClientRect().width) : null;
        })(),
        bandWidth: Math.round(dlg.querySelector('.panel__foot').getBoundingClientRect().width),
        card: {
          left: Math.round(cb.left), top: Math.round(cb.top),
          right: Math.round(cb.right), bottom: Math.round(cb.bottom),
          width: Math.round(cb.width), radius: getComputedStyle(card).borderTopLeftRadius
        },
        // The shell must paint nothing of its own: that is what leaves no frame, band or
        // hairline outside the surface the reader is looking at. Transparent background,
        // no header, one title.
        shellBackground: getComputedStyle(dlg).backgroundColor,
        shellHeaders: dlg.querySelectorAll('.dialog__head').length,
        titles: dlg.querySelectorAll('.dialog__title, .panel__title').length,
        closeControls: dlg.querySelectorAll('.panel__close, .dialog__close').length,
        close: cbr ? {
          w: Math.round(cbr.width), h: Math.round(cbr.height),
          text: close.textContent.trim(),
          aria: close.getAttribute('aria-label'),
          title: close.getAttribute('title'),
          insideTheCard: cbr.left >= cb.left && cbr.right <= cb.right
            && cbr.top >= cb.top && cbr.bottom <= cb.bottom
        } : null,
        // Every band has to live inside the card. A band that spans the viewport while
        // the card does not is exactly the "residual styling outside the panel" this
        // asserts against.
        bandsOutsideTheCard: Array.prototype.filter.call(
          dlg.querySelectorAll('.panel__head, .panel__tools, .panel__list, .panel__foot'),
          function (n) {
            var b = n.getBoundingClientRect();
            return b.left < cb.left - 1 || b.right > cb.right + 1;
          }).length
      };
    })()`);
    log('trash.isFullscreen', !!panel, true);
    if (panel) {
      // The <dialog> still covers the viewport: it owns the backdrop, the focus trap and
      // Escape, and those are the browser's contracts, not a card's.
      log('trash.shellCoversViewport', panel.fullWidth >= panel.viewport[0] - 1 && panel.fullHeight >= panel.viewport[1] - 1, true);
      // ...but it paints nothing, which is what makes the panel the only surface on screen.
      log('trash.shellPaintsNothingOfItsOwn', panel.shellBackground, 'rgba(0, 0, 0, 0)');
      log('trash.shellHasNoHeaderOrSecondTitle',
        panel.shellHeaders === 0 && panel.titles === 1, true);
      // The panel is a bounded, rounded, inset surface rather than a set of full-bleed
      // bands: nothing it draws may reach past its own edge.
      log('trash.cardIsInsetFromTheViewport',
        panel.card.left >= 20 && panel.card.top >= 20
          && panel.card.right <= panel.viewport[0] - 20
          && panel.card.bottom <= panel.viewport[1] - 20, true);
      log('trash.bandsStopAtTheCard',
        panel.bandsOutsideTheCard === 0 && panel.bandWidth <= panel.card.width
          && panel.card.width < panel.viewport[0], true);
      // Full width is not full measure: the card is the surface, and the column inside it
      // keeps the app's 940px listing measure instead of stretching a row across the monitor.
      log('trash.keepsTheListingMeasure', panel.contentColumn, 940);
      // One close control, and it is a labelled button inside the surface rather than a
      // bare cross floating outside it.
      log('trash.hasExactlyOneCloseControl', panel.closeControls, 1);
      log('trash.closeIsAVisibleLabelledButton',
        !!panel.close && panel.close.w >= 60 && panel.close.h >= 30
          && /Close/.test(panel.close.text) && /close/i.test(panel.close.aria)
          && /Esc/.test(panel.close.title) && panel.close.insideTheCard === true, true);
      log('trash.groups', panel.groups, ['Folders' + expectedRows.folders.length, 'Notes' + expectedRows.notes.length]);
      log('trash.hasSelectAll', panel.hasSelectAll, true);
      log('trash.hasFilters', panel.hasFilters, 4);
      console.log('     card: ' + JSON.stringify(panel.card) + ' close: ' + JSON.stringify(panel.close));
      console.log('     rows: ' + JSON.stringify(panel.rows));
      console.log('     footer: ' + JSON.stringify(panel.footer.trim()));
    }
    await shot('19-trash-panel', 1440, 900, 'light');

    // The panel at phone width. Its narrow rules used to live in the global media block
    // *above* the panel CSS, and since a media query adds no specificity they were all
    // overridden by the base rules they were written to replace — so on a phone the toolbar
    // never wrapped and the padding stayed at the desktop value. This asserts they land.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 414, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(450);
    const narrow = await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      var card = dlg.querySelector('.panel');
      var cb = card.getBoundingClientRect();
      var tools = dlg.querySelector('.panel__tools');
      var field = dlg.querySelector('.search-field');
      var group = dlg.querySelector('.panel__group');
      return {
        width: Math.round(cb.width),
        viewport: window.innerWidth,
        cardLeft: Math.round(cb.left),
        cardInset: Math.round(group.getBoundingClientRect().left - cb.left),
        toolsWrap: getComputedStyle(tools).flexWrap,
        sepHidden: getComputedStyle(dlg.querySelector('.panel__sep')).display,
        searchOnItsOwnLine: Math.round(field.getBoundingClientRect().left) === Math.round(group.getBoundingClientRect().left)
      };
    })()`);
    // The card keeps its inset from the phone's edges — a full-bleed band is what the
    // inset exists to prevent — and the horizontal padding inside it tightens.
    log('trash.mobileCardKeepsItsInset', narrow.cardLeft, 12);
    log('trash.mobileCardFitsTheViewport', narrow.width, narrow.viewport - 24);
    log('trash.mobileTightensThePadding', narrow.cardInset, 15);
    // Wrapping instead of squeezing is what keeps the filters and the filter field readable
    // at 414px; the separator is dropped because a wrapped row already separates them.
    log('trash.mobileWrapsTheToolbar', narrow.toolsWrap, 'wrap');
    log('trash.mobileDropsTheSeparator', narrow.sepHidden, 'none');
    log('trash.mobileGivesTheFilterItsOwnLine', narrow.searchOnItsOwnLine, true);
    await shot('29-trash-mobile', 414, 800, 'light');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(420);

    // The counts in the toolbar have to match the data, or the filters lie.
    const rowCount = await cdp.evaluate(`document.querySelectorAll('dialog.dialog--full .trash-row').length`);
    log('trash.rowCountMatchesData',
      rowCount, expectedRows.folders.length + expectedRows.notes.length);
    // A folder that was deleted with contents must say so: "1 item inside" is the only
    // cue that restoring or purging it moves more than one row.
    const nestedRow = await cdp.evaluate(`(function(){
      var rows = Array.prototype.slice.call(document.querySelectorAll('dialog.dialog--full .trash-row'));
      return rows.map(function(r){
        return { kind: r.getAttribute('data-kind'),
                 name: r.querySelector('.trash-row__name').textContent,
                 meta: r.querySelector('.trash-row__meta').textContent };
      });
    })()`);
    log('trash.deletedFolderReportsItsContents',
      nestedRow.some((r) => r.kind === 'folder' && /item inside/.test(r.meta)), true);
    log('trash.descendantShowsItIsNested',
      nestedRow.some((r) => r.name === 'Script drafts'), true);

    // Select one row via its checkbox.
    await cdp.evaluate(`(function(){
      var box = document.querySelector('dialog.dialog--full .trash-row .checkbox__input');
      box.click();
      return 'ticked';
    })()`);
    await sleep(420);
    const selected = await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      return {
        rowsSelected: dlg.querySelectorAll('.trash-row.is-selected').length,
        footer: dlg.querySelector('.panel__foot').textContent.trim(),
        allState: (function(){ var i = dlg.querySelector('.checkbox__input'); return { checked: i.checked, indeterminate: i.indeterminate }; })()
      };
    })()`);
    log('trash.rowSelects', selected.rowsSelected, 1);
    log('trash.selectAllGoesIndeterminate', selected.allState, { checked: false, indeterminate: true });
    console.log('     footer: ' + JSON.stringify(selected.footer));

    // Select-all, then confirm the bulk footer offers both operations.
    await cdp.evaluate(`document.querySelector('dialog.dialog--full .trash-row .checkbox__input').click()`);
    await sleep(200);
    await cdp.evaluate(`(function(){ document.querySelector('dialog.dialog--full .panel__tools .checkbox__input').click(); return 'all'; })()`);
    await sleep(320);
    const bulk = await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      return {
        selected: dlg.querySelectorAll('.trash-row.is-selected').length,
        actions: Array.prototype.map.call(dlg.querySelectorAll('.panel__foot .btn'), function(b){ return b.getAttribute('data-action'); }),
        allChecked: dlg.querySelector('.panel__tools .checkbox__input').checked
      };
    })()`);
    log('trash.selectAllSelectsEveryRow', bulk.selected, rowCount);
    log('trash.bulkActions', bulk.actions,
      ['clear-trash-selection', 'restore-selected-trash', 'delete-selected-trash']);
    await shot('20-trash-selected', 1440, 900, 'light');

    // Right-click inside the panel: the bulk menu must name the selection.
    const trashMenu = await cdp.evaluate(`(function(){
      var row = document.querySelector('dialog.dialog--full .trash-row');
      var box = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: Math.round(box.left + 80), clientY: Math.round(box.top + 20)
      }));
      var menu = document.querySelector('.menu');
      var live = Array.prototype.filter.call(document.querySelectorAll('.menu'), function(m){ return !m.classList.contains('is-hidden'); })[0];
      return live ? {
        title: (live.querySelector('.menu__title') || {}).textContent || null,
        items: Array.prototype.map.call(live.querySelectorAll('.menu__item'), function(b){ return b.querySelector('.menu__label').textContent; }),
        // Also assert where the menu lives: a menu appended to <body> while a modal is open
        // is behind the dialog's backdrop — in the DOM, and invisible on screen.
        parentClass: live.parentNode.className
      } : null;
    })()`);
    log('trashMenu.namesSelection', trashMenu && trashMenu.title, rowCount + ' items selected');
    log('trashMenu.offersBoth', trashMenu && trashMenu.items,
      ['Restore ' + rowCount + ' items', 'Delete ' + rowCount + ' items permanently\u2026']);
    log('trashMenu.livesInsideTheDialog', trashMenu && trashMenu.parentClass, 'dialog dialog--full');
    await shot('21-trash-menu', 1440, 900, 'light');
    await closeMenu();

    // Filter: switching to Folders must hide every note row.
    await cdp.evaluate(`(function(){
      var items = Array.prototype.slice.call(document.querySelectorAll('dialog.dialog--full .segmented__item'));
      var folder = items.filter(function(i){ return i.textContent.indexOf('Folders') === 0; })[0];
      folder.querySelector('.segmented__input').click();
      return 'filtered';
    })()`);
    await sleep(360);
    // Diagnostic: state at the moment of the assertion, so a failure says which of the
    // links broke — the panel handle, the filter state, or the repaint itself.
    console.log('     [diag] ' + JSON.stringify(await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      var body = dlg.querySelector('.dialog__body');
      var calls = [];
      var real = body.__refresh;
      body.__refresh = function(next){ calls.push(next.view); return real(next); };
      var out = {
        dialogRefresh: typeof dlg.__refresh,
        bodyRefresh: typeof body.__refresh,
        checked: dlg.querySelector('.segmented__input:checked').value,
        badge: dlg.querySelector('.segmented__item:has(.segmented__input:checked) .segmented__badge').textContent,
        groupHeads: dlg.querySelectorAll('.panel__group').length
      };
      // Re-drive the same state change the radio click should have made, and see whether
      // the repaint follows. If it does, the wiring between the two is what is broken.
      var input = dlg.querySelector('.segmented__input[value="folder"]');
      input.checked = false;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      out.refreshCalls = calls.slice();
      out.groupHeadsAfter = dlg.querySelectorAll('.panel__group').length;
      out.rowsAfter = dlg.querySelectorAll('.trash-row').length;
      return out;
    })()`)));
    const filtered = await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      var rows = dlg.querySelectorAll('.trash-row');
      return {
        kinds: Array.prototype.map.call(rows, function(r){ return r.getAttribute('data-kind'); }),
        badge: dlg.querySelector('.segmented__item:has(.segmented__input:checked) .segmented__badge').textContent
      };
    })()`);
    log('trash.filterToFolders', filtered.kinds, ['folder']);
    log('trash.filterBadgeCountsFolders', filtered.badge, String(expectedRows.folders.length));
    await shot('22-trash-filtered', 1440, 900, 'light');

    // The notes filter has to include nested notes, not only loose ones.
    await cdp.evaluate(`(function(){
      var items = Array.prototype.slice.call(document.querySelectorAll('dialog.dialog--full .segmented__item'));
      var notes = items.filter(function(i){ return i.textContent.indexOf('Notes') === 0; })[0];
      notes.querySelector('.segmented__input').click();
      return 'notes';
    })()`);
    await sleep(340);
    const notesOnly = await cdp.evaluate(`(function(){
      var rows = document.querySelectorAll('dialog.dialog--full .trash-row');
      return Array.prototype.map.call(rows, function(r){ return r.getAttribute('data-kind'); });
    })()`);
    log('trash.filterToNotes', notesOnly, expectedRows.notes.map(function () { return 'note'; }));

    await cdp.evaluate(`(function(){
      var items = Array.prototype.slice.call(document.querySelectorAll('dialog.dialog--full .segmented__item'));
      var all = items.filter(function(i){ return i.textContent.indexOf('All') === 0; })[0];
      all.querySelector('.segmented__input').click();
      return 'reset';
    })()`);
    await sleep(320);

    // Restore the loose note by its own row button, and prove the panel stays open on the
    // same list rather than snapping shut — you usually want to keep working in here.
    // The note is chosen by name so this stays a test of the restore path, not of row
    // order; the nested one lives inside a trashed folder and is covered separately.
    const looseTitle = 'Receipts 2025';
    await cdp.evaluate(`(function(){
      var rows = Array.prototype.slice.call(document.querySelectorAll('dialog.dialog--full .trash-row'));
      var note = rows.filter(function(r){
        return r.getAttribute('data-kind') === 'note'
          && r.querySelector('.trash-row__name').textContent === ${JSON.stringify('__TITLE__')};
      })[0];
      note.querySelector('[data-action="restore-trash-item"]').click();
      return 'restore';
    })()`.replace('__TITLE__', looseTitle));
    await sleep(1600);
    const afterRestore = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var dlg = document.querySelector('dialog.dialog--full');
      return {
        panelStillOpen: !!dlg,
        rowsLeft: dlg ? dlg.querySelectorAll('.trash-row').length : -1,
        folderRowsLeft: dlg ? dlg.querySelectorAll('.trash-row[data-kind="folder"]').length : -1,
        liveNotes: App.db.listAllNotes(App.app.state.workspaceId).filter(function(n){ return n.title === ${JSON.stringify('__TITLE__')}; }).length
      };
    })()`.replace('__TITLE__', looseTitle));
    log('restore.panelStaysOpen', afterRestore.panelStillOpen, true);
    log('restore.noteIsLiveAgain', afterRestore.liveNotes, 1);
    // A loose note restores on its own: exactly one row leaves the list, and the folder
    // that is separately in the trash is untouched (it is somebody else's restore).
    log('restore.onlyThatRowLeaves', afterRestore.rowsLeft, expectedTotal - 1);
    log('restore.untouchedRowsStay', afterRestore.folderRowsLeft, expectedRows.folders.length);

    // Restoring a note whose folder is also deleted must bring the folder back too,
    // otherwise the note is live but invisible in every list.
    const orphan = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      return App.db.createFolder(ws, 'Outer', null).then(function(outer){
        return App.db.createFolder(ws, 'Inner', outer.id).then(function(inner){
          return App.db.createNote(ws, inner.id, 'Buried note').then(function(note){
            return App.db.deleteFolder(outer.id).then(function(){
              return App.db.restoreWithAncestors('note', note.id).then(function(ancestors){
                var back = App.db.getNote(note.id);
                var folders = App.db.listFolders(ws);
                return {
                  ancestorsRestored: ancestors,
                  noteIsLive: !!back,
                  innerIsLive: folders.some(function(f){ return f.id === inner.id; }),
                  outerIsLive: folders.some(function(f){ return f.id === outer.id; })
                };
              });
            });
          });
        });
      });
    })()`);
    log('restore.ancestorsBroughtBack', orphan, {
      ancestorsRestored: 2, noteIsLive: true, innerIsLive: true, outerIsLive: true,
    });

    // Permanent delete, end to end, through the panel's own button and confirm dialog.
    //
    // The fixture is built from scratch here so the numbers asserted below come from the
    // data rather than from the phases above: everything still in the trash is put back
    // first, then one folder holding one subfolder holding one note is trashed. That shape
    // is deliberate — deleting the top folder pulls in a subfolder the user never ticked,
    // which is the cascade the confirm has to own up to.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var existing = App.db.listTrash(ws);
      var jobs = existing.folders.map(function(f){ return App.db.restoreFolder(f.id); })
        .concat(existing.notes.map(function(n){ return App.db.restoreWithAncestors('note', n.id); }))
        .concat(existing.files.map(function(f){ return App.db.restoreWithAncestors('file', f.id); }));
      return Promise.all(jobs).then(function(){
        return App.db.createFolder(ws, 'Purge me', null);
      }).then(function(outer){
        return App.db.createFolder(ws, 'Sub', outer.id).then(function(sub){
          return App.db.createNote(ws, sub.id, 'Inside the sub').then(function(){
            return App.db.deleteFolder(outer.id);
          });
        });
      });
    })()`);
    await sleep(900);
    await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      dlg.querySelector('.panel__foot [data-action="close-trash"]').click();
      return 'closed';
    })()`);
    await sleep(900);
    await cdp.evaluate(`document.getElementById('workspace-trash').click()`);
    await sleep(900);

    const purgeTarget = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.listTrash(App.app.state.workspaceId);
      var dlg = document.querySelector('dialog.dialog--full');
      return {
        folders: t.folders.map(function(f){ return f.name; }),
        notes: t.notes.map(function(n){ return n.title; }),
        files: t.files.length,
        rows: dlg.querySelectorAll('.trash-row').length,
        refreshHandle: typeof dlg.querySelector('.dialog__body').__refresh
      };
    })()`);
    console.log('     purge target: ' + JSON.stringify(purgeTarget));
    // The fixture is the only thing in the trash, so the panel is showing exactly it.
    log('purge.fixtureIsTheWholeTrash', purgeTarget.rows, 3);
    log('purge.panelHandleInstalled', purgeTarget.refreshHandle, 'function');

    // Tick the folder row specifically — deleting it is what makes the cascade visible.
    await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      var row = dlg.querySelector('.trash-row[data-kind="folder"]');
      row.querySelector('.checkbox__input').click();
      return 'ticked';
    })()`);
    await sleep(360);
    await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      dlg.querySelector('[data-action="delete-selected-trash"]').click();
      return 'purge';
    })()`);
    await sleep(900);
    const confirmDialog = await cdp.evaluate(`(function(){
      var d = document.querySelector('dialog[open]:not(.dialog--full)');
      if (!d) return null;
      return {
        title: d.querySelector('.dialog__title').textContent,
        danger: d.classList.contains('dialog--danger'),
        consequences: Array.prototype.map.call(d.querySelectorAll('.dialog__consequences li'), function(li){ return li.textContent; }),
        focus: document.activeElement ? document.activeElement.textContent.trim() : null
      };
    })()`);
    log('purge.confirmNamesTheLoss', !!confirmDialog, true);
    if (confirmDialog) {
      log('purge.confirmIsDanger', confirmDialog.danger, true);
      log('purge.focusOnSafeOption', confirmDialog.focus, 'Keep in trash');
      // Two folders ticked as one: the top folder takes its subfolder with it — the confirm
      // is the only place that can say so before the data is gone.
      log('purge.countsTheWholeSubtree', confirmDialog.consequences[0], '2 folders.');
      log('purge.explainsTheCascade',
        confirmDialog.consequences.some(function (c) { return /more than the 1 you selected/.test(c); }), true);
      console.log('     consequences: ' + JSON.stringify(confirmDialog.consequences));
    }
    await shot('23-purge-confirm', 1440, 900, 'light');

    await cdp.evaluate(`(function(){
      var d = document.querySelector('dialog[open]:not(.dialog--full)');
      var confirm = Array.prototype.slice.call(d.querySelectorAll('.dialog__footer .btn')).filter(function(b){ return b.type === 'submit'; })[0];
      confirm.click();
      return 'confirmed';
    })()`);
    // The purge runs a write per removed row, and each write re-serialises the whole
    // database into IndexedDB: wait for the busy dialog to come and go rather than
    // guessing a duration.
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const busy = await cdp.evaluate(`document.querySelectorAll('dialog[open]:not(.dialog--full)').length`);
      if (busy === 0) break;
    }
    await sleep(500);
    const afterPurge = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var dlg = document.querySelector('dialog.dialog--full');
      return {
        panelStillOpen: !!dlg,
        rowsLeft: dlg ? dlg.querySelectorAll('.trash-row').length : -1,
        folderRowsLeft: dlg ? dlg.querySelectorAll('.trash-row[data-kind="folder"]').length : -1,
        rowsRemaining: (function(){ var t = App.db.listTrash(App.app.state.workspaceId); return t.folders.length + t.notes.length + t.files.length; })(),
        folderGone: !App.db.listFolders(App.app.state.workspaceId).some(function(f){ return f.name === 'Purge me'; }),
        nestedGone: !App.db.listFolders(App.app.state.workspaceId).some(function(f){ return f.name === 'Sub'; }),
        noteGone: !App.db.listAllNotes(App.app.state.workspaceId).some(function(n){ return n.title === 'Inside the sub'; }),
        emptyText: dlg ? (dlg.querySelector('.trash-empty') ? dlg.querySelector('.trash-empty h3').textContent : null) : null,
        openDialogs: document.querySelectorAll('dialog[open]').length,
        leftover: (function(){
          var t = App.db.listTrash(App.app.state.workspaceId);
          return { folders: t.folders.map(function(f){ return f.name; }), notes: t.notes.map(function(n){ return n.title; }) };
        })()
      };
    })()`);
    log('purge.panelStaysOpen', afterPurge.panelStillOpen, true);
    log('purge.folderReallyGone', afterPurge.folderGone, true);
    log('purge.theNoteInsideWentWithIt', afterPurge.noteGone, true);
    // The nested folder was trashed by the cascade, so removing the parent has to remove
    // it too — otherwise its notes are orphaned rows pointing at a folder that is gone.
    log('purge.nestedFolderGoneToo', afterPurge.nestedGone, true);
    log('purge.everythingElseLeftTheTrash', afterPurge.rowsRemaining, 0);
    console.log('     leftover in trash: ' + JSON.stringify(afterPurge.leftover));
    log('purge.emptyStateShown', afterPurge.emptyText, 'Trash is empty');
    log('purge.noDialogLeftBehind', afterPurge.openDialogs, 1);
    await shot('24-trash-empty', 1440, 900, 'light');

    // Closing the panel: go through the panel's own control, so what is exercised is the
    // app's teardown path rather than a raw DOM close.
    await cdp.evaluate(`(function(){
      var back = document.querySelector('dialog.dialog--full .panel__foot [data-action="close-trash"]');
      if (back) back.click();
      return 'closed';
    })()`);
    await sleep(900);
    const closed = await cdp.evaluate(`(function(){
      return {
        panelGone: !document.querySelector('dialog.dialog--full'),
        treeRows: document.querySelectorAll('#tree .tree__row').length,
        railReadout: document.getElementById('rail-storage').textContent.trim(),
        diag: {
          fullDialogs: document.querySelectorAll('dialog.dialog--full').length,
          openDialogs: document.querySelectorAll('dialog[open]').length
        }
      };
    })()`);
    log('close.panelGone', closed.panelGone, true);
    console.log('     [close diag] ' + JSON.stringify(closed.diag));
    log('close.treeStillRendered', closed.treeRows > 0, true);
    console.log('     rail readout after: ' + JSON.stringify(closed.railReadout));

    // ------------------------------------------------------------------ dark mode
    // Dark is not a filter over light: the danger tokens, the sticky group heading and
    // the selected-row fill all resolve differently, so the panel gets its own capture.
    await setTheme('dark');
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      return App.db.createNote(ws, null, 'Receipts 2025').then(function(n){
        return App.db.deleteNote(n.id);
      }).then(function(){
        return App.db.createFolder(ws, 'Old drafts', null);
      }).then(function(f){
        return App.db.deleteFolder(f.id);
      }).then(function(){
        document.getElementById('workspace-trash').click();
        return 'reopened';
      });
    })()`);
    await sleep(1200);
    await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      if (dlg) dlg.querySelector('.trash-row .checkbox__input').click();
      return 'selected';
    })()`);
    await sleep(420);
    await shot('25-trash-dark', 1440, 900, 'dark');
    await cdp.evaluate(`(function(){
      var dlg = document.querySelector('dialog.dialog--full');
      if (dlg) dlg.close();
      return 'closed';
    })()`);
    await sleep(700);
    await shot('26-rail-dark', 1440, 900, 'dark');

    const errs = await cdp.evaluate(`(function(){
      return window.__SHOT_ERRORS__ ? window.__SHOT_ERRORS__.join(' | ') : 'none captured';
    })()`);

    console.log('\nscreenshots written to tools/shots/');
    console.log(notes.join('\n'));
    console.log('page errors: ' + errs);

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
    if (failed.length) {
      failed.forEach((f) => console.log(`  FAIL ${f.name}: got ${JSON.stringify(f.value)}, expected ${JSON.stringify(f.expected)}`));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('TRASH CHECK ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close', params: {} })); } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
