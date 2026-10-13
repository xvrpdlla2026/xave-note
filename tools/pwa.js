/**
 * The installable-app files: manifest, icons and the service worker.
 *
 * Written by tools/build.js on every build. They sit beside index.html rather than inside
 * it, because a service worker cannot be registered from file:// and a manifest is only
 * read over http: the single-file app keeps working when it is double-clicked, and gains a
 * home-screen icon and an offline shell when it is served (see tools/serve.js).
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

// ------------------------------------------------------------------- PNG encoding
// A dependency-free PNG writer, so the icons can be regenerated from this file at any time
// instead of being checked in as opaque base64.
const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** RGBA pixels to a PNG. deflateSync already emits the zlib envelope IDAT expects. */
function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter 0 (none): the image is flat, so the size stays small
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The app mark: an accent tile holding a two-tone X monogram, from the same geometry as
 * the favicon in src/index.html. Sampled three times per axis, because the tile corners
 * and the stroke ends are curves and a hard-edged 512 shows its stair steps.
 */
function appIcon(size) {
  const SUB = 3;
  const unit = size / 22; // one mark unit, the favicon is drawn on a 22 by 22 grid
  const pad = size * 0.02;
  const radius = 6 * unit;
  const accent = [59, 78, 222]; // #3b4ede, the indigo default
  const strokes = [
    { x1: 7, y1: 7, x2: 15, y2: 15, alpha: 1 },
    { x1: 15, y1: 7, x2: 7, y2: 15, alpha: 0.55 },
  ];
  const half = 1.1; // half of the 2.2 stroke width on the 22 unit grid
  const inTile = (x, y) => {
    if (x < pad || y < pad || x > size - pad || y > size - pad) return false;
    const cx = Math.min(Math.max(x, pad + radius), size - pad - radius);
    const cy = Math.min(Math.max(y, pad + radius), size - pad - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  const inStroke = (x, y) => {
    for (const s of strokes) {
      const vx = (s.x2 - s.x1) * unit;
      const vy = (s.y2 - s.y1) * unit;
      const px = x - s.x1 * unit;
      const py = y - s.y1 * unit;
      const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
      const dx = px - vx * t;
      const dy = py - vy * t;
      if (Math.sqrt(dx * dx + dy * dy) <= half * unit) return s.alpha;
    }
    return 0;
  };
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let bar = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = x + (sx + 0.5) / SUB;
          const py = y + (sy + 0.5) / SUB;
          if (!inTile(px, py)) continue;
          tile++;
          bar += inStroke(px, py);
        }
      }
      if (!tile) continue; // outside the tile stays transparent
      const mix = bar / tile;
      const at = (y * size + x) * 4;
      rgba[at] = Math.round(accent[0] + (255 - accent[0]) * mix);
      rgba[at + 1] = Math.round(accent[1] + (255 - accent[1]) * mix);
      rgba[at + 2] = Math.round(accent[2] + (255 - accent[2]) * mix);
      rgba[at + 3] = Math.round(255 * (tile / (SUB * SUB)));
    }
  }
  return encodePng(size, size, rgba);
}

// --------------------------------------------------------------------- the files
/** The web app manifest. Relative urls, so it works from a subdirectory too. */
function manifest() {
  return JSON.stringify({
    name: "Xave",
    short_name: "Xave",
    description: "Offline note taking with SQLite (WASM), stored in the browser.",
    start_url: ".",
    scope: ".",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3b4ede",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2) + "\n";
}

/**
 * The offline shell.
 *
 * The cache name carries a hash of the built page, so a new build installs a new cache and
 * the activate handler deletes the old one: no window where a stale shell can be served,
 * and no version number to remember to bump.
 */
function serviceWorker(version) {
  return [
    "/* generated by tools/build.js: the offline shell for build " + version + " */",
    "const CACHE = 'notebook-" + version + "';",
    "const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];",
    "",
    "self.addEventListener('install', function (event) {",
    "  event.waitUntil(",
    "    caches.open(CACHE)",
    "      .then(function (cache) { return cache.addAll(ASSETS); })",
    "      .then(function () { return self.skipWaiting(); })",
    "  );",
    "});",
    "",
    "self.addEventListener('activate', function (event) {",
    "  event.waitUntil(",
    "    caches.keys().then(function (keys) {",
    "      return Promise.all(keys.filter(function (key) { return key !== CACHE; })",
    "        .map(function (key) { return caches.delete(key); }));",
    "    }).then(function () { return self.clients.claim(); })",
    "  );",
    "});",
    "",
    "// GET only, and never under /vault/: a cached answer to a POST would be a wrong answer,",
    "// and an encrypted payload has no business sitting in a cache.",
    "self.addEventListener('fetch', function (event) {",
    "  var request = event.request;",
    "  if (request.method !== 'GET') return;",
    "  var url = new URL(request.url);",
    "  if (url.origin !== self.location.origin) return;",
    "  if (url.pathname.indexOf('/vault/') !== -1) return;",
    "  // The page itself: network first, so a new build arrives as soon as there is a network,",
    "  // with the cached copy as the offline answer.",
    "  if (request.mode === 'navigate') {",
    "    event.respondWith(",
    "      fetch(request).then(function (response) {",
    "        var copy = response.clone();",
    "        caches.open(CACHE).then(function (cache) { cache.put('./index.html', copy); });",
    "        return response;",
    "      }).catch(function () {",
    "        return caches.match('./index.html').then(function (hit) {",
    "          return hit || caches.match('./');",
    "        });",
    "      })",
    "    );",
    "    return;",
    "  }",
    "  // Everything else is the shell: it changes only when the build does, so the cached copy",
    "  // answers first and the network is the backfill.",
    "  event.respondWith(",
    "    caches.match(request).then(function (hit) {",
    "      if (hit) return hit;",
    "      return fetch(request).then(function (response) {",
    "        if (response && response.ok) {",
    "          var copy = response.clone();",
    "          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });",
    "        }",
    "        return response;",
    "      });",
    "    })",
    "  );",
    "});",
    "",
  ].join("\n");
}

/** Write the four files beside index.html and report the build token that names the cache. */
function emit(html) {
  const version = crypto.createHash("sha1").update(html).digest("hex").slice(0, 10);
  const files = [
    ["manifest.json", manifest()],
    ["icon-192.png", appIcon(192)],
    ["icon-512.png", appIcon(512)],
    ["sw.js", serviceWorker(version)],
  ];
  files.forEach(function (entry) {
    fs.writeFileSync(path.join(ROOT, entry[0]), entry[1]);
  });
  return { version: version, files: files.map(function (entry) { return entry[0]; }) };
}

module.exports = { emit: emit, appIcon: appIcon, manifest: manifest, serviceWorker: serviceWorker };
