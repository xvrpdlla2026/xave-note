/**
 * storage.js — where the SQLite snapshot lives between page loads.
 *
 * Two interchangeable backends behind one interface:
 *
 *   1. IndexedDB (preferred) — stores the whole database as one binary value under a
 *      fixed key. Binary-safe, effectively unbounded (quota is a share of free disk
 *      space), and transactional.
 *   2. localStorage (fallback) — only used when IndexedDB is unavailable or refuses to
 *      initialise (private windows, hardened browser settings). localStorage holds
 *      UTF-16 strings only and caps out around 5 MB, so the binary is base64-encoded
 *      and split across several keys.
 *
 * Everything here is async. The rest of the app calls load()/save() and never cares
 * which backend answered.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  // IndexedDB coordinates. Bumping IDB_VERSION would run onupgradeneeded.
  var IDB_NAME = 'note-app';
  var IDB_STORE = 'kv';
  var IDB_VERSION = 1;

  // Fixed key for the database snapshot, per the storage contract. Everything else the
  // app keeps (theme choice, last-opened note) is small and goes through state.js-style
  // localStorage helpers below.
  var SNAPSHOT_KEY = 'sqlite-snapshot-v1';

  // The tab's unlocked vault key, stored beside the snapshot. See saveVaultKey().
  var VAULT_KEY = 'vault-session-key-v1';

  // localStorage fallback layout.
  var LS_META = 'noteapp.snapshot.meta';
  var LS_CHUNK = 'noteapp.snapshot.chunk.';
  var LS_CHUNK_CHARS = 512 * 1024; // ~1 MB of UTF-16 per key; stays under per-key limits

  // How long we are willing to wait for IndexedDB to answer before giving up on it.
  // A browser that is still starting its storage backend can stall an open() request
  // indefinitely — without this guard the app would sit on a blank screen forever
  // instead of falling back.
  var IDB_TIMEOUT_MS = 4000;

  var backend = null;        // 'indexeddb' | 'localstorage' | 'memory'
  var idbHandle = null;      // cached IDBDatabase once opened
  var idbRefused = false;    // true once IndexedDB has failed/timed out this session
  var persistGranted = null; // result of navigator.storage.persist(), when asked
  var warnedAboutFallback = false;

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timeout waiting for ' + label));
      }, ms);
      promise.then(
        function (value) { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
        function (err) { if (!settled) { settled = true; clearTimeout(timer); reject(err); } }
      );
    });
  }

  // ------------------------------------------------------------------ IndexedDB
  function openIdb() {
    if (idbHandle) return Promise.resolve(idbHandle);
    return withTimeout(new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(IDB_NAME, IDB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB.open failed')); };
      // Fires when another tab holds an older version open. Treat as fatal for this
      // session rather than hanging.
      req.onblocked = function () { reject(new Error('indexedDB blocked by another tab')); };
    }), IDB_TIMEOUT_MS, 'IndexedDB open').then(function (db) {
      idbHandle = db;
      // If the browser closes the connection (storage pressure, profile change), drop
      // the cache so the next call reopens instead of throwing InvalidStateError.
      db.onclose = function () { idbHandle = null; };
      db.onversionchange = function () { try { db.close(); } catch (e) { /* ignore */ } idbHandle = null; };
      return db;
    });
  }

  function idbRequest(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, mode);
      var store = tx.objectStore(IDB_STORE);
      var request = fn(store);
      var result;
      if (request) {
        // Read the value inside onsuccess: the transaction may auto-commit right after,
        // but the request result stays valid.
        request.onsuccess = function () { result = request.result; };
        request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
      }
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  }

  // --------------------------------------------------------------- localStorage
  function lsAvailable() {
    try {
      var probe = '__noteapp_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  function lsClearSnapshot() {
    var keys = [];
    for (var i = 0; i < window.localStorage.length; i++) {
      var key = window.localStorage.key(i);
      if (key && key.indexOf(LS_CHUNK) === 0) keys.push(key);
    }
    keys.forEach(function (k) { window.localStorage.removeItem(k); });
    window.localStorage.removeItem(LS_META);
  }

  // -------------------------------------------------------------- public interface
  var Storage = {
    /** Which backend answered the last operation, for the settings panel. */
    backendName: function () { return backend || 'unknown'; },

    /** True when navigator.storage.persist() was granted (survives storage pressure). */
    isPersistent: function () { return persistGranted === true; },

    /**
     * Ask the browser to mark our origin as persistent so it will not evict the data
     * under storage pressure. Best-effort: a `false` answer means "not granted", which
     * is normal in private windows and never an error.
     *
     * Only called once per install (see db.init) so we do not pester the user.
     */
    requestPersistence: function () {
      if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
        persistGranted = false;
        return Promise.resolve(false);
      }
      if (typeof navigator.storage.persisted === 'function') {
        return navigator.storage.persisted().then(function (already) {
          if (already) { persistGranted = true; return true; }
          return navigator.storage.persist().then(function (granted) {
            persistGranted = !!granted;
            return persistGranted;
          });
        }).catch(function () { persistGranted = false; return false; });
      }
      return navigator.storage.persist().then(function (granted) {
        persistGranted = !!granted;
        return persistGranted;
      }).catch(function () { persistGranted = false; return false; });
    },

    /** Rough storage numbers for the settings panel. */
    estimate: function () {
      if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
        return Promise.resolve(null);
      }
      return navigator.storage.estimate().then(function (est) {
        return { usage: est.usage || 0, quota: est.quota || 0 };
      }).catch(function () { return null; });
    },

    /**
     * Read the stored snapshot.
     * @returns {Promise<{bytes: Uint8Array|null, backend: string}>} bytes is null on a
     *          first run (nothing stored yet).
     */
    load: function () {
      // Try IndexedDB first unless it has already failed this session.
      if (!idbRefused) {
        return openIdb()
          .then(function (db) {
            return idbRequest(db, 'readonly', function (store) { return store.get(SNAPSHOT_KEY); });
          })
          .then(function (value) {
            backend = 'indexeddb';
            if (!value) return { bytes: null, backend: backend };
            // IndexedDB hands back exactly the Uint8Array we stored; normalise in case a
            // different engine returns a plain ArrayBuffer.
            var bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
            return { bytes: bytes, backend: backend };
          })
          .catch(function (err) {
            idbRefused = true;
            idbHandle = null;
            App.util.toast('IndexedDB unavailable (' + err.message + ') — using localStorage instead.', 'error');
            return loadFromLocalStorage();
          });
      }
      return loadFromLocalStorage();
    },

    /**
     * Persist the snapshot. Called after EVERY write, from db.persist().
     * @param {Uint8Array} bytes result of sqlite db.export()
     */
    save: function (bytes) {
      if (!bytes || !bytes.length) return Promise.reject(new Error('refusing to store an empty snapshot'));

      if (!idbRefused) {
        return openIdb()
          .then(function (db) {
            // Store a copy. db.export() hands out a view onto the WASM heap, which the
            // engine reuses on the next export — keeping the original would let a later
            // export mutate data that is queued for storage.
            var copy = new Uint8Array(bytes.length);
            copy.set(bytes);
            return idbRequest(db, 'readwrite', function (store) { return store.put(copy, SNAPSHOT_KEY); });
          })
          .then(function () {
            backend = 'indexeddb';
            return { backend: backend };
          })
          .catch(function (err) {
            idbRefused = true;
            idbHandle = null;
            if (!warnedAboutFallback) {
              warnedAboutFallback = true;
              App.util.toast('IndexedDB write failed (' + err.message + ') — falling back to localStorage.', 'error');
            }
            return saveToLocalStorage(bytes);
          });
      }
      return saveToLocalStorage(bytes);
    },

    /** Wipe the stored snapshot (used by "Reset everything" in settings). */
    clear: function () {
      var steps = [];
      if (!idbRefused) {
        steps.push(openIdb()
          .then(function (db) {
            return idbRequest(db, 'readwrite', function (store) {
              store.delete(SNAPSHOT_KEY);
              // The remembered vault key goes with the notebook it opened: "Delete all data"
              // is the one action that must leave nothing behind to be adopted later.
              return store.delete(VAULT_KEY);
            });
          })
          .catch(function () { /* nothing stored / no access — nothing to delete */ }));
      }
      steps.push(Promise.resolve().then(function () {
        if (lsAvailable()) lsClearSnapshot();
      }));
      return Promise.all(steps).then(function () { return true; });
    },

    /**
     * Remember the key this tab unlocked the notebook with, and read it back.
     *
     * Why IndexedDB and not the prefs store: the key is a CryptoKey OBJECT, and structured
     * clone is the only way one can be written down at all — localStorage carries strings.
     * It is stored non-extractable (see crypto.js), so what lands here is a key this origin
     * can USE and no one can read out: not this app, not a script injected into the page.
     *
     * Best-effort by design. On the localStorage fallback, or anywhere IndexedDB is refused,
     * nothing is remembered and the notebook keeps asking for the password after a reload:
     * a worse experience, never a wrong answer.
     */
    saveVaultKey: function (record) {
      if (idbRefused) return Promise.resolve(false);
      return openIdb()
        .then(function (db) {
          return idbRequest(db, 'readwrite', function (store) { return store.put(record, VAULT_KEY); });
        })
        .then(function () { return true; }, function () { return false; });
    },

    /** The remembered key record, or null. Shape: { id: <tab session id>, key: CryptoKey }. */
    loadVaultKey: function () {
      if (idbRefused) return Promise.resolve(null);
      return openIdb()
        .then(function (db) {
          return idbRequest(db, 'readonly', function (store) { return store.get(VAULT_KEY); });
        })
        .then(function (value) { return value || null; }, function () { return null; });
    },

    /** Forget it. Called wherever the key is dropped, so the record cannot outlive the lock. */
    clearVaultKey: function () {
      if (idbRefused) return Promise.resolve(false);
      return openIdb()
        .then(function (db) {
          return idbRequest(db, 'readwrite', function (store) { return store.delete(VAULT_KEY); });
        })
        .then(function () { return true; }, function () { return false; });
    },
  };

  // ---------------------------------------------------- localStorage implementation
  function loadFromLocalStorage() {
    backend = 'localstorage';
    if (!lsAvailable()) {
      backend = 'memory';
      App.util.toast('No persistent storage available — notes will not survive a reload.', 'error', 10000);
      return Promise.resolve({ bytes: null, backend: backend });
    }
    try {
      var metaRaw = window.localStorage.getItem(LS_META);
      if (!metaRaw) return Promise.resolve({ bytes: null, backend: backend });
      var meta = JSON.parse(metaRaw);
      var joined = '';
      for (var i = 0; i < meta.chunks; i++) {
        var part = window.localStorage.getItem(LS_CHUNK + i);
        if (part === null) throw new Error('snapshot chunk ' + i + ' is missing');
        joined += part;
      }
      return Promise.resolve({ bytes: base64ToBytes(joined), backend: backend });
    } catch (err) {
      App.util.toast('Stored data could not be read (' + err.message + ').', 'error');
      return Promise.resolve({ bytes: null, backend: backend });
    }
  }

  function saveToLocalStorage(bytes) {
    backend = 'localstorage';
    if (!lsAvailable()) {
      backend = 'memory';
      return Promise.resolve({ backend: backend });
    }
    return new Promise(function (resolve, reject) {
      try {
        var encoded = bytesToBase64(bytes);
        var chunks = Math.ceil(encoded.length / LS_CHUNK_CHARS) || 1;
        // Remove stale chunks first so a shrinking snapshot cannot leave orphaned tails.
        lsClearSnapshot();
        for (var i = 0; i < chunks; i++) {
          window.localStorage.setItem(LS_CHUNK + i, encoded.substr(i * LS_CHUNK_CHARS, LS_CHUNK_CHARS));
        }
        window.localStorage.setItem(LS_META, JSON.stringify({ chunks: chunks, length: bytes.length, savedAt: App.util.nowIso() }));
        resolve({ backend: backend });
      } catch (err) {
        // QuotaExceededError is the expected failure here: localStorage is ~5 MB and the
        // snapshot is base64 (33% larger than the binary).
        reject(new Error('localStorage quota exceeded — the database is too large for this fallback (' + err.name + ')'));
      }
    });
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000; // avoid blowing the argument limit on large snapshots
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length))));
    }
    return btoa(parts.join(''));
  }

  function base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ------------------------------------------------------------- small key/value
  /**
   * Tiny synchronous store for UI preferences (theme, last opened note). Never holds
   * note data, so localStorage is the right home for it.
   */
  App.prefs = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem('noteapp.pref.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (err) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem('noteapp.pref.' + key, JSON.stringify(value));
      } catch (err) {
        /* preferences are best-effort */
      }
    },
  };

  /**
   * The tab's own session marker.
   *
   * sessionStorage rather than localStorage, and deliberately: an unlock is remembered for
   * the tab that made it and for no longer than that. The id is what a stored vault key is
   * tagged with, so a key left behind by a tab that has closed is recognised as nobody's on
   * the next boot and dropped rather than adopted.
   */
  App.session = {
    /** False when sessionStorage is unreachable; nothing is then remembered at all. */
    available: function () {
      try { return !!window.sessionStorage; } catch (err) { return false; }
    },

    /** This tab's id, minted on first use. */
    id: function () {
      try {
        var existing = window.sessionStorage.getItem('noteapp.session.id');
        if (existing) return existing;
        var fresh = App.util.uuid();
        window.sessionStorage.setItem('noteapp.session.id', fresh);
        return fresh;
      } catch (err) {
        // Answer with something unique rather than nothing: a caller that stored a record
        // under this id could never match it again, which is exactly the locked outcome.
        return 'ephemeral-' + App.util.uuid();
      }
    },

    clear: function () {
      try { window.sessionStorage.removeItem('noteapp.session.id'); } catch (err) { /* nothing to clear */ }
    },
  };

  App.storage = Storage;
})(window.NoteApp);
