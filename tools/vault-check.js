#!/usr/bin/env node
/**
 * vault-check.js — password-gated encryption of note bodies and file contents, end to end.
 *
 *   node tools/vault-check.js
 *
 * Drives the real index.html in headless Chromium over file://, in a throwaway profile, and
 * asserts the security property rather than a flag: after the vault is on, the raw database
 * bytes handed to storage (and to the "Export .db" button) must not contain the note's text or
 * the file's bytes anywhere — while the app's own read API keeps returning them unchanged.
 *
 * HOW IT PROVES THINGS. Every claim about what is STORED is made by scanning the exported
 * SQLite bytes for a unique random marker, never by trusting a boolean the app reports. Every
 * claim about the INTERFACE is made by clicking the app's real controls — the Settings button,
 * the lock notice's Unlock action, the dialogs' own submit buttons — through the same
 * delegated handlers a user's click reaches, so a gap between what the UI offers and what the
 * data layer does would show up here.
 *
 * NOT SEEDED. tools/trash-check.js preloads tools/shot-seed.js because it needs a busy
 * notebook to look at. This check wants the opposite: an empty one, where a marker found in
 * the raw bytes can only have come from the fixture this file wrote. It still uses the same
 * throwaway-profile pattern, so a real notebook is never touched.
 *
 * Writes PNGs to tools/shots/.
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
const profile = path.join(os.tmpdir(), 'noteapp-vault-profile-' + process.pid);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

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
/** An assertion. Counted in the final pass total. */
const log = (name, value, expected) => {
  const ok = expected === undefined ? true : JSON.stringify(value) === JSON.stringify(expected);
  results.push({ name, value, expected, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} = ${JSON.stringify(value)}${ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'}`);
};
/** A reported fact, not an assertion: printed, deliberately not counted. */
const info = (name, value) => { console.log(`     ${name} = ${JSON.stringify(value)}`); };

// --------------------------------------------------------------------- fixtures
const STAMP = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
const MARKER_NOTE = 'VAULTNOTEMARKER' + STAMP;
const MARKER_FILE = 'VAULTFILEMARKER' + STAMP;
const NOTE_TITLE = 'Encrypted fixture ' + STAMP;
// Deliberately SHORT and guessable. The scans in section (l) are negative assertions — "this
// string is nowhere in the exported bytes and nowhere in localStorage" — and a 40-character
// random string makes them unfalsifiable: nothing could contain it by accident, so a scan that
// read the wrong bytes entirely would still report zero. A short common password is the case
// where a hit is a real leak, and it is also the honest worst case, because a weak password is
// exactly when a leak matters most.
const PASSWORD = 'letmein1';
const WRONG_PASSWORD = 'letmein2';
const NOTE_BODY = 'The passphrase is hidden here: ' + MARKER_NOTE + '\nsecond line\nthird line';
const DUPLICATE_BODY = 'identical plaintext ' + MARKER_NOTE;
const FILE_TEXT = 'binary-fixture::' + MARKER_FILE + '::end';
const FILE_NAME = 'vault-fixture-' + STAMP + '.bin';

/** Count non-overlapping occurrences of a UTF-8 ASCII marker inside the exported bytes.
 *  The snapshot export inlines the attachment sidecar, so a payload parked in IndexedDB is
 *  scanned here too: a scan of the SQLite bytes alone would report the same clean zero. */
const countBytes = (marker) => `window.NoteApp.db.exportSnapshot().then(function (bytes) {
  var needle = new TextEncoder().encode(${JSON.stringify(marker)});
  var hits = 0;
  outer: for (var i = 0; i + needle.length <= bytes.length; i++) {
    for (var j = 0; j < needle.length; j++) { if (bytes[i + j] !== needle[j]) continue outer; }
    hits++;
    i += needle.length - 1;
  }
  return { hits: hits, size: bytes.length };
})`;

/** Values the check reads back from the page in one round trip. */
const STATE = `(function(){
  var App = window.NoteApp;
  return {
    vaultState: App.db.vaultState(),
    cryptoStatus: App.crypto.status(),
    supported: App.crypto.isSupported(),
    info: App.db.vaultInfo(),
    backend: App.storage.backendName()
  };
})()`;

/** Click a [data-action] element the way the app's own context menus do. */
const invokeAction = (action, id) => `(function(){
  var b = document.createElement('button');
  b.setAttribute('data-action', ${JSON.stringify(action)});
  ${id ? `b.setAttribute('data-id', ${JSON.stringify(id)});` : ''}
  document.body.appendChild(b);
  b.click();
  document.body.removeChild(b);
  return true;
})()`;

/** The innermost open dialog: the settings panel may still be behind whatever is on top. */
const DIALOG = `(function(){ var d = document.querySelectorAll('dialog[open]'); return d.length ? d[d.length - 1] : null; })()`;

const fillPassword = (index, value) => `(function(){
  var ds = document.querySelectorAll('dialog[open]');
  var d = ds[ds.length - 1];
  if (!d) return 'no dialog';
  var inputs = d.querySelectorAll('input[type="password"]');
  if (!inputs[${index}]) return 'no password field at ' + ${index};
  inputs[${index}].value = ${JSON.stringify(value)};
  inputs[${index}].dispatchEvent(new Event('input', { bubbles: true }));
  return inputs.length;
})()`;

const submitDialog = () => `(function(){
  var ds = document.querySelectorAll('dialog[open]');
  var d = ds[ds.length - 1];
  if (!d) return 'no dialog';
  var btns = Array.prototype.slice.call(d.querySelectorAll('.dialog__footer .btn'));
  var confirm = btns.filter(function(b){ return b.type === 'submit'; })[0];
  if (!confirm) return 'no submit button';
  confirm.click();
  return 'clicked';
})()`;

/** The stepped enable flow owns its footer buttons, so steps move by label. */
const clickDialogButton = (label) => `(function(){
  var ds = document.querySelectorAll('dialog[open]');
  var d = ds[ds.length - 1];
  if (!d) return 'no dialog';
  var btns = Array.prototype.slice.call(d.querySelectorAll('.dialog__footer .btn'));
  var hit = btns.filter(function(b){ return b.textContent.trim() === ${JSON.stringify(label)}; })[0];
  if (!hit) return 'no button ' + ${JSON.stringify(label)};
  hit.click();
  return 'clicked';
})()`;

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
  const notes = [];

  const shot = async (name, w, h) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(420);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    notes.push(`${name}.png  ${w}x${h}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
  };

  /** Poll a page expression until it is truthy. Returns whether it ever was. */
  const poll = async (expr, tries = 120, gap = 250) => {
    for (let i = 0; i < tries; i++) {
      if (await cdp.evaluate(expr)) return true;
      await sleep(gap);
    }
    return false;
  };

  const waitForReady = async () => {
    await poll('!!(window.NoteApp && window.NoteApp.app && window.NoteApp.db && window.NoteApp.db.isReady())', 120, 250);
    await cdp.evaluate('window.NoteApp.app.ready()');
    await sleep(600);
  };

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
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(6500);
    await waitForReady();

    // ------------------------------------------------------------------ (a) WebCrypto
    // The app runs from file://, where nothing guarantees crypto.subtle. It is a blocking
    // finding if it is missing, not something to route around: the feature would have to be
    // refused rather than silently storing plaintext.
    const env = await cdp.evaluate(`(function(){
      return {
        protocol: location.protocol,
        isSecureContext: window.isSecureContext,
        hasSubtle: !!(window.crypto && window.crypto.subtle),
        subtleType: window.crypto ? typeof window.crypto.subtle : 'no window.crypto',
        hasGetRandomValues: !!(window.crypto && typeof window.crypto.getRandomValues === 'function'),
        appSupported: window.NoteApp.crypto.isSupported(),
        backend: window.NoteApp.storage.backendName()
      };
    })()`);
    info('environment', env);
    log('a.subtleAvailableOnFileProtocol', env.hasSubtle, true);
    log('a.appReportsSupported', env.appSupported, true);
    if (!env.hasSubtle) {
      console.error('\nBLOCKING FINDING: crypto.subtle is unavailable in this context, so note bodies '
        + 'and file contents cannot be encrypted here at all. Stopping rather than continuing: '
        + 'every assertion below would be about plaintext.');
      throw new Error('crypto.subtle unavailable on ' + env.protocol);
    }

    // The stored iteration count is UNAUTHENTICATED: it sits in the vault row in the clear and
    // nothing covers it. An out-of-range one therefore has to be refused, not quietly replaced
    // by the default — a substitution would derive a key the notebook was never sealed under
    // and report that as a wrong password, which hides the tampering and downgrades the
    // derivation cost in the same move. The count is checked before any key is derived, so a
    // bad one answers immediately; that is also what makes this cheap to assert here, with a
    // synthetic row that never touches the notebook on disk.
    const badCounts = await cdp.evaluate(`(function(){
      function b64(length, seed) {
        var bytes = new Uint8Array(length);
        for (var i = 0; i < length; i++) bytes[i] = seed + i;
        var s = '';
        for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
        return btoa(s);
      }
      function tryCount(value) {
        return window.NoteApp.crypto.unlock({
          salt: b64(16, 1), check_iv: b64(12, 2), check_ct: b64(32, 3), iterations: value
        }, 'guessable').then(
          function () { return '(unlocked)'; },
          function (err) { return err.message; });
      }
      return Promise.all([tryCount(10), tryCount('abc'), tryCount(null)]).then(function (m) {
        return {
          tooLow: m[0], notANumber: m[1], missing: m[2],
          damaged: m.map(function (text) { return /vault metadata in this notebook is damaged/.test(text); })
        };
      });
    })()`);
    info('tampered iteration counts', badCounts);
    log('a.refusesAnOutOfRangeIterationCount', badCounts.damaged, [true, true, true]);
    log('a.doesNotBlameThePasswordForDamagedMetadata',
      /not the one this notebook was encrypted with/.test(badCounts.tooLow), false);

    // ------------------------------------------------------------------ (b) plaintext fixture
    const fixture = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var noteId = null;
      return App.db.createNote(ws, null, ${JSON.stringify(NOTE_TITLE)})
        .then(function (note) {
          noteId = note.id;
          return App.db.updateNote(note.id, ${JSON.stringify(NOTE_TITLE)}, ${JSON.stringify(NOTE_BODY)});
        })
        .then(function () {
          var bytes = new TextEncoder().encode(${JSON.stringify(FILE_TEXT)});
          return App.app.uploadFiles([new File([bytes], ${JSON.stringify(FILE_NAME)}, { type: 'application/octet-stream' })], null);
        })
        .then(function () {
          var file = App.db.listFilesIn(ws, null).filter(function (f) { return f.filename === ${JSON.stringify(FILE_NAME)}; })[0];
          return { noteId: noteId, fileId: file ? file.id : null, fileSize: file ? file.size : null, ws: ws };
        });
    })()`);
    info('fixture', fixture);
    log('b.fixtureNoteCreated', !!fixture.noteId, true);
    log('b.fixtureFileCreated', !!fixture.fileId, true);
    log('b.fileSizeIsPlaintextLength', fixture.fileSize, FILE_TEXT.length);

    const beforeNote = await cdp.evaluate(countBytes(MARKER_NOTE));
    const beforeFile = await cdp.evaluate(countBytes(MARKER_FILE));
    info('raw db bytes, vault off', beforeNote.size);
    log('b.noteMarkerPresentInRawBytes', beforeNote.hits > 0, true);
    log('b.fileMarkerPresentInRawBytes', beforeFile.hits > 0, true);
    // The API returns the fixture unchanged while the vault is off — the baseline the invariant
    // is measured against.
    const plainRead = await cdp.evaluate(`(function(){
      var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)});
      return { content: n.content, locked: !!n.locked, damaged: !!n.damaged, stored: window.NoteApp.db.storedContent(n.id) };
    })()`);
    log('b.getNoteReturnsPlaintextWhenOff', plainRead.content, NOTE_BODY);
    log('b.storedContentIsPlaintextWhenOff', plainRead.stored, NOTE_BODY);
    log('b.nothingLockedWhenOff', [plainRead.locked, plainRead.damaged], [false, false]);

    // ------------------------------------------------------------ (c) enable via the UI
    await cdp.evaluate(`document.getElementById('settings-open').click()`);
    await sleep(600);
    const enableButton = await cdp.evaluate(`(function(){
      var b = document.querySelector('[data-action="vault-enable"]');
      if (!b) return 'missing';
      b.click();
      return 'clicked';
    })()`);
    log('c.settingsOffersEnable', enableButton, 'clicked');
    await sleep(700);
    const enableDialog = await cdp.evaluate(`(function(){
      var d = ${DIALOG};
      if (!d) return null;
      return {
        title: d.querySelector('.dialog__title') ? d.querySelector('.dialog__title').textContent : null,
        consequences: Array.prototype.map.call(d.querySelectorAll('.dialog__consequences li'), function(li){ return li.textContent; }),
        fields: d.querySelectorAll('input[type="password"]').length
      };
    })()`);
    info('enable dialog', enableDialog);
    log('c.enableShowsOneFieldAtATime', enableDialog ? enableDialog.fields : -1, 1);
    log('c.warnsItCannotBeRecovered',
      !!enableDialog && enableDialog.consequences.some((c) => /forgotten password cannot be recovered/i.test(c)), true);

    // A short password must be refused on step 1 — the rule is stated, not silently applied.
    await cdp.evaluate(fillPassword(0, 'short'));
    await cdp.evaluate(clickDialogButton('Continue'));
    await sleep(700);
    const tooShort = await cdp.evaluate(`(function(){
      var d = ${DIALOG};
      var err = d ? d.querySelector('.field__message--error') : null;
      return { message: err ? err.textContent : null, state: window.NoteApp.db.vaultState() };
    })()`);
    log('c.shortPasswordRefused', tooShort.state, 'off');
    log('c.shortPasswordExplained', /at least 8 characters/i.test(tooShort.message || ''), true);

    // A mismatch must be refused before anything is written.
    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(clickDialogButton('Continue'));
    await sleep(500);
    await cdp.evaluate(fillPassword(0, PASSWORD + '-typo'));
    await cdp.evaluate(clickDialogButton('Encrypt this notebook'));
    await sleep(700);
    const mismatch = await cdp.evaluate(`(function(){
      var d = ${DIALOG};
      var err = d ? d.querySelector('.field__message--error') : null;
      return { message: err ? err.textContent : null, state: window.NoteApp.db.vaultState() };
    })()`);
    log('c.mismatchRefused', mismatch.state, 'off');
    log('c.mismatchExplained', /do not match/i.test(mismatch.message || ''), true);

    // Back keeps the first password, so a typo costs one field, not the whole flow.
    await cdp.evaluate(clickDialogButton('Back'));
    await sleep(500);
    const kept = await cdp.evaluate(`(function(){
      var d = ${DIALOG};
      var inp = d ? d.querySelector('input[type="password"]') : null;
      return inp ? inp.value : null;
    })()`);
    log('c.backKeepsTheFirstPassword', kept, PASSWORD);
    await cdp.evaluate(clickDialogButton('Continue'));
    await sleep(500);
    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(clickDialogButton('Encrypt this notebook'));
    // Enabling ends LOCKED: the key that did the sealing is dropped as the last step of the
    // conversion, so the protection starts with the action rather than with the next reload.
    const enabled = await poll(`window.NoteApp.db.vaultState() === 'locked'`, 160, 250);
    log('c.enableCompletes', enabled, true);
    await sleep(600);

    const afterEnable = await cdp.evaluate(STATE);
    info('state after enabling', afterEnable);
    log('c.locksAsSoonAsEncryptionIsOn', afterEnable.vaultState, 'locked');
    log('c.iterationsRecorded', afterEnable.info.iterations, 600000);

    // And the way back in is right there in the panel that is already open, with no reload.
    await cdp.evaluate(`document.querySelector('[data-action="vault-unlock"]').click()`);
    await sleep(700);
    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(submitDialog());
    const reopened = await poll(`window.NoteApp.db.vaultState() === 'unlocked'`, 160, 250);
    log('c.unlocksAgainWithoutAReload', reopened, true);
    await sleep(400);
    // The conversion's own dialog has to be gone: a progress dialog still sitting over an
    // enabled notebook is the interface claiming something is still happening. The Settings
    // panel it was opened from is deliberately still up underneath, so what this asserts is
    // what its old name claimed — that no dialog opened BY the conversion is left open —
    // rather than a bare count of 1, which a second stray dialog would satisfy just as well.
    const openDialogs = await cdp.evaluate(`(function(){
      return Array.prototype.map.call(document.querySelectorAll('dialog[open]'), function(d){ return d.id || '(unnamed)'; });
    })()`);
    info('dialogs still open', openDialogs);
    log('c.noConversionDialogLeftOpen', openDialogs.filter(function(id){ return id !== 'settings-dialog'; }), []);
    log('c.settingsPanelStillUpUnderneath', openDialogs.indexOf('settings-dialog') !== -1, true);

    // The invariant: callers are unaffected.
    const encryptedRead = await cdp.evaluate(`(function(){
      var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)});
      return { content: n.content, stored: window.NoteApp.db.storedContent(n.id) };
    })()`);
    log('c.getNoteStillReturnsTheSameText', encryptedRead.content, NOTE_BODY);

    const afterNote = await cdp.evaluate(countBytes(MARKER_NOTE));
    const afterFile = await cdp.evaluate(countBytes(MARKER_FILE));
    const afterWord = await cdp.evaluate(countBytes('The passphrase is hidden here'));
    info('raw db bytes, vault on', afterNote.size);
    log('c.noteMarkerGoneFromRawBytes', afterNote.hits, 0);
    log('c.noteBodyWordsGoneFromRawBytes', afterWord.hits, 0);
    log('c.fileMarkerGoneFromRawBytes', afterFile.hits, 0);

    // ------------------------------------------------- (d) envelope marker in the column
    log('d.storedContentIsEnvelope', encryptedRead.stored.indexOf('enc:v1:'), 0);
    const fileStored = await cdp.evaluate(`window.NoteApp.storage.getBlob(${JSON.stringify(fixture.fileId)}).then(function (stored) {
      if (!stored) return { type: 'none', prefix: '(none)' };
      if (stored.type !== 'application/x-noteapp-sealed') return { type: stored.type, prefix: '(bytes)' };
      return stored.text().then(function (text) { return { type: 'sealed', prefix: text.slice(0, 7) }; });
    })`);
    info('stored file value', fileStored);
    log('d.storedFileIsEnvelope', fileStored.prefix, 'enc:v1:');

    // Those two assertions go through the app's OWN diagnostics, so the columns are read a
    // second time independently of them: a fresh SQLite connection opened over the exported
    // bytes, with the same SQL the accessors run. A lying accessor cannot make this pass — and
    // the title, which is stored in the clear, is read through the same connection, so the
    // reader is proven to be reading the real notes table rather than returning nothing.
    const snapshotB64 = await cdp.evaluate(`window.NoteApp.db.exportSnapshot().then(function (bytes) {
      var parts = [];
      for (var i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
      return btoa(parts.join(''));
    })`);
    const rawTables = await cdp.evaluate(`(function(){
      return initSqlJs().then(function (SQL) {
        var bin = atob(${JSON.stringify(snapshotB64)});
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var raw = new SQL.Database(bytes);
        function cell(sql, id) {
          var stmt = raw.prepare(sql);
          stmt.bind([id]);
          var value = null;
          if (stmt.step()) value = stmt.get()[0];
          stmt.free();
          return value;
        }
        var out = {
          note: cell('SELECT content FROM notes WHERE id = ?', ${JSON.stringify(fixture.noteId)}),
          file: cell('SELECT blob_data FROM files WHERE id = ?', ${JSON.stringify(fixture.fileId)}),
          title: cell('SELECT title FROM notes WHERE id = ?', ${JSON.stringify(fixture.noteId)})
        };
        raw.close();
        return {
          notePrefix: typeof out.note === 'string' ? out.note.slice(0, 7) : '(' + typeof out.note + ')',
          filePrefix: typeof out.file === 'string' ? out.file.slice(0, 7) : '(' + typeof out.file + ')',
          title: out.title
        };
      });
    })()`);
    info('raw table read', rawTables);
    log('d.rawNotesTableHoldsAnEnvelope', rawTables.notePrefix, 'enc:v1:');
    log('d.rawFilesTableHoldsAnEnvelope', rawTables.filePrefix, 'enc:v1:');
    log('d.rawReadStillSeesThePlaintextTitle', rawTables.title, NOTE_TITLE);

    // ------------------------------------------- (e) identical plaintext, different ciphertext
    const twins = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      return App.db.createNote(ws, null, 'twin one')
        .then(function (a) { return App.db.updateNote(a.id, 'twin one', ${JSON.stringify(DUPLICATE_BODY)}).then(function () { return a.id; }); })
        .then(function (a) {
          return App.db.createNote(ws, null, 'twin two')
            .then(function (b) { return App.db.updateNote(b.id, 'twin two', ${JSON.stringify(DUPLICATE_BODY)}).then(function () { return [a, b.id]; }); });
        })
        .then(function (ids) {
          var one = App.db.storedContent(ids[0]);
          var two = App.db.storedContent(ids[1]);
          return { equal: one === two, bothEnvelopes: one.indexOf('enc:v1:') === 0 && two.indexOf('enc:v1:') === 0, sample: one.slice(0, 24) };
        });
    })()`);
    info('twin ciphertext', twins.sample);
    log('e.twinsBothEncrypted', twins.bothEnvelopes, true);
    log('e.twinsDifferUnderSamePlaintext', twins.equal, false);

    // ---------------------------------------- (f) a reload in this tab stays unlocked
    // The unlock is remembered for the TAB that made it: the record holds the CryptoKey object
    // itself and is tagged with this tab's session id, so a reload adopts it and lands on the
    // notes instead of on a lock notice.
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(6500);
    await waitForReady();
    const afterReload = await cdp.evaluate(STATE);
    info('state after reload', afterReload);
    log('f.staysUnlockedAfterReload', afterReload.vaultState, 'unlocked');
    log('f.stillIndexedDb', afterReload.backend, 'indexeddb');
    // Adopted, not merely claimed: the remembered key has to actually open the data.
    const resumedRead = await cdp.evaluate(`(function(){
      var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)});
      return { content: n ? n.content : null, locked: !!(n && n.locked) };
    })()`);
    log('f.readsTheNoteAfterReload', resumedRead.content, NOTE_BODY);
    log('f.nothingLockedAfterReload', resumedRead.locked, false);
    const remembered = await cdp.evaluate(`window.NoteApp.storage.loadVaultKey().then(function (r) {
      return !!(r && r.key && r.key.extractable === false);
    })`);
    log('f.rememberedKeyCannotBeExported', remembered, true);

    // ------------------------- (f2) a session that did not unlock starts locked
    // A new tab (or a browser restart) carries no session id of its own, and that id is what
    // the record is tagged with. Clearing it here is the same input to the same code, without
    // a second DevTools session to drive. The remembered key is then nobody's and is dropped.
    await cdp.evaluate(`sessionStorage.removeItem('noteapp.session.id')`);
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(6500);
    await waitForReady();
    const freshSession = await cdp.evaluate(STATE);
    info('state in a session that did not unlock', freshSession);
    log('f.startsLockedInASessionThatDidNotUnlock', freshSession.vaultState, 'locked');
    const droppedRecord = await cdp.evaluate(`window.NoteApp.storage.loadVaultKey().then(function (r) {
      return r ? 'kept' : 'dropped';
    })`);
    log('f.dropsAKeyNoSessionOwns', droppedRecord, 'dropped');

    const lockedView = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var n = App.db.getNote(${JSON.stringify(fixture.noteId)});
      return {
        content: n ? n.content : '(no row)',
        locked: !!(n && n.locked),
        title: n ? n.title : null,
        treeHasTitle: document.getElementById('tree').textContent.indexOf(${JSON.stringify(NOTE_TITLE)}) !== -1,
        titleColumnReadable: n ? n.title : null
      };
    })()`);
    log('f.getNoteDoesNotThrowWhileLocked', lockedView.title, NOTE_TITLE);
    log('f.lockedFlagIsTruthful', lockedView.locked, true);
    log('f.contentIsNullNotEmptyString', lockedView.content, null);
    log('f.treeStillShowsTheTitle', lockedView.treeHasTitle, true);

    await cdp.evaluate(invokeAction('open-note', fixture.noteId));
    await sleep(700);
    const editorWhileLocked = await cdp.evaluate(`(function(){
      var main = document.getElementById('main');
      var notice = main.querySelector('.lock-notice');
      return {
        hasNotice: !!notice,
        noticeText: notice ? notice.textContent.replace(/\\s+/g, ' ').trim() : null,
        emptyEditor: !!document.getElementById('note-body'),
        actions: notice ? Array.prototype.map.call(notice.querySelectorAll('[data-action]'), function(b){ return b.getAttribute('data-action'); }) : []
      };
    })()`);
    info('locked editor', editorWhileLocked);
    log('f.showsLockNoticeNotAnEditor', editorWhileLocked.hasNotice && !editorWhileLocked.emptyEditor, true);
    log('f.noticeOffersUnlock', editorWhileLocked.actions.indexOf('vault-unlock') !== -1, true);
    await shot('36-vault-locked', 1440, 900);

    // A locked file preview: no bytes, and the pane says why.
    const lockedFilePane = await cdp.evaluate(`window.NoteApp.db.getFileBlob(${JSON.stringify(fixture.fileId)}).then(function (blob) {
      return { blob: blob === null ? null : 'returned', state: window.NoteApp.db.vaultState() };
    })`);
    log('f.getFileBlobReturnsNullWhileLocked', lockedFilePane.blob, null);
    await cdp.evaluate(invokeAction('open-file', fixture.fileId));
    await sleep(700);
    const lockedFileView = await cdp.evaluate(`(function(){
      var main = document.getElementById('main');
      return {
        hasNotice: !!main.querySelector('.lock-notice'),
        offersDownload: !!main.querySelector('[data-action="download-file"]'),
        showsName: main.textContent.indexOf(${JSON.stringify(FILE_NAME)}) !== -1
      };
    })()`);
    log('f.filePreviewSaysLocked', lockedFileView.hasNotice, true);
    log('f.filePreviewOffersNoDeadDownload', lockedFileView.offersDownload, false);
    log('f.fileNameStillVisible', lockedFileView.showsName, true);

    // Nothing may be WRITTEN into an encrypted notebook while it is locked. encrypt() rejects
    // rather than passing text through, and these are the two writers a user can reach without
    // unlocking: a new note, and an upload. A rejection that still left a row behind would be
    // the plaintext hole this whole design exists to close.
    const lockedWrites = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var notesBefore = App.db.listAllNotes(ws).length;
      var filesBefore = App.db.listFilesIn(ws, null).length;
      function counts() {
        return { notesAdded: App.db.listAllNotes(ws).length - notesBefore, filesAdded: App.db.listFilesIn(ws, null).length - filesBefore };
      }
      return App.db.createNote(ws, null, 'must not exist').then(
        function () { return { noteRejected: false }; },
        function (noteErr) {
          return App.db.addFile(ws, null, 'must-not-exist.bin', 'application/octet-stream', new Uint8Array([1, 2, 3])).then(
            function () { return { noteRejected: true, fileRejected: false }; },
            function (fileErr) {
              var c = counts();
              return {
                noteRejected: true, fileRejected: true,
                noteMessage: noteErr.message, fileMessage: fileErr.message,
                notesAdded: c.notesAdded, filesAdded: c.filesAdded
              };
            });
        });
    })()`);
    info('locked writes', lockedWrites);
    log('f.createNoteRefusedWhileLocked', lockedWrites.noteRejected, true);
    log('f.addFileRefusedWhileLocked', lockedWrites.fileRejected, true);
    log('f.noRowWrittenWhileLocked', [lockedWrites.notesAdded, lockedWrites.filesAdded], [0, 0]);
    log('f.refusalSaysWhy', /locked/i.test(lockedWrites.noteMessage || ''), true);

    // Renaming while locked hands the data layer a null body, because the caller has no
    // plaintext to give it. That must leave the stored ciphertext exactly as it was: a rename
    // that wrote NULL (or an empty string) over the body would destroy the note while looking
    // like it only changed the title.
    const renameWhileLocked = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var id = ${JSON.stringify(fixture.noteId)};
      var before = App.db.storedContent(id);
      return App.db.updateNote(id, 'Renamed while locked', null).then(function () {
        var after = App.db.storedContent(id);
        return App.db.updateNote(id, ${JSON.stringify(NOTE_TITLE)}, null).then(function () {
          return {
            bytesUnchanged: before === after,
            stillEnvelope: after.indexOf('enc:v1:') === 0,
            titleRestored: App.db.getNote(id).title === ${JSON.stringify(NOTE_TITLE)},
            stillLocked: App.db.getNote(id).locked === true
          };
        });
      });
    })()`);
    log('f.renameWhileLockedKeepsTheBody', renameWhileLocked.bytesUnchanged, true);
    log('f.renameWhileLockedStaysEnvelope', renameWhileLocked.stillEnvelope, true);
    log('f.renameWhileLockedWorks', renameWhileLocked.titleRestored, true);
    log('f.readingWhileLockedStillLocked', renameWhileLocked.stillLocked, true);

    // --------------------------------------- (k part 1) search while locked: titles only
    const lockedSearch = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var byTitle = App.db.search(ws, ${JSON.stringify(NOTE_TITLE)}, 50);
      var byBody = App.db.search(ws, ${JSON.stringify(MARKER_NOTE)}, 50);
      return {
        titleHits: byTitle.notes.length,
        bodyHits: byBody.notes.length,
        lockedFlag: byBody.locked,
        scanned: byBody.contentScanned
      };
    })()`);
    info('locked search', lockedSearch);
    log('k.titleSearchStillWorksWhileLocked', lockedSearch.titleHits > 0, true);
    log('k.bodySearchCannotMatchWhileLocked', lockedSearch.bodyHits, 0);
    log('k.searchReportsThatItIsLocked', lockedSearch.lockedFlag, true);

    // And the interface says so rather than quietly returning fewer results.
    await cdp.evaluate(`(function(){
      var input = document.getElementById('search');
      input.value = ${JSON.stringify(MARKER_NOTE)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(700);
    const lockedSearchUi = await cdp.evaluate(`document.getElementById('tree').textContent.replace(/\\s+/g, ' ')`);
    info('locked search ui', lockedSearchUi.slice(0, 200));
    log('k.lockedSearchUiSaysBodiesAreNotSearched', /not searched while the notebook is locked/i.test(lockedSearchUi), true);
    await cdp.evaluate(`(function(){
      var input = document.getElementById('search');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(600);

    // ------------------------------------------- (g) wrong password, then the right one
    await cdp.evaluate(invokeAction('open-note', fixture.noteId));
    await sleep(500);
    const opened = await cdp.evaluate(`(function(){
      var b = document.querySelector('#main .lock-notice [data-action="vault-unlock"]');
      if (!b) return 'missing';
      b.click();
      return 'clicked';
    })()`);
    log('g.lockNoticeOpensUnlock', opened, 'clicked');
    await sleep(700);
    await cdp.evaluate(fillPassword(0, WRONG_PASSWORD));
    await cdp.evaluate(submitDialog());
    await sleep(2500);
    const wrong = await cdp.evaluate(`(function(){
      var d = ${DIALOG};
      var err = d ? d.querySelector('.field__message--error') : null;
      return {
        message: err ? err.textContent.replace(/\\s+/g, ' ').trim() : null,
        state: window.NoteApp.db.vaultState(),
        note: (function(){ var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)}); return n ? n.content : '(none)'; })()
      };
    })()`);
    info('wrong password', wrong);
    log('g.wrongPasswordRejectedInline', /not the one this notebook was encrypted with/i.test(wrong.message || ''), true);
    log('g.staysLockedAfterWrongPassword', wrong.state, 'locked');
    log('g.noPlaintextLeakedByFailure', wrong.note, null);
    log('g.dialogStaysOpenForAnotherTry', await cdp.evaluate(`(function(){ var d = ${DIALOG}; return d ? d.querySelector('.dialog__title').textContent : null; })()`), 'Unlock this notebook');
    await shot('37-vault-unlock-dialog', 1440, 900);

    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(submitDialog());
    const unlocked = await poll(`window.NoteApp.db.vaultState() === 'unlocked'`, 160, 250);
    log('g.correctPasswordUnlocks', unlocked, true);
    await sleep(600);
    const decoded = await cdp.evaluate(`(function(){
      var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)});
      return { content: n.content, locked: !!n.locked };
    })()`);
    log('g.decryptedTextIsByteIdentical', decoded.content, NOTE_BODY);
    log('g.notMarkedLocked', decoded.locked, false);

    // ------------------------------------------------------------ (h) file preview works
    const fileRoundTrip = await cdp.evaluate(`window.NoteApp.db.getFileBlob(${JSON.stringify(fixture.fileId)}).then(function (resolved) {
      if (!resolved) return { ok: false };
      return resolved.blob.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var expected = new TextEncoder().encode(${JSON.stringify(FILE_TEXT)});
        var same = bytes.length === expected.length;
        for (var i = 0; same && i < bytes.length; i++) { if (bytes[i] !== expected[i]) same = false; }
        return { ok: same, size: bytes.length, expected: expected.length, mime: resolved.mime_type, name: resolved.filename };
      });
    })`);
    info('file round trip', fileRoundTrip);
    log('h.fileBytesRoundTripExactly', fileRoundTrip.ok, true);
    log('h.fileSizeUnchanged', fileRoundTrip.size, FILE_TEXT.length);

    await cdp.evaluate(invokeAction('open-file', fixture.fileId));
    await sleep(700);
    const filePaneUnlocked = await cdp.evaluate(`(function(){
      var main = document.getElementById('main');
      return {
        hasNotice: !!main.querySelector('.lock-notice'),
        offersDownload: !!main.querySelector('[data-action="download-file"]'),
        showsName: main.textContent.indexOf(${JSON.stringify(FILE_NAME)}) !== -1
      };
    })()`);
    log('h.previewRendersAfterUnlock', filePaneUnlocked.hasNotice, false);
    log('h.downloadAvailableAfterUnlock', filePaneUnlocked.offersDownload, true);
    log('h.previewNamesTheFile', filePaneUnlocked.showsName, true);

    // ------------------------------------- (k part 2) search by body once unlocked
    const unlockedSearch = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var byBody = App.db.search(ws, ${JSON.stringify(MARKER_NOTE)}, 50);
      var byUnique = App.db.search(ws, 'second line', 50);
      return {
        bodyHits: byBody.notes.map(function (n) { return n.title; }),
        scanned: byBody.contentScanned,
        truncated: byBody.contentTruncated,
        lockedFlag: byBody.locked,
        lineHits: byUnique.notes.length
      };
    })()`);
    info('unlocked search', unlockedSearch);
    log('k.bodySearchFindsTheNoteOnceUnlocked', unlockedSearch.bodyHits.indexOf(NOTE_TITLE) !== -1, true);
    log('k.searchScannedEncryptedBodies', unlockedSearch.scanned > 0, true);
    log('k.notReportedAsLocked', unlockedSearch.lockedFlag, false);
    log('k.midBodyTextIsSearchable', unlockedSearch.lineHits > 0, true);

    // ------------------------------------------------------------ (i) lock now, no reload
    await cdp.evaluate(`document.getElementById('settings-open').click()`);
    await sleep(700);
    const settingsView = await cdp.evaluate(`(function(){
      var d = document.getElementById('settings-dialog');
      var section = d.querySelector('#vault-info');
      var actions = Array.prototype.map.call(d.querySelectorAll('#vault-actions [data-action]'), function(b){ return b.getAttribute('data-action'); });
      var note = d.querySelector('#vault-actions').parentNode.querySelector('.dialog__note');
      return {
        state: section ? section.textContent.replace(/\\s+/g, ' ').trim() : null,
        actions: actions,
        disclosure: note ? note.textContent.replace(/\\s+/g, ' ').trim() : null
      };
    })()`);
    info('settings security section', settingsView.state);
    info('settings disclosure', settingsView.disclosure);
    log('i.settingsShowsUnlocked', /Unlocked for this session/.test(settingsView.state || ''), true);
    log('i.settingsOffersLockNow', settingsView.actions.indexOf('vault-lock') !== -1, true);
    log('i.settingsOffersTurnOff', settingsView.actions.indexOf('vault-disable') !== -1, true);
    // The honest statement: what is NOT protected has to be said, not implied.
    const disclosure = settingsView.disclosure || '';
    log('i.saysTitlesAreNotEncrypted', /titles, file names, folder names, dates and sizes are not/i.test(disclosure), true);
    log('i.saysItDoesNotProtectAnUnlockedSession', /does not protect a session you have already unlocked/i.test(disclosure), true);
    log('i.saysPasswordIsNotStored', /password is not stored anywhere/i.test(disclosure), true);
    // The Security section is the last thing before the danger zone, so the panel has to be
    // scrolled to it: a screenshot of the Appearance palette would prove nothing about this
    // feature.
    await cdp.evaluate(`(function(){
      var section = document.getElementById('vault-info');
      if (section && section.scrollIntoView) section.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await sleep(500);
    await shot('38-vault-settings', 1440, 900);

    await cdp.evaluate(`(function(){
      var b = document.querySelector('#vault-actions [data-action="vault-lock"]');
      b.click();
      return true;
    })()`);
    await sleep(800);
    const relocked = await cdp.evaluate(STATE);
    log('i.lockNowDropsTheKey', relocked.vaultState, 'locked');
    log('i.cryptoModuleAgrees', relocked.cryptoStatus, 'locked');
    const relockedRead = await cdp.evaluate(`(function(){
      var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)});
      return { content: n.content, locked: !!n.locked, tree: document.getElementById('tree').textContent.indexOf(${JSON.stringify(NOTE_TITLE)}) !== -1 };
    })()`);
    log('i.lockedAgainWithoutReload', relockedRead.locked && relockedRead.content === null, true);
    log('i.titleStillListedWhileLocked', relockedRead.tree, true);
    await cdp.evaluate(invokeAction('open-note', fixture.noteId));
    await sleep(700);
    log('i.editorLocksNoticeAgain', await cdp.evaluate(`!!document.querySelector('#main .lock-notice')`), true);

    // ---------------------------------------------- (l) nothing readable in localStorage
    const localBefore = await cdp.evaluate(`(function(){
      var leaked = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = String(localStorage.getItem(k) || '');
        if (v.indexOf(${JSON.stringify(MARKER_NOTE)}) !== -1) leaked.push(k + ':note-marker');
        if (v.indexOf(${JSON.stringify(MARKER_FILE)}) !== -1) leaked.push(k + ':file-marker');
        if (v.indexOf(${JSON.stringify(PASSWORD)}) !== -1) leaked.push(k + ':password');
      }
      return { keys: localStorage.length, leaked: leaked };
    })()`);
    info('localStorage while encrypted', localBefore);
    log('l.noPlaintextMarkerInLocalStorage', localBefore.leaked, []);

    // The password itself must not be anywhere in the stored database either — it is the one
    // secret, and only the salt and the iteration count are supposed to be kept.
    const passwordInDb = await cdp.evaluate(countBytes(PASSWORD));
    log('l.passwordNeverStoredInTheDatabase', passwordInDb.hits, 0);
    // A zero is only evidence if the same scan can find a string that IS there. The note title
    // is stored in the clear while the vault is on, so finding it is what makes the zero above
    // a real zero rather than the answer of a scanner that read nothing.
    const titleScan = await cdp.evaluate(countBytes(NOTE_TITLE));
    info('byte scan control', { titleHits: titleScan.hits, bytes: titleScan.size });
    log('l.theSameScanFindsAStringThatIsStored', titleScan.hits > 0, true);
    const vaultRowLeak = await cdp.evaluate(countBytes(PASSWORD.slice(0, 6)));
    log('l.noSliceOfThePasswordStored', vaultRowLeak.hits, 0);

    // ------------------------------------------- (j) turn encryption off, plaintext restored
    // The locked state offers the way IN, not the way out. Turning encryption off from a locked
    // notebook is a reasonable thing to want, but it starts with the password exactly as
    // unlocking does — so rather than offering a second door that asks the same question, the
    // panel offers Unlock, and the check goes through it. That also asserts the requirement
    // that the actions shown match the state shown.
    await cdp.evaluate(`document.getElementById('settings-open').click()`);
    await sleep(700);
    const lockedSettings = await cdp.evaluate(`(function(){
      var d = document.getElementById('settings-dialog');
      return {
        actions: Array.prototype.map.call(d.querySelectorAll('#vault-actions [data-action]'), function(b){ return b.getAttribute('data-action'); }),
        state: d.querySelector('#vault-info').textContent.replace(/\\s+/g, ' ').trim()
      };
    })()`);
    info('locked settings section', lockedSettings.state);
    log('j.lockedStateShown', /Locked/.test(lockedSettings.state), true);
    log('j.lockedStateOffersUnlockOnly', lockedSettings.actions, ['vault-unlock']);

    await cdp.evaluate(`document.querySelector('#vault-actions [data-action="vault-unlock"]').click()`);
    await sleep(700);
    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(submitDialog());
    const unlockedAgain = await poll(`window.NoteApp.db.vaultState() === 'unlocked'`, 160, 250);
    log('j.unlockFromSettingsWorks', unlockedAgain, true);
    await sleep(800);

    const disableOpened = await cdp.evaluate(`(function(){
      var b = document.querySelector('#vault-actions [data-action="vault-disable"]');
      if (!b) return 'missing';
      b.click();
      return 'clicked';
    })()`);
    log('j.settingsOffersTurnOffOnceUnlocked', disableOpened, 'clicked');
    await sleep(700);
    // A wrong password must not turn encryption off.
    await cdp.evaluate(fillPassword(0, WRONG_PASSWORD));
    await cdp.evaluate(submitDialog());
    await sleep(2500);
    const disableWrong = await cdp.evaluate(`(function(){
      var d = ${DIALOG};
      var err = d ? d.querySelector('.field__message--error') : null;
      return { message: err ? err.textContent.replace(/\\s+/g, ' ').trim() : null, state: window.NoteApp.db.vaultState() };
    })()`);
    log('j.wrongPasswordCannotDisable', disableWrong.state !== 'off', true);
    log('j.wrongPasswordDisableExplained', /not the one this notebook was encrypted with/i.test(disableWrong.message || ''), true);

    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(submitDialog());
    const disabled = await poll(`window.NoteApp.db.vaultState() === 'off'`, 200, 250);
    log('j.disableCompletes', disabled, true);
    await sleep(700);

    const afterDisable = await cdp.evaluate(STATE);
    info('state after disabling', afterDisable);
    log('j.vaultStateOff', afterDisable.vaultState, 'off');
    log('j.vaultRowGone', afterDisable.info.state, 'off');
    log('j.iterationsForgotten', afterDisable.info.iterations, null);

    const restoredNote = await cdp.evaluate(countBytes(MARKER_NOTE));
    const restoredFile = await cdp.evaluate(countBytes(MARKER_FILE));
    const noEnvelopes = await cdp.evaluate(countBytes('enc:v1:'));
    log('j.noteMarkerBackInRawBytes', restoredNote.hits > 0, true);
    log('j.fileMarkerBackInRawBytes', restoredFile.hits > 0, true);
    log('j.noEnvelopeMarkerLeftAnywhere', noEnvelopes.hits, 0);

    const readAfterDisable = await cdp.evaluate(`window.NoteApp.db.getFileBlob(${JSON.stringify(fixture.fileId)}).then(function (file) {
      var n = window.NoteApp.db.getNote(${JSON.stringify(fixture.noteId)});
      var stored = window.NoteApp.db.storedContent(${JSON.stringify(fixture.noteId)});
      return { content: n.content, stored: stored, fileReturned: !!file, locked: !!n.locked };
    })`);
    log('j.getNoteReturnsPlaintextAgain', readAfterDisable.content, NOTE_BODY);
    log('j.storedContentIsPlaintextAgain', readAfterDisable.stored, NOTE_BODY);
    log('j.nothingLockedWhenOff', readAfterDisable.locked, false);
    log('j.fileReadableAgain', readAfterDisable.fileReturned, true);

    // Same reasoning as the byte scan, in storage: a control value is planted first, because a
    // scan that walks no storage at all reports exactly the same clean result as a scan that
    // walked everything.
    const localAfter = await cdp.evaluate(`(function(){
      var control = 'VAULTLOCALCONTROL' + ${JSON.stringify(STAMP)};
      window.localStorage.setItem('noteapp.check.control', control);
      var leaked = [];
      var controlSeen = false;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = String(localStorage.getItem(k) || '');
        if (v.indexOf(control) !== -1) controlSeen = true;
        if (v.indexOf(${JSON.stringify(PASSWORD)}) !== -1) leaked.push(k + ':password');
      }
      var keys = window.localStorage.length;
      window.localStorage.removeItem('noteapp.check.control');
      return { keys: keys, leaked: leaked, controlSeen: controlSeen };
    })()`);
    info('localStorage after the vault is off', localAfter);
    log('l.passwordNeverReachedLocalStorage', localAfter.leaked, []);
    log('l.theLocalStorageScanFindsAPlantedValue', localAfter.controlSeen, true);

    // ------------------- (n) a compaction failure must not read as an enable that did not happen
    // Compaction is not part of the enable transaction, so it can fail AFTER the vault row and the
    // ciphertext have committed. When it does, the notebook IS encrypted — and locked, because the
    // key is dropped as the last step of the conversion — and enableVault() has to resolve with
    // that news rather than reject: a rejection is what would leave the Settings section reading
    // "Encryption Off" over an encrypted notebook, which is the one lie this panel must never
    // print. The failure is forced where it really happens, by failing storage.save() while the
    // vault is unlocked — that is the compaction and nothing else, because the commit's own save
    // runs while the vault is still 'locked' — and the whole thing is driven through the real
    // dialog, so what is asserted is what a user would see.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      window.__REAL_SAVE__ = App.storage.save;
      App.storage.save = function (bytes) {
        if (App.db.vaultState() === 'unlocked') return Promise.reject(new Error('forced compaction failure'));
        return window.__REAL_SAVE__.call(App.storage, bytes);
      };
      return true;
    })()`);
    await cdp.evaluate(`document.getElementById('settings-open').click()`);
    await sleep(700);
    const forcedEnableOpened = await cdp.evaluate(`(function(){
      var b = document.querySelector('[data-action="vault-enable"]');
      if (!b) return 'missing';
      b.click();
      return 'clicked';
    })()`);
    log('n.settingsOffersTheEnableActionAgain', forcedEnableOpened, 'clicked');
    await sleep(700);
    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(clickDialogButton('Continue'));
    await sleep(500);
    await cdp.evaluate(fillPassword(0, PASSWORD));
    await cdp.evaluate(clickDialogButton('Encrypt this notebook'));
    log('n.enableCompletesDespiteTheFailedCompaction',
      await poll(`window.NoteApp.db.vaultState() === 'locked'`, 160, 250), true);
    await sleep(900);
    const forcedView = await cdp.evaluate(`(function(){
      var host = document.getElementById('toast-host');
      return {
        settingsState: document.querySelector('#vault-info').textContent.replace(/\\s+/g, ' ').trim(),
        actions: Array.prototype.map.call(document.querySelectorAll('#vault-actions [data-action]'), function(b){ return b.getAttribute('data-action'); }),
        toasts: host ? Array.prototype.map.call(host.querySelectorAll('.toast__msg'), function(n){ return n.textContent; }) : [],
        dialogsOpen: document.querySelectorAll('dialog[open]').length
      };
    })()`);
    info('settings after a forced compaction failure', forcedView);
    log('n.settingsDoesNotReadOffOverAnEncryptedNotebook',
      /Locked/.test(forcedView.settingsState), true);
    log('n.settingsStoppedSayingOff', /Off/.test(forcedView.settingsState), false);
    log('n.settingsOffersTheVaultActionsInstead', forcedView.actions, ['vault-unlock']);
    log('n.theCompactionWarningIsAToast',
      forcedView.toasts.some(function(m){ return /could not be reclaimed/.test(m); }), true);
    // And the enable's own toast says what state it left the notebook in: encrypted, and LOCKED.
    // Announcing an unlocked notebook here would be the same lie in the other direction.
    log('n.theFailureToastSaysItIsLocked',
      forcedView.toasts.some(function(m){ return /notebook is locked/i.test(m); }), true);
    log('n.theWarningPromisesNoImportPath',
      forcedView.toasts.some(function(m){ return /import/i.test(m); }), false);
    log('n.theEnableDialogClosedAnyway', forcedView.dialogsOpen, 1);

    // Back to a plaintext notebook for the refusal test below.
    const backToPlaintext = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.storage.save = window.__REAL_SAVE__;
      delete window.__REAL_SAVE__;
      return App.db.disableVault(${JSON.stringify(PASSWORD)}).then(function () { return App.db.vaultState(); });
    })()`);
    log('n.turnedOffAgainForTheRefusalTest', backToPlaintext, 'off');

    // ------------------------ (m) the refusal path, on a notebook that is half converted
    // enableVault() refuses a notebook that already holds an envelope row with no key to it:
    // sealing ciphertext a second time would put the plaintext inside it out of reach for good,
    // and nothing on this path could open it first. That refusal is load-bearing — it is what
    // stands between a crashed conversion and a permanently unreadable note — and it has never
    // been exercised, because the interface cannot produce the state: the vault row is written
    // in the same transaction as the envelopes. So the state is built by hand, exactly as a
    // notebook abandoned by a crashed conversion would be: the exported bytes are opened in a
    // fresh SQLite connection, one envelope row is inserted, and the result is written back to
    // storage and reloaded.
    const refusalState = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var id = 'raw-envelope-' + Date.now().toString(36);
      var envelope = 'enc:v1:' + btoa('not-a-real-envelope-not-a-real-envelope');
      var stamp = new Date().toISOString();
      return initSqlJs().then(function (SQL) {
        var raw = new SQL.Database(App.db.exportBytes());
        raw.run('INSERT INTO notes (id, folder_id, workspace_id, title, content, created_at, updated_at) '
          + 'VALUES (?, NULL, ?, ?, ?, ?, ?)',
          [id, ws, 'Half converted ' + id, envelope, stamp, stamp]);
        var bytes = raw.export();
        raw.close();
        return App.storage.save(bytes);
      }).then(function () { return { id: id, envelope: envelope }; });
    })()`);
    info('half converted notebook', refusalState);
    await cdp.send('Page.navigate', { url: appUrl });
    await sleep(6500);
    await waitForReady();

    const refusal = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var id = ${JSON.stringify(refusalState.id)};
      var before = App.db.storedContent(id);
      return App.db.enableVault(${JSON.stringify(PASSWORD)}).then(
        function () {
          return { refused: false, state: App.db.vaultState(), before: before, after: App.db.storedContent(id), vaultRow: App.db.vaultInfo().state };
        },
        function (err) {
          return {
            refused: true, message: err.message, state: App.db.vaultState(),
            vaultRow: App.db.vaultInfo().state, before: before, after: App.db.storedContent(id)
          };
        });
    })()`);
    info('refusal on a half converted notebook', refusal);
    log('m.theHandBuiltEnvelopeSurvivedTheReload', refusal.before, refusalState.envelope);
    log('m.refusesANotebookWithAnUnopenableEnvelope', refusal.refused, true);
    log('m.refusalNamesTheAlreadyEncryptedRecord', /record is already encrypted/i.test(refusal.message || ''), true);
    log('m.refusalSaysNothingWasChanged', /Nothing was changed/i.test(refusal.message || ''), true);
    log('m.refusalLeftTheVaultOff', refusal.state, 'off');
    log('m.refusalLeftTheNotebookUntouched', [refusal.after === refusal.before, refusal.vaultRow], [true, 'off']);

    const errs = await cdp.evaluate(`window.__VAULT_ERRORS__ ? window.__VAULT_ERRORS__.join(' | ') : 'none captured'`);

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
    console.error('VAULT CHECK ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close', params: {} })); } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
