#!/usr/bin/env node
/**
 * verify-db.js — open an exported/persisted .db file with sql.js (in Node) and print its
 * contents. This is independent ground truth: it proves the bytes the app stores really
 * are a complete, readable SQLite database — the same thing a desktop SQLite tool would see.
 *
 *   node tools/verify-db.js <file.db>
 */

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/verify-db.js <file.db>');
  process.exit(2);
}

const vendor = path.join(__dirname, '..', 'vendor');
const initSqlJs = require(path.join(vendor, 'sql-wasm.js'));

// sql.js in Node loads the .wasm from disk next to the glue by default.
process.chdir(vendor);

initSqlJs({ locateFile: (f) => path.join(vendor, f) }).then((SQL) => {
  const bytes = fs.readFileSync(target);
  console.log(`file: ${target} (${bytes.length} bytes)`);

  // A real SQLite file starts with the 16-byte magic string.
  const header = bytes.subarray(0, 15).toString('latin1');
  console.log(`header: "${header}" ${header === 'SQLite format 3' ? '(valid SQLite)' : '(NOT a SQLite file)'}`);

  const db = new SQL.Database(bytes);
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0];
  console.log('tables:', tables ? tables.values.map((r) => r[0]).join(', ') : '(none)');

  const version = db.exec('PRAGMA user_version')[0];
  console.log('user_version:', version ? version.values[0][0] : '?');

  const fk = db.exec('PRAGMA foreign_key_check');
  console.log('foreign_key_check:', fk.length ? JSON.stringify(fk[0].values) : 'clean');

  for (const table of ['workspaces', 'folders', 'notes', 'files']) {
    try {
      const rows = db.exec(`SELECT * FROM ${table}`);
      const count = rows.length ? rows[0].values.length : 0;
      console.log(`\n${table}: ${count} row(s)`);
      if (rows.length) {
        console.log('  columns:', rows[0].columns.join(', '));
        rows[0].values.forEach((r) => {
          const pretty = r.map((v) => {
            if (v instanceof Uint8Array) return `<blob ${v.length} bytes>`;
            const s = String(v);
            return s.length > 60 ? s.slice(0, 60) + '…' : s;
          });
          console.log('  -', pretty.join(' | '));
        });
      }
    } catch (err) {
      console.log(`\n${table}: ERROR ${err.message}`);
    }
  }
  db.close();
}).catch((err) => {
  console.error('failed:', err.message);
  process.exit(1);
});
