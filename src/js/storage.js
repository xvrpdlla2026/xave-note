window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var IDB_NAME = 'note-app';
  var IDB_STORE = 'kv';
  var IDB_VERSION = 1;

  var SNAPSHOT_KEY = 'sqlite-snapshot-v1';

  var VAULT_KEY = 'vault-session-key-v1';

  var LS_META = 'noteapp.snapshot.meta';
  var LS_CHUNK = 'noteapp.snapshot.chunk.';
  var LS_CHUNK_CHARS = 512 * 1024; 

  var IDB_TIMEOUT_MS = 4000;

  var backend = null;        
  var idbHandle = null;      
  var idbRefused = false;    
  var persistGranted = null; 
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
      req.onblocked = function () { reject(new Error('indexedDB blocked by another tab')); };
    }), IDB_TIMEOUT_MS, 'IndexedDB open').then(function (db) {
      idbHandle = db;
      db.onclose = function () { idbHandle = null; };
      db.onversionchange = function () { try { db.close(); } catch (e) {  } idbHandle = null; };
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
        request.onsuccess = function () { result = request.result; };
        request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
      }
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  }

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

  var Storage = {
    backendName: function () { return backend || 'unknown'; },

    isPersistent: function () { return persistGranted === true; },

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

    estimate: function () {
      if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
        return Promise.resolve(null);
      }
      return navigator.storage.estimate().then(function (est) {
        return { usage: est.usage || 0, quota: est.quota || 0 };
      }).catch(function () { return null; });
    },

    load: function () {
      if (!idbRefused) {
        return openIdb()
          .then(function (db) {
            return idbRequest(db, 'readonly', function (store) { return store.get(SNAPSHOT_KEY); });
          })
          .then(function (value) {
            backend = 'indexeddb';
            if (!value) return { bytes: null, backend: backend };
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

    save: function (bytes) {
      if (!bytes || !bytes.length) return Promise.reject(new Error('refusing to store an empty snapshot'));

      if (!idbRefused) {
        return openIdb()
          .then(function (db) {
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

    clear: function () {
      var steps = [];
      if (!idbRefused) {
        steps.push(openIdb()
          .then(function (db) {
            return idbRequest(db, 'readwrite', function (store) {
              store.delete(SNAPSHOT_KEY);
              return store.delete(VAULT_KEY);
            });
          })
          .catch(function () {  }));
      }
      steps.push(Promise.resolve().then(function () {
        if (lsAvailable()) lsClearSnapshot();
      }));
      return Promise.all(steps).then(function () { return true; });
    },

    saveVaultKey: function (record) {
      if (idbRefused) return Promise.resolve(false);
      return openIdb()
        .then(function (db) {
          return idbRequest(db, 'readwrite', function (store) { return store.put(record, VAULT_KEY); });
        })
        .then(function () { return true; }, function () { return false; });
    },

    loadVaultKey: function () {
      if (idbRefused) return Promise.resolve(null);
      return openIdb()
        .then(function (db) {
          return idbRequest(db, 'readonly', function (store) { return store.get(VAULT_KEY); });
        })
        .then(function (value) { return value || null; }, function () { return null; });
    },

    clearVaultKey: function () {
      if (idbRefused) return Promise.resolve(false);
      return openIdb()
        .then(function (db) {
          return idbRequest(db, 'readwrite', function (store) { return store.delete(VAULT_KEY); });
        })
        .then(function () { return true; }, function () { return false; });
    },
  };

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
        lsClearSnapshot();
        for (var i = 0; i < chunks; i++) {
          window.localStorage.setItem(LS_CHUNK + i, encoded.substr(i * LS_CHUNK_CHARS, LS_CHUNK_CHARS));
        }
        window.localStorage.setItem(LS_META, JSON.stringify({ chunks: chunks, length: bytes.length, savedAt: App.util.nowIso() }));
        resolve({ backend: backend });
      } catch (err) {
        reject(new Error('localStorage quota exceeded — the database is too large for this fallback (' + err.name + ')'));
      }
    });
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000; 
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
      }
    },
  };

  App.session = {
    available: function () {
      try { return !!window.sessionStorage; } catch (err) { return false; }
    },

    id: function () {
      try {
        var existing = window.sessionStorage.getItem('noteapp.session.id');
        if (existing) return existing;
        var fresh = App.util.uuid();
        window.sessionStorage.setItem('noteapp.session.id', fresh);
        return fresh;
      } catch (err) {
        return 'ephemeral-' + App.util.uuid();
      }
    },

    clear: function () {
      try { window.sessionStorage.removeItem('noteapp.session.id'); } catch (err) {  }
    },
  };

  App.storage = Storage;
})(window.NoteApp);
