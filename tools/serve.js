#!/usr/bin/env node
/**
 * serve.js - the little static server this folder is meant to be opened through.
 *
 *   node tools/serve.js [--port 8181] [--no-open]
 *
 * The app itself needs no server: index.html inlines its engine and its styles, so a
 * double click runs the whole notebook. Spawner does need one. A page opened from a file:
 * address sends "Origin: null", Ollama rejects that origin, and the only server side way
 * to accept it is to allow every origin. Served over http://127.0.0.1 the origin is one
 * Ollama already trusts, so the model is reachable and nothing had to be widened.
 *
 * Standard library only. It binds to the loopback interface and serves files from this
 * folder, so the only thing reachable from the address is the app itself.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg === -1 ? 8181 : Number(argv[portArg + 1]);
const OPEN = !argv.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const asked = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = asked === '/' ? 'index.html' : asked.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  // Nothing outside this folder, whatever the URL claims.
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('outside the folder');
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? 'port ' + PORT + ' is already in use, pass --port with another one'
    : String(error.message));
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/index.html';
  console.log('Notebook served at ' + url + '  (Ctrl+C stops it)');
  if (OPEN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
});
