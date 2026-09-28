#!/usr/bin/env node
/**
 * run-flow.js — end-to-end acceptance test for the real index.html.
 *
 *   node tools/run-flow.js
 *
 * Session 1 creates data in a fresh profile; session 2 restarts the browser on that same
 * profile and asserts every byte came back.
 *
 * Both sessions run inside ONE harness invocation, and that is deliberate. Chromium's
 * IndexedDB backend does not flush to disk on an abrupt exit, so a *separate* harness
 * process reading the same profile sees an empty database even when the data is fine —
 * verified by writing a plain string through the same API and watching it vanish too. A
 * restart within one process avoids that artifact and still exercises a real relaunch.
 *
 * Exits non-zero if either round fails, so it doubles as a regression gate.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const FLOW = path.join(__dirname, 'flow-check.js');
const CHECK = path.join(__dirname, 'browser-check.js');

if (!fs.existsSync(APP)) {
  console.error('index.html not found — run `node tools/build.js` first');
  process.exit(2);
}

const appUrl = url.pathToFileURL(APP).href;
const profile = path.join(os.tmpdir(), 'noteapp-flow-profile');
const tmp = path.join(os.tmpdir(), 'noteapp-flow-' + process.pid);
const dumpA = path.join(tmp, 'round-a-snapshot.db');

fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

// The preload is injected into both documents; flow-check.js decides which round to run by
// reading window.__HARNESS_SESSION__, which the harness sets per launch.
const preload = path.join(tmp, 'preload-flow.js');
fs.writeFileSync(preload, fs.readFileSync(FLOW, 'utf8'));

console.log('=== ROUND A (create) then ROUND B (browser restarted, verify) ===');
const res = spawnSync(process.execPath, [
  CHECK, appUrl,
  `--preload=${preload}`,
  '--eval=window.__FLOW__()',
  '--eval2=window.__FLOW__()',
  '--wait-ms=7000',
  `--profile=${profile}`,
  '--restart',
  // Captured during session 2, while the app is still running: this is byte-for-byte the
  // data the app restored from IndexedDB, exported through the same code path as the
  // "Export .db" button.
  `--export-dump=${dumpA}`,
], { encoding: 'utf8', stdio: 'pipe' });

const output = res.stdout || '';
process.stdout.write(output);
if (res.stderr) process.stderr.write(res.stderr);

// Verify the exported file as a plain SQLite database, with no app code involved. This is
// the migration claim under test: the bytes on disk open in any SQLite tool.
if (fs.existsSync(dumpA)) {
  console.log('\n=== the exported .db, opened by sql.js in Node (no app code) ===');
  const v = spawnSync(process.execPath, [path.join(__dirname, 'verify-db.js'), dumpA], { encoding: 'utf8' });
  process.stdout.write(v.stdout || '');
  if (v.stderr) process.stderr.write(v.stderr);
}

fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });

const aOk = /FLOW A OK/.test(output);
const bOk = /FLOW B OK/.test(output);

console.log('\n=== summary ===');
console.log('round A (create):', aOk ? 'PASS' : 'FAIL');
console.log('round B (persist across browser restart):', bOk ? 'PASS' : 'FAIL');

if (bOk) {
  // The specific facts the storage architecture promises.
  const checks = [
    ['workspace restored', /workspaceRestored=true/.test(output)],
    ['folder nesting restored', /nestingRestored=true/.test(output)],
    ['note restored', /noteRestored=true/.test(output)],
    ['note body byte-identical', /noteBodyRestored="typed by the flow check"/.test(output.replace(/\\"/g, '"'))],
    ['attachment byte-identical (8 bytes)', /blobBytesRestored=8/.test(output)],
    ['search index intact', /searchRestored=1/.test(output)],
    ['sidebar rendered from restored DB', /sidebarRows=[1-9]/.test(output)],
    ['nested note visible in tree (ancestors expanded)', /treeNoteRows=[1-9]/.test(output)],
    ['workspace-root note renders as a top-level row', /rootNoteRows=[1-9]/.test(output)],
  ];
  let failed = 0;
  checks.forEach(([name, ok]) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  });
  process.exit(failed ? 1 : 0);
}
process.exit(1);
