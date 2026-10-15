/* One zip holding the SQLite database and every stored attachment. */
(function (App) {
  'use strict';

  var FORMAT = 'xave-bundle';
  var VERSION = 1;
  var MANIFEST = 'xave.json';
  var DATABASE = 'xave.db';
  var BLOBS = 'blobs/';
  var SQLITE_MAGIC = 'SQLite format 3\u0000';

  function lib() {
    if (typeof JSZip === 'undefined') throw new Error('The zip library did not load.');
    return JSZip;
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function toBytes(blob) {
    return blob.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
  }

  function isDatabase(bytes) {
    if (!bytes || bytes.length < 512) return false;
    var head = '';
    for (var i = 0; i < SQLITE_MAGIC.length; i++) head += String.fromCharCode(bytes[i]);
    return head === SQLITE_MAGIC;
  }

  function summary(blobCount) {
    var out = { workspaces: 0, notes: 0, folders: 0, files: 0, blobs: blobCount || 0 };
    try {
      var list = App.db.listWorkspaces();
      out.workspaces = list.length;
      list.forEach(function (ws) {
        var c = App.db.counts(ws.id);
        out.notes += c.notes;
        out.folders += c.folders;
        out.files += c.files;
      });
    } catch (e) { }
    return out;
  }

  function build(onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () { };
    var zip = new (lib())();
    var blobs = [];
    report('Reading the database');
    return App.db.exportSnapshot().then(function (dbBytes) {
      if (!isDatabase(dbBytes)) throw new Error('The database did not export correctly.');
      zip.file(DATABASE, dbBytes, { compression: 'DEFLATE' });
      return App.storage.blobKeys();
    }).then(function (keys) {
      var total = keys.length;
      var walk = function (index) {
        if (index >= total) return Promise.resolve();
        var id = keys[index];
        return App.storage.getBlob(id).then(function (blob) {
          if (!blob) return null;
          return toBytes(blob).then(function (bytes) {
            var path = BLOBS + id;
            zip.file(path, bytes, { compression: 'STORE' });
            blobs.push({ id: id, type: blob.type || '', size: bytes.length, path: path });
          });
        }).then(function () {
          report('Packing attachments ' + (index + 1) + ' of ' + total);
          return walk(index + 1);
        });
      };
      return walk(0);
    }).then(function () {
      zip.file(MANIFEST, JSON.stringify({
        format: FORMAT,
        version: VERSION,
        exportedAt: App.util.nowIso(),
        database: DATABASE,
        blobs: blobs,
        counts: summary(blobs.length),
      }, null, 2), { compression: 'DEFLATE' });
      report('Compressing ' + blobs.length + ' attachment' + (blobs.length === 1 ? '' : 's'));
      return zip.generateAsync({ type: 'uint8array' }, function (meta) {
        report('Compressing ' + Math.round(meta.percent) + '%');
      });
    }).then(function (bytes) {
      return { bytes: bytes, name: 'xave-' + stamp() + '.zip', blobs: blobs.length, counts: summary(blobs.length) };
    });
  }

  function read(file, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () { };
    report('Opening the bundle');
    return lib().loadAsync(file).then(function (zip) {
      var manifestFile = zip.file(MANIFEST);
      if (!manifestFile) throw new Error('That file is not a Xave bundle.');
      return manifestFile.async('string').then(function (text) {
        var manifest = null;
        try { manifest = JSON.parse(text); } catch (e) { manifest = null; }
        if (!manifest || manifest.format !== FORMAT) throw new Error('That file is not a Xave bundle.');
        if (Number(manifest.version) > VERSION) throw new Error('That bundle was written by a newer version of this app.');
        var dbFile = zip.file(manifest.database || DATABASE);
        if (!dbFile) throw new Error('That bundle has no database inside it.');
        return dbFile.async('uint8array').then(function (dbBytes) {
          if (!isDatabase(dbBytes)) throw new Error('The database inside that bundle is not a SQLite file.');
          var list = manifest.blobs && manifest.blobs.length ? manifest.blobs : [];
          var restored = 0;
          var walk = function (index) {
            if (index >= list.length) return Promise.resolve();
            var entry = list[index];
            var inner = zip.file(entry.path || (BLOBS + entry.id));
            if (!inner) return walk(index + 1);
            return inner.async('uint8array').then(function (bytes) {
              return App.storage.putBlob(entry.id, new Blob([bytes], { type: entry.type || 'application/octet-stream' }));
            }).then(function () {
              restored += 1;
              report('Restoring attachments ' + restored + ' of ' + list.length);
              return walk(index + 1);
            });
          };
          return walk(0).then(function () {
            return { dbBytes: dbBytes, blobs: restored, manifest: manifest };
          });
        });
      });
    });
  }

  App.bundle = { build: build, read: read, format: FORMAT };
})(window.NoteApp);
