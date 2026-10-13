#!/usr/bin/env node
/**
 * build.js — assembles the single-file, offline-capable app.
 *
 * Why a build step exists at all: the app must run by *double-clicking index.html*.
 * On the `file://` protocol Chromium refuses networked fetches of local files (CORS
 * blocks XHR/fetch to file URLs), so a `<script src="js/app.js">` chain and a
 * `sql-wasm.wasm` sibling file cannot be loaded reliably. The fix is to inline
 * everything — including the WASM binary, base64-encoded into a `data:` URI — so the
 * finished page needs no network and no server.
 *
 * Sources live in src/ (readable, modular). The output is a single index.html.
 *
 *   node tools/build.js            # bundle only (vendored engine required)
 *   node tools/build.js --refresh  # re-download the sql.js engine from the CDN first
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pwa = require('./pwa'); // manifest, icons and the service worker

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const VENDOR = path.join(ROOT, 'vendor');
const OUT = path.join(ROOT, 'index.html');

// Pinned so builds are reproducible. sql.js is MIT licensed; the WASM is SQLite (public domain).
const SQLJS_VERSION = '1.10.3';
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VERSION}`;

/** Script order matters: each file attaches to window.NoteApp in dependency order. */
const SCRIPTS = ['js/util.js', 'js/trigram.js', 'js/storage.js', 'js/crypto.js', 'js/db.js', 'js/components.js', 'js/preview.js', 'js/ui.js', 'js/app.js'];

const read = (p) => fs.readFileSync(p, 'utf8');

// --------------------------------------------------------------- vendor setup
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function fetchVendor(refresh) {
  fs.mkdirSync(VENDOR, { recursive: true });
  const wasm = path.join(VENDOR, 'sql-wasm.wasm');
  const glue = path.join(VENDOR, 'sql-wasm.js');
  if (refresh || !fs.existsSync(wasm) || !fs.existsSync(glue)) {
    console.log(`fetching sql.js ${SQLJS_VERSION} from cdnjs...`);
    await download(`${CDN}/sql-wasm.wasm`, wasm);
    await download(`${CDN}/sql-wasm.js`, glue);
  }
}

// -------------------------------------------------------------------- bundling
/** Inline a script so it cannot be broken by a `</script>` sequence inside it. */
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

/**
 * Parse every script with V8 before bundling. A syntax error anywhere in the sources
 * otherwise surfaces only as a blank page in the browser, which is a slow way to find
 * an unbalanced brace.
 */
function assertParses(name, code) {
  try {
    new vm.Script(code, { filename: name });
  } catch (err) {
    throw new Error(`${name} does not parse: ${err.message}`);
  }
}

function build() {
  const vendored = readVendor();

  const html = read(path.join(SRC, 'index.html'));
  const css = read(path.join(SRC, 'css', 'style.css'));
  const scripts = SCRIPTS.map((rel) => read(path.join(SRC, rel)));

  assertParses('vendor/sql-wasm.js', vendored.glue);
  SCRIPTS.forEach((rel, i) => assertParses(rel, scripts[i]));

  const parts = [
    '<!DOCTYPE html>',
    '<!--',
    '  Local-first note taking app — single-file build.',
    '  GENERATED FILE: edit the sources in src/ and run `node tools/build.js`.',
    '  Bundle contents: style.css + js/{util,trigram,storage,crypto,db,components,ui,app}.js + vendored sql.js engine.',
    '-->',
    html
      .replace('/*__CSS__*/', () => css)
      .replace('<!--__VENDOR__-->', () => `<script>${safe(vendored.glue)}</script>`)
      .replace('<!--__WASM__-->', () => `<script>${read(path.join(VENDOR, 'sql-wasm.base64.js'))}</script>`)
      .replace('<!--__SCRIPTS__-->', () => scripts.map((s) => `<script>${safe(s)}</script>`).join('\n')),
  ];

  // Guard: every placeholder must have been consumed, or we ship a broken page.
  const out = parts.join('\n');
  for (const marker of ['__CSS__', '__VENDOR__', '__WASM__', '__SCRIPTS__']) {
    if (out.includes(marker)) throw new Error(`placeholder ${marker} was not replaced`);
  }
  const bundle = out.replace('__BUILD__', new Date().toLocaleString('sv-SE').slice(0, 16));
  fs.writeFileSync(OUT, bundle);
  // The installable shell is emitted from the finished page, so the worker's cache name
  // changes exactly when the page does and no version number has to be maintained.
  const installable = pwa.emit(bundle);
  console.log(
    `built ${path.relative(ROOT, OUT)} — ${(out.length / 1024 / 1024).toFixed(2)} MB ` +
      `(sqlite wasm ${vendored.wasmKB} KB, inlined as base64)`
  );
  console.log(`installable shell (build ${installable.version}): ${installable.files.join(', ')}`);
}

/** Read the vendored engine and materialise the base64 data-URI module. */
function readVendor() {
  const wasm = path.join(VENDOR, 'sql-wasm.wasm');
  const glue = path.join(VENDOR, 'sql-wasm.js');
  if (!fs.existsSync(wasm) || !fs.existsSync(glue)) {
    console.error('error: vendored sql.js missing — run `node tools/build.js --refresh` first');
    process.exit(1);
  }
  const b64 = fs.readFileSync(wasm).toString('base64');
  fs.writeFileSync(
    path.join(VENDOR, 'sql-wasm.base64.js'),
    '/* generated by tools/build.js — sql.js WASM binary, base64, loaded as a data: URI */\n' +
      'window.__SQLJS_WASM_DATA_URI__ = "data:application/octet-stream;base64,' + b64 + '";\n'
  );
  return { glue: read(glue), wasmKB: Math.round(fs.statSync(wasm).size / 1024) };
}

// ------------------------------------------------------------------------ main
(async () => {
  await fetchVendor(process.argv.includes('--refresh'));
  build();
})().catch((err) => {
  console.error('build failed:', err.message);
  process.exit(1);
});
