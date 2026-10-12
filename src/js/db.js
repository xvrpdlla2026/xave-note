window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;

  var MIGRATIONS = [
    [
      'CREATE TABLE IF NOT EXISTS workspaces (' +
        '  id TEXT PRIMARY KEY,' +
        '  name TEXT NOT NULL,' +
        '  created_at TEXT NOT NULL' +
        ')',
      'CREATE TABLE IF NOT EXISTS folders (' +
        '  id TEXT PRIMARY KEY,' +
        '  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,' +
        '  name TEXT NOT NULL,' +
        '  parent_folder_id TEXT REFERENCES folders(id),' +
        '  created_at TEXT NOT NULL' +
        ')',
      'CREATE TABLE IF NOT EXISTS notes (' +
        '  id TEXT PRIMARY KEY,' +
        '  folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,' +
        '  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,' +
        '  title TEXT NOT NULL DEFAULT "",' +
        '  content TEXT NOT NULL DEFAULT "",' +
        '  created_at TEXT NOT NULL,' +
        '  updated_at TEXT NOT NULL' +
        ')',
      'CREATE TABLE IF NOT EXISTS files (' +
        '  id TEXT PRIMARY KEY,' +
        '  folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,' +
        '  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,' +
        '  filename TEXT NOT NULL,' +
        '  mime_type TEXT NOT NULL DEFAULT "application/octet-stream",' +
        '  blob_data BLOB,' +
        '  size INTEGER NOT NULL DEFAULT 0,' +
        '  created_at TEXT NOT NULL' +
        ')',
      'CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders (workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (parent_folder_id)',
      'CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes (workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes (folder_id)',
      'CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_files_workspace ON files (workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_files_folder ON files (folder_id)',
    ],
    [
      'ALTER TABLE folders ADD COLUMN deleted_at TEXT',
      'ALTER TABLE notes ADD COLUMN deleted_at TEXT',
      'ALTER TABLE files ADD COLUMN deleted_at TEXT',
      'CREATE INDEX IF NOT EXISTS idx_folders_deleted ON folders (deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes (deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_files_deleted ON files (deleted_at)',
    ],
    [
      'ALTER TABLE workspaces ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE files ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'UPDATE workspaces SET position = (' +
        '  SELECT COUNT(*) FROM workspaces w2' +
        '  WHERE w2.created_at < workspaces.created_at' +
        '     OR (w2.created_at = workspaces.created_at AND w2.id < workspaces.id)' +
        ')',
      'UPDATE notes SET position = (' +
        '  SELECT COUNT(*) FROM notes n2' +
        '  WHERE n2.workspace_id = notes.workspace_id' +
        "    AND COALESCE(n2.folder_id, '') = COALESCE(notes.folder_id, '')" +
        '    AND (n2.updated_at > notes.updated_at' +
        '      OR (n2.updated_at = notes.updated_at AND n2.id < notes.id))' +
        ')',
      'UPDATE files SET position = (' +
        '  SELECT COUNT(*) FROM files f2' +
        '  WHERE f2.workspace_id = files.workspace_id' +
        "    AND COALESCE(f2.folder_id, '') = COALESCE(files.folder_id, '')" +
        '    AND (f2.created_at > files.created_at' +
        '      OR (f2.created_at = files.created_at AND f2.id < files.id))' +
        ')',
      'UPDATE folders SET position = (' +
        '  SELECT COUNT(*) FROM folders f2' +
        '  WHERE f2.workspace_id = folders.workspace_id' +
        "    AND COALESCE(f2.parent_folder_id, '') = COALESCE(folders.parent_folder_id, '')" +
        '    AND (f2.name COLLATE NOCASE < folders.name COLLATE NOCASE' +
        '      OR (f2.name COLLATE NOCASE = folders.name COLLATE NOCASE AND f2.id < folders.id))' +
        ')',
      'CREATE INDEX IF NOT EXISTS idx_workspaces_position ON workspaces (position)',
      'CREATE INDEX IF NOT EXISTS idx_folders_manual ON folders (workspace_id, parent_folder_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_notes_manual ON notes (folder_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_notes_manual_root ON notes (workspace_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_files_manual ON files (folder_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_files_manual_root ON files (workspace_id, position)',
    ],
    [
      'CREATE TABLE IF NOT EXISTS tasks (' +
        '  id TEXT PRIMARY KEY,' +
        '  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,' +
        '  folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,' +
        '  title TEXT NOT NULL,' +
        '  notes TEXT,' +
        '  done INTEGER NOT NULL DEFAULT 0,' +
        '  done_at TEXT,' +
        '  due_at TEXT,' +
        '  due_has_time INTEGER NOT NULL DEFAULT 0,' +
        '  priority INTEGER NOT NULL DEFAULT 0,' +
        '  position INTEGER NOT NULL DEFAULT 0,' +
        '  created_at TEXT,' +
        '  updated_at TEXT' +
        ')',
      'CREATE INDEX IF NOT EXISTS idx_tasks_workspace_done ON tasks (workspace_id, done)',
      'CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON tasks (workspace_id, due_at)',
      'CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks (workspace_id, folder_id, position)',
    ],
    [
      'CREATE TABLE IF NOT EXISTS vault (' +
        '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
        '  salt TEXT NOT NULL,' +
        '  iterations INTEGER NOT NULL,' +
        '  check_iv TEXT NOT NULL,' +
        '  check_ct TEXT NOT NULL,' +
        '  created_at TEXT NOT NULL' +
        ')',
    ],
    [
      'CREATE TABLE IF NOT EXISTS note_links (' +
        '  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,' +
        '  target_norm TEXT NOT NULL,' +
        '  target_raw TEXT NOT NULL DEFAULT "",' +
        '  workspace_id TEXT NOT NULL,' +
        '  PRIMARY KEY (source_note_id, target_norm)' +
        ')',
      'CREATE INDEX IF NOT EXISTS idx_links_target ON note_links (workspace_id, target_norm)',
      'CREATE INDEX IF NOT EXISTS idx_links_source ON note_links (source_note_id)',
    ],
  ['CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT \'\', content TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);', 'CREATE INDEX IF NOT EXISTS idx_templates_ws ON templates(workspace_id);'],
  ['DROP TABLE IF EXISTS revisions;', 'DROP INDEX IF EXISTS idx_revisions_note;'],
  ['DROP TABLE IF EXISTS lenses;', 'DROP INDEX IF EXISTS idx_lenses_ws;'],
  [
    'ALTER TABLE notes ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX IF NOT EXISTS idx_notes_private ON notes (is_private)',
  ],
  [
    'ALTER TABLE tasks ADD COLUMN remind_at TEXT',
    'ALTER TABLE tasks ADD COLUMN reminded_at TEXT',
    'ALTER TABLE tasks ADD COLUMN recurrence TEXT',
    'CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks (remind_at, reminded_at)',
  ],
];

  var db = null;        
  var writeQueue = null; 

  var TABLES = {
    workspace: 'workspaces',
    folder: 'folders',
    note: 'notes',
    file: 'files',
    task: 'tasks',
  };


  function query(sql, params) {
    var stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      var rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function queryOne(sql, params) {
    var rows = query(sql, params);
    return rows.length ? rows[0] : null;
  }

  function rawRun(sql, params) {
    db.run(sql, params || undefined);
  }

  function mapNote(row) {
    return {
      id: row.id,
      folder_id: row.folder_id,
      workspace_id: row.workspace_id,
      workspace_name: row.workspace_name || null,
      title: row.title || '',
      is_private: Number(row.is_private) ? 1 : 0,
      content: '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      position: row.position,
    };
  }

  function mapFileMeta(row) {
    return {
      id: row.id,
      folder_id: row.folder_id,
      workspace_id: row.workspace_id,
      workspace_name: row.workspace_name || null,
      filename: row.filename,
      mime_type: row.mime_type,
      size: row.size,
      created_at: row.created_at,
    };
  }

  function mapTask(row) {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      folder_id: row.folder_id,
      title: row.title || '',
      notes: row.notes || '',
      done: Number(row.done) ? 1 : 0,
      done_at: row.done_at || null,
      due_at: row.due_at || null,
      due_has_time: Number(row.due_has_time) ? 1 : 0,
      priority: Number(row.priority) || 0,
      remind_at: row.remind_at || null,
      reminded_at: row.reminded_at || null,
      recurrence: row.recurrence || null,
      position: Number(row.position) || 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  var TASK_EDITABLE = {
    title: function (value) {
      return String(value === undefined || value === null ? '' : value).trim() || 'Untitled task';
    },
    notes: function (value) {
      return value === undefined || value === null || value === '' ? null : String(value);
    },
    due_at: function (value) { return value ? String(value) : null; },
    due_has_time: function (value) { return value ? 1 : 0; },
    priority: function (value) { return clampPriority(value); },
    folder_id: function (value) { return value ? String(value) : null; },
    remind_at: function (value) { return value ? String(value) : null; },
    recurrence: function (value) { return normalizeRecurrence(value); },
  };

  function clampPriority(value) {
    var n = Number(value);
    return n === 1 || n === 2 ? n : 0;
  }

  var RECURRENCE_FREQS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

  function normalizeRecurrence(value) {
    if (!value || typeof value !== 'object') return null;
    var freq = String(value.freq || '');
    if (RECURRENCE_FREQS.indexOf(freq) === -1) return null;
    var interval = Math.max(1, Math.min(99, Math.round(Number(value.interval) || 1)));
    return JSON.stringify({ freq: freq, interval: interval });
  }

  function parseRecurrence(encoded) {
    if (!encoded) return null;
    try {
      var parsed = typeof encoded === 'string' ? JSON.parse(encoded) : encoded;
      if (!parsed || RECURRENCE_FREQS.indexOf(String(parsed.freq)) === -1) return null;
      return { freq: String(parsed.freq), interval: Math.max(1, Math.round(Number(parsed.interval) || 1)) };
    } catch (err) {
      return null;
    }
  }

  function nextOccurrence(iso, hasTime, rule) {
    var base = new Date(iso);
    if (!iso || isNaN(base.getTime()) || !rule) return null;
    var step = rule.interval || 1;
    var next = new Date(base.getTime());
    var day;
    var last;
    if (rule.freq === 'weekdays') {
      do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
    } else if (rule.freq === 'daily') {
      next.setDate(next.getDate() + step);
    } else if (rule.freq === 'weekly') {
      next.setDate(next.getDate() + 7 * step);
    } else if (rule.freq === 'monthly') {
      day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + step);
      last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
    } else if (rule.freq === 'yearly') {
      next.setFullYear(next.getFullYear() + step);
    } else {
      return null;
    }
    if (!hasTime) next.setHours(0, 0, 0, 0);
    if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  function advanceReminder(remindAt, oldDue, newDue) {
    if (!remindAt || !oldDue || !newDue) return remindAt || null;
    var offset = new Date(oldDue).getTime() - new Date(remindAt).getTime();
    if (isNaN(offset)) return remindAt;
    return new Date(new Date(newDue).getTime() - offset).toISOString();
  }

  function taskDayBounds(now) {
    var base = new Date(now === undefined || now === null ? Date.now() : now);
    base.setHours(0, 0, 0, 0);
    function shift(days) {
      var d = new Date(base.getTime());
      d.setDate(d.getDate() + days);
      return d.toISOString();
    }
    return {
      todayStart: base.toISOString(),
      tomorrowStart: shift(1),
      dayAfterTomorrowStart: shift(2),
      weekEnd: shift(7),
    };
  }

  var TASK_VIEWS = ['all', 'today', 'upcoming', 'done'];

  function normaliseTaskView(view) {
    return TASK_VIEWS.indexOf(view) === -1 ? 'all' : view;
  }

  function taskViewClause(view, bounds) {
    if (view === 'today') {
      return { sql: ' AND done = 0 AND due_at IS NOT NULL AND due_at < ?', params: [bounds.tomorrowStart] };
    }
    if (view === 'upcoming') {
      return { sql: ' AND done = 0 AND due_at IS NOT NULL AND due_at >= ?', params: [bounds.tomorrowStart] };
    }
    if (view === 'done') return { sql: ' AND done = 1', params: [] };
    return { sql: ' AND done = 0', params: [] };
  }

  var SORT_KEYS = ['manual', 'name', 'created', 'updated', 'size'];
  var SORT_DIRECTIONS = ['asc', 'desc'];
  var SORT_LABELS = {
    manual: 'Manual order',
    name: 'Name',
    created: 'Date created',
    updated: 'Date modified',
    size: 'Size',
  };

  var SORT_COLUMNS = {
    workspaces: { name: 'name', created: 'created_at' },
    folders: { name: 'name', created: 'created_at' },
    notes: { name: 'title', created: 'created_at', updated: 'updated_at' },
    files: { name: 'filename', created: 'created_at', size: 'size' },
  };
  var SORT_FALLBACK = { updated: 'created_at' };

  function orderBy(table, sort) {
    if (!sort || !sort.key) return null;
    var columns = SORT_COLUMNS[table];
    if (!columns) return null;
    var dir = SORT_DIRECTIONS.indexOf(sort.dir) === -1 ? 'asc' : sort.dir;
    var upper = dir.toUpperCase();
    var tiebreak = 'id ASC';

    if (sort.key === 'manual') {
      return 'ORDER BY position ' + upper + ', ' + tiebreak;
    }

    var column = columns[sort.key];
    if (!column) column = SORT_FALLBACK[sort.key] || columns.name;
    var collate = column === columns.name ? ' COLLATE NOCASE' : '';
    return 'ORDER BY ' + column + collate + ' ' + upper + ', ' + tiebreak;
  }

  function normaliseSort(sort) {
    if (!sort || typeof sort !== 'object') return null;
    if (SORT_KEYS.indexOf(sort.key) === -1) return null;
    var dir = SORT_DIRECTIONS.indexOf(sort.direction) === -1 ? sort.dir : sort.direction;
    if (SORT_DIRECTIONS.indexOf(dir) === -1) dir = 'asc';
    return { key: sort.key, dir: dir };
  }

  function orderOf(table, sort) {
    var explicit = normaliseSort(sort);
    return explicit ? orderBy(table, explicit) : null;
  }

  function reorderScope(kind, scopeId, scopeFolderId) {
    if (kind === 'workspace') return { where: '', params: [] };
    if (kind === 'folder') {
      return {
        where: "workspace_id = ? AND COALESCE(parent_folder_id, '') = COALESCE(?, '')",
        params: [scopeId || '', scopeFolderId || null],
      };
    }
    return {
      where: "workspace_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')",
      params: [scopeId || '', scopeFolderId || null],
    };
  }

  function reorderWithin(kind, id, delta, scopeId, scopeFolderId) {
    var table = TABLES[kind];
    if (!table) return Promise.resolve(false);
    var step = Number(delta) < 0 ? -1 : 1;
    var scope = reorderScope(kind, scopeId, scopeFolderId);
    var narrow = scope.where ? ' AND ' + scope.where : '';

    var current = queryOne(
      'SELECT id, position FROM ' + table + ' WHERE id = ?' + narrow,
      [id].concat(scope.params)
    );
    if (!current) return Promise.resolve(false);

    var comparison = step < 0 ? '<' : '>';
    var tail = ' ORDER BY position ' + (step < 0 ? 'DESC' : 'ASC')
      + ', id ' + (step < 0 ? 'DESC' : 'ASC') + ' LIMIT 1';
    var neighbour = queryOne(
      'SELECT id, position FROM ' + table + ' WHERE ' + scope.where
        + (scope.where ? ' AND ' : '')
        + '(position ' + comparison + ' ? OR (position = ? AND id ' + comparison + ' ?))' + tail,
      scope.params.concat([current.position, current.position, id])
    );
    if (!neighbour) return Promise.resolve(false);

    return write(function (run) {
      run('UPDATE ' + table + ' SET position = ? WHERE id = ?', [neighbour.position, current.id]);
      run('UPDATE ' + table + ' SET position = ? WHERE id = ?', [current.position, neighbour.id]);
    }).then(function () { return true; });
  }

  function likeParam(term) {
    return '%' + String(term).replace(/[\\%_]/g, function (ch) { return '\\' + ch; }) + '%';
  }


  function write(sqlOrFn, params) {
    var task = function () {
      var changes = 0;

      rawRun('BEGIN');
      try {
        if (typeof sqlOrFn === 'function') {
          sqlOrFn(function (sql, bound) {
            rawRun(sql, bound);
            changes += db.getRowsModified();
          });
        } else {
          rawRun(sqlOrFn, params);
          changes = db.getRowsModified();
        }
        rawRun('COMMIT');
      } catch (err) {
        try { rawRun('ROLLBACK'); } catch (rollbackErr) {  }
        throw err;
      }

      return App.storage.save(db.export()).then(function () {
        return { changes: changes };
      });
    };

    var result = (writeQueue || Promise.resolve()).then(task, task);
    writeQueue = result.catch(function () {  });
    return result;
  }

  function propagateRenameWrites(renamedId, oldTitle, newTitle) {
    var oldNorm = util.normTitle(oldTitle);
    if (!oldNorm || util.normTitle(newTitle) === oldNorm) return Promise.resolve(false);
    var sources = query(
      'SELECT DISTINCT l.source_note_id AS sid FROM note_links l ' +
      'JOIN notes n ON n.id = l.source_note_id ' +
      'WHERE l.target_norm = ? AND n.deleted_at IS NULL', [oldNorm]);
    if (!sources.length) return Promise.resolve(false);
    var pending = sources.map(function (source) {
      var body = null;
      try {
        var note = API.getNote(source.sid);
        body = note ? note.content : null;
      } catch (e) { body = null; }
      if (typeof body !== 'string') return Promise.resolve(null);
      var raws = query('SELECT target_raw FROM note_links WHERE source_note_id = ? AND target_norm = ?',
        [source.sid, oldNorm]);
      var next = body;
      raws.forEach(function (raw) {
        next = next.split('[[' + raw.target_raw + ']]').join('[[' + newTitle + ']]');
      });
      if (next === body) return Promise.resolve(null);
      return App.crypto.encrypt(next).then(function (sealed) {
        return { id: source.sid, sealed: sealed, plain: next };
      });
    });
    return Promise.all(pending).then(function (changed) {
      changed = changed.filter(Boolean);
      if (!changed.length) return false;
      return write(function (run) {
        var stamp = util.nowIso();
        changed.forEach(function (item) {
          run('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [item.sealed, stamp, item.id]);
          if (viewReady) noteText[item.id] = item.plain;
          refreshLinksInto(run, item.id, item.plain);
        });
      }).then(function () { return true; });
    });
  }

  function refreshLinksInto(run, noteId, plaintext) {
    if (typeof plaintext !== 'string') return;
    var owner = queryOne('SELECT workspace_id FROM notes WHERE id = ?', [noteId]);
    if (!owner) return;
    run('DELETE FROM note_links WHERE source_note_id = ?', [noteId]);
    util.extractWikiLinks(plaintext).forEach(function (link) {
      run('INSERT OR IGNORE INTO note_links (source_note_id, target_norm, target_raw, workspace_id)' +
        ' VALUES (?, ?, ?, ?)', [noteId, link.norm, link.raw, owner.workspace_id]);
    });
  }

  var noteText = {};   
  var fileBytes = {};  

  var viewReady = false;

  var VAULT_ID = 1;

  var CONTENT_SCAN_CAP = 2000;

  function vaultRow() {
    return queryOne(
      'SELECT salt, iterations, check_iv, check_ct, created_at FROM vault WHERE id = ?',
      [VAULT_ID]
    );
  }

  function hasOwn(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  function blobBytes(value) {
    if (!value) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value);
  }

  function eachSeries(items, step) {
    var index = 0;
    function next() {
      if (index >= items.length) return Promise.resolve();
      var item = items[index++];
      return Promise.resolve(step(item)).then(next);
    }
    return next();
  }

  function vaultTotals() {
    var notes = queryOne('SELECT COUNT(*) AS n FROM notes');
    var files = queryOne('SELECT COUNT(*) AS n FROM files');
    return (notes ? notes.n : 0) + (files ? files.n : 0);
  }

  function planEncryption(onProgress) {
    var plan = {
      notes: [], files: [], noteText: {}, fileBytes: {}, alreadyEncrypted: [],
    };
    var noteRows = query('SELECT id, content FROM notes');
    var fileRows = query('SELECT id, blob_data FROM files');
    var total = noteRows.length + fileRows.length;
    var seen = 0;
    function tick() { seen++; if (onProgress) onProgress(seen, total); }

    return eachSeries(noteRows, function (row) {
      tick();
      if (App.crypto.isEnvelope(row.content)) {
        plan.alreadyEncrypted.push({ kind: 'note', id: row.id });
        return;
      }
      var plain = row.content === null || row.content === undefined ? '' : String(row.content);
      return App.crypto.encrypt(plain).then(function (stored) {
        plan.notes.push({ id: row.id, stored: stored });
        plan.noteText[row.id] = plain;
      });
    }).then(function () {
      return eachSeries(fileRows, function (row) {
        tick();
        if (typeof row.blob_data === 'string' && App.crypto.isEnvelope(row.blob_data)) {
          plan.alreadyEncrypted.push({ kind: 'file', id: row.id });
          return;
        }
        var bytes = blobBytes(row.blob_data);
        return App.crypto.encryptBytes(bytes).then(function (stored) {
          plan.files.push({ id: row.id, stored: stored });
          plan.fileBytes[row.id] = bytes;
        });
      });
    }).then(function () { return plan; });
  }

  function planDecryption(onProgress) {
    var plan = { notes: [], files: [], failures: [] };
    var noteRows = query('SELECT id, content FROM notes');
    var fileRows = query('SELECT id, blob_data FROM files');
    var total = noteRows.length + fileRows.length;
    var seen = 0;
    function tick() { seen++; if (onProgress) onProgress(seen, total); }

    return eachSeries(noteRows, function (row) {
      tick();
      if (!App.crypto.isEnvelope(row.content)) return; 
      return App.crypto.decrypt(row.content).then(function (plain) {
        plan.notes.push({ id: row.id, plain: plain });
      }, function (err) {
        plan.failures.push({ kind: 'note', id: row.id, message: err.message });
      });
    }).then(function () {
      return eachSeries(fileRows, function (row) {
        tick();
        if (!(typeof row.blob_data === 'string' && App.crypto.isEnvelope(row.blob_data))) return;
        return App.crypto.decryptBytes(row.blob_data).then(function (bytes) {
          plan.files.push({ id: row.id, plain: bytes });
        }, function (err) {
          plan.failures.push({ kind: 'file', id: row.id, message: err.message });
        });
      });
    }).then(function () { return plan; });
  }

  function decryptEverything(onProgress) {
    var text = {};
    var byteMap = {};
    var failures = [];
    var noteRows = query('SELECT id, content FROM notes');
    var fileRows = query('SELECT id, blob_data FROM files');
    var total = noteRows.length + fileRows.length;
    var seen = 0;
    function tick() { seen++; if (onProgress) onProgress(seen, total); }

    return eachSeries(noteRows, function (row) {
      tick();
      if (!App.crypto.isEnvelope(row.content)) {
        text[row.id] = row.content === null || row.content === undefined ? '' : String(row.content);
        return;
      }
      return App.crypto.decrypt(row.content).then(function (plain) {
        text[row.id] = plain;
      }, function (err) {
        failures.push({ kind: 'note', id: row.id, message: err.message });
      });
    }).then(function () {
      return eachSeries(fileRows, function (row) {
        tick();
        if (!(typeof row.blob_data === 'string' && App.crypto.isEnvelope(row.blob_data))) return;
        return App.crypto.decryptBytes(row.blob_data).then(function (bytes) {
          byteMap[row.id] = bytes;
        }, function (err) {
          failures.push({ kind: 'file', id: row.id, message: err.message });
        });
      });
    }).then(function () {
      return { noteText: text, fileBytes: byteMap, failures: failures };
    });
  }

  function compact() {
    rawRun('VACUUM');
    return App.storage.save(db.export());
  }

  function compactQuietly(report) {
    var attempt;
    try {
      attempt = compact();
    } catch (err) {
      attempt = Promise.reject(err);
    }
    return attempt.then(function () { return report; }, function (err) {
      report.compactionFailed = true;
      App.util.toast('The notebook is encrypted, but the space that held the previous '
        + 'unencrypted copy could not be reclaimed (' + err.message + '), so that earlier copy '
        + 'may still be recoverable from this database file. Turning encryption off and on '
        + 'again from Settings retries the compaction.', 'error', 14000);
      return report;
    });
  }

  function syncVault() {
    var row = vaultRow();
    App.crypto.setVaultExists(!!row);
    return row;
  }

  function buildUnlockedView(onProgress) {
    var pass = (writeQueue || Promise.resolve()).then(function () {
      return decryptEverything(onProgress);
    });
    writeQueue = pass.then(function () { return null; }, function () { return null; });
    return pass.then(function (view) {
      noteText = view.noteText;
      fileBytes = view.fileBytes;
      viewReady = true;
      return view;
    });
  }

  function rememberSession() {
    var live = App.crypto.currentKey();
    if (!live || !App.session.available()) return Promise.resolve(false);
    return App.storage.saveVaultKey({ id: App.session.id(), key: live });
  }

  function forgetSession() {
    App.session.clear();
    return App.storage.clearVaultKey();
  }

  function applyMigrations() {
    rawRun('PRAGMA foreign_keys = ON');

    var row = queryOne('PRAGMA user_version');
    var current = row ? Number(row.user_version) : 0;

    for (var version = current; version < MIGRATIONS.length; version++) {
      rawRun('BEGIN');
      try {
        MIGRATIONS[version].forEach(function (statement) { rawRun(statement); });
        rawRun('PRAGMA user_version = ' + (version + 1));
        rawRun('COMMIT');
      } catch (err) {
        try { rawRun('ROLLBACK'); } catch (e) {  }
        throw new Error('schema migration ' + (version + 1) + ' failed: ' + err.message);
      }
    }
  }

  function seed() {
    var stamp = util.nowIso();
    var workspaceId = util.uuid();
    var folderId = util.uuid();
    var noteId = util.uuid();

    return write(function (run) {
      run('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)', [workspaceId, 'Personal', stamp]);
      run('INSERT INTO folders (id, workspace_id, name, parent_folder_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [folderId, workspaceId, 'Getting started', null, stamp]);
      run('INSERT INTO notes (id, folder_id, workspace_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          noteId, folderId, workspaceId, 'Welcome',
          'This notebook lives entirely in your browser.\n\n' +
          '\u2022 Everything you type is saved automatically \u2014 there is no save button.\n' +
          '\u2022 Notes and uploads are stored in a real SQLite database, which is written to IndexedDB after every change.\n' +
          '\u2022 Use the sidebar to create workspaces and nested folders.\n' +
          '\u2022 Drag a file anywhere onto the window to attach it.\n' +
          '\u2022 Settings \u2699 exports the database as a .db file you can open with any SQLite tool.\n\n' +
          'Delete this note whenever you like.',
          stamp, stamp,
        ]);
    }).then(function () { return workspaceId; });
  }

  var API = {
    init: function () {
      return App.storage.load()
        .then(function (loaded) {
          var wasmUri = window.__SQLJS_WASM_DATA_URI__;
          if (!wasmUri) {
            throw new Error('the bundled SQLite engine is missing (window.__SQLJS_WASM_DATA_URI__)');
          }
          if (typeof initSqlJs !== 'function') {
            throw new Error('sql.js failed to load');
          }
          return initSqlJs({ locateFile: function () { return wasmUri; } }).then(function (SQL) {
            var fresh = false;
            if (loaded.bytes && loaded.bytes.length) {
              try {
                db = new SQL.Database(loaded.bytes);
              } catch (err) {
                App.util.toast('Saved database could not be opened (' + err.message + '). Starting a new one.', 'error', 10000);
                db = new SQL.Database();
                fresh = true;
              }
            } else {
              db = new SQL.Database();
              fresh = true;
            }

            applyMigrations();

            var orphanCount = 0;
            try {
              orphanCount = queryOne(
                'SELECT COUNT(*) AS n FROM folders WHERE parent_folder_id IS NOT NULL AND deleted_at IS NULL' +
                ' AND parent_folder_id NOT IN (SELECT p.id FROM folders AS p' +
                ' WHERE p.deleted_at IS NULL AND p.workspace_id = folders.workspace_id)'
              ).n || 0;
            } catch (e) { orphanCount = 0; }
            var repairPromise = orphanCount ? write(
              'UPDATE folders SET parent_folder_id = NULL WHERE parent_folder_id IS NOT NULL AND deleted_at IS NULL' +
              ' AND parent_folder_id NOT IN (SELECT p.id FROM folders AS p' +
              ' WHERE p.deleted_at IS NULL AND p.workspace_id = folders.workspace_id)'
            ).catch(function () { return null; }) : Promise.resolve(null);

            var vault = syncVault();

            var empty = queryOne('SELECT COUNT(*) AS n FROM workspaces').n === 0;
            var seedPromise = repairPromise.then(function () {
              return (!vault && (fresh || empty)) ? seed() : Promise.resolve(null);
            });

            return seedPromise.then(function () {
              var last = App.prefs.get('lastWorkspaceId', null);
              var exists = last
                ? queryOne('SELECT id FROM workspaces WHERE id = ?', [last])
                : null;
              if (!exists) {
                var first = queryOne('SELECT id FROM workspaces ORDER BY created_at LIMIT 1');
                last = first ? first.id : null;
              }
              return { fresh: fresh || empty, backend: loaded.backend, lastWorkspaceId: last };
            });
          });
        });
    },

    isReady: function () { return !!db; },

    sortKeys: SORT_KEYS.slice(),
    sortDirections: SORT_DIRECTIONS.slice(),

    sortKeysFor: function () {
      return SORT_KEYS.map(function (key) { return { key: key, label: SORT_LABELS[key] }; });
    },

    reorderWithin: reorderWithin,

    orderInfo: function (kind, id, scopeId, scopeFolderId) {
      var table = TABLES[kind];
      if (!table) return null;
      var scope = reorderScope(kind, scopeId, scopeFolderId);
      var narrow = scope.where ? ' AND ' + scope.where : '';
      var row = queryOne(
        'SELECT position FROM ' + table + ' WHERE id = ?' + narrow,
        [id].concat(scope.params)
      );
      if (!row) return null;
      var count = queryOne(
        'SELECT COUNT(*) AS n FROM ' + table + (scope.where ? ' WHERE ' + scope.where : ''),
        scope.params
      );
      return { position: row.position, count: count ? count.n : 1 };
    },

    listWorkspaces: function (sort) {
      return query('SELECT id, name, created_at, position FROM workspaces '
        + (orderOf('workspaces', sort) || 'ORDER BY created_at'));
    },

    createWorkspace: function (name) {
      var id = util.uuid();
      var stamp = util.nowIso();
      return write(
        'INSERT INTO workspaces (id, name, created_at, position) ' +
          'VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces))',
        [id, (name || 'Untitled workspace').trim() || 'Untitled workspace', stamp])
        .then(function () {
          var row = queryOne('SELECT position FROM workspaces WHERE id = ?', [id]);
          return { id: id, name: name, created_at: stamp, position: row ? row.position : 0 };
        });
    },

    renameWorkspace: function (id, name) {
      return write('UPDATE workspaces SET name = ? WHERE id = ?', [String(name).trim() || 'Untitled workspace', id]);
    },

    deleteWorkspace: function (id) {
      return write('DELETE FROM workspaces WHERE id = ?', [id]);
    },

    listFolders: function (workspaceId, sort) {
      return query(
        'SELECT id, workspace_id, name, parent_folder_id, created_at, position FROM folders ' +
          'WHERE workspace_id = ? AND deleted_at IS NULL ' +
          (orderOf('folders', sort) || 'ORDER BY name COLLATE NOCASE'),
        [workspaceId]
      );
    },

    createFolder: function (workspaceId, name, parentFolderId) {
      var id = util.uuid();
      var stamp = util.nowIso();
      return write(
        'INSERT INTO folders (id, workspace_id, name, parent_folder_id, created_at, position) ' +
          'VALUES (?, ?, ?, ?, ?, (' +
          '  SELECT COALESCE(MAX(position), -1) + 1 FROM folders' +
          "  WHERE workspace_id = ? AND COALESCE(parent_folder_id, '') = COALESCE(?, '')" +
          '))',
        [id, workspaceId, String(name).trim() || 'New folder', parentFolderId || null, stamp,
          workspaceId, parentFolderId || null],
      ).then(function () {
        var row = queryOne('SELECT position FROM folders WHERE id = ?', [id]);
        return {
          id: id, workspace_id: workspaceId, name: name,
          parent_folder_id: parentFolderId || null, created_at: stamp,
          position: row ? row.position : 0,
        };
      });
    },

    renameFolder: function (id, name) {
      return write('UPDATE folders SET name = ? WHERE id = ?', [String(name).trim() || 'New folder', id]);
    },

    descendantFolderIds: function (rootId) {
      var ids = [rootId];
      var frontier = [rootId];
      while (frontier.length) {
        var placeholders = frontier.map(function () { return '?'; }).join(',');
        var children = query(
          'SELECT id FROM folders WHERE parent_folder_id IN (' + placeholders + ') AND deleted_at IS NULL', frontier
        ).map(function (r) { return r.id; });
        if (!children.length) break;
        ids = ids.concat(children);
        frontier = children;
      }
      return ids;
    },

    moveFolder: function (folderId, targetWorkspaceId) {
      var ids = API.descendantFolderIds(folderId);
      return write(function (run) {
        var placeholders = ids.map(function () { return '?'; }).join(',');
        var params = [targetWorkspaceId].concat(ids);
        run('UPDATE folders SET workspace_id = ? WHERE id IN (' + placeholders + ')', params);
        params = [targetWorkspaceId].concat(ids);
        run('UPDATE notes SET workspace_id = ? WHERE folder_id IN (' + placeholders + ')', params);
        params = [targetWorkspaceId].concat(ids);
        run('UPDATE files SET workspace_id = ? WHERE folder_id IN (' + placeholders + ')', params);
        run('UPDATE folders SET parent_folder_id = NULL WHERE id = ?', [folderId]);
      });
    },

    deleteFolder: function (id) {
      var ids = API.descendantFolderIds(id);
      var stamp = util.nowIso();
      return write(function (run) {
        var placeholders = ids.map(function () { return '?'; }).join(',');
        run('UPDATE folders SET deleted_at = ? WHERE id IN (' + placeholders + ')', [stamp].concat(ids));
        run('UPDATE notes SET deleted_at = ? WHERE folder_id IN (' + placeholders + ')', [stamp].concat(ids));
        run('UPDATE files SET deleted_at = ? WHERE folder_id IN (' + placeholders + ')', [stamp].concat(ids));
      });
    },

    countFolderContents: function (id) {
      var ids = API.descendantFolderIds(id);
      var placeholders = ids.map(function () { return '?'; }).join(',');
      var notes = queryOne('SELECT COUNT(*) AS n FROM notes WHERE folder_id IN (' + placeholders + ') AND deleted_at IS NULL', ids);
      var files = queryOne('SELECT COUNT(*) AS n FROM files WHERE folder_id IN (' + placeholders + ') AND deleted_at IS NULL', ids);
      return {
        notes: notes ? notes.n : 0,
        files: files ? files.n : 0,
        folders: ids.length - 1,
      };
    },

    listNotesIn: function (workspaceId, folderId, sort) {
      var order = orderOf('notes', sort) || 'ORDER BY updated_at DESC';
      var rows = folderId
        ? query('SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, position FROM notes WHERE folder_id = ? AND deleted_at IS NULL ' + order, [folderId])
        : query('SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, position FROM notes WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ' + order, [workspaceId]);
      return rows.map(mapNote);
    },

    titlesLike: function (workspaceId, words) {
      var terms = (words || [])
        .map(function (w) { return String(w || '').trim(); })
        .filter(function (w) { return w.length > 1; })
        .slice(0, 3);
      if (!workspaceId || !terms.length) return [];
      var clause = terms.map(function () { return "title LIKE ? ESCAPE '\\'"; }).join(' OR ');
      return query(
        'SELECT id, title FROM notes WHERE workspace_id = ? AND deleted_at IS NULL AND (' + clause + ')',
        [workspaceId].concat(terms.map(likeParam))
      );
    },

    listAllNotes: function (workspaceId, sort) {
      return query(
        'SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, position FROM notes ' +
          'WHERE workspace_id = ? AND deleted_at IS NULL ' +
          (orderOf('notes', sort) || 'ORDER BY updated_at DESC'),
        [workspaceId]
      ).map(mapNote);
    },

    getNote: function (id) {
      var row = queryOne('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!row) return null;
      var note = mapNote(row);
      note.content = row.content === null || row.content === undefined ? '' : row.content;
      if (!App.crypto.isEnvelope(row.content)) return note;
      if (!viewReady) {
        note.content = null;
        note.locked = true;
        return note;
      }
      if (hasOwn(noteText, id)) {
        note.content = noteText[id];
        return note;
      }
      note.content = null;
      note.damaged = true;
      return note;
    },

    createNote: function (workspaceId, folderId, title) {
      var id = util.uuid();
      var stamp = util.nowIso();
      return App.crypto.encrypt('').then(function (empty) {
        return write(
          'INSERT INTO notes (id, folder_id, workspace_id, title, content, is_private, created_at, updated_at, position) ' +
            'VALUES (?, ?, ?, ?, ?, 0, ?, ?, (' +
            '  SELECT COALESCE(MAX(position), -1) + 1 FROM notes' +
            "  WHERE workspace_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')" +
            '))',
          [id, folderId || null, workspaceId, (title || 'Untitled note'), empty, stamp, stamp,
            workspaceId, folderId || null],
        );
      }).then(function () {
        if (viewReady) noteText[id] = '';
        var row = queryOne('SELECT position, is_private FROM notes WHERE id = ?', [id]);
        return {
          id: id, folder_id: folderId || null, workspace_id: workspaceId,
          title: title || 'Untitled note', content: '', is_private: 0,
          created_at: stamp, updated_at: stamp,
          position: row ? row.position : 0,
        };
      });
    },

    setNotePrivate: function (id, flag) {
      var value = flag ? 1 : 0;
      return write('UPDATE notes SET is_private = ?, updated_at = ? WHERE id = ?',
        [value, util.nowIso(), id]);
    },

    updateNote: function (id, title, content) {
      var stamp = util.nowIso();
      var sealed = content === null || content === undefined
        ? Promise.resolve(null)
        : App.crypto.encrypt(content);
      var prevTitle = '';
      try {
        var prev = queryOne('SELECT title FROM notes WHERE id = ?', [id]);
        prevTitle = prev ? prev.title || '' : '';
      } catch (e) {  }
      return sealed.then(function (stored) {
        return write(function (run) {
          run('UPDATE notes SET title = ?, content = COALESCE(?, content), updated_at = ? WHERE id = ?',
            [title, stored, stamp, id]);
          refreshLinksInto(run, id, content);
        });
      }).then(function () {
        if (viewReady && typeof content === 'string') noteText[id] = content;
        if (typeof content === 'string' && title !== prevTitle) {
          return propagateRenameWrites(id, prevTitle, title).then(function () {
            return { updated_at: stamp };
          });
        }
        return { updated_at: stamp };
      });
    },

    moveNote: function (id, workspaceId, folderId) {
      return write('UPDATE notes SET folder_id = ?, workspace_id = ?, updated_at = ? WHERE id = ?',
        [folderId || null, workspaceId, util.nowIso(), id]).then(function (res) {
          var n = queryOne('SELECT COUNT(*) AS n FROM note_links WHERE source_note_id = ?', [id]);
          if (n && n.n > 0) {
            return write('UPDATE note_links SET workspace_id = ? WHERE source_note_id = ?',
              [workspaceId, id]).then(function () { return res; });
          }
          return res;
        });
    },

    moveFile: function (id, workspaceId, folderId) {
      return write('UPDATE files SET folder_id = ?, workspace_id = ? WHERE id = ?',
        [folderId || null, workspaceId, id]);
    },

    deleteNote: function (id) {
      return write('UPDATE notes SET deleted_at = ? WHERE id = ?', [util.nowIso(), id]);
    },

    bulkMoveNotes: function (ids, workspaceId, folderId) {
      var list = (ids || []).filter(function (id) { return id !== null && id !== undefined; });
      if (!list.length) return Promise.resolve(0);
      var placeholders = list.map(function () { return '?'; }).join(',');
      var stamp = util.nowIso();
      return write(function (run) {
        run('UPDATE notes SET folder_id = ?, workspace_id = ?, updated_at = ? WHERE id IN (' + placeholders + ')',
          [folderId || null, workspaceId, stamp].concat(list));
        run('UPDATE note_links SET workspace_id = ? WHERE source_note_id IN (' + placeholders + ')',
          [workspaceId].concat(list));
      }).then(function () { return list.length; });
    },

    bulkDeleteNotes: function (ids) {
      var list = (ids || []).filter(function (id) { return id !== null && id !== undefined; });
      if (!list.length) return Promise.resolve(0);
      var placeholders = list.map(function () { return '?'; }).join(',');
      return write('UPDATE notes SET deleted_at = ? WHERE id IN (' + placeholders + ')',
        [util.nowIso()].concat(list)).then(function () { return list.length; });
    },

    rebuildLinks: function () {
      var have = queryOne('SELECT COUNT(*) AS n FROM note_links');
      if (have && have.n > 0) return Promise.resolve({ built: false });
      var notes = query('SELECT id, workspace_id, content FROM notes WHERE deleted_at IS NULL');
      if (!notes.length) return Promise.resolve({ built: false });
      var vault = queryOne('SELECT id FROM vault WHERE id = 1');
      var jobs = [];
      notes.forEach(function (row) {
        var text = null;
        if (!App.crypto.isEnvelope(row.content)) text = row.content || '';
        else if (viewReady && hasOwn(noteText, row.id)) text = noteText[row.id];
        else return;
        util.extractWikiLinks(text).forEach(function (link) {
          jobs.push([row.id, link.norm, link.raw, row.workspace_id]);
        });
      });
      if (!jobs.length) return Promise.resolve({ built: false });
      return write(function (run) {
        run('DELETE FROM note_links');
        jobs.forEach(function (job) {
          run('INSERT OR IGNORE INTO note_links (source_note_id, target_norm, target_raw, workspace_id)' +
            ' VALUES (?, ?, ?, ?)', job);
        });
      }).then(function () { return { built: true }; });
    },

    resolveLinkTarget: function (workspaceId, norm) {
      var rows = query('SELECT id, title, updated_at FROM notes' +
        ' WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC',
        [workspaceId]);
      for (var i = 0; i < rows.length; i++) {
        if (util.normTitle(rows[i].title) === norm) return { id: rows[i].id, title: rows[i].title };
      }
      return null;
    },

    getOutgoingLinks: function (sourceId) {
      var owner = queryOne('SELECT workspace_id FROM notes WHERE id = ?', [sourceId]);
      if (!owner) return [];
      var titles = query('SELECT id, title FROM notes' +
        ' WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC',
        [owner.workspace_id]);
      var byNorm = {};
      titles.forEach(function (row) {
        var norm = util.normTitle(row.title);
        if (norm && !byNorm[norm]) byNorm[norm] = row.id;
      });
      return query('SELECT target_norm, target_raw FROM note_links WHERE source_note_id = ?', [sourceId])
        .map(function (row) {
          return {
            raw: row.target_raw, norm: row.target_norm,
            noteId: byNorm[row.target_norm] || null,
          };
        });
    },

    getBacklinks: function (noteId) {
      var note = queryOne('SELECT workspace_id, title FROM notes WHERE id = ? AND deleted_at IS NULL',
        [noteId]);
      if (!note) return [];
      var norm = util.normTitle(note.title);
      if (!norm) return [];
      return query(
        'SELECT l.source_note_id AS id, n.title AS title FROM note_links l ' +
        'JOIN notes n ON n.id = l.source_note_id ' +
        'WHERE l.workspace_id = ? AND l.target_norm = ? AND n.deleted_at IS NULL ' +
        'AND l.source_note_id != ? ORDER BY n.updated_at DESC',
        [note.workspace_id, norm, noteId]);
    },

    listFilesIn: function (workspaceId, folderId, sort) {
      var order = orderOf('files', sort) || 'ORDER BY created_at DESC';
      var rows = folderId
        ? query('SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at, position FROM files WHERE folder_id = ? AND deleted_at IS NULL ' + order, [folderId])
        : query('SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at, position FROM files WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ' + order, [workspaceId]);
      return rows.map(mapFileMeta);
    },

    addFile: function (workspaceId, folderId, filename, mimeType, bytes) {
      var id = util.uuid();
      var stamp = util.nowIso();
      var plain = bytes ? bytes.length : 0;
      return App.crypto.encryptBytes(bytes).then(function (stored) {
        return write(
          'INSERT INTO files (id, folder_id, workspace_id, filename, mime_type, blob_data, size, created_at, position) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, (' +
            '  SELECT COALESCE(MAX(position), -1) + 1 FROM files' +
            "  WHERE workspace_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')" +
            '))',
          [id, folderId || null, workspaceId, filename, mimeType || 'application/octet-stream', stored, plain, stamp,
            workspaceId, folderId || null],
        );
      }).then(function () {
        if (viewReady) fileBytes[id] = bytes;
        var row = queryOne('SELECT position FROM files WHERE id = ?', [id]);
        return {
          id: id, folder_id: folderId || null, workspace_id: workspaceId, filename: filename,
          mime_type: mimeType, size: bytes.length, created_at: stamp,
          position: row ? row.position : 0,
        };
      });
    },

    getFileMeta: function (id) {
      var row = queryOne('SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at FROM files WHERE id = ? AND deleted_at IS NULL', [id]);
      return row ? mapFileMeta(row) : null;
    },

    getFileBlob: function (id) {
      var row = queryOne('SELECT filename, mime_type, blob_data FROM files WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!row) return null;
      var data = row.blob_data;
      var bytes;
      if (typeof data === 'string' && App.crypto.isEnvelope(data)) {
        if (!viewReady) return null;
        bytes = hasOwn(fileBytes, id) ? fileBytes[id] : null;
        if (!bytes) {
          throw new Error('"' + row.filename + '" is stored encrypted and could not be read back. It may be damaged.');
        }
      } else {
        bytes = blobBytes(data);
      }
      var type = row.mime_type || 'application/octet-stream';
      return {
        filename: row.filename,
        mime_type: type,
        blob: new Blob([bytes], { type: type }),
      };
    },

    renameFile: function (id, filename) {
      return write('UPDATE files SET filename = ? WHERE id = ?', [String(filename).trim() || 'file', id]);
    },

    deleteFile: function (id) {
      return write('UPDATE files SET deleted_at = ? WHERE id = ?', [util.nowIso(), id]);
    },

    taskDayBounds: function (now) { return taskDayBounds(now); },

    listTasks: function (workspaceId, opts) {
      var o = opts || {};
      var view = normaliseTaskView(o.view);
      var clause = taskViewClause(view, taskDayBounds());
      var params = [workspaceId].concat(clause.params);
      var scope = '';
      if (o.folderId) {
        scope = ' AND folder_id = ?';
        params.push(o.folderId);
      }
      var order = view === 'done'
        ? 'ORDER BY done_at DESC, id ASC'
        : 'ORDER BY (due_at IS NULL), due_at ASC, priority DESC, position ASC, id ASC';
      return query(
        'SELECT id, workspace_id, folder_id, title, notes, done, done_at, due_at, due_has_time, ' +
          'priority, position, created_at, updated_at, remind_at, reminded_at, recurrence FROM tasks ' +
          'WHERE workspace_id = ?' + clause.sql + scope + ' ' + order,
        params
      ).map(mapTask);
    },

    countTasks: function (workspaceId, opts) {
      var o = opts || {};
      var bounds = taskDayBounds();
      var scope = o.folderId ? ' AND folder_id = ?' : '';
      var scopeParams = o.folderId ? [o.folderId] : [];

      var counts = {};
      TASK_VIEWS.forEach(function (view) {
        var clause = taskViewClause(view, bounds);
        var row = queryOne(
          'SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?' + clause.sql + scope,
          [workspaceId].concat(clause.params).concat(scopeParams)
        );
        counts[view] = row ? row.n : 0;
      });

      var overdue = queryOne(
        'SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND done = 0' +
          ' AND due_at IS NOT NULL AND due_at < ?' + scope,
        [workspaceId, bounds.todayStart].concat(scopeParams)
      );
      counts.overdue = overdue ? overdue.n : 0;
      return counts;
    },

    countOpenTasks: function (workspaceId) {
      var row = queryOne('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND done = 0', [workspaceId]);
      return row ? row.n : 0;
    },

    getTask: function (id) {
      var row = queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
      return row ? mapTask(row) : null;
    },

    createTask: function (workspaceId, folderId, title, fields) {
      var f = fields || {};
      var id = util.uuid();
      var stamp = util.nowIso();
      var due = f.due_at ? String(f.due_at) : null;
      return write(
        'INSERT INTO tasks (id, workspace_id, folder_id, title, notes, done, done_at, due_at, ' +
          'due_has_time, priority, position, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, (' +
          '  SELECT COALESCE(MAX(position), -1) + 1 FROM tasks' +
          "  WHERE workspace_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')" +
          '), ?, ?)',
        [id, workspaceId, folderId || null, TASK_EDITABLE.title(title), TASK_EDITABLE.notes(f.notes),
          due, due ? TASK_EDITABLE.due_has_time(f.due_has_time) : 0, clampPriority(f.priority),
          workspaceId, folderId || null, stamp, stamp]
      ).then(function () { return API.getTask(id); });
    },

    updateTask: function (id, fields) {
      var next = fields || {};
      var row = queryOne('SELECT workspace_id, folder_id, remind_at FROM tasks WHERE id = ?', [id]);
      if (!row) return Promise.resolve(false);

      var stamp = util.nowIso();
      var sets = [];
      var params = [];
      Object.keys(TASK_EDITABLE).forEach(function (column) {
        if (!Object.prototype.hasOwnProperty.call(next, column)) return;
        sets.push(column + ' = ?');
        params.push(TASK_EDITABLE[column](next[column]));
      });
      if (Object.prototype.hasOwnProperty.call(next, 'remind_at')
        && TASK_EDITABLE.remind_at(next.remind_at) !== (row.remind_at || null)) {
        sets.push('reminded_at = NULL');
      }
      if (!sets.length) return Promise.resolve(false);
      sets.push('updated_at = ?');
      params.push(stamp);

      if (Object.prototype.hasOwnProperty.call(next, 'folder_id')
        && String(next.folder_id || '') !== String(row.folder_id || '')) {
        sets.push('position = (' +
          '  SELECT COALESCE(MAX(position), -1) + 1 FROM tasks' +
          "  WHERE workspace_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')" +
          ')');
        params.push(row.workspace_id, next.folder_id || null);
      }
      params.push(id);
      return write('UPDATE tasks SET ' + sets.join(', ') + ' WHERE id = ?', params)
        .then(function () { return true; });
    },

    setTaskDone: function (id, done) {
      var stamp = util.nowIso();
      if (!done) {
        return write('UPDATE tasks SET done = 0, done_at = NULL, updated_at = ? WHERE id = ?', [stamp, id])
          .then(function () { return { repeated: null }; });
      }
      var row = queryOne('SELECT due_at, due_has_time, recurrence, remind_at FROM tasks WHERE id = ?', [id]);
      var rule = row ? parseRecurrence(row.recurrence) : null;
      var next = row && rule && row.due_at ? nextOccurrence(row.due_at, row.due_has_time, rule) : null;
      if (!next) {
        return write('UPDATE tasks SET done = 1, done_at = ?, updated_at = ? WHERE id = ?', [stamp, stamp, id])
          .then(function () { return { repeated: null }; });
      }
      var remind = advanceReminder(row.remind_at, row.due_at, next);
      return write(
        'UPDATE tasks SET done = 0, done_at = NULL, due_at = ?, remind_at = ?, reminded_at = NULL, ' +
          'updated_at = ? WHERE id = ?',
        [next, remind, stamp, id]
      ).then(function () { return { repeated: next }; });
    },

    dueReminders: function (nowIso) {
      var now = nowIso || util.nowIso();
      try {
        return query(
          'SELECT id, workspace_id, folder_id, title, notes, done, done_at, due_at, due_has_time, ' +
            'priority, position, created_at, updated_at, remind_at, reminded_at, recurrence FROM tasks ' +
            'WHERE done = 0 AND remind_at IS NOT NULL AND remind_at <= ? AND reminded_at IS NULL ' +
            'ORDER BY remind_at ASC LIMIT 20',
          [now]
        ).map(mapTask);
      } catch (err) {
        return [];
      }
    },

    markReminderFired: function (id, when) {
      return write('UPDATE tasks SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL',
        [when || util.nowIso(), id]);
    },

    deleteTask: function (id) {
      return write('DELETE FROM tasks WHERE id = ?', [id]);
    },
    search: function (workspaceId, term, limit) {
      var trimmed = String(term || '').trim();
      if (!trimmed) return { notes: [], files: [] };
      var pattern = likeParam(trimmed);
      var cap = limit || 100;
      var scoped = workspaceId !== null && workspaceId !== undefined;
      var scope = scoped ? ' AND workspace_id = ?' : '';
      var scopeArgs = scoped ? [workspaceId] : [];

      var files = query(
        'SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at, ' +
        '(SELECT name FROM workspaces WHERE id = files.workspace_id) AS workspace_name FROM files ' +
        "WHERE deleted_at IS NULL" + scope + " AND filename LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?",
        scopeArgs.concat([pattern, cap])
      ).map(mapFileMeta);

      if (!App.crypto.isActive()) {
        var plain = query(
          'SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, ' +
        '(SELECT name FROM workspaces WHERE id = notes.workspace_id) AS workspace_name FROM notes ' +
          "WHERE deleted_at IS NULL" + scope + " AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') " +
          'ORDER BY updated_at DESC LIMIT ?',
          scopeArgs.concat([pattern, pattern, cap])
        ).map(mapNote);
        return { notes: plain, files: files };
      }

      var notes = query(
        'SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, ' +
        '(SELECT name FROM workspaces WHERE id = notes.workspace_id) AS workspace_name FROM notes ' +
        "WHERE deleted_at IS NULL" + scope + " AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?",
        scopeArgs.concat([pattern, cap])
      ).map(mapNote);

      var result = { notes: notes, files: files, locked: !viewReady, contentScanned: 0, contentTruncated: false };
      if (!viewReady) return result;

      var matched = {};
      notes.forEach(function (note) { matched[note.id] = true; });
      var needle = trimmed.toLowerCase();
      var candidates = query(
        'SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, ' +
        '(SELECT name FROM workspaces WHERE id = notes.workspace_id) AS workspace_name FROM notes ' +
        'WHERE deleted_at IS NULL' + scope + ' ORDER BY updated_at DESC LIMIT ?',
        scopeArgs.concat([CONTENT_SCAN_CAP])
      );
      var all = queryOne('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL' + scope, scopeArgs);
      result.contentTruncated = candidates.length < (all ? all.n : 0);

      candidates.forEach(function (row) {
        result.contentScanned++;
        if (!hasOwn(noteText, row.id)) return; 
        if (noteText[row.id].toLowerCase().indexOf(needle) === -1) return;
        if (matched[row.id]) return;
        matched[row.id] = true;
        if (notes.length < cap) notes.push(mapNote(row));
      });
      return result;
    },

    counts: function (workspaceId) {
      var notes = queryOne('SELECT COUNT(*) AS n FROM notes WHERE workspace_id = ? AND deleted_at IS NULL', [workspaceId]);
      var files = queryOne('SELECT COUNT(*) AS n FROM files WHERE workspace_id = ? AND deleted_at IS NULL', [workspaceId]);
      var folders = queryOne('SELECT COUNT(*) AS n FROM folders WHERE workspace_id = ? AND deleted_at IS NULL', [workspaceId]);
      return { notes: notes ? notes.n : 0, files: files ? files.n : 0, folders: folders ? folders.n : 0 };
    },

    folderChains: function (workspaceId) {
      var folders = API.listFolders(workspaceId);
      var byId = {};
      folders.forEach(function (f) { byId[f.id] = f; });
      var cache = {};
      function chainOf(id) {
        if (cache[id]) return cache[id];
        var parts = [];
        var cursor = byId[id];
        var guard = 0;
        while (cursor && guard++ < 100) {
          parts.unshift({ id: cursor.id, name: cursor.name });
          cursor = cursor.parent_folder_id ? byId[cursor.parent_folder_id] : null;
        }
        cache[id] = parts;
        return parts;
      }
      var out = {};
      folders.forEach(function (f) { out[f.id] = chainOf(f.id); });
      return out;
    },

    folderPaths: function (workspaceId) {
      var chains = API.folderChains(workspaceId);
      var out = {};
      Object.keys(chains).forEach(function (id) {
        out[id] = chains[id].map(function (step) { return step.name; }).join(' / ');
      });
      return out;
    },

    exportBytes: function () {
      return db.export();
    },

    pendingWrites: function () {
      return writeQueue || Promise.resolve();
    },

    vaultState: function () {
      if (!App.crypto.isActive()) return 'off';
      return viewReady ? 'unlocked' : 'locked';
    },

    locked: function () {
      return App.crypto.isActive() && !viewReady;
    },

    vaultInfo: function () {
      var row = vaultRow();
      return {
        state: !row ? 'off' : (viewReady ? 'unlocked' : 'locked'),
        supported: App.crypto.isSupported(),
        iterations: row ? Number(row.iterations) : null,
        created_at: row ? row.created_at : null,
      };
    },

    enableVault: function (password, onProgress) {
      if (!App.crypto.isSupported()) return Promise.reject(new Error(App.crypto.unsupportedMessage()));
      if (vaultRow()) return Promise.reject(new Error('This notebook is already encrypted.'));

      var vault = null;
      var plan = null;
      var committed = false;

      return API.pendingWrites()
        .then(function () { return App.crypto.beginEnrollment(password); })
        .then(function (row) {
          vault = row;
          return planEncryption(onProgress);
        })
        .then(function (result) {
          plan = result;
          if (plan.alreadyEncrypted.length) {
            throw new Error(plan.alreadyEncrypted.length + ' record'
              + (plan.alreadyEncrypted.length === 1 ? ' is' : 's are')
              + ' already encrypted, and this notebook has no key for '
              + (plan.alreadyEncrypted.length === 1 ? 'it' : 'them')
              + '. Nothing was changed.');
          }
          return write(function (run) {
            plan.notes.forEach(function (entry) {
              run('UPDATE notes SET content = ? WHERE id = ?', [entry.stored, entry.id]);
            });
            plan.files.forEach(function (entry) {
              run('UPDATE files SET blob_data = ? WHERE id = ?', [entry.stored, entry.id]);
            });
            run('INSERT INTO vault (id, salt, iterations, check_iv, check_ct, created_at) '
              + 'VALUES (?, ?, ?, ?, ?, ?)',
              [VAULT_ID, vault.salt, vault.iterations, vault.check_iv, vault.check_ct, util.nowIso()]);
          });
        })
        .then(function () {
          committed = true;
          App.crypto.finishEnrollment();
          noteText = plan.noteText;
          fileBytes = plan.fileBytes;
          viewReady = true;
          var report = { notes: plan.notes.length, files: plan.files.length, compactionFailed: false };
          return compactQuietly(report);
        })
        .catch(function (err) {
          if (committed) throw err;
          App.crypto.cancelEnrollment();
          noteText = {};
          fileBytes = {};
          viewReady = false;
          throw err;
        });
    },

    unlockVault: function (password, onProgress) {
      var row = vaultRow();
      if (!row) return Promise.reject(new Error('This notebook is not encrypted.'));
      if (!App.crypto.isSupported()) return Promise.reject(new Error(App.crypto.unsupportedMessage()));

      return App.crypto.unlock(row, password)
        .then(function () { return buildUnlockedView(onProgress); })
        .then(function (view) {
          var result = { failures: view.failures };
          return rememberSession().then(function () { return result; }, function () { return result; });
        })
        .catch(function (err) {
          App.crypto.lock();
          noteText = {};
          fileBytes = {};
          viewReady = false;
          throw err;
        });
    },

    resumeVault: function (onProgress) {
      if (!vaultRow()) return Promise.resolve({ resumed: false });
      if (!App.crypto.isSupported()) return Promise.resolve({ resumed: false });

      return App.storage.loadVaultKey().then(function (record) {
        if (!record || !record.key) return { resumed: false };
        if (record.id !== App.session.id()) {
          return App.storage.clearVaultKey().then(function () { return { resumed: false }; });
        }
        App.crypto.adoptKey(record.key);
        return buildUnlockedView(onProgress).then(function (view) {
          return { resumed: true, failures: view.failures };
        }, function () {
          App.crypto.lock();
          noteText = {};
          fileBytes = {};
          viewReady = false;
          return forgetSession().then(function () { return { resumed: false, dropped: true }; });
        });
      }).catch(function () {
        return { resumed: false };
      });
    },

    lockVault: function () {
      App.crypto.lock();
      noteText = {};
      fileBytes = {};
      viewReady = false;
      forgetSession();
    },

    disableVault: function (password, onProgress) {
      var row = vaultRow();
      if (!row) return Promise.reject(new Error('This notebook is not encrypted.'));
      if (!App.crypto.isSupported()) return Promise.reject(new Error(App.crypto.unsupportedMessage()));

      var plan = null;
      var wasReady = viewReady;
      var committed = false;

      return API.pendingWrites()
        .then(function () { return App.crypto.unlock(row, password); })
        .then(function () { return planDecryption(onProgress); })
        .then(function (result) {
          plan = result;
          if (plan.failures.length) {
            throw new Error(plan.failures.length + ' record'
              + (plan.failures.length === 1 ? ' could' : 's could')
              + ' not be decrypted, so encryption was left on. Nothing was changed.');
          }
          return write(function (run) {
            plan.notes.forEach(function (entry) {
              run('UPDATE notes SET content = ? WHERE id = ?', [entry.plain, entry.id]);
            });
            plan.files.forEach(function (entry) {
              run('UPDATE files SET blob_data = ? WHERE id = ?', [entry.plain, entry.id]);
            });
            run('DELETE FROM vault WHERE id = ?', [VAULT_ID]);
          });
        })
        .then(function () {
          committed = true;
          App.crypto.setVaultExists(false);
          noteText = {};
          fileBytes = {};
          viewReady = false;
          forgetSession();
          var report = { notes: plan.notes.length, files: plan.files.length };
          return compact().then(function () { return report; }, function () { return report; });
        })
        .catch(function (err) {
          if (committed) throw err;
          if (!wasReady) {
            App.crypto.lock();
            noteText = {};
            fileBytes = {};
            viewReady = false;
          }
          throw err;
        });
    },

    storedContent: function (id) {
      var row = queryOne('SELECT content FROM notes WHERE id = ?', [id]);
      return row ? row.content : null;
    },

    storedFileValue: function (id) {
      var row = queryOne('SELECT blob_data FROM files WHERE id = ?', [id]);
      return row ? row.blob_data : null;
    },

    countTrash: function (workspaceId) {
      var scope = workspaceId ? ' AND workspace_id = ?' : '';
      var args = workspaceId ? [workspaceId] : [];
      var folders = queryOne('SELECT COUNT(*) AS n FROM folders WHERE deleted_at IS NOT NULL' + scope, args);
      var notes = queryOne('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NOT NULL' + scope, args);
      var files = queryOne('SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NOT NULL' + scope, args);
      return (folders ? folders.n : 0) + (notes ? notes.n : 0) + (files ? files.n : 0);
    },

    listTrash: function (workspaceId) {
      var folderRows = query(
        'SELECT id, workspace_id, name, deleted_at FROM folders WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
        [workspaceId]
      );
      var noteRows = query(
        'SELECT id, workspace_id, folder_id, title, is_private, deleted_at FROM notes WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
        [workspaceId]
      );
      var fileRows = query(
        'SELECT id, workspace_id, folder_id, filename, deleted_at FROM files WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
        [workspaceId]
      );
      return {
        folders: folderRows,
        notes: noteRows.map(mapNote),
        files: fileRows.map(mapFileMeta),
      };
    },

    subtreeFileBytes: function (workspaceId) {
      var rows = query(
        'SELECT folder_id AS folder_id, SUM(size) AS bytes FROM files ' +
        'WHERE workspace_id = ? AND folder_id IS NOT NULL GROUP BY folder_id',
        [workspaceId]
      );
      var direct = {};
      rows.forEach(function (r) { direct[r.folder_id] = Number(r.bytes) || 0; });

      var folders = query(
        'SELECT id, parent_folder_id FROM folders WHERE workspace_id = ?', [workspaceId]
      );
      var parentOf = {};
      folders.forEach(function (f) { parentOf[f.id] = f.parent_folder_id || null; });

      var totals = {};
      Object.keys(direct).forEach(function (folderId) {
        var cursor = folderId;
        var guard = 0;
        while (cursor && guard++ < 100) {
          totals[cursor] = (totals[cursor] || 0) + direct[folderId];
          cursor = parentOf[cursor];
        }
      });
      return totals;
    },

    descendantFolderIdsAll: function (rootId) {
      var seen = {};
      var ids = [rootId];
      seen[rootId] = true;
      var frontier = [rootId];
      while (frontier.length) {
        var placeholders = frontier.map(function () { return '?'; }).join(',');
        var children = query(
          'SELECT id FROM folders WHERE parent_folder_id IN (' + placeholders + ')',
          frontier
        ).map(function (r) { return r.id; }).filter(function (id) {
          if (seen[id]) return false;
          seen[id] = true;
          return true;
        });
        if (!children.length) break;
        ids = ids.concat(children);
        frontier = children;
      }
      return ids;
    },

    restoreFolder: function (id) {
      var ids = API.descendantFolderIdsAll(id);
      return write(function (run) {
        var placeholders = ids.map(function () { return '?'; }).join(',');
        run('UPDATE folders SET deleted_at = NULL WHERE id IN (' + placeholders + ')', ids);
        run('UPDATE notes SET deleted_at = NULL WHERE folder_id IN (' + placeholders + ')', ids);
        run('UPDATE files SET deleted_at = NULL WHERE folder_id IN (' + placeholders + ')', ids);
      });
    },

    restoreNote: function (id) {
      return write('UPDATE notes SET deleted_at = NULL WHERE id = ?', [id]);
    },

    restoreFile: function (id) {
      return write('UPDATE files SET deleted_at = NULL WHERE id = ?', [id]);
    },

    restoreWithAncestors: function (kind, id) {
      var table = kind === 'note' ? 'notes' : 'files';
      var row = queryOne('SELECT folder_id FROM ' + table + ' WHERE id = ?', [id]);
      var cursor = row ? row.folder_id : null;

      var ancestors = [];
      var guard = 0;
      while (cursor && guard++ < 100) {
        var folder = queryOne('SELECT id, parent_folder_id, deleted_at FROM folders WHERE id = ?', [cursor]);
        if (!folder) break;
        if (folder.deleted_at) ancestors.push(folder.id);
        cursor = folder.parent_folder_id || null;
      }

      return write(function (run) {
        run('UPDATE ' + table + ' SET deleted_at = NULL WHERE id = ?', [id]);
        if (ancestors.length) {
          var placeholders = ancestors.map(function () { return '?'; }).join(',');
          run('UPDATE folders SET deleted_at = NULL WHERE id IN (' + placeholders + ')', ancestors);
        }
      }).then(function () { return ancestors.length; });
    },

    permanentDeleteFolder: function (id) {
      var ids = API.descendantFolderIdsAll(id);
      return write(function (run) {
        var placeholders = ids.map(function () { return '?'; }).join(',');
        run('DELETE FROM notes WHERE folder_id IN (' + placeholders + ')', ids);
        run('DELETE FROM files WHERE folder_id IN (' + placeholders + ')', ids);
        run('DELETE FROM folders WHERE id IN (' + placeholders + ')', ids);
      });
    },

    permanentDeleteNote: function (id) {
      delete noteText[id];
      return write('DELETE FROM notes WHERE id = ?', [id]);
    },

    permanentDeleteFile: function (id) {
      delete fileBytes[id];
      return write('DELETE FROM files WHERE id = ?', [id]);
    },

    listTemplates: function (wsId) { return query('SELECT * FROM templates WHERE workspace_id=? ORDER BY name', [wsId||0]); },
    saveTemplate: function (id, wsId, name, content) { return write('INSERT INTO templates (id, workspace_id, name, content, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id, name=excluded.name, content=excluded.content', [id||null, wsId||0, String(name).trim()||'Untitled', content||'']); },
    deleteTemplate: function (id) { return write('DELETE FROM templates WHERE id=?', [id]); },

    destroy: function () {
      App.crypto.lock();
      noteText = {};
      fileBytes = {};
      viewReady = false;
      if (db) {
        try { db.close(); } catch (err) {  }
        db = null;
      }
    },
  };

  App.db = API;
})(window.NoteApp);
