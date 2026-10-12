/**
 * db.js — the SQLite layer.  *** This is the part worth reading carefully. ***
 *
 * Engine: sql.js (SQLite compiled to WebAssembly). The database lives in WASM memory,
 * which is volatile — closing the tab would lose everything. So every mutation goes
 * through one funnel, write(), which does three things atomically from the app's point
 * of view:
 *
 *     1. run the SQL (parameterised, inside a transaction)
 *     2. db.export()  -> the entire database as a Uint8Array
 *     3. hand those bytes to storage.save()  -> IndexedDB
 *
 * Nothing else in the app is allowed to touch SQL, so there is exactly one place where
 * "data changed but was not persisted" could happen. There is no save button because
 * there is no unsaved state.
 *
 * Cost note: db.export() serialises the whole database, and sql.js has no incremental
 * write-back. That is fine at the scale this app targets (thousands of notes, tens of
 * MB of attachments); see README "Limitations" for where it stops being fine.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;

  // ------------------------------------------------------------------- schema
  // Applied in order; PRAGMA user_version records how far we have got, so future
  // versions of the app can append migrations without touching existing databases.
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
        // NULL means "at the workspace root"; otherwise points at another folder.
        '  parent_folder_id TEXT REFERENCES folders(id),' +
        '  created_at TEXT NOT NULL' +
        ')',
      'CREATE TABLE IF NOT EXISTS notes (' +
        '  id TEXT PRIMARY KEY,' +
        // NULL folder_id = loose note at the workspace root.
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
        // The attachment itself, raw bytes, exactly as uploaded.
        '  blob_data BLOB,' +
        '  size INTEGER NOT NULL DEFAULT 0,' +
        '  created_at TEXT NOT NULL' +
        ')',
      // Indexes for the reads the UI actually does: tree per workspace, contents per
      // folder, and search.
      'CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders (workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (parent_folder_id)',
      'CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes (workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes (folder_id)',
      'CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_files_workspace ON files (workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_files_folder ON files (folder_id)',
    ],
    [
      // Migration for trash / soft-delete support (v2).
      'ALTER TABLE folders ADD COLUMN deleted_at TEXT',
      'ALTER TABLE notes ADD COLUMN deleted_at TEXT',
      'ALTER TABLE files ADD COLUMN deleted_at TEXT',
      'CREATE INDEX IF NOT EXISTS idx_folders_deleted ON folders (deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes (deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_files_deleted ON files (deleted_at)',
    ],
    [
      // Migration for manual ordering (v3).
      //
      // Until now every list was drawn in the order its rows happened to fall out of the
      // database: created_at for the workspace rail, name for folders, updated_at
      // descending for notes, created_at descending for files. Adding a position column
      // therefore has to answer a second question besides where the column lives: where
      // does EVERY EXISTING ROW start? Leaving them all at 0 would collapse the manual
      // order into whatever order SQLite felt like returning for equal keys, which reads
      // as the app having shuffled the notebook on the upgrade that claimed to add a
      // feature. So each table is backfilled with its row index in its own historical
      // order first, and only then does position mean anything.
      //
      // The backfill is a correlated count rather than a window function. ROW_NUMBER()
      // would express this more directly, but a plain count is what every SQLite the app
      // can find itself compiled against supports, and it is the same shape for all four
      // tables. It is also stable under ties: the id is the tiebreak, so two rows sharing
      // a millisecond cannot both claim one slot and swap places on every boot.
      'ALTER TABLE workspaces ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE files ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'UPDATE workspaces SET position = (' +
        '  SELECT COUNT(*) FROM workspaces w2' +
        '  WHERE w2.created_at < workspaces.created_at' +
        '     OR (w2.created_at = workspaces.created_at AND w2.id < workspaces.id)' +
        ')',
      // Each backfill reproduces the list it is replacing — folders were alphabetical,
      // notes newest-edited-first, files newest-first, workspaces oldest-first — rather than
      // imposing one order on all four. A shared "by created_at" would have been simpler to
      // write and would have greeted the reader with their notebook reversed on both of the
      // lists where the old order ran backwards.
      //
      // Notes and files are grouped by their folder, not by their workspace: a note
      // reordered inside one folder must not disturb its sibling, which is the whole
      // reason the scope carries the folder. COALESCE is what makes the root work — a
      // plain comparison against NULL is never true, so every loose row would have been
      // backfilled to 0 and piled up at the top of the tree.
      //
      // "How many rows sort before me" is the same count in both directions: for a list
      // that ran newest-first it counts the rows that are newer, with the id breaking the
      // tie exactly as the ORDER BY at read time does.
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
      // One index per list that actually sorts on position, and none for the rest. The
      // scope columns are already indexed by v1 (idx_notes_folder, idx_files_folder,
      // idx_folders_parent); what a manual ORDER BY adds is the second half of the key,
      // so that is what these carry.
      'CREATE INDEX IF NOT EXISTS idx_workspaces_position ON workspaces (position)',
      'CREATE INDEX IF NOT EXISTS idx_folders_manual ON folders (workspace_id, parent_folder_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_notes_manual ON notes (folder_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_notes_manual_root ON notes (workspace_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_files_manual ON files (folder_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_files_manual_root ON files (workspace_id, position)',
    ],
    [
      // Migration for the task list (v4).
      //
      // A task reuses the folder tree as its project rather than introducing a second
      // taxonomy: a folder already means "a group of things in this workspace", and a
      // reader who has arranged a notebook has already said where their work belongs. So
      // folder_id is nullable for exactly the reason a note's is — a task with no project
      // is the common case, and the workspace root is a real place here rather than a
      // missing value.
      //
      // due_has_time is a separate column because an all-day to-do and a timed event are
      // different things, and one nullable timestamp cannot tell them apart. Both store an
      // ISO instant, and "sometime on Tuesday" has to be stored as *some* midnight — so on
      // its own the column would render every all-day task as "09:00" in one timezone and
      // "23:00" in another, and a task due Tuesday would read as overdue for most of the
      // day it is due. The flag says which of the two the timestamp means; it is what lets
      // the pane print a date without inventing a time, and it is deliberately a flag
      // rather than a second timestamp, because there is only ever one due moment.
      //
      // done_at is the counterpart in the other direction: done says whether the row is
      // finished, and the stamp says when, which is what the Done view is sorted by.
      // Clearing it on undo is what keeps "when was this finished" honest instead of
      // leaving a completion date on a task that is open again.
      'CREATE TABLE IF NOT EXISTS tasks (' +
        '  id TEXT PRIMARY KEY,' +
        '  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,' +
        // NULL means "no project"; otherwise the folder the task is filed under.
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
      // One index per query the pane actually runs, and nothing speculative: the rail
      // counts a workspace's open work, the four view filters narrow on the due date,
      // and a manual reorder counts siblings inside one folder scope.
      'CREATE INDEX IF NOT EXISTS idx_tasks_workspace_done ON tasks (workspace_id, done)',
      'CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON tasks (workspace_id, due_at)',
      'CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks (workspace_id, folder_id, position)',
    ],
    [
      // Migration for the vault (v5).
      //
      // Exactly one row, ever, and the CHECK is what says so: this table describes the
      // notebook rather than something inside it, so a second row would be two answers to
      // "which key opens this database" with no way to choose between them.
      //
      // The row carries what is needed to derive the key again — the per-vault salt and the
      // iteration count it was derived with — plus one encrypted known string. The iteration
      // count lives here rather than in a constant so it can be raised later without
      // invalidating an existing notebook: an old vault is always unlocked with the count it
      // was written with.
      //
      // check_ct is the KNOWN STRING sealed with the derived key, not a hash of the password.
      // That choice is the whole verification design: the only way to "pass" this check is to
      // derive the key that decrypts the data, because AES-GCM's authentication tag fails
      // under any other key. A stored hash would be a second, independent artefact that could
      // be verified without ever producing a usable key — two facts that can drift apart, and
      // a password-equivalent value sitting in the database next to the ciphertext it guards.
      //
      // check_iv and check_ct are separate columns rather than one "enc:..." envelope because
      // this row is not a payload: it is read before any key exists, and a nonce and a
      // ciphertext are the native shape the AES-GCM API consumes.
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
      // Migration for wiki links / backlinks (v6).
      //
      // Links are keyed by TARGET TITLE, not by target id: a rename then keeps every
      // link pointing at the note rather than orphaning them all, and an unresolved
      // [[title]] is simply a row with no note behind it yet — the "click to create"
      // the interface offers. The source side is an id with ON DELETE CASCADE, so a
      // permanently deleted note takes its outgoing links with it; a soft-deleted
      // (trashed) source keeps its rows, and the backlink read filters those out.
      //
      // Only titles are stored — never body text — so this table leaks nothing the
      // notes table does not already hold in the clear when the vault is on.
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
  // v7 templates
  ['CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT \'\', content TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);', 'CREATE INDEX IF NOT EXISTS idx_templates_ws ON templates(workspace_id);'],
  // v8 retired: revisions removed; stub drops the table so old installs clean up
  // while the array keeps its length (existing DBs sit at user_version 8).
  ['DROP TABLE IF EXISTS revisions;', 'DROP INDEX IF EXISTS idx_revisions_note;'],
  // v9 retired: saved filters (lenses) removed; stub drops the table so old installs
  // clean up while the array keeps its length (existing DBs sit at user_version 9).
  ['DROP TABLE IF EXISTS lenses;', 'DROP INDEX IF EXISTS idx_lenses_ws;'],
  [
    // Manual Private flag (v10) — replaces the removed Safe-Share auto-block.
    //
    // One column, not a scan: a note is private because the reader said so, not
    // because its text matched a pattern. Bulk export skips private notes;
    // per-note copy/download stay allowed. Additive only — existing rows default
    // to 0 (not private) via the column default.
    'ALTER TABLE notes ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX IF NOT EXISTS idx_notes_private ON notes (is_private)',
  ],
  [
    // Reminders and recurrence (v11).
    //
    // remind_at is an absolute instant rather than an offset from the due date. The form
    // offers the offset (at the due time, an hour before) and resolves it, but what is
    // stored is the moment to announce, which is the only thing a timer can compare
    // against. reminded_at is the stamp that stops a timer from
    // announcing the same reminder every thirty seconds. recurrence is JSON for one of a
    // handful of code literals (see RECURRENCE_FREQS), the same rule every other stored
    // enum here follows: the interface picks one, it can never write SQL.
    'ALTER TABLE tasks ADD COLUMN remind_at TEXT',
    'ALTER TABLE tasks ADD COLUMN reminded_at TEXT',
    'ALTER TABLE tasks ADD COLUMN recurrence TEXT',
    'CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks (remind_at, reminded_at)',
  ],
];

  var db = null;        // the sql.js Database
  var writeQueue = null; // serialises writes so two rapid saves cannot interleave

  // The orderable entities, under the names the interface uses for them. This is the one
  // mapping from a string that arrived from outside to a table name, which is exactly why
  // it exists: a reorder has to interpolate a table name into SQL, and this map is what
  // keeps that name from ever being the caller's.
  var TABLES = {
    workspace: 'workspaces',
    folder: 'folders',
    note: 'notes',
    file: 'files',
    task: 'tasks',
  };

  // ------------------------------------------------------------------ SQL helpers

  /**
   * Run a read statement and return an array of objects.
   * sql.js caches every prepared statement internally until Database.close(), so each
   * statement is explicitly freed — otherwise a long session leaks WASM memory one
   * query at a time.
   */
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

  /** Execute one or more statements with optional parameters. No persistence. */
  function rawRun(sql, params) {
    db.run(sql, params || undefined);
  }

  /**
   * Derive the non-blob columns of a row. SELECT * would drag whole attachments into
   * memory just to draw a list, so every list query names its columns and this helper
   * decides which of them are safe to hand to the renderer.
   *
   * position is one of them even though a sorted list never draws it. Manual order counts
   * from the top of each folder, so the workspace-wide list the tree is assembled from
   * cannot be put in manual order by SQL at all — the renderer re-orders each folder's
   * slice itself, and it can only do that if the row still carries the number.
   */
  function mapNote(row) {
    return {
      id: row.id,
      folder_id: row.folder_id,
      workspace_id: row.workspace_id,
      // Filled only by search(), which asks each query to carry the name of the workspace the
      // row lives in. A hit labelled from a list held elsewhere could name a workspace it is
      // not in; this cannot.
      workspace_name: row.workspace_name || null,
      title: row.title || '',
      // Manual Private flag (v10): 1 means "skip me in bulk export". Coerced to 0/1
      // here so callers never see undefined (old SELECTs) or SQLite's loose typing.
      is_private: Number(row.is_private) ? 1 : 0,
      // Always empty, and deliberately so. Every list query above omits the content column, so
      // this was already '' in practice — but with a vault in play the raw column is a
      // possibility that must not exist: an envelope is base64, and a prose field that carried
      // one would be printed by a renderer as if the user had typed it. getNote() is the one
      // reader that resolves the body, and it sets this itself.
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
      // See mapNote: search() is the one caller that fills this in.
      workspace_name: row.workspace_name || null,
      filename: row.filename,
      mime_type: row.mime_type,
      size: row.size,
      created_at: row.created_at,
    };
  }

  /**
   * Derive a task row for the renderer and for the edit dialog.
   *
   * notes is carried on every row even though the list only draws the title: a task's
   * notes are a line or two of text, so re-reading the row when the edit dialog opens
   * would be a second query for something already in hand.
   *
   * done, done_at and due_has_time are normalised to numbers here rather than left as
   * whatever sql.js hands back. A checkbox's checked state and a count's arithmetic both
   * depend on them, and SQLite has no boolean type, so "0 or 1" is a decision this layer
   * makes once instead of one every caller makes for itself.
   */
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

  /**
   * The columns updateTask() will write, keyed by the names the interface uses for them.
   *
   * One mapping from a caller's string to a column name, for the same reason TABLES
   * exists: a SET clause has to interpolate a column name, and iterating this object is
   * what keeps that name from ever being the caller's. Each entry also carries its own
   * coercion, because the three kinds of value on this table — text, an ISO instant and a
   * 0/1 flag — are each stored differently from the way a form control reports them.
   */
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

  /** Priority is 0 (normal), 1 (low) or 2 (high); anything else is stored as normal. */
  function clampPriority(value) {
    var n = Number(value);
    return n === 1 || n === 2 ? n : 0;
  }

  /** The repeat rules that exist. Anything else is stored as no repeat at all. */
  var RECURRENCE_FREQS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

  /**
   * A repeat rule as the JSON this app stores, or null.
   *
   * Only the literals above survive and the interval is clamped to a sane range, so a
   * stored rule can never carry arbitrary text into the date arithmetic and a damaged
   * value degrades to a plain task rather than throwing on every render.
   */
  function normalizeRecurrence(value) {
    if (!value || typeof value !== 'object') return null;
    var freq = String(value.freq || '');
    if (RECURRENCE_FREQS.indexOf(freq) === -1) return null;
    var interval = Math.max(1, Math.min(99, Math.round(Number(value.interval) || 1)));
    return JSON.stringify({ freq: freq, interval: interval });
  }

  /** Read a stored rule back. Never throws: a damaged value means no repeat. */
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

  /**
   * The next instant a repeat rule lands on, measured on the local calendar.
   *
   * Calendar arithmetic, not milliseconds: a week later is the same wall clock time seven
   * days on, across a daylight-saving change, and the 31st of a month with no 31st clamps
   * to that month's last day instead of spilling into the next one.
   */
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
    // A rule whose next date is still behind the one it came from would leave the task
    // overdue forever, so it moves one more day.
    if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  /** Move a reminder with its task, keeping the distance from the due date it had. */
  function advanceReminder(remindAt, oldDue, newDue) {
    if (!remindAt || !oldDue || !newDue) return remindAt || null;
    var offset = new Date(oldDue).getTime() - new Date(remindAt).getTime();
    if (isNaN(offset)) return remindAt;
    return new Date(new Date(newDue).getTime() - offset).toISOString();
  }

  // ----------------------------------------------------------------- task queries
  /**
   * The day boundaries every task query and the pane's grouping are measured from.
   *
   * Local midnight, not UTC midnight: "today" is a fact about the calendar on the wall
   * the reader is looking at, and a task due at 09:00 their time is not due on the
   * previous day merely because instants are stored in UTC. This lives in the database
   * layer even though it touches no SQL, because the SQL views and the bucket headings
   * in the pane must both be measured from the same boundaries — two definitions of where
   * today ends would drift the moment either was edited, and the pane would then label a
   * row "Today" under a "Tomorrow" heading.
   */
  function taskDayBounds(now) {
    var base = new Date(now === undefined || now === null ? Date.now() : now);
    base.setHours(0, 0, 0, 0);
    function shift(days) {
      // setDate rather than millisecond arithmetic: a day that crosses a daylight-saving
      // boundary is not 86,400,000 ms long, and adding a fixed block of them would move
      // this boundary by an hour twice a year.
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

  /** Anything unrecognised is the open list, which is the view with no question in it. */
  function normaliseTaskView(view) {
    return TASK_VIEWS.indexOf(view) === -1 ? 'all' : view;
  }

  /**
   * The WHERE fragment for one view, built once so the list and the badge above it cannot
   * disagree. This codebase has already shipped a count that described a different list
   * than the one it headed, and the fix then was the same as the fix here: one place that
   * decides what a view means, used by both the query and the number.
   *
   * Each view is phrased as the question the reader is asking rather than as a window on
   * the data. Today therefore includes what is overdue — a task due yesterday is still
   * today's problem, and hiding it behind a second filter is how a task list loses work —
   * and Upcoming starts at tomorrow's midnight for the same reason: today is answered by
   * the view before it. Undated work belongs to no view but All, because "coming up" is a
   * claim about a date it does not have.
   */
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

  // ------------------------------------------------------------- sort vocabulary
  /**
   * The one sort vocabulary the whole app speaks. Every sort the interface can express
   * is a member of SORT_KEYS and nothing else reaches SQL: these are keys, never
   * fragments, and orderBy() is the only function that turns one into a fragment.
   */
  var SORT_KEYS = ['manual', 'name', 'created', 'updated', 'size'];
  var SORT_DIRECTIONS = ['asc', 'desc'];
  // The interface's words for those keys, in the order the one sort menu offers them.
  // Manual first, because it is the only key that describes the reader's own arrangement
  // rather than the data, and the only one that unlocks the move commands.
  var SORT_LABELS = {
    manual: 'Manual order',
    name: 'Name',
    created: 'Date created',
    updated: 'Date modified',
    size: 'Size',
  };

  /**
   * Which column each key means, per list. Deliberately not one shared table: notes have
   * no size column and files have no updated_at, so the key is resolved against the table
   * that is being read. When the column is genuinely absent the key still has to mean
   * something, because the one sort menu offers every key for every list — orderBy()
   * therefore falls back (SORT_FALLBACK, otherwise the name) instead of failing, and
   * interpolating the missing column is never an option.
   */
  var SORT_COLUMNS = {
    workspaces: { name: 'name', created: 'created_at' },
    folders: { name: 'name', created: 'created_at' },
    notes: { name: 'title', created: 'created_at', updated: 'updated_at' },
    files: { name: 'filename', created: 'created_at', size: 'size' },
  };
  // What a key becomes when the list has no such column. updated on a file is closest to
  // when it arrived, so it lands on created_at; everything else lands on the name, which
  // every table has — and that is also the documented fallback for size on notes.
  var SORT_FALLBACK = { updated: 'created_at' };

  /**
   * ORDER BY for one table, or null when no sort was asked for at all.
   *
   * Two things hold for every fragment this returns. It is assembled from the
   * SORT_COLUMNS whitelist, so no value a caller supplied is ever interpolated; and it
   * ends with a tiebreak, because every one of these keys can tie — two notes sharing a
   * title, two files uploaded in the same millisecond — and a sort with equal keys and no
   * tiebreak is a list that reshuffles itself between two otherwise identical renders.
   * Manual order falls back to the row id rather than to a timestamp, so the one edit
   * manual order exists for, a swap between two adjacent rows, survives its own re-read.
   */
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
    // Name is the one key that carries a collation, for the same reason the folder list
    // has always carried one: NOCASE is what stops a lowercase title from sorting after
    // a capitalised one. The other keys are dates, ids and integers, which have none.
    var collate = column === columns.name ? ' COLLATE NOCASE' : '';
    return 'ORDER BY ' + column + collate + ' ' + upper + ', ' + tiebreak;
  }

  /**
   * Normalise anything that might be a sort into { key, dir } with both members known
   * good, or null when it is not a sort at all. This is the boundary that lets the
   * preference store (localStorage, hand-editable) and a caller argument be treated
   * identically: both come out of here as one of a handful of literals.
   */
  function normaliseSort(sort) {
    if (!sort || typeof sort !== 'object') return null;
    if (SORT_KEYS.indexOf(sort.key) === -1) return null;
    var dir = SORT_DIRECTIONS.indexOf(sort.direction) === -1 ? sort.dir : sort.direction;
    if (SORT_DIRECTIONS.indexOf(dir) === -1) dir = 'asc';
    return { key: sort.key, dir: dir };
  }

  /**
   * ORDER BY for a table from whatever sort the caller passed, or null when the caller
   * passed nothing recognisable.
   *
   * A caller that asks for no sort has not asked for one, so it gets the same ORDER BY the
   * list has always had (see the list functions below). That is not politeness to old
   * code: the renderer is not the only caller, and folderPaths(), the scope lookups and
   * every check tool read these lists without a sort argument. Quietly substituting the
   * stored preference here would hand them an order they never asked for and cannot see,
   * while the interface — which does pass the sort explicitly — would be unaffected.
   */
  function orderOf(table, sort) {
    var explicit = normaliseSort(sort);
    return explicit ? orderBy(table, explicit) : null;
  }

  /**
   * A manual reorder is a swap between siblings, so every query in reorderWithin() is
   * narrowed to one scope: the same parent folder for folders, the same folder for notes
   * and files, and everything at once for workspaces, which have no parent.
   *
   * COALESCE appears wherever a scope column can be NULL, and it is not decoration. The
   * workspace root IS parent_folder_id NULL (or folder_id NULL), and equality against
   * NULL is never true, so without it a root-level row would have no neighbours and could
   * not be moved at all — the one case a first-time user is most likely to try.
   */
  function reorderScope(kind, scopeId, scopeFolderId) {
    if (kind === 'workspace') return { where: '', params: [] };
    if (kind === 'folder') {
      return {
        where: "workspace_id = ? AND COALESCE(parent_folder_id, '') = COALESCE(?, '')",
        params: [scopeId || '', scopeFolderId || null],
      };
    }
    // note, file and task share a shape: they live in a workspace and optionally in a
    // folder. A task's project IS that folder, so a move inside one project leaves the
    // neighbours in every other project exactly where they were.
    return {
      where: "workspace_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')",
      params: [scopeId || '', scopeFolderId || null],
    };
  }

  /**
   * Swap a row position with its neighbour, one step per call, inside its own scope.
   *
   * One step rather than move-to-the-end because the interface offers up and down; a row
   * that jumped a whole list on one press would be impossible to place by eye. Both ends
   * are clamped by the absence of a neighbour, so pressing up at the top of a list is a
   * no-op rather than an error, and the caller is told so by the resolved boolean.
   *
   * @returns {Promise<boolean>} whether anything actually moved.
   */
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

    // The neighbour is the nearest row on the requested side, with the id as the
    // tiebreak. Two rows that share a position would otherwise make which one is above
    // me arbitrary, and the swap could pick the same row twice and appear to do nothing.
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

    // One transaction, so a swap is never half applied: two rows holding the same
    // position is the one state manual order cannot represent.
    return write(function (run) {
      run('UPDATE ' + table + ' SET position = ? WHERE id = ?', [neighbour.position, current.id]);
      run('UPDATE ' + table + ' SET position = ? WHERE id = ?', [current.position, neighbour.id]);
    }).then(function () { return true; });
  }

  /** Escape the LIKE wildcards so a search for 50% means literally 50%. */
  function likeParam(term) {
    return '%' + String(term).replace(/[\\%_]/g, function (ch) { return '\\' + ch; }) + '%';
  }

  // ------------------------------------------------------------- THE WRITE FUNNEL

  /**
   * THE single write entry point. Everything that mutates the database comes through
   * here, which is what makes "auto-save on every write" a structural guarantee rather
   * than a habit.
   *
   * @param {string|function} sqlOrFn SQL string, or a function receiving a `run(sql, params)`
   *                                  helper so several statements can share one transaction
   *                                  and one persistence round-trip.
   * @param {Array} [params] bound parameters for the string form.
   * @returns {Promise<{changes:number}>} resolves once the snapshot is safely in IndexedDB.
   *
   * Writes are queued: sql.js is synchronous, but persistence is async, so two writes
   * landing together (e.g. debounced autosave plus a rename) are executed and stored in
   * order instead of racing to overwrite each other's snapshot.
   */
  function write(sqlOrFn, params) {
    var task = function () {
      var changes = 0;

      // Step 1 — execute the SQL. Each write is its own transaction: if a multi-statement
      // unit fails halfway, ROLLBACK leaves the database exactly as it was, so the
      // snapshot we persist can never contain a half-applied change.
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
        try { rawRun('ROLLBACK'); } catch (rollbackErr) { /* transaction already gone */ }
        throw err;
      }

      // Step 2 + 3 — serialise the whole database and push it into storage.
      // db.export() returns a Uint8Array; storage.save() copies it before handing it to
      // IndexedDB, because the WASM heap this view points at is reused on the next export.
      return App.storage.save(db.export()).then(function () {
        return { changes: changes };
      });
    };

    // Chain onto the queue, and keep the chain alive even if one write rejects.
    var result = (writeQueue || Promise.resolve()).then(task, task);
    writeQueue = result.catch(function () { /* swallow so the chain continues */ });
    return result;
  }

  /**
   * Follow a rename: sources naming the old title (exact raw spelling) are
   * rewritten to the new one. Without this, title-keyed links would orphan on
   * every rename; the exact-spelling scope is what keeps it from rewriting text
   * the reader never meant as a link. One chained transaction after the rename
   * itself — renames are rare, snapshots are not free, and recursion is avoided
   * by writing directly instead of going back through updateNote.
   */
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
      // Locked or damaged bodies cannot be rewritten; their rows keep naming the
      // old title, which then reads as an unresolved link rather than a lie.
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

  /**
   * Queue one note's link rewrite into an open write(). Module-level (not on the
   * API) so the note mutations above share it without exposing it.
   */
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

  // ---------------------------------------------------------------- vault state
  /**
   * The unlocked view.  *** This is the other part worth reading carefully. ***
   *
   * WebCrypto is asynchronous, and this layer is not. getNote() and getFileBlob() are
   * synchronous calls made from inside a plain render function; making them return promises
   * would push the encryption invariant out into every caller, which is the one thing this
   * design refuses to do — a caller that forgot would either show a blank note or hand
   * ciphertext to the editor and save it back as if it were prose.
   *
   * So decryption happens ONCE, eagerly, at the one moment it can be done in bulk: when the
   * notebook is unlocked. The results live here, in memory, for the session. Every read after
   * that is a synchronous lookup, and not one call site had to change shape.
   *
   * WHAT THAT COSTS, HONESTLY: while the vault is unlocked, every note body and every stored
   * attachment is held decrypted in JS memory — the ciphertext is already in WASM memory
   * beside it, so a notebook full of attachments roughly doubles. That is the price of
   * keeping the data layer synchronous, and it buys the guarantee that no read path can
   * forget the decryption step. Locking, and reloading, both empty these maps.
   */
  var noteText = {};   // noteId -> plaintext body
  var fileBytes = {};  // fileId -> plaintext attachment bytes

  // False until those maps hold EVERY encrypted row. While it is false a read reports the row
  // as locked rather than as empty: a blank note that looks like the user's own is the one
  // outcome that must never be produced by a failure to decrypt.
  var viewReady = false;

  // The vault table's single row. The schema's CHECK (id = 1) is what makes this constant a
  // fact rather than a convention.
  var VAULT_ID = 1;

  /**
   * How many note bodies search will scan in memory when the vault is on. SQL cannot do the
   * matching: the column holds base64 ciphertext, so LIKE would be matching the ciphertext.
   * The cap bounds the work one keystroke of search can cause, and search() reports when it
   * bites so the interface can say that older notes were matched on their titles only.
   */
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

  /** Whatever a BLOB column holds, as bytes. */
  function blobBytes(value) {
    if (!value) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value);
  }

  /**
   * Run an async step over items one at a time.
   *
   * One at a time rather than Promise.all because these loops walk every row in the database:
   * hundreds of parallel WebCrypto calls would hold every payload in flight at once, and the
   * whole point of the progress callback is that the work is observable as it advances.
   */
  function eachSeries(items, step) {
    var index = 0;
    function next() {
      if (index >= items.length) return Promise.resolve();
      var item = items[index++];
      // Promise.resolve().then() rather than calling next() directly: a step that completes
      // synchronously would otherwise recurse once per row and blow the stack on a notebook
      // that runs to a few thousand notes.
      return Promise.resolve(step(item)).then(next);
    }
    return next();
  }

  /** The row counts a conversion walks, for one progress denominator. */
  function vaultTotals() {
    var notes = queryOne('SELECT COUNT(*) AS n FROM notes');
    var files = queryOne('SELECT COUNT(*) AS n FROM files');
    return (notes ? notes.n : 0) + (files ? files.n : 0);
  }

  /**
   * Read every stored payload and seal it, without writing anything.
   *
   * Deleted rows are included, and that is not tidiness: a trashed note has been stamped,
   * not erased, so its body is still sitting in the database in plaintext. Leaving the trash
   * out would mean "encrypt my notebook" kept a readable copy of everything the user had
   * thrown away.
   *
   * @returns {Promise<{notes:Array, files:Array, noteText:Object, fileBytes:Object,
   *                    alreadyEncrypted:Array}>}
   */
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
      // A row that already carries an envelope must not be sealed again: the ciphertext would
      // be encrypted a second time and the plaintext inside it would be unreachable. On this
      // path there is no vault to open it with, so the conversion refuses as a whole and names
      // the rows rather than half-doing the job.
      if (App.crypto.isEnvelope(row.content)) {
        plan.alreadyEncrypted.push({ kind: 'note', id: row.id });
        return;
      }
      var plain = row.content === null || row.content === undefined ? '' : String(row.content);
      return App.crypto.encrypt(plain).then(function (stored) {
        plan.notes.push({ id: row.id, stored: stored });
        // The plaintext we just sealed IS the unlocked view: keeping it means enabling
        // encryption costs one pass, not one to seal and another to read back.
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

  /**
   * Read every stored payload and open it, without writing anything — the mirror of
   * planEncryption(), used when encryption is being turned off.
   *
   * Rows that fail to decrypt are collected rather than skipped: the caller must refuse the
   * whole operation, because deleting the key afterwards would turn "could not decrypt" into
   * "gone for good".
   */
  function planDecryption(onProgress) {
    var plan = { notes: [], files: [], failures: [] };
    var noteRows = query('SELECT id, content FROM notes');
    var fileRows = query('SELECT id, blob_data FROM files');
    var total = noteRows.length + fileRows.length;
    var seen = 0;
    function tick() { seen++; if (onProgress) onProgress(seen, total); }

    return eachSeries(noteRows, function (row) {
      tick();
      if (!App.crypto.isEnvelope(row.content)) return; // already plaintext
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

  /**
   * Build the unlocked view: open every stored payload once, and report the rows that could
   * not be read.
   *
   * A row that fails here is not fatal — the key is known good, because the check string
   * proved it — so the failures are counted and reported, and the affected rows are marked
   * damaged when they are read. Losing the whole notebook to one bad record would be worse.
   *
   * The two maps are built HERE and returned, never assigned to the module's own as the pass
   * goes: an unlocked view that is half built is a state no reader may ever see, because a row
   * the pass has not reached yet cannot be told apart from a row that could not be read at all.
   * unlockVault() installs what this returns in one assignment, after the pass has ended.
   */
  function decryptEverything(onProgress) {
    // Local until the caller installs them. The module's own maps keep describing the previous
    // (locked) state for the whole duration of the pass, which is exactly what viewReady false
    // promises every reader.
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
      // Plaintext is already the answer for a row written before the vault existed. Handing
      // it back through decrypt() would work, but storing it here makes the two cases one.
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

  /**
   * Rewrite the database compactly, so the bytes it replaced are no longer in the file.
   *
   * SQLite does not erase the old image of a row it rewrites. The updated cell is written and
   * the previous bytes are left in the page's free space, or in a page that has just been
   * unlinked — and both of those are still inside the image db.export() serialises, which is
   * what goes to IndexedDB and what the Export .db button hands out. For the rest of this app
   * that is merely untidy. For this feature it is the whole ballgame: sealing a note body
   * replaces plaintext with ciphertext, and without this the plaintext it replaced would still
   * be readable in the exported database. VACUUM rebuilds the file from the live rows, so
   * nothing that was overwritten is carried over.
   *
   * It CANNOT go through write(): SQLite refuses to VACUUM inside a transaction, and write() is
   * a transaction by definition. So this runs raw and then persists — the one other place in
   * this file that hands bytes to storage. It is safe because it only ever runs after a
   * conversion has already committed: the database is correct before this starts, and a failure
   * here costs file size and leftover bytes, not data.
   *
   * What it does NOT clean: the browser's own storage layer. The PREVIOUS snapshot handed to
   * IndexedDB held the plaintext, and whether the backend has since compacted it away is the
   * browser's business, not something this app can promise.
   */
  function compact() {
    rawRun('VACUUM');
    return App.storage.save(db.export());
  }

  /**
   * Compact, and never let the outcome un-say the conversion that already committed.
   *
   * VACUUM can fail two ways: storage.save() rejects, and sql.js raises straight out of rawRun()
   * so compact() itself THROWS. Past the commit both have to arrive in the same place, because
   * the notebook is encrypted either way; the failure is reported as a warning and carried on
   * the report rather than allowed to reject an enrollment that is already a fact.
   *
   * The warning says only what is true. The file still holds the bytes the previous plaintext
   * image occupied, so an earlier unencrypted copy may be recoverable from it — and there is NO
   * import path in this app, only export, so the retry named here is the one the interface
   * actually offers: turning encryption off and on again runs this same VACUUM. Advice a user
   * cannot act on is worse than no advice at all.
   */
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

  /**
   * Tell the crypto module whether this database has a vault, and hand back the row.
   * Called once after migrations, and again after every change to the vault table.
   */
  function syncVault() {
    var row = vaultRow();
    App.crypto.setVaultExists(!!row);
    return row;
  }

  /**
   * Read every sealed payload once and install the result as the unlocked view.
   *
   * Shared by the two ways in: a password proved against the vault's check string, and the
   * key this tab unlocked the notebook with earlier. The pass runs INSIDE the write queue for
   * the reason unlockVault() states: a debounced autosave landing mid-decrypt would seal a row
   * this pass had already read past, and that row would come back afterwards as a "damaged"
   * note, indistinguishable from real corruption.
   */
  function buildUnlockedView(onProgress) {
    var pass = (writeQueue || Promise.resolve()).then(function () {
      return decryptEverything(onProgress);
    });
    // Left pointing at the pass so later writes chain behind it, and resolved either way:
    // write() tolerates a rejecting queue, but a failed pass must not turn every write after it
    // into a rejection of its own.
    writeQueue = pass.then(function () { return null; }, function () { return null; });
    return pass.then(function (view) {
      // Installed in ONE assignment, only now that every encrypted row has been read: the maps
      // and viewReady flip together, so no reader can observe a view holding some of the
      // plaintext and not the rest.
      noteText = view.noteText;
      fileBytes = view.fileBytes;
      viewReady = true;
      return view;
    });
  }

  /**
   * Keep this unlock for the tab that made it.
   *
   * The record holds the CryptoKey object itself — the one value in the app that can be used
   * but never read out (see crypto.js) — tagged with this tab's own session id. When the
   * browser can hold neither the object (no IndexedDB) nor the tag (no sessionStorage),
   * nothing is remembered and the notebook simply asks again after a reload.
   */
  function rememberSession() {
    var live = App.crypto.currentKey();
    if (!live || !App.session.available()) return Promise.resolve(false);
    return App.storage.saveVaultKey({ id: App.session.id(), key: live });
  }

  /** Drop the remembered unlock. Called by every path that locks or un-keys the notebook. */
  function forgetSession() {
    App.session.clear();
    return App.storage.clearVaultKey();
  }

  // ------------------------------------------------------------------ bootstrap
  function applyMigrations() {
    // Foreign keys are off by default in SQLite and must be enabled per connection,
    // otherwise ON DELETE CASCADE silently does nothing and deletes leave orphans.
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
        try { rawRun('ROLLBACK'); } catch (e) { /* ignore */ }
        throw new Error('schema migration ' + (version + 1) + ' failed: ' + err.message);
      }
    }
  }

  /** A brand-new database gets one workspace and one note so the app is never a void. */
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

  // ------------------------------------------------------------------- public API
  var API = {
    /**
     * Boot the engine: load sql.js, restore the snapshot from IndexedDB (or create a
     * fresh database), run migrations, and seed on first run.
     *
     * @returns {Promise<{fresh:boolean, backend:string, lastWorkspaceId:string|null}>}
     */
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
          // locateFile returns a data: URI with the WASM embedded. The engine recognises
          // the "data:application/octet-stream;base64," prefix and decodes it directly,
          // so no network request is made and file:// works.
          return initSqlJs({ locateFile: function () { return wasmUri; } }).then(function (SQL) {
            var fresh = false;
            if (loaded.bytes && loaded.bytes.length) {
              try {
                db = new SQL.Database(loaded.bytes);
              } catch (err) {
                // A snapshot we cannot parse is worse than starting over, but the user
                // must be told, and the old blob is left untouched in storage until the
                // next successful write replaces it.
                App.util.toast('Saved database could not be opened (' + err.message + '). Starting a new one.', 'error', 10000);
                db = new SQL.Database();
                fresh = true;
              }
            } else {
              db = new SQL.Database();
              fresh = true;
            }

            applyMigrations();

            // Orphan repair, before any read or seed: a folder whose parent is
            // missing, deleted, or in another workspace (possible after older
            // cross-workspace moves) is counted but can never render — re-root
            // it so it reappears instead of vanishing silently. One snapshot,
            // and only when orphans actually exist.
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

            // The vault flag is read once, here, before anything reads a note: every read path
            // below branches on it, and it must not be discovered halfway through a boot.
            var vault = syncVault();

            // Seed only when the workspaces table is genuinely empty, so an install that
            // has never stored a snapshot still gets a usable starting point.
            //
            // Never into an encrypted notebook. The seed writes its welcome text straight to
            // SQL — it has to, it runs before any key exists — so seeding here would put a
            // plaintext body inside a notebook whose bodies are all ciphertext, and would do
            // it in the one state where it cannot be encrypted instead: a locked boot.
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

    /** Escape hatch for diagnostics/testing. */
    isReady: function () { return !!db; },

    // ------------------------------------------------------------------- ordering
    /**
     * The sort vocabulary, exposed so the interface can build its menu from the same list
     * the SQL is whitelisted against. A menu offering a key this array does not hold would
     * be offering something the database would then ignore.
     */
    sortKeys: SORT_KEYS.slice(),
    sortDirections: SORT_DIRECTIONS.slice(),

    /**
     * The keys the sort menu offers, in the order it offers them.
     *
     * The whole vocabulary, not the subset of it that one table happens to hold. There is
     * a single control for the tree, the pane and the rail, and its options must not move
     * under the pointer: a Size that vanished while a folder of notes was in front and
     * reappeared two clicks later is the same choice wearing two faces. A key a list has
     * no column for falls back in orderBy() instead of disappearing.
     */
    sortKeysFor: function () {
      return SORT_KEYS.map(function (key) { return { key: key, label: SORT_LABELS[key] }; });
    },

    reorderWithin: reorderWithin,

    /**
     * Where a row sits now, and how many siblings share its scope. The two facts a move
     * command needs in order to disable itself at the ends of a list rather than appear to
     * do nothing.
     */
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

    // ------------------------------------------------------------------ workspaces
    /**
     * Every workspace, in the sort the rail is using.
     *
     * position is selected even though the rail never draws it: a reorder has to know
     * where a workspace sits now, and reading it back from the list the interface just
     * drew is cheaper than asking the database again for one integer.
     */
    listWorkspaces: function (sort) {
      return query('SELECT id, name, created_at, position FROM workspaces '
        + (orderOf('workspaces', sort) || 'ORDER BY created_at'));
    },

    createWorkspace: function (name) {
      var id = util.uuid();
      var stamp = util.nowIso();
      // The new row goes to the end of the rail: max + 1 inside a scope that is the whole
      // table, because a workspace has no parent. Leaving it at the column default of 0
      // would put every new workspace at the TOP of a manual order, above everything the
      // user had already arranged, which is the opposite of appending.
      return write(
        'INSERT INTO workspaces (id, name, created_at, position) ' +
          'VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces))',
        [id, (name || 'Untitled workspace').trim() || 'Untitled workspace', stamp])
        .then(function () {
          // Read back rather than predicted: the subquery above is what knows where the
          // end of the rail currently is.
          var row = queryOne('SELECT position FROM workspaces WHERE id = ?', [id]);
          return { id: id, name: name, created_at: stamp, position: row ? row.position : 0 };
        });
    },

    renameWorkspace: function (id, name) {
      return write('UPDATE workspaces SET name = ? WHERE id = ?', [String(name).trim() || 'Untitled workspace', id]);
    },

    /** Deletes the workspace plus every folder, note and file inside it (cascade). */
    deleteWorkspace: function (id) {
      return write('DELETE FROM workspaces WHERE id = ?', [id]);
    },

    // --------------------------------------------------------------------- folders
    /** Every live folder in a workspace.
     *
     * The whole workspace rather than one level, because the tree groups folders by parent
     * in ui.js while the sort is a single ORDER BY: grouping an already-sorted list keeps
     * the sort inside each group, which is exactly the scope manual order is defined in.
     */
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
      // Appended inside its own parent scope. The empty-string sentinel is what lets one
      // subquery cover both a nested folder and a root folder, where the parent is NULL and
      // NULL = NULL matches nothing at all.
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

    /** All folder ids in the subtree rooted at `rootId`, including the root. */
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

    /** Move a folder (and all notes/files/subfolders inside it) to another workspace. */
    moveFolder: function (folderId, targetWorkspaceId) {
      var ids = API.descendantFolderIds(folderId);
      return write(function (run) {
        var placeholders = ids.map(function () { return '?'; }).join(',');
        // Update folder workspace IDs: bind targetWorkspaceId as first param, then ids for IN clause.
        // Note: SQL params are ordered. First param = targetWorkspaceId for SET, rest = ids for IN.
        var params = [targetWorkspaceId].concat(ids);
        run('UPDATE folders SET workspace_id = ? WHERE id IN (' + placeholders + ')', params);
        params = [targetWorkspaceId].concat(ids);
        run('UPDATE notes SET workspace_id = ? WHERE folder_id IN (' + placeholders + ')', params);
        params = [targetWorkspaceId].concat(ids);
        run('UPDATE files SET workspace_id = ? WHERE folder_id IN (' + placeholders + ')', params);
        // The moved root becomes a root in the new workspace: its old parent
        // stayed behind, and keeping the pointer would orphan the whole subtree
        // (counted in the workspace, unrenderable in the tree). Descendants keep
        // their parents — those moved along with them.
        run('UPDATE folders SET parent_folder_id = NULL WHERE id = ?', [folderId]);
      });
    },

    /**
     * Delete a folder AND everything nested under it. SQLite would handle the direct
     * children via cascade, but notes/files in deeper folders are only reachable through
     * the intermediate folders, so the whole subtree is resolved first and removed in one
     * transaction.
     */
    deleteFolder: function (id) {
      var ids = API.descendantFolderIds(id);
      var stamp = util.nowIso();
      return write(function (run) {
        var placeholders = ids.map(function () { return '?'; }).join(',');
        // Soft delete: set deleted_at for folder subtree.
        run('UPDATE folders SET deleted_at = ? WHERE id IN (' + placeholders + ')', [stamp].concat(ids));
        run('UPDATE notes SET deleted_at = ? WHERE folder_id IN (' + placeholders + ')', [stamp].concat(ids));
        run('UPDATE files SET deleted_at = ? WHERE folder_id IN (' + placeholders + ')', [stamp].concat(ids));
      });
    },

    /** How many notes/files a folder subtree holds, for the delete confirmation. */
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

    // ----------------------------------------------------------------------- notes
    /** Notes directly inside a folder (or at the workspace root when folderId is null). */
    /** Notes directly inside a folder (or at the workspace root when folderId is null).
     *
     * The two branches keep their own WHERE clause — the root is folder_id IS NULL, never
     * = NULL — and share one ORDER BY, because the sort applies to a scope and these two
     * scopes are the folder and the root under the same rule.
     */
    listNotesIn: function (workspaceId, folderId, sort) {
      var order = orderOf('notes', sort) || 'ORDER BY updated_at DESC';
      var rows = folderId
        ? query('SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, position FROM notes WHERE folder_id = ? AND deleted_at IS NULL ' + order, [folderId])
        : query('SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, position FROM notes WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ' + order, [workspaceId]);
      return rows.map(mapNote);
    },

    /** Every note in a workspace (used for the "All notes" view and search fallback). */
    /**
     * Title prefilter for the Deja-vu check: workspace-scoped LIKEs over the caller's
     * words. Parameterized only — the words arrive as bound parameters, never as SQL —
     * and capped at three, which is all the check asks for (the first three significant
     * words of the committed title). Returns light [{id, title}] rows; the trigram
     * similarity itself runs in JS over what this returns.
     */
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

    /** Every note in a workspace, for the tree and the All notes listing. */
    listAllNotes: function (workspaceId, sort) {
      return query(
        'SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, position FROM notes ' +
          'WHERE workspace_id = ? AND deleted_at IS NULL ' +
          (orderOf('notes', sort) || 'ORDER BY updated_at DESC'),
        [workspaceId]
      ).map(mapNote);
    },

    /**
     * Full row including content — only for opening the editor.
     *
     * The encryption invariant lives here rather than in the editor. Callers keep getting a
     * synchronous row with a plaintext `content`, exactly as they always have; what changed is
     * only what happens when the plaintext is not available:
     *
     *   - vault off, or a row written before it existed -> the stored value IS the content;
     *   - vault on and unlocked -> content comes from the unlocked view, byte-identical to
     *     what was saved;
     *   - vault on and locked -> content is null and `locked` is true. Deliberately not an
     *     exception: the tree, the title, the timestamps and every list still render, and the
     *     editor can say why the body is not there. An empty string here would be a lie that
     *     looks like the user's own blank note.
     */
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
      // Encrypted, unlocked, and still not readable: the row was damaged, or it appeared in
      // the database after the view was built. Reported as damaged, never as empty.
      note.content = null;
      note.damaged = true;
      return note;
    },

    createNote: function (workspaceId, folderId, title) {
      var id = util.uuid();
      var stamp = util.nowIso();
      // The empty body is sealed like any other. With the vault on, that is what keeps the
      // table uniform — every body is an envelope, so nothing downstream has to ask "is this
      // one encrypted?" — and with the vault locked it is what makes this reject with the
      // unlock message instead of writing an empty body in the clear.
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

    /**
     * Flip the manual Private flag. One write() (one snapshot), parameterized —
     * the flag is 0/1, never interpolated. Bulk export skips private notes;
     * per-note copy/download stay allowed.
     */
    setNotePrivate: function (id, flag) {
      var value = flag ? 1 : 0;
      return write('UPDATE notes SET is_private = ?, updated_at = ? WHERE id = ?',
        [value, util.nowIso(), id]);
    },

    /**
     * Save title/content. Called by the debounced autosave on every keystroke burst.
     * Returns the new updated_at so the UI can show it without a re-read.
     */
    updateNote: function (id, title, content) {
      var stamp = util.nowIso();
      // A null body means "the caller does not have the text in hand", which is exactly the
      // case while the notebook is locked: renameNote() passes on the null content getNote()
      // gave it. COALESCE then leaves the stored ciphertext alone instead of writing NULL —
      // or, worse, an empty string — over it. Every other caller passes a real string, and a
      // real string is always written.
      var sealed = content === null || content === undefined
        ? Promise.resolve(null)
        : App.crypto.encrypt(content);
      var prevTitle = '';
      try {
        var prev = queryOne('SELECT title FROM notes WHERE id = ?', [id]);
        prevTitle = prev ? prev.title || '' : '';
      } catch (e) { /* treat as unchanged */ }
      return sealed.then(function (stored) {
        return write(function (run) {
          run('UPDATE notes SET title = ?, content = COALESCE(?, content), updated_at = ? WHERE id = ?',
            [title, stored, stamp, id]);
          // Links ride the same transaction: one snapshot for text and graph.
          refreshLinksInto(run, id, content);
        });
      }).then(function () {
        // Keep the unlocked view in step with the write, so the next read is the text we
        // already have in hand rather than a decryption round trip for it.
        if (viewReady && typeof content === 'string') noteText[id] = content;
        // A changed title pulls its incoming links along with it.
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
          // Links are workspace-scoped, so they follow the note. A second write only
          // when rows exist — moves are rare, snapshots are not free.
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

    /**
     * Bulk writers: one write per op, not one per row. Every write() serialises
     * the whole database and persists a snapshot, so a per-id loop over 40 notes
     * would cost 40 snapshots; these cost one, atomically.
     */
    bulkMoveNotes: function (ids, workspaceId, folderId) {
      var list = (ids || []).filter(function (id) { return id !== null && id !== undefined; });
      if (!list.length) return Promise.resolve(0);
      var placeholders = list.map(function () { return '?'; }).join(',');
      var stamp = util.nowIso();
      return write(function (run) {
        run('UPDATE notes SET folder_id = ?, workspace_id = ?, updated_at = ? WHERE id IN (' + placeholders + ')',
          [folderId || null, workspaceId, stamp].concat(list));
        // Links are workspace-scoped like in moveNote; setting the same value
        // back when the workspace did not change is a harmless no-op.
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

    // --------------------------------------------------------------- wiki links
    /**
     * Backfill the links table after the v6 migration: one transaction, one
     * snapshot — and no write at all when there is nothing to store, so a
     * zero-link notebook never pays a snapshot per boot. Locked bodies are skipped
     * rather than guessed: their rows stay as they were, which is still correct
     * because a body cannot change while it is locked.
     */
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

    /**
     * Resolve a normalised title to the note it names, newest first: a duplicate
     * title resolves to the most recently touched note, which is the one the
     * reader most likely means.
     */
    resolveLinkTarget: function (workspaceId, norm) {
      var rows = query('SELECT id, title, updated_at FROM notes' +
        ' WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC',
        [workspaceId]);
      for (var i = 0; i < rows.length; i++) {
        if (util.normTitle(rows[i].title) === norm) return { id: rows[i].id, title: rows[i].title };
      }
      return null;
    },

    /** Outgoing links of one note: [{ raw, norm, noteId|null }]. Null means no note
     *  carries that title yet — the interface offers to create it. Resolved against
     *  a single title scan rather than one query per link. */
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

    /** Notes linking TO this one: [{ id, title }], newest first, self-links excluded. */
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

    // ----------------------------------------------------------------------- files
    /** Attachments directly inside a folder (or at the workspace root). */
    listFilesIn: function (workspaceId, folderId, sort) {
      var order = orderOf('files', sort) || 'ORDER BY created_at DESC';
      var rows = folderId
        ? query('SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at, position FROM files WHERE folder_id = ? AND deleted_at IS NULL ' + order, [folderId])
        : query('SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at, position FROM files WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ' + order, [workspaceId]);
      return rows.map(mapFileMeta);
    },

    /**
     * Insert an attachment. `bytes` is a Uint8Array straight from FileReader/File.arrayBuffer
     * and is written as a BLOB, so the exported .db holds the real file.
     */
    addFile: function (workspaceId, folderId, filename, mimeType, bytes) {
      var id = util.uuid();
      var stamp = util.nowIso();
      // size is the PLAINTEXT length, and it stays that way even when what is stored is a
      // base64 envelope: the size column is what the interface prints and what the folder
      // byte totals add up, so it has to describe the file rather than its encoding. With the
      // vault off the value written is the caller's own Uint8Array, byte for byte.
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

    /** Metadata only — deliberately excludes blob_data. */
    getFileMeta: function (id) {
      var row = queryOne('SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at FROM files WHERE id = ? AND deleted_at IS NULL', [id]);
      return row ? mapFileMeta(row) : null;
    },

    /**
     * The actual bytes, fetched only when the user previews or downloads the file.
     *
     * Locked returns null rather than an exception — the preview pane has a lock notice to
     * draw, and that is a state, not a failure. A stored envelope with no readable plaintext
     * behind it DOES throw, because handing back a zero-length Blob would save an empty file
     * over the user's attachment and call it done.
     */
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
        // Wrap the bytes in a real Blob so the object URL carries the right MIME type and a
        // `download` attribute can name the file.
        blob: new Blob([bytes], { type: type }),
      };
    },

    renameFile: function (id, filename) {
      return write('UPDATE files SET filename = ? WHERE id = ?', [String(filename).trim() || 'file', id]);
    },

    deleteFile: function (id) {
      return write('UPDATE files SET deleted_at = ? WHERE id = ?', [util.nowIso(), id]);
    },

    // ----------------------------------------------------------------------- tasks
    // Exposed to the renderer, which groups rows by the same boundaries the queries above
    // filter them with. The work is done by the module-level function, deliberately not by
    // a second copy — two copies of "where today ends" is two chances to disagree.
    taskDayBounds: function (now) { return taskDayBounds(now); },

    /**
     * The rows for one view of the task list.
     *
     * @param {string} workspaceId
     * @param {object} [opts] { view: 'all'|'today'|'upcoming'|'done', folderId }
     *
     * The order is chosen per view rather than offered, because each view is a question
     * ("what is late", "what is coming", "what did I finish") and each has exactly one
     * order that answers it. Open work runs by date with the undated rows last — a task
     * with no date is not due at the beginning of time — and ties fall to priority and
     * then to the manual position, so a reorder survives its own re-read. Done work is
     * newest first, because the reason to open that view is nearly always the thing just
     * finished.
     */
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

    /**
     * Every number the tasks pane shows, in one call.
     *
     * The badges and the header are counted through the same clause builder the list is
     * read with, which is the only way a badge can be trusted to describe the list under
     * it. This codebase has already shipped a count that belonged to a different list than
     * the one it headed, and the shape of that bug is that the two numbers were computed in
     * two places.
     *
     * `all` is the open count the header prints; there is no separate field for it, because
     * two names for one number is the first half of that bug.
     */
    countTasks: function (workspaceId, opts) {
      var o = opts || {};
      var bounds = taskDayBounds();
      var scope = o.folderId ? ' AND folder_id = ?' : '';
      var scopeParams = o.folderId ? [o.folderId] : [];

      // Looped over the view list rather than written out four times: the badges sit in a
      // row and are read as one object, and a view added to TASK_VIEWS without a count
      // would then be a filter with a blank where its number should be.
      var counts = {};
      TASK_VIEWS.forEach(function (view) {
        var clause = taskViewClause(view, bounds);
        var row = queryOne(
          'SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?' + clause.sql + scope,
          [workspaceId].concat(clause.params).concat(scopeParams)
        );
        counts[view] = row ? row.n : 0;
      });

      // Overdue is not a view: it is the part of Today that has already run out of time,
      // and the header names it separately because "three open" and "three open, two of
      // them late" are different mornings.
      var overdue = queryOne(
        'SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND done = 0' +
          ' AND due_at IS NOT NULL AND due_at < ?' + scope,
        [workspaceId, bounds.todayStart].concat(scopeParams)
      );
      counts.overdue = overdue ? overdue.n : 0;
      return counts;
    },

    /**
     * Open work in the active workspace — the rail row's count, and nothing else's.
     *
     * Deliberately unscoped by folder and by view: the rail names the workspace, so its
     * number has to be a fact about the workspace. A count that followed the selection
     * would change when a folder was clicked and read as tasks appearing and vanishing.
     */
    countOpenTasks: function (workspaceId) {
      var row = queryOne('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND done = 0', [workspaceId]);
      return row ? row.n : 0;
    },

    /**
     * One task, with its notes — what the edit dialog and the context menu are built from.
     *
     * SELECT * is safe here in a way it is not for notes: nothing on this table is a blob,
     * so the widest row is a title, a line of notes and a handful of integers.
     */
    getTask: function (id) {
      var row = queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
      return row ? mapTask(row) : null;
    },

    /**
     * Insert a task and hand back the stored row.
     *
     * @param {string} workspaceId
     * @param {string|null} folderId the project, or null for the workspace root
     * @param {string} title
     * @param {object} [fields] { notes, due_at, due_has_time, priority }
     *
     * The new row is appended to the end of its own scope, exactly as a note or a folder
     * is: position means "where the reader put it", and a new row that claimed position 0
     * would land at the top of an arrangement it never took part in. Reading the row back
     * rather than predicting it is what makes that true for the root as well, where the
     * scope column is NULL and the subquery has to compare with COALESCE.
     */
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

    /**
     * Change the parts of a task the edit dialog owns, and nothing else.
     *
     * Only the keys present in `fields` are written, so the caller never has to read the
     * row first and hand back values it did not touch — a dialog that sends four fields
     * cannot thereby rewrite the fifth. Which keys exist at all is decided by
     * TASK_EDITABLE, which is also what keeps a caller's string out of the SET clause.
     *
     * @returns {Promise<boolean>} false when the row is gone (deleted in another tab).
     */
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
      // A reminder moved to a new time is a reminder not yet given. Without this the row
      // would keep the stamp from the old time and stay silent at the new one.
      if (Object.prototype.hasOwnProperty.call(next, 'remind_at')
        && TASK_EDITABLE.remind_at(next.remind_at) !== (row.remind_at || null)) {
        sets.push('reminded_at = NULL');
      }
      if (!sets.length) return Promise.resolve(false);
      sets.push('updated_at = ?');
      params.push(stamp);

      // A task that changes project moves to the end of the list it moves into. Positions
      // count from the top of one scope, so the number it carried belonged to the folder it
      // just left: left alone, a task filed under a new project would claim a place above
      // rows that folder's owner had already arranged.
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

    /**
     * Tick a task off, or put it back on the list.
     *
     * done and done_at are written together because they are one fact in two halves: a
     * finished task with no completion stamp would be missing from the order the Done view
     * is built on, and undoing one that kept its stamp would report a completion that has
     * been taken back.
     */
    setTaskDone: function (id, done) {
      var stamp = util.nowIso();
      if (!done) {
        return write('UPDATE tasks SET done = 0, done_at = NULL, updated_at = ? WHERE id = ?', [stamp, id])
          .then(function () { return { repeated: null }; });
      }
      // A repeating task is not finished by ticking it: the tick moves it to its next
      // occurrence and hands it back to the list. The rule is applied here rather than in
      // the interface, so the checkbox, the context menu and any future caller all roll
      // the same way.
      var row = queryOne('SELECT due_at, due_has_time, recurrence, remind_at FROM tasks WHERE id = ?', [id]);
      var rule = row ? parseRecurrence(row.recurrence) : null;
      var next = row && rule && row.due_at ? nextOccurrence(row.due_at, row.due_has_time, rule) : null;
      if (!next) {
        return write('UPDATE tasks SET done = 1, done_at = ?, updated_at = ? WHERE id = ?', [stamp, stamp, id])
          .then(function () { return { repeated: null }; });
      }
      // The reminder travels with the due date, keeping the distance the reader chose, and
      // reminded_at is cleared so the new occurrence is announced in its turn.
      var remind = advanceReminder(row.remind_at, row.due_at, next);
      return write(
        'UPDATE tasks SET done = 0, done_at = NULL, due_at = ?, remind_at = ?, reminded_at = NULL, ' +
          'updated_at = ? WHERE id = ?',
        [next, remind, stamp, id]
      ).then(function () { return { repeated: next }; });
    },

    /**
     * The reminders that are due, oldest first, for the notifier started at boot.
     *
     * done = 0 because a finished task has nothing to announce, and reminded_at IS NULL
     * because that stamp is what stops a thirty-second timer announcing itself twice.
     */
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
        // A notebook from before v11 has no remind_at column: no reminders, no boot failure.
        return [];
      }
    },

    /** Record that a reminder has been announced, so one tick cannot announce it twice. */
    markReminderFired: function (id, when) {
      return write('UPDATE tasks SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL',
        [when || util.nowIso(), id]);
    },

    /**
     * Remove a task outright.
     *
     * A task is not soft-deleted into the trash. The trash exists to hold things that are
     * expensive to lose — a note's body, an attachment's bytes — and it pays for that with a
     * panel, a restore path and a permanent-delete path, all of which a single line of text
     * does not earn. Its delete is confirmed in the pane instead.
     */
    deleteTask: function (id) {
      return write('DELETE FROM tasks WHERE id = ?', [id]);
    },
    // ---------------------------------------------------------------------- search
    /**
     * Search note titles/bodies and file names. Pass a workspace id to search inside that one
     * workspace, or null to search the whole notebook. Results are capped so a pathological
     * query cannot try to render the entire database.
     */
    search: function (workspaceId, term, limit) {
      var trimmed = String(term || '').trim();
      if (!trimmed) return { notes: [], files: [] };
      var pattern = likeParam(trimmed);
      var cap = limit || 100;
      // The one thing a scoped search and a notebook-wide one disagree about, written once:
      // every query below is otherwise identical text, so the two scopes cannot drift into
      // different answers to the same question.
      var scoped = workspaceId !== null && workspaceId !== undefined;
      var scope = scoped ? ' AND workspace_id = ?' : '';
      var scopeArgs = scoped ? [workspaceId] : [];

      var files = query(
        'SELECT id, folder_id, workspace_id, filename, mime_type, size, created_at, ' +
        '(SELECT name FROM workspaces WHERE id = files.workspace_id) AS workspace_name FROM files ' +
        "WHERE deleted_at IS NULL" + scope + " AND filename LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?",
        scopeArgs.concat([pattern, cap])
      ).map(mapFileMeta);

      // With no vault, titles and bodies are both plaintext, so one SQL statement matches
      // either of them and run-flow asserts the result byte for byte.
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

      // Vault on. Titles and file names are not encrypted, so SQL still answers that half in
      // either state — which is what keeps the notebook searchable while it is locked.
      var notes = query(
        'SELECT id, folder_id, workspace_id, title, is_private, created_at, updated_at, ' +
        '(SELECT name FROM workspaces WHERE id = notes.workspace_id) AS workspace_name FROM notes ' +
        "WHERE deleted_at IS NULL" + scope + " AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?",
        scopeArgs.concat([pattern, cap])
      ).map(mapNote);

      var result = { notes: notes, files: files, locked: !viewReady, contentScanned: 0, contentTruncated: false };
      // Locked: only titles and file names can match, and the caller is TOLD so rather than
      // being handed a shorter list that looks like the whole answer.
      if (!viewReady) return result;

      // Unlocked: match the bodies in memory. The column holds ciphertext, so this is not a
      // second opinion about the SQL above — it is the only way to ask the question at all.
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
        if (!hasOwn(noteText, row.id)) return; // damaged row: nothing to match against
        if (noteText[row.id].toLowerCase().indexOf(needle) === -1) return;
        if (matched[row.id]) return;
        matched[row.id] = true;
        if (notes.length < cap) notes.push(mapNote(row));
      });
      return result;
    },

    // ------------------------------------------------------------------ aggregates
    /** Sidebar counts, in two queries rather than one per workspace. */
    counts: function (workspaceId) {
      var notes = queryOne('SELECT COUNT(*) AS n FROM notes WHERE workspace_id = ? AND deleted_at IS NULL', [workspaceId]);
      var files = queryOne('SELECT COUNT(*) AS n FROM files WHERE workspace_id = ? AND deleted_at IS NULL', [workspaceId]);
      var folders = queryOne('SELECT COUNT(*) AS n FROM folders WHERE workspace_id = ? AND deleted_at IS NULL', [workspaceId]);
      return { notes: notes ? notes.n : 0, files: files ? files.n : 0, folders: folders ? folders.n : 0 };
    },

    /**
     * Every folder's chain of ancestors, root first: id -> [{ id, name }, ...].
     *
     * The same walk folderPaths() below has always done, left as segments rather than joined into
     * a string. A path printed as text is a fact; a path whose every step is a place to go is
     * navigation, and a breadcrumb needs the folder ids that "A / B / C" has already thrown away.
     */
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

    /** The same chains joined into the "A / B / C" strings the panes print in prose. */
    folderPaths: function (workspaceId) {
      var chains = API.folderChains(workspaceId);
      var out = {};
      Object.keys(chains).forEach(function (id) {
        out[id] = chains[id].map(function (step) { return step.name; }).join(' / ');
      });
      return out;
    },

    /**
     * The current database as raw bytes — the "Export .db" button. This is the same
     * byte stream that is stored in IndexedDB, so the exported file IS the app's
     * database, directly openable by sqlite3/DBeaver/DB Browser.
     */
    exportBytes: function () {
      return db.export();
    },

    // -------------------------------------------------------------------- vault
    /**
     * The write queue, for a caller about to rewrite every row.
     *
     * The conversion paths below MUST NOT read the database while a write is still queued: the
     * queue is ordered, so a pending autosave has not run yet at the moment they read, and the
     * conversion's own UPDATE would then put the pre-autosave text back. Waiting here is what
     * makes "read every row, then write every row" mean what it says.
     */
    pendingWrites: function () {
      return writeQueue || Promise.resolve();
    },

    /**
     * Which state the notebook is in, as the one word the interface needs.
     *
     * 'off' is "no vault row exists"; 'unlocked' is "the view holds every plaintext"; anything
     * else with a vault row is 'locked'. Deliberately keyed on viewReady rather than on the
     * presence of the key: between deriving a key and finishing the decryption the notebook is
     * neither readable nor honestly callable unlocked.
     */
    vaultState: function () {
      if (!App.crypto.isActive()) return 'off';
      return viewReady ? 'unlocked' : 'locked';
    },

    /** True when bodies and attachments exist but cannot be read right now. */
    locked: function () {
      return App.crypto.isActive() && !viewReady;
    },

    /** Everything the Security section prints, read fresh. */
    vaultInfo: function () {
      var row = vaultRow();
      return {
        state: !row ? 'off' : (viewReady ? 'unlocked' : 'locked'),
        supported: App.crypto.isSupported(),
        iterations: row ? Number(row.iterations) : null,
        created_at: row ? row.created_at : null,
      };
    },

    /**
     * Turn encryption on: seal every note body and stored attachment, and commit the vault row.
     *
     * The whole conversion and the vault row land in ONE transaction (see write()). That is not
     * tidiness — it is the difference between a notebook that is either plaintext or encrypted,
     * and one that is half of each with no key to the half that is sealed. If any statement
     * fails, write() rolls back and this promise rejects with the notebook untouched.
     *
     * @param {string} password
     * @param {function} [onProgress] (done, total) => void, for the progress dialog.
     * @returns {Promise<{notes:number, files:number}>}
     */
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
            // Re-sealing ciphertext would put the plaintext inside it out of reach for good.
            // Nothing has been written at this point, so refusing costs the user nothing.
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
          // The plaintext that was just sealed IS the unlocked view, so enabling encryption
          // costs one pass over the data rather than a seal followed by a decrypt of it.
          noteText = plan.noteText;
          fileBytes = plan.fileBytes;
          viewReady = true;
          var report = { notes: plan.notes.length, files: plan.files.length, compactionFailed: false };
          // The compaction is what makes the protection true of the FILE and not just of the
          // rows: without it the plaintext that was replaced is still in the image that gets
          // stored and exported. It is not part of the transaction, so it can fail without
          // undoing anything — and if it does, the user is told rather than left believing the
          // old text is gone.
          return compactQuietly(report);
        })
        .catch(function (err) {
          // Past the commit the vault is real, and un-saying that would be far worse than the
          // error being reported: it would leave rows sealed by a key this module denies having.
          if (committed) throw err;
          App.crypto.cancelEnrollment();
          noteText = {};
          fileBytes = {};
          viewReady = false;
          throw err;
        });
    },

    /**
     * Verify the password, install the key, and build the unlocked view.
     *
     * A wrong password rejects from App.crypto.unlock() — the GCM tag on the vault's check
     * string cannot be satisfied by any other key — and nothing here ever compares a password
     * or a hash of one.
     *
     * @returns {Promise<{failures:Array}>} the rows that exist but could not be opened.
     */
    unlockVault: function (password, onProgress) {
      var row = vaultRow();
      if (!row) return Promise.reject(new Error('This notebook is not encrypted.'));
      if (!App.crypto.isSupported()) return Promise.reject(new Error(App.crypto.unsupportedMessage()));

      return App.crypto.unlock(row, password)
        .then(function () { return buildUnlockedView(onProgress); })
        .then(function (view) {
          var result = { failures: view.failures };
          // The unlock is remembered for this tab, so a reload inside it does not ask again.
          // Best-effort on purpose: a browser that cannot hold the key still unlocks here, it
          // merely asks next time.
          return rememberSession().then(function () { return result; }, function () { return result; });
        })
        .catch(function (err) {
          // A failed unlock leaves the notebook locked. Keeping a key that was derived from
          // the wrong password, or from a notebook whose data then failed to open, would be
          // the worst of both states: reporting one thing and holding another.
          App.crypto.lock();
          noteText = {};
          fileBytes = {};
          viewReady = false;
          throw err;
        });
    },

    /**
     * Adopt the unlock this tab left behind, and rebuild the view from it.
     *
     * Called once at boot, before the first paint, so a reload lands on the notes rather than
     * on a lock notice. Three answers are all "locked": there is no vault; the record belongs
     * to a tab that is gone (its id no longer matches this tab's); or the key no longer opens
     * the data, because the notebook was re-keyed or encryption was turned off and on again
     * since. A remembered key that has stopped working is dropped rather than kept, so the
     * stale record cannot fail twice.
     *
     * @returns {Promise<{resumed:boolean, failures?:Array}>}
     */
    resumeVault: function (onProgress) {
      if (!vaultRow()) return Promise.resolve({ resumed: false });
      if (!App.crypto.isSupported()) return Promise.resolve({ resumed: false });

      return App.storage.loadVaultKey().then(function (record) {
        if (!record || !record.key) return { resumed: false };
        if (record.id !== App.session.id()) {
          // Another tab's unlock, or one whose tab has closed. Not ours to keep.
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

    /**
     * Drop the key and the plaintext with it. The stored data is untouched.
     *
     * The remembered unlock goes with them: "Lock now" has to mean this tab stops being able
     * to read the notebook without the password, reload or no reload.
     */
    lockVault: function () {
      App.crypto.lock();
      noteText = {};
      fileBytes = {};
      viewReady = false;
      forgetSession();
    },

    /**
     * Turn encryption off: write every payload back as plaintext and delete the vault row, in
     * one transaction.
     *
     * The password is required even when the notebook is already unlocked. The key in memory
     * would be enough to decrypt, but this is the action that puts everything back in the
     * clear, and it should cost the same password that hid it.
     *
     * @returns {Promise<{notes:number, files:number}>}
     */
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
            // Refuse rather than drop ciphertext on the floor: once the vault row is gone, a
            // row that could not be decrypted is a row that can never be read again.
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
          // No vault, so no remembered key: a record kept for a notebook that is no longer
          // encrypted is one more thing that could be adopted by mistake.
          forgetSession();
          var report = { notes: plan.notes.length, files: plan.files.length };
          // Same reasoning in the other direction: the ciphertext that was just replaced is
          // inert without the key, but leaving it in the file makes the export larger and the
          // state harder to reason about. This one is allowed to fail silently — nothing about
          // the result is a secret once the vault row is gone.
          return compact().then(function () { return report; }, function () { return report; });
        })
        .catch(function (err) {
          if (committed) throw err;
          // Put the previous state back exactly: a locked notebook that was unlocked only to
          // make this check must not be left holding a key it did not have before.
          if (!wasReady) {
            App.crypto.lock();
            noteText = {};
            fileBytes = {};
            viewReady = false;
          }
          throw err;
        });
    },

    /**
     * Diagnostics and check tools only: the stored (possibly encrypted) text of a note, and
     * the raw value of a file's blob column, exactly as they sit in SQLite. The app never calls
     * these — a caller that wants a note's text uses getNote(), which decrypts. What this
     * returns is ciphertext, so it cannot leak plaintext; it exists so a check can prove that
     * ciphertext is what is stored rather than taking a flag's word for it.
     */
    storedContent: function (id) {
      var row = queryOne('SELECT content FROM notes WHERE id = ?', [id]);
      return row ? row.content : null;
    },

    storedFileValue: function (id) {
      var row = queryOne('SELECT blob_data FROM files WHERE id = ?', [id]);
      return row ? row.blob_data : null;
    },

    // ------------------------------------------------------------------- trash
    /**
     * How many items are in the trash, optionally scoped to one workspace.
     *
     * The corner control passes the workspace on screen, because the panel it opens lists
     * THAT workspace's deleted rows: a badge counting rows the panel will not show — rows
     * belonging to another workspace — contradicts itself the moment it is clicked. The
     * parameter stays optional so a caller can still ask the database-wide question.
     */
    countTrash: function (workspaceId) {
      var scope = workspaceId ? ' AND workspace_id = ?' : '';
      var args = workspaceId ? [workspaceId] : [];
      var folders = queryOne('SELECT COUNT(*) AS n FROM folders WHERE deleted_at IS NOT NULL' + scope, args);
      var notes = queryOne('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NOT NULL' + scope, args);
      var files = queryOne('SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NOT NULL' + scope, args);
      return (folders ? folders.n : 0) + (notes ? notes.n : 0) + (files ? files.n : 0);
    },

    /** List deleted items in a workspace. */
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

    /**
     * Total bytes of every file inside a folder's subtree, including nested folders.
     * One grouped query rather than a SUM per folder, because the trash lists a size for
     * each deleted folder it shows. Deleted rows are included on purpose: the caller is
     * usually asking about a folder that is itself in the trash, and the honest answer to
     * "how many bytes are in here" counts everything the folder holds.
     *
     * @returns {Object<string, number>} folderId -> bytes
     */
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

    /**
     * Every folder id in the subtree rooted at `rootId`, including the root, following
     * links through soft-deleted folders as well.
     *
     * deleteFolder() stamps the entire subtree, so when a folder is restored the deleted
     * folders *inside* it are still stamped. descendantFolderIds() deliberately filters
     * those out (it answers "what is live under here"), which is why the restore path
     * needs this second walk — without it, restoring a folder brings back the folder and
     * silently leaves every nested folder and its contents in the trash.
     */
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

    /** Restore a folder (and descendants) or single item. */
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

    /**
     * Restore one note or file, and any deleted folder above it.
     *
     * A note deleted on its own still sits inside its folder, so restoring it is enough.
     * But when the *folder* was deleted, the note was stamped as part of the cascade —
     * clearing its own stamp alone leaves it live inside a deleted folder, where every
     * list query filters it out. It would be restored and invisible, which reads as a
     * lost note. Walking the ancestry is what makes single-item restore honest.
     *
     * @returns {number} how many ancestor folders had to be brought back as well
     */
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

    /**
     * Permanently delete a folder and its whole subtree.
     *
     * Uses the deleted-inclusive walk: a trashed folder's nested folders are stamped too,
     * so the live-only walk stops at the first trashed level and would leave orphaned
     * notes and files pointing at folders that no longer exist.
     */
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

    // Templates (v7)
    listTemplates: function (wsId) { return query('SELECT * FROM templates WHERE workspace_id=? ORDER BY name', [wsId||0]); },
    saveTemplate: function (id, wsId, name, content) { return write('INSERT INTO templates (id, workspace_id, name, content, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id, name=excluded.name, content=excluded.content', [id||null, wsId||0, String(name).trim()||'Untitled', content||'']); },
    deleteTemplate: function (id) { return write('DELETE FROM templates WHERE id=?', [id]); },

    /** Tear the engine down (used by "reset everything" before a reload). */
    destroy: function () {
      // The unlocked view goes with it. Whatever is about to happen — a reload, a wipe — the
      // decrypted notebook must not outlive the database it was read from.
      App.crypto.lock();
      noteText = {};
      fileBytes = {};
      viewReady = false;
      if (db) {
        try { db.close(); } catch (err) { /* already closed */ }
        db = null;
      }
    },
  };

  App.db = API;
})(window.NoteApp);
