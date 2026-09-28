#!/usr/bin/env node
/**
 * palette-check.js — behavioural check for the six palettes and the tab icon.
 *
 *   node tools/palette-check.js
 *
 * Drives the real index.html in headless Chromium over the DevTools protocol, in a
 * throwaway profile seeded by tools/shot-seed.js (so the user's own database is never
 * touched). Nothing here is asserted against the stylesheet as text: every check reads
 * back what the browser resolved, because a palette is only real once it has won the
 * cascade. The preference is exercised through localStorage and a reload as well, which
 * is the only way to prove the pre-paint script restores the palette before the app's
 * own scripts have run.
 *
 * Writes PNGs to tools/shots/ as 30-palette-<name>-light.png and 31-palette-<name>-dark.png.
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
const profile = path.join(os.tmpdir(), 'noteapp-palette-profile-' + process.pid);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = fs.readFileSync(path.join(__dirname, 'shot-seed.js'), 'utf8');

// Record every data-theme / data-palette write, together with whether the app's own
// modules had loaded yet. That flag is the whole point: the pre-paint script and app.js
// set the same attribute, and only the timestamp tells them apart.
const RECORDER = `
  window.__ATTR__ = [];
  (function () {
    var set = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this === document.documentElement && (name === 'data-theme' || name === 'data-palette')) {
        window.__ATTR__.push({
          name: name,
          value: String(value),
          beforeApp: typeof window.NoteApp === 'undefined',
          readyState: document.readyState
        });
      }
      return set.call(this, name, value);
    };
  })();
`;

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

const PALETTES = ['indigo', 'teal', 'amber', 'rose', 'violet', 'graphite'];
// The values the stylesheet declares, transcribed here on purpose: if a token block is
// edited without the other, this check is what notices.
const LIGHT = { indigo: '#3b4ede', teal: '#0f766e', amber: '#a15c07', rose: '#b3325a', violet: '#6d34c4', graphite: '#4a5260' };
const DARK = { indigo: '#7d8dff', teal: '#3ecfb8', amber: '#e0a13f', rose: '#ff8098', violet: '#b79cff', graphite: '#b9c2d0' };
const SHOT_PALETTES = ['teal', 'amber', 'violet'];

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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });

    // Settle on a loaded document whose app is actually ready. Polling for readiness beats
    // a fixed sleep: the reloads below would otherwise need their own tuned constant.
    const settle = async (timeoutMs = 20000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          const up = await cdp.evaluate(`(function(){
            return !!(window.NoteApp && window.NoteApp.app && window.NoteApp.app.ready);
          })()`);
          if (up) {
            await cdp.evaluate(`window.NoteApp.app.ready()`);
            await sleep(900);
            return true;
          }
        } catch { /* navigating */ }
        await sleep(300);
      }
      return false;
    };

    await cdp.send('Page.navigate', { url: appUrl });
    await settle();
    await cdp.evaluate(`window.NoteApp.app.ready().then(function(){ return window.__SEED__(); })`);
    await sleep(1200);
    // Reload once so the app boots into the seeded workspace and the screenshots show a
    // populated notebook rather than an empty shell.
    await cdp.send('Page.reload', {});
    await settle();

    const shot = async (name, theme) => {
      await sleep(350);
      const live = await cdp.evaluate(`document.documentElement.getAttribute('data-theme')`);
      if (theme && live !== theme) throw new Error(`${name}: page is ${live}, expected ${theme}`);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      notes.push(`${name}.png  1440x900  ${live}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    };

    await cdp.evaluate(`(function(){ document.getElementById('settings-open').click(); return 'open'; })()`);
    await sleep(900);

    // ----------------------------------------------------- (a) the chooser itself
    // The chooser's contract is structural: six real radios inside one labelled
    // radiogroup. A div-with-click-handler would look identical and lose arrow keys and
    // the accessibility tree, so the DOM shape is asserted, not the appearance.
    const structure = await cdp.evaluate(`(function(){
      var group = document.getElementById('palette-group');
      if (!group) return { missing: true };
      var inputs = Array.prototype.slice.call(group.querySelectorAll('input[type="radio"]'));
      var dots = Array.prototype.slice.call(group.querySelectorAll('.palette-option__dot'));
      var probe = document.createElement('span');
      document.body.appendChild(probe);
      var toRgb = function (hex) { probe.style.color = hex; return getComputedStyle(probe).color; };
      var dotColours = dots.map(function (d) {
        return { value: d.className, bg: getComputedStyle(d).backgroundColor };
      });
      var out = {
        role: group.getAttribute('role'),
        label: group.getAttribute('aria-label'),
        total: inputs.length,
        allRadios: inputs.every(function (i) { return i.type === 'radio'; }),
        names: inputs.map(function (i) { return i.value; }),
        oneGroup: inputs.every(function (i) { return i.name === 'palette'; }),
        dotCount: dots.length,
        dotColours: dotColours,
        expected: {}
      };
      ${JSON.stringify(PALETTES)}.forEach(function (p) { out.expected[p] = toRgb(${JSON.stringify(LIGHT)}[p]); });
      document.body.removeChild(probe);
      return out;
    })()`);

    log('chooser.groupExists', !structure.missing, true);
    log('chooser.hasRadiogroupRole', structure.role, 'radiogroup');
    log('chooser.hasAccessibleLabel', typeof structure.label === 'string' && structure.label.length > 0, true);
    log('chooser.sixChoices', structure.total, 6);
    log('chooser.everyChoiceIsARadio', structure.allRadios, true);
    log('chooser.valuesAreTheSixPalettes', structure.names, PALETTES);
    log('chooser.oneRadioGroupName', structure.oneGroup, true);
    log('chooser.everyChoiceHasASwatch', structure.dotCount, 6);
    const swatchesWrong = LIGHT ? structure.dotColours.filter(function (d, i) {
      return d.bg !== structure.expected[PALETTES[i]];
    }) : [];
    log('chooser.swatchesUseEachPaletteAccent', swatchesWrong, []);

    // ------------------------------------------------------ (b)(c)(f)(g) light pass
    const setThemeTo = async (theme) => {
      const live = await cdp.evaluate(`(function(){
        if (document.documentElement.getAttribute('data-theme') !== ${JSON.stringify(theme)}) {
          document.getElementById('theme-toggle').click();
        }
        return document.documentElement.getAttribute('data-theme');
      })()`);
      return live;
    };

    const runPass = async (mode) => {
      const expected = mode === 'dark' ? DARK : LIGHT;
      const accents = [];
      const hrefs = [];
      for (const name of PALETTES) {
        const r = await cdp.evaluate(`(function(){
          var group = document.getElementById('palette-group');
          var input = group.querySelector('input[value=${JSON.stringify(name)}]');
          if (!input) return { missing: true };
          var before = document.documentElement.getAttribute('data-theme');
          input.click();
          var cs = getComputedStyle(document.documentElement);
          return {
            themeBefore: before,
            themeAfter: document.documentElement.getAttribute('data-theme'),
            palette: document.documentElement.getAttribute('data-palette'),
            checked: input.checked,
            accent: cs.getPropertyValue('--accent').trim(),
            href: document.getElementById('app-icon').getAttribute('href'),
            stored: window.NoteApp.prefs.get('palette')
          };
        })()`);
        if (r.missing) { log(`palette.${mode}.${name}.inputExists`, false, true); continue; }
        accents.push(r.accent);
        hrefs.push(r.href);
        log(`palette.${mode}.${name}.attribute`, r.palette, name);
        log(`palette.${mode}.${name}.accent`, r.accent, expected[name]);
        log(`palette.${mode}.${name}.themeUnchanged`, r.themeBefore === r.themeAfter, true);
        log(`palette.${mode}.${name}.radioReflectsIt`, r.checked, true);
        log(`palette.${mode}.${name}.prefStored`, r.stored, name);
        // (f) and (g): the tab icon has to be redrawn from the token the page is now
        // using. A cached href would still be the previous palette's colour.
        const svg = decodeURIComponent(r.href);
        log(`palette.${mode}.${name}.iconCarriesTheLiveAccent`, svg.indexOf('fill="' + r.accent + '"') !== -1, true);
      }
      log(`palette.${mode}.allAccentsDiffer`, new Set(accents).size, 6);
      log(`palette.${mode}.allIconHrefsDiffer`, new Set(hrefs).size, 6);
      return hrefs;
    };

    log('theme.startsLight', await setThemeTo('light'), 'light');
    const lightHrefs = await runPass('light');
    for (const name of SHOT_PALETTES) {
      await cdp.evaluate(`document.querySelector('#palette-group input[value=${JSON.stringify(name)}]').click()`);
      await sleep(300);
      await shot('30-palette-' + name + '-light', 'light');
    }

    // ----------------------------------------------------------- (d) dark pass
    log('theme.switchedToDark', await setThemeTo('dark'), 'dark');
    const darkHrefs = await runPass('dark');
    for (const name of SHOT_PALETTES) {
      await cdp.evaluate(`document.querySelector('#palette-group input[value=${JSON.stringify(name)}]').click()`);
      await sleep(300);
      await shot('31-palette-' + name + '-dark', 'dark');
    }
    // The light and dark values of one palette are different colours, so the icon drawn
    // for a palette must not be the same in both modes.
    log('icon.darkPassDrewDifferentIcons', JSON.stringify(lightHrefs) !== JSON.stringify(darkHrefs), true);

    // --------------------------------------------- (e) the preference and pre-paint
    await cdp.evaluate(`(function(){ window.NoteApp.prefs.set('palette', 'violet'); return 'stored'; })()`);
    await cdp.send('Page.reload', {});
    await settle();
    const afterReload = await cdp.evaluate(`(function(){
      return {
        live: document.documentElement.getAttribute('data-palette'),
        stored: window.NoteApp.prefs.get('palette'),
        log: window.__ATTR__ || []
      };
    })()`);
    log('reload.prefStillViolet', afterReload.stored, 'violet');
    log('reload.attributeLive', afterReload.live, 'violet');
    const early = afterReload.log.filter(function (e) {
      return e.name === 'data-palette' && e.value === 'violet' && e.beforeApp;
    });
    log('reload.paintedBeforeTheAppScriptsRan', early.length > 0, true);
    console.log('     attribute writes on reload: ' + JSON.stringify(afterReload.log));

    // A preference that is absent or malformed must land on the default rather than on an
    // attribute no palette block matches. This is the failure a stored value from an older
    // build would produce, and it is silent without a check.
    await cdp.evaluate(`(function(){
      window.localStorage.removeItem('noteapp.pref.palette');
      window.localStorage.removeItem('noteapp.pref.theme');
      return 'cleared';
    })()`);
    await cdp.send('Page.reload', {});
    await settle();
    const absent = await cdp.evaluate(`(function(){
      return {
        live: document.documentElement.getAttribute('data-palette'),
        stored: window.NoteApp.prefs.get('palette'),
        theme: document.documentElement.getAttribute('data-theme')
      };
    })()`);
    log('absent.fallsBackToIndigo', absent.live, 'indigo');
    log('absent.prefNormalised', absent.stored, 'indigo');
    log('absent.themeStillResolves', ['light', 'dark'].indexOf(absent.theme) !== -1, true);

    await cdp.evaluate(`(function(){
      window.localStorage.setItem('noteapp.pref.palette', JSON.stringify('chartreuse'));
      return 'corrupted';
    })()`);
    await cdp.send('Page.reload', {});
    await settle();
    const broken = await cdp.evaluate(`(function(){
      var cs = getComputedStyle(document.documentElement);
      return {
        live: document.documentElement.getAttribute('data-palette'),
        stored: window.NoteApp.prefs.get('palette'),
        theme: document.documentElement.getAttribute('data-theme'),
        accent: cs.getPropertyValue('--accent').trim()
      };
    })()`);
    log('malformed.fallsBackToIndigo', broken.live, 'indigo');
    log('malformed.prefNormalised', broken.stored, 'indigo');
    // Which mode the app lands in depends on the platform preference, so the expected
    // default accent is read from the mode the page actually resolved to.
    log('malformed.accentIsTheDefault', broken.accent, (broken.theme === 'dark' ? DARK : LIGHT).indigo);

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
    console.error('PALETTE CHECK ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close', params: {} })); } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
