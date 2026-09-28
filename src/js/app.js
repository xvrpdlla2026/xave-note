/**
 * app.js — state + event wiring. This is the only module that mutates application state;
 * ui.js renders it and db.js persists it.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var el = util.el;

  // ---------------------------------------------------------------------- state
  var state = {
    ready: false,
    workspaceId: null,
    selection: { type: 'all', id: null }, // 'all' | 'folder'
    activeNoteId: null,
    activeFileId: null,
    expanded: {},                          // folderId -> true
    // The live sort, adopted from the stored preference by applySort() before the first
    // render. Every list in the app reads this one object, which is what keeps the tree,
    // the pane and the rail from ever describing different orders.
    sort: { key: 'manual', dir: 'asc' },
    // The row a reorder just moved, held for exactly one render so the list can reveal it.
    sortTouched: null,
    searchTerm: '',
    // Which surface the main pane is showing. A view rather than a selection, because the
    // task list is not a place in the tree: while it is in front, the selection still says
    // which folder a new note — or a new task — would be filed into.
    view: 'notes',                         // 'notes' | 'tasks'
    taskView: 'all',                       // 'all' | 'today' | 'upcoming' | 'done'
    // The half-typed task. Held here rather than only in the field, because every change on
    // screen repaints the pane, and a keystroke that did not survive that would make quick
    // add a field that eats what you typed.
    taskDraft: '',
    taskAddFocus: false,                   // hand focus back to the quick-add field
    taskScrollReset: false,                // start the task list at its own top
    railFocus: false,                      // hand focus back to the rail's task row
    // Trash panel. `selected` holds `kind:id` keys rather than row references, so a
    // selection survives the repaint that follows every restore or purge.
    trashOpen: false,
    trashSelected: [],
    trashView: 'all',                      // 'all' | 'folder' | 'note' | 'file'
    trashTerm: '',
    estimate: null,                        // navigator.storage.estimate(), from Settings
  };

  var dom = {};            // cached element references
  var uploadQueue = Promise.resolve(); // serialises uploads so each one persists in turn
  var currentPreviewUrl = null;        // object URL for the open image preview
  var trashPanel = null;               // the dialog element currently showing the trash

  // ---------------------------------------------------------------- autosave
  /**
   * Debounced autosave for the open note. 500 ms after the last keystroke the note is
   * written, and db.write() pushes the resulting snapshot to IndexedDB.
   */
  var saveOpenNote = util.debounce(function () {
    var note = state.currentNote;
    if (!note || !state.editorDirty) return Promise.resolve();

    var id = note.id;
    // Update the in-memory row immediately so the sidebar/tree reflects the new title
    // as soon as it is rendered, then persist.
    note.updated_at = util.nowIso();
    state.editorDirty = false;
    setStatus('Saving\u2026');

    return App.db.updateNote(id, note.title, note.content).then(function (res) {
      // Only report "Saved" if the user is still looking at the note we just wrote.
      if (state.currentNote && state.currentNote.id === id) {
        note.updated_at = res.updated_at;
        setStatus('Saved ' + new Date().toLocaleTimeString());
      }
    }).catch(function (err) {
      state.editorDirty = true;
      setStatus('Save failed');
      util.toast('Could not save the note: ' + err.message, 'error');
    });
  }, 500);

  function setStatus(text) {
    var node = document.getElementById('note-status');
    if (!node) return;
    node.textContent = text;
    // The dot beside the label is coloured by state: quiet while a write is in
    // flight, red if it failed, green once it landed. One shape, three states.
    node.classList.toggle('editor__status--dirty', /Saving|Unsaved/.test(text));
    node.classList.toggle('editor__status--error', /failed/i.test(text));
  }

  /**
   * Force any pending autosave to disk right now. Used when switching notes, hiding the
   * tab, or closing it — the flush is what stops the last 500 ms of typing from vanishing.
   */
  function flushPendingSave() {
    if (saveOpenNote.pending()) saveOpenNote.flush();
    // Where the reader was is written down here too: this is the path a hidden tab and a
    // closed one take, and a reload is exactly the moment it is needed.
    savePlace();
  }

  // ------------------------------------------------------------------- rendering
  function currentWorkspace() {
    return state.workspaces.filter(function (w) { return w.id === state.workspaceId; })[0] || null;
  }

  // ----------------------------------------------------------------------- sorting
  // One preference for the whole notebook, and one control that writes it. The tree, the
  // pane listing and the workspace rail are three drawings of lists that the user thinks of
  // as one notebook; three separate sort settings would be three ways for them to disagree.
  var SORT_PREF = 'sortOrder';

  /** Which list each surface is sorting. The keys themselves come from the db layer, which
   *  is where the SQL whitelist lives, so a key exists only where it can be honoured. */
  var SORT_TABLES = {
    workspaces: 'workspaces',
    tree: 'notes',
    pane: 'notes',
    files: 'files',
  };

  /** The order the sort menu lists keys in. A key the menu omits is still honoured if it is
   *  what the preference already holds, which is what stops an old choice from being lost the
   *  first time a surface that cannot honour it opens the menu. */
  var SORT_PICKER = ['manual', 'name', 'created', 'updated', 'size'];

  /**
   * The sort every list is drawn with.
   *
   * Read from state rather than from the preference on every call, because opening the sort
   * menu, choosing an item and re-rendering all happen inside one turn: a value read back out
   * of localStorage each time would be correct and slower, and state is where the session's
   * decisions already live.
   */
  function sortOf() {
    return state.sort || { key: 'manual', dir: 'asc' };
  }

  /**
   * Siblings in manual order, in the direction the notebook is in.
   *
   * The database already returns a workspace-wide list in position order, but position counts
   * from the top of each folder — that is what makes a reorder inside one folder leave its
   * sibling alone — so a flat list cannot be sorted by it. Each folder's own notes are
   * ordered here instead, and the id breaks any tie exactly as the SQL tiebreak does, so a
   * re-read after a swap cannot land in a different order than the render that caused it.
   *
   * The direction is part of the comparator because the toggle has to reach this sort as
   * well. SQL reverses the folders and the files it orders while this reverses the notes,
   * and a toggle that turned half a tree around would be a control disagreeing with itself.
   */
  function positionComparator(dir) {
    var sign = dir === 'desc' ? -1 : 1;
    return function (a, b) {
      var delta = ((Number(a.position) || 0) - (Number(b.position) || 0)) * sign;
      if (delta) return delta;
      // Ascending in both directions, which is what the SQL tiebreak does: two rows sharing a
      // position must not swap places merely because the list was reversed.
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    };
  }

  /** The shape that is written to the preference store and handed to the db layer. */
  function serialiseSort(sort) {
    return { key: sort.key, direction: sort.dir };
  }

  /**
   * Adopt a stored sort preference. Called once, before the first render, so nothing is ever
   * painted in one order and then repainted in another on the way to the database being ready.
   *
   * The fallback is manual ascending, which is the order the position column itself
   * describes: if this were to drift from what the lists are actually asked for, every list
   * would draw its rows in one order and read them back in another, and a reorder would
   * appear to move the wrong row.
   */
  function applySort() {
    var stored = App.prefs.get(SORT_PREF, null);
    var key = stored && typeof stored.key === 'string' && SORT_PICKER.indexOf(stored.key) !== -1
      ? stored.key : 'manual';
    var dir = stored && stored.direction === 'desc' ? 'desc' : 'asc';
    state.sort = { key: key, dir: dir };
    return state.sort;
  }

  /** Choose a sort and remember it. A new key keeps the direction the notebook is already in;
   *  the direction toggle is the one that changes direction, so it is the one that says so. */
  function setSort(key, direction) {
    if (SORT_PICKER.indexOf(key) === -1) return;
    state.sort = {
      key: key,
      dir: direction === 'asc' || direction === 'desc' ? direction : sortOf().dir,
    };
    App.prefs.set(SORT_PREF, serialiseSort(state.sort));
    // The rail is the third list this one control governs, and unlike the tree and the pane it
    // is not read by render() — its order lives in state.workspaces, which only a workspace
    // action refreshes. Without this the switcher would go on describing the sort the notebook
    // was in a moment ago, which is exactly the disagreement the one control exists to prevent.
    refreshWorkspaces();
    render();
    paintSortButton();
  }

  /** listWorkspaces() is synchronous (it reads the in-memory SQLite database). */
  function refreshWorkspaces() {
    state.workspaces = App.db.listWorkspaces(sortOf());
    if (!state.workspaces.length) {
      // Every workspace was deleted — make a fresh one so the app is never unusable.
      return App.db.createWorkspace('Personal').then(refreshWorkspaces);
    }
    if (!state.workspaceId || !state.workspaces.some(function (w) { return w.id === state.workspaceId; })) {
      state.workspaceId = state.workspaces[0].id;
      state.selection = { type: 'all', id: null };
      state.activeNoteId = null;
      state.activeFileId = null;
    }
    App.prefs.set('lastWorkspaceId', state.workspaceId);
    return Promise.resolve(state.workspaces);
  }

  // ------------------------------------------------------------- where you were
  /**
   * The reader's place, remembered per workspace.
   *
   * Which folders are open, which row is selected, the note or file the pane is showing, and
   * which pane it is. Without it a reload puts the reader back at the workspace root with every
   * folder shut — the page forgetting what they were doing.
   *
   * Deliberately NOT remembered: the search term (a term that outlives the reload hides the
   * tree it was typed into), the scroll offsets, and anything inside the trash panel, which is
   * a dialog the reader opened once rather than a place they were working. The theme, the
   * palette, the sort order and the last workspace were already kept and stay where they were.
   */
  var PLACE_PREF = 'place.';

  /** Write it down. Called on a debounce from render(), and directly on the unload path. */
  function savePlace() {
    if (!state.ready || !state.workspaceId) return;
    var open = [];
    Object.keys(state.expanded).forEach(function (id) { if (state.expanded[id]) open.push(id); });
    App.prefs.set(PLACE_PREF + state.workspaceId, {
      expanded: open,
      selection: state.selection,
      noteId: state.activeNoteId,
      fileId: state.activeFileId,
      view: state.view,
      taskView: state.taskView,
    });
  }
  var savePlaceSoon = util.debounce(savePlace, 400);

  /**
   * Put the reader back. Every id is checked against the database first: a folder deleted in
   * another tab, or a note that is no longer there, must not come back as a selected row with
   * nothing behind it.
   */
  function restorePlace(workspaceId) {
    if (!workspaceId) return;
    var place = App.prefs.get(PLACE_PREF + workspaceId, null);
    if (!place) return;
    var folders = {};
    App.db.listFolders(workspaceId).forEach(function (f) { folders[f.id] = true; });
    (place.expanded || []).forEach(function (id) { if (folders[id]) state.expanded[id] = true; });
    if (place.view === 'tasks') state.view = 'tasks';
    if (TASK_VIEWS.indexOf(place.taskView) !== -1) state.taskView = place.taskView;
    var selection = place.selection || {};
    state.selection = selection.type === 'folder' && folders[selection.id]
      ? { type: 'folder', id: selection.id }
      : { type: 'all', id: null };
    var note = place.noteId ? App.db.getNote(place.noteId) : null;
    if (note && note.workspace_id === workspaceId) {
      state.activeNoteId = note.id;
      if (note.folder_id) {
        state.expanded[note.folder_id] = true;
        expandAncestors(note.folder_id);
      }
      return;
    }
    var file = place.fileId ? App.db.getFileMeta(place.fileId) : null;
    if (file && file.workspace_id === workspaceId) {
      state.activeFileId = file.id;
      if (file.folder_id) {
        state.expanded[file.folder_id] = true;
        expandAncestors(file.folder_id);
      }
    }
  }

  /** Build the sidebar model from the database, then draw everything. */
  function render() {
    if (!state.ready) return;
    var wsId = state.workspaceId;

    var sort = sortOf();
    // Every list on screen is asked for in the same order, including the rail's workspaces
    // (refreshWorkspaces). The alternative — sorting the tree and letting the pane draw
    // whatever the database returns — is a pane that disagrees with the tree beside it.
    var folders = App.db.listFolders(wsId, sort);
    var notes = App.db.listAllNotes(wsId, sort);

    // Files are fetched per folder plus the root, since listAllNotes has no blob cost but
    // listing every file row would still be wasteful at scale.
    var filesByFolder = {};
    var rootFiles = App.db.listFilesIn(wsId, null, sort);
    folders.forEach(function (folder) {
      filesByFolder[folder.id] = App.db.listFilesIn(wsId, folder.id, sort);
    });

    var notesByFolder = {};
    var rootNotes = [];
    notes.forEach(function (note) {
      if (note.folder_id) {
        (notesByFolder[note.folder_id] = notesByFolder[note.folder_id] || []).push(note);
      } else {
        rootNotes.push(note);
      }
    });

    // A flat list ordered by position cannot express manual order, because position counts
    // from the top of each folder: sorting a workspace-wide list by it interleaves
    // folders that are only ever drawn as separate groups. So each scope is ordered inside
    // itself, and the folder groups are then laid out in the order the folders came in —
    // which is exactly the scope the reorder operates on, so what is drawn and what a Move
    // up command will do cannot disagree.
    var manual = sort.key === 'manual';
    var byPosition = positionComparator(sort.dir);
    var orderedNotesByFolder = {};
    folders.forEach(function (folder) {
      var inFolder = notesByFolder[folder.id] || [];
      orderedNotesByFolder[folder.id] = manual
        ? inFolder.slice().sort(byPosition)
        : inFolder;
    });
    var orderedRootNotes = manual ? rootNotes.slice().sort(byPosition) : rootNotes;

    var treeModel = {
      folders: folders,
      notesByFolder: orderedNotesByFolder,
      filesByFolder: filesByFolder,
      rootNotes: orderedRootNotes,
      rootFiles: rootFiles,
      expanded: state.expanded,
      selection: state.selection,
      activeNoteId: state.activeNoteId,
      activeFileId: state.activeFileId,
      counts: App.db.counts(wsId),
      // The pane listing is drawn from this same model, so it is sorted by the same answer
      // rather than by a second query that could have been asked a moment later.
      sort: sort,
    };

    App.ui.renderWorkspaceSelect(dom.workspaceSelect, state.workspaces, wsId);

    // Sidebar: search results replace the tree while a query is active. The query is asked of
    // the whole notebook rather than of the open workspace: a note whose home you cannot
    // remember is exactly the one worth searching for, and confining the answer to the
    // workspace on screen is the failure this must not have. A hit from elsewhere names its
    // workspace on the row.
    if (state.searchTerm) {
      var results = App.db.search(null, state.searchTerm, 100);
      App.ui.renderSearchResults(dom.tree, {
        results: results,
        term: state.searchTerm,
        currentWorkspaceId: wsId,
        activeNoteId: state.activeNoteId,
        activeFileId: state.activeFileId,
      });
    } else {
      App.ui.renderTree(dom.tree, treeModel);
    }

    renderMainPane(treeModel);

    // The header's task button. Drawn from the render that draws everything it counts, rather
    // than from the click that opens the pane: the count changes for reasons that have
    // nothing to do with this button — a checkbox, a delete, a quick add — and a count only
    // refreshed by its own control is the stale-badge bug this codebase has already had.
    // It is affordable here because it is one indexed count; the footer's byte readout is
    // not, which is why that one lives outside render().
    App.ui.renderTopbarViews(dom.topbarViews, { view: state.view, open: openTaskCount() });

    // The corner trash control. Cheap enough to keep in step with every render: it is two
    // indexed counts, not the database serialisation the footer readout needs.
    App.ui.setTrashButton(dom.trashFab, deletedCount());

    // Narrow viewports show one pane at a time. The list is the home screen; a running
    // search and an empty canvas both belong to it. Decided after renderMainPane() so a
    // note that vanished underneath us falls back to the list instead of a dead canvas.
    // The task list is a pane of its own, so on a narrow viewport it IS the canvas:
    // deciding by the note selection alone would show the tree and leave the pane the
    // reader just asked for off screen.
    showMobilePane(state.view === 'tasks'
      ? 'canvas'
      : (state.searchTerm || (!state.activeNoteId && !state.activeFileId) ? 'list' : 'canvas'));

    // The button describes the order the two panes were just drawn in, so it is repainted from
    // the same render rather than from the click that changed it. One place to be right.
    paintSortButton();

    if (state.sortTouched) {
      var touched = state.sortTouched;
      state.sortTouched = null;
      focusMovedRow(touched.kind, touched.id);
    }

    // Focus belongs back on the control that caused the repaint, in the two places where
    // that control is itself replaced by it: the quick-add field after a task is filed, and
    // the rail's task row after it is pressed. Both flags are set by the action that
    // triggered this render and consumed here, so no unrelated repaint ever steals focus.
    if (state.taskAddFocus) {
      state.taskAddFocus = false;
      var addField = document.getElementById('task-add');
      if (addField) addField.focus();
    }
    if (state.railFocus) {
      state.railFocus = false;
      var railRow = document.querySelector('[data-action="view-tasks"]');
      if (railRow) railRow.focus();
    }

    // Where the reader is, for the next load. Debounced, because a render is often one step of
    // a gesture — a folder opening, a note being picked — and a burst of them is one place.
    savePlaceSoon();
  }

  /** Main pane: the task list, the editor, a file preview, a folder listing, or nothing yet. */
  function renderMainPane(treeModel) {
    App.ui.revokeObjectUrls();
    currentPreviewUrl = null;

    // Before every other branch, because the task list is a view of the workspace rather
    // than something inside it: it stays in front whatever the tree has selected. Nothing
    // below is cleared on the way in, which is what lets closing the pane put the reader
    // back on the note or folder they were looking at.
    if (state.view === 'tasks') {
      renderTasksPane();
      return;
    }

    if (state.activeNoteId) {
      var note = App.db.getNote(state.activeNoteId);
      if (note) {
        state.currentNote = note;
        state.editorDirty = false;
        App.ui.renderEditor(dom.main, {
          note: note,
          path: note.folder_id ? App.db.folderPaths(state.workspaceId)[note.folder_id] : '',
        });
        return;
      }
      // The note vanished underneath us (deleted in another tab) — fall through.
      state.activeNoteId = null;
    }

    if (state.activeFileId) {
      var meta = App.db.getFileMeta(state.activeFileId);
      if (meta) {
        state.currentFile = meta;
        var previewUrl = null;
        // Locked is a state the pane draws, not an error. Asking for the bytes would return
        // null, and rendering that as "no inline preview for this type" would blame the file
        // for the notebook being locked.
        var fileLocked = App.db.locked();
        if (!fileLocked && util.isImageMime(meta.mime_type)) {
          try {
            var resolved = App.db.getFileBlob(meta.id);
            if (resolved) {
              previewUrl = App.ui.makeObjectUrl(resolved.blob);
              currentPreviewUrl = previewUrl;
            }
          } catch (err) {
            util.toast('Preview failed: ' + err.message, 'error');
          }
        }
        App.ui.renderFilePreview(dom.main, { file: meta, previewUrl: previewUrl, locked: fileLocked });
        return;
      }
      state.activeFileId = null;
    }

    if (state.selection.type === 'folder') {
      var folder = treeModel.folders.filter(function (f) { return f.id === state.selection.id; })[0];
      if (folder) {
        App.ui.renderFolderView(dom.main, {
          kind: 'folder',
          folderName: folder.name,
          path: App.db.folderPaths(state.workspaceId)[folder.id],
          subfolders: treeModel.folders.filter(function (f) { return f.parent_folder_id === folder.id; }),
          notes: treeModel.notesByFolder[folder.id] || [],
          files: treeModel.filesByFolder[folder.id] || [],
          activeNoteId: state.activeNoteId,
          activeFileId: state.activeFileId,
        });
        return;
      }
      state.selection = { type: 'all', id: null };
    }

    App.ui.renderFolderView(dom.main, {
      kind: 'all',
      folderName: 'All notes',
      workspaceName: (currentWorkspace() || {}).name || '',
      subfolders: treeModel.folders.filter(function (f) { return !f.parent_folder_id; }),
      notes: treeModel.rootNotes,
      files: treeModel.rootFiles,
      activeNoteId: state.activeNoteId,
      activeFileId: state.activeFileId,
    });
  }

  // ------------------------------------------------------------------ task actions
  /**
   * The folder a new task is filed into: the selected folder, else the workspace root.
   *
   * A task's project IS a folder, so "where does this belong" is a question the tree has
   * already answered — this is the same answer newNote() uses. The one difference is that
   * a folder selection also scopes the list, so what is on screen and where the next task
   * lands are the same place rather than two.
   */
  function taskTargetFolder() {
    return state.selection.type === 'folder' ? state.selection.id : null;
  }

  /**
   * Open work in the active workspace: the rail row's number.
   *
   * Never scoped by the selection, because the rail row names the workspace: a count that
   * followed the tree would change when a folder was clicked and read as tasks appearing
   * and vanishing. The throw guard is the one deletedCount() carries, for the same reason
   * — reading a count must never be the thing that breaks a render.
   */
  function openTaskCount() {
    try {
      return App.db.countOpenTasks(state.workspaceId);
    } catch (err) {
      return 0;
    }
  }

  /**
   * Everything the tasks pane draws, derived from the database on every paint.
   *
   * Cached nowhere, deliberately. A stored list is how a badge comes to describe the moment
   * before the last change — the stale-count bug this codebase has already had once — and
   * every field here is one query or one in-memory lookup, all asked in the same turn as
   * the render that consumes them.
   */
  function taskModel() {
    var wsId = state.workspaceId;
    var folderId = taskTargetFolder();
    var folders = App.db.listFolders(wsId);
    var folder = null;
    var projectNames = {};
    folders.forEach(function (f) {
      projectNames[f.id] = f.name;
      if (f.id === folderId) folder = f;
    });
    var counts = App.db.countTasks(wsId, { folderId: folderId });
    return {
      view: state.taskView,
      // The same boundaries the SQL views were filtered with, handed to the renderer so it
      // can group the rows without deciding for itself where today ends.
      bounds: App.db.taskDayBounds(),
      manual: sortOf().key === 'manual',
      draft: state.taskDraft,
      tasks: App.db.listTasks(wsId, { view: state.taskView, folderId: folderId }),
      counts: counts,
      open: counts.all,
      overdue: counts.overdue,
      folderName: folder ? folder.name : null,
      projectNames: projectNames,
      onToggle: toggleTaskDone,
      onView: setTaskView,
    };
  }

  /**
   * Draw the tasks pane without moving the reader.
   *
   * #main is the element that scrolls, and the pane is rebuilt from scratch on every change
   * — a checkbox, a save, an unrelated repaint — so replacing its children throws the
   * offset away: ticking a task halfway down a long list would jump back to the top. This is
   * the same problem the trash panel answers by refreshing itself in place; the pane here
   * has no header to keep, so the offset is captured and put back instead. The one case that
   * must not be preserved is a change of view, which is a different list and starts at its
   * own beginning.
   */
  function renderTasksPane() {
    var keep = state.taskScrollReset ? 0 : dom.main.scrollTop;
    state.taskScrollReset = false;
    App.ui.renderTasks(dom.main, taskModel());
    dom.main.scrollTop = keep;
  }

  /** Show the task list, or hand the pane back to the notebook. */
  function showTasks(on) {
    flushPendingSave();
    state.view = on ? 'tasks' : 'notes';
    if (on) {
      // Arriving at a list starts at its top, and the rail row that was just pressed is
      // rebuilt by the render below — so focus is handed back to it afterwards rather than
      // being dropped on <body> halfway through a keyboard session.
      state.taskScrollReset = true;
      state.railFocus = true;
    }
    render();
  }

  /** The slices of the task list, in the order the filter offers them. */
  var TASK_VIEWS = ['all', 'today', 'upcoming', 'done'];

  /** Which slice of the list is showing. A different list starts at its own top. */
  function setTaskView(view) {
    if (TASK_VIEWS.indexOf(view) === -1) return;
    if (view === state.taskView) return;
    state.taskView = view;
    state.taskScrollReset = true;
    render();
  }

  /**
   * File a new task from the quick-add field.
   *
   * Focus goes back into the field for the next one, which is what makes this a way of
   * entering several tasks in a row rather than a small form. The flag is consumed by the
   * render below, because the field itself is rebuilt by it.
   */
  /**
   * File whatever is in the quick-add field — from Enter, or from the Add button beside it.
   *
   * One path for both, so the key and the button cannot drift apart. The draft is cleared
   * BEFORE the write, not after it: the render that follows the write would otherwise put the
   * text that was just filed back into the box.
   */
  function addTaskFromQuickAdd() {
    var field = document.getElementById('task-add');
    var text = field ? field.value : state.taskDraft;
    if (field) field.value = '';
    state.taskDraft = '';
    state.taskAddFocus = true;
    addTask(text);
  }

  function addTask(title) {
    var text = String(title || '').trim();
    // An empty Enter is not an error and not a task: it is the reader changing their mind,
    // and the honest response is to do nothing at all.
    if (!text) return Promise.resolve(null);
    return App.db.createTask(state.workspaceId, taskTargetFolder(), text, {}).then(function (task) {
      state.taskDraft = '';
      state.taskAddFocus = true;
      // Filing a task into a collapsed folder reveals it, exactly as creating a note there
      // does — otherwise the pane says it worked and the tree shows nothing.
      if (task && task.folder_id) expandAncestors(task.folder_id);
      render();
      return task;
    }).catch(function (err) {
      util.toast('Could not add the task: ' + err.message, 'error');
      return null;
    });
  }

  /** Tick a task off, or put it back. The rows, the badges and the rail all re-read. */
  function toggleTaskDone(id, done) {
    App.db.setTaskDone(id, done).then(function () {
      render();
    }).catch(function (err) {
      util.toast('Could not update the task: ' + err.message, 'error');
    });
  }

  /**
   * A caption above any control, in the three-element shape components.js uses.
   *
   * App.ui.field builds one of these for a plain text input; a date control, a select
   * widget and a checkbox take their accessible names from themselves, so the ones that
   * have no focusable element for a <label> to point at are captioned with a span instead
   * of carrying a `for` that resolves to nothing a screen reader would announce.
   */
  function taskField(label, control, id) {
    return el('div', { class: 'field' }, [
      id
        ? el('label', { class: 'field__label', for: id, text: label })
        : el('span', { class: 'field__label', text: label }),
      control,
    ]);
  }

  /** A local-time date, as the value a date control wants. Wall clock, never UTC. */
  function dateInputValue(iso) {
    var when = new Date(iso);
    if (!iso || isNaN(when.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate());
  }

  /** The same for a time control. Only meaningful when the task actually has a time. */
  function timeInputValue(iso) {
    var when = new Date(iso);
    if (!iso || isNaN(when.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(when.getHours()) + ':' + pad(when.getMinutes());
  }

  /**
   * The edit dialog's controls, and the one function that reads them back.
   *
   * @returns {{root: Node, read: function}} read() gives exactly the fields updateTask()
   *          accepts, in the types the database stores: an ISO instant, a 0/1 flag and an
   *          integer. Nothing else about the dialog leaves this function.
   *
   * A date and a time are read as local wall-clock values and written as the one ISO
   * instant every other timestamp in this app is. A task with no time is pinned to local
   * midnight, and due_has_time is what stops that midnight being read back as a time — the
   * two facts one timestamp cannot carry on its own, which is why the column exists.
   */
  function buildTaskForm(task) {
    var titleInput = el('input', {
      id: 'task-title',
      class: 'field__input',
      type: 'text',
      value: task.title || '',
      placeholder: 'What needs doing?',
      autocomplete: 'off',
    });
    var notesInput = el('textarea', {
      id: 'task-notes',
      class: 'field__input field__input--area',
      rows: '3',
      placeholder: 'Notes for this task',
      'aria-label': 'Task notes',
    });
    notesInput.value = task.notes || '';

    var folders = App.db.listFolders(state.workspaceId);
    var project = App.ui.select({
      label: 'Project',
      value: task.folder_id || '',
      options: [{ value: '', label: 'No project' }].concat(folders.map(function (f) {
        return { value: f.id, label: f.name };
      })),
    });

    var dueDate = el('input', {
      id: 'task-due',
      class: 'field__input',
      type: 'date',
      value: dateInputValue(task.due_at),
    });
    var allDay = App.ui.checkbox({
      label: 'All day',
      checked: !task.due_has_time,
      className: 'task-form__toggle',
    });
    allDay.input.id = 'task-allday';
    var dueTime = el('input', {
      id: 'task-time',
      class: 'field__input',
      type: 'time',
      value: timeInputValue(task.due_at),
      'aria-label': 'Due time',
    });
    // A time for an all-day task is a control that cannot do anything. Disabled rather than
    // hidden, so the choice between the two stays visible and the field keeps its place.
    dueTime.disabled = allDay.input.checked;
    allDay.input.addEventListener('change', function () {
      dueTime.disabled = allDay.input.checked;
      if (!dueTime.disabled && !dueTime.value) dueTime.value = '09:00';
    });

    var priority = App.ui.select({
      label: 'Priority',
      value: String(task.priority || 0),
      options: [
        { value: '0', label: 'Normal' },
        { value: '1', label: 'Low' },
        { value: '2', label: 'High' },
      ],
    });

    var root = el('div', { class: 'task-form' }, [
      taskField('Task', el('div', { class: 'field__control' }, [titleInput]), 'task-title'),
      taskField('Notes', el('div', { class: 'field__control' }, [notesInput]), 'task-notes'),
      el('div', { class: 'task-form__row' }, [
        taskField('Project', project, null),
        taskField('Priority', priority, null),
      ]),
      el('div', { class: 'task-form__row' }, [
        taskField('Due date', el('div', { class: 'field__control' }, [dueDate]), 'task-due'),
        taskField('Time', el('div', { class: 'field__control task-form__when' }, [allDay, dueTime]), 'task-allday'),
      ]),
    ]);

    return {
      root: root,
      read: function () {
        var hasTime = !allDay.input.checked;
        var due = null;
        if (dueDate.value) {
          // The parts are read as local numbers rather than through Date.parse, which would
          // read a bare yyyy-mm-dd as UTC midnight and move the task a day for anyone west
          // of Greenwich.
          var parts = dueDate.value.split('-');
          var when = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
          if (hasTime && /^\d{1,2}:\d{2}$/.test(dueTime.value)) {
            var hm = dueTime.value.split(':');
            when.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
          }
          due = isNaN(when.getTime()) ? null : when.toISOString();
        }
        return {
          title: titleInput.value,
          notes: notesInput.value,
          folder_id: project.getValue() || null,
          due_at: due,
          // A time with no date is not a time at all: there is no instant for it to
          // describe, so the flag follows the date rather than the toggle.
          due_has_time: due && hasTime ? 1 : 0,
          priority: Number(priority.getValue()) || 0,
        };
      },
    };
  }

  /**
   * Edit one task in a dialog, and put the change back on the row.
   *
   * The save resolves through onSubmit, so the dialog stays open with the failure written
   * next to the field that caused it instead of closing on a save that did not happen. The
   * repaint that follows keeps the list's scroll position (renderTasksPane), which is the
   * difference between editing a task in a long list and being thrown back to its top.
   */
  function editTask(id) {
    var task = App.db.getTask(id);
    if (!task) return;
    var form = buildTaskForm(task);
    App.ui.dialog({
      title: 'Edit task',
      icon: 'checkCircle',
      wide: true,
      body: form.root,
      focus: '#task-title',
      confirmLabel: 'Save task',
      onSubmit: function () {
        return App.db.updateTask(id, form.read()).then(function (ok) {
          // The row can be gone: another tab can delete it between the dialog opening and
          // the save landing, and reporting that is better than closing on a write that
          // changed nothing.
          if (!ok) throw new Error('That task is no longer in the list.');
          return true;
        });
      },
    }).then(function (saved) {
      if (!saved) return;
      render();
    });
  }

  /**
   * Delete one task, after saying what that costs.
   *
   * A task is not moved to the trash — see db.deleteTask — so this confirm is the only
   * thing standing between the row and the end of it, and it says so in the same words the
   * other danger dialogs use.
   */
  function deleteTask(id) {
    var task = App.db.getTask(id);
    if (!task) return;
    App.ui.dialog({
      title: 'Delete this task?',
      icon: 'trash',
      danger: true,
      message: '\u201c' + task.title + '\u201d will be removed from this workspace.',
      consequences: [
        task.notes ? 'Its notes are deleted with it.' : 'It leaves the list for good.',
        'Deleting cannot be undone.',
        'Export the database from Settings first if you want a copy.',
      ],
      confirmLabel: 'Delete task',
    }).then(function (ok) {
      if (!ok) return;
      App.db.deleteTask(id).then(function () {
        util.toast('Task deleted.', 'info');
        render();
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }
  // --------------------------------------------------------------- note actions
  /** Where a newly created note should land: inside the selected folder, else root. */
  function targetFolderId() {
    return state.selection.type === 'folder' ? state.selection.id : null;
  }

  function newNote() {
    flushPendingSave();
    // The new note has to be visible, which means the editor has to be the pane that is
    // showing — creating one behind the task list would look like nothing happened.
    state.view = 'notes';
    return App.db.createNote(state.workspaceId, targetFolderId(), 'Untitled note').then(function (note) {
      if (note.folder_id) expandAncestors(note.folder_id);
      state.activeFileId = null;
      state.activeNoteId = note.id;
      state.selection = note.folder_id ? { type: 'folder', id: note.folder_id } : state.selection;
      render();
      focusEditorTitle();
    }).catch(function (err) {
      util.toast('Could not create the note: ' + err.message, 'error');
    });
  }

  /** Expand every folder above `folderId` so the nested item becomes visible in the tree. */
  function expandAncestors(folderId) {
    if (!folderId) return;
    var byId = {};
    App.db.listFolders(state.workspaceId).forEach(function (f) { byId[f.id] = f; });
    var cursor = byId[folderId];
    var guard = 0;
    while (cursor && guard++ < 100) {
      state.expanded[cursor.id] = true;
      cursor = cursor.parent_folder_id ? byId[cursor.parent_folder_id] : null;
    }
  }

  /**
   * Is the reader working inside this folder?
   *
   * True when the row they have selected, or the note or file the pane is showing, sits inside
   * this folder — a note filed DIRECTLY in it counts, and that is the ordinary case, not an
   * edge one. False when the folder is itself the selected row, because a folder has to stay
   * closable while it is the thing in front of you.
   *
   * The tree asks this before folding a folder up. Folding it over the reader's own place takes
   * the row they were on off the screen with it, which is a focus loss dressed up as tidying:
   * the folder stays open until they have moved out of it.
   */
  function holdsTheSelection(folderId) {
    if (!folderId) return false;
    // The subtree rooted here, this folder included.
    var subtree = App.db.descendantFolderIdsAll(folderId);
    // A child FOLDER has to be strictly below this one: the folder itself being selected is what
    // has to leave it closable. A note or a file is inside the folder it is FILED IN, so its own
    // folder id counts — reading a note that sits directly in this folder is the whole point.
    if (state.selection.type === 'folder' && state.selection.id !== folderId
        && subtree.indexOf(state.selection.id) !== -1) {
      return true;
    }
    if (state.activeNoteId) {
      var open = App.db.getNote(state.activeNoteId);
      if (open && open.folder_id && subtree.indexOf(open.folder_id) !== -1) return true;
    }
    if (state.activeFileId) {
      var openFile = App.db.getFileMeta(state.activeFileId);
      if (openFile && openFile.folder_id && subtree.indexOf(openFile.folder_id) !== -1) return true;
    }
    return false;
  }

  /**
   * Move to the workspace an item belongs to before opening it.
   *
   * Search answers for the whole notebook, so a hit can live somewhere the reader is not — and
   * everything else on screen is workspace-scoped: the tree, the counts, the breadcrumb trail
   * and the remembered place. Opening the note without moving would show a note that the tree
   * beside it cannot point at, and would file its id under the wrong workspace's place. The
   * running query is deliberately kept, because it is the list the reader is working through and
   * it is still the answer after the move: that is the one thing this does differently from
   * switchWorkspace().
   */
  function adoptWorkspaceOf(workspaceId) {
    if (!workspaceId || workspaceId === state.workspaceId) return;
    flushPendingSave();
    // The workspace being left keeps the place the reader had in it; the one being entered gets
    // the item about to be opened, which is a place of its own.
    savePlace();
    state.workspaceId = workspaceId;
    state.selection = { type: 'all', id: null };
    state.expanded = {};
    App.prefs.set('lastWorkspaceId', workspaceId);
  }

  function openNote(id) {
    flushPendingSave();
    // A hit in another workspace takes the reader there before the note opens. See above.
    var note = App.db.getNote(id);
    if (note) adoptWorkspaceOf(note.workspace_id);
    state.view = 'notes';
    state.activeFileId = null;
    state.activeNoteId = id;
    // Reveal the note if it lives inside a collapsed folder, at any nesting depth.
    if (note && note.folder_id) expandAncestors(note.folder_id);
    render();
  }

  function deleteNote(id) {
    var note = App.db.getNote(id);
    if (!note) return;
    var label = note.title && note.title.trim() ? note.title : 'Untitled note';
    var words = (note.content || '').trim().split(/\s+/).filter(Boolean).length;

    App.ui.dialog({
      title: 'Delete this note?',
      icon: 'trash',
      danger: true,
      message: '\u201c' + label + '\u201d will be removed from this browser.',
      // The concrete consequence, not a generic "are you sure".
      consequences: [
        words ? 'The note body (' + words + ' word' + (words === 1 ? '' : 's') + ') is deleted with it.' : 'The note body is deleted with it.',
        'Deleting cannot be undone.',
        'Export the database from Settings first if you want a copy.',
      ],
      confirmLabel: 'Delete note',
    }).then(function (ok) {
      if (!ok) return;
      saveOpenNote.cancel();
      App.db.deleteNote(id).then(function () {
        if (state.activeNoteId === id) {
          state.activeNoteId = null;
          state.currentNote = null;
        }
        util.toast('Note deleted.', 'info');
        render();
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }

  function renameNote(id) {
    var note = App.db.getNote(id);
    if (!note) return;
    App.ui.prompt({
      title: 'Rename note',
      label: 'Note title',
      value: note.title || '',
      placeholder: 'Untitled note',
      confirmLabel: 'Rename',
    }).then(function (next) {
      if (next === null) return;
      saveOpenNote.cancel();
      App.db.updateNote(id, next, note.content).then(function () {
        if (state.currentNote && state.currentNote.id === id) state.currentNote.title = next;
        render();
      }).catch(function (err) {
        util.toast('Rename failed: ' + err.message, 'error');
      });
    });
  }

  // ------------------------------------------------------------- folder actions
  function newFolder(parentId) {
    App.ui.prompt({
      title: parentId ? 'New subfolder' : 'New folder',
      icon: 'folder',
      label: 'Folder name',
      value: 'New folder',
      confirmLabel: 'Create folder',
    }).then(function (name) {
      if (name === null) return;
      App.db.createFolder(state.workspaceId, name, parentId || null).then(function (folder) {
        state.expanded[folder.id] = true;
        if (parentId) state.expanded[parentId] = true;
        render();
      }).catch(function (err) {
        util.toast('Could not create the folder: ' + err.message, 'error');
      });
    });
  }

  function renameFolder(id) {
    var folders = App.db.listFolders(state.workspaceId);
    var folder = folders.filter(function (f) { return f.id === id; })[0];
    if (!folder) return;
    App.ui.prompt({
      title: 'Rename folder',
      icon: 'folder',
      label: 'Folder name',
      value: folder.name,
      confirmLabel: 'Rename',
    }).then(function (next) {
      if (next === null) return;
      App.db.renameFolder(id, next).then(render).catch(function (err) {
        util.toast('Rename failed: ' + err.message, 'error');
      });
    });
  }

  function moveFolder(id) {
    var folders = App.db.listFolders(state.workspaceId);
    var folder = folders.filter(function (f) { return f.id === id; })[0];
    if (!folder) return;
    var workspaces = App.db.listWorkspaces();
    var others = workspaces.filter(function (w) { return w.id !== state.workspaceId; });
    if (!others.length) {
      util.toast('No other workspace exists to move to.', 'info');
      return;
    }

    // Custom dialog with a native workspace select.
    var titleId = 'dlg-move-title-' + util.uuid().slice(0, 8);
    var node = document.createElement('dialog');
    node.className = 'dialog';
    node.setAttribute('aria-labelledby', titleId);

    var form = document.createElement('form');
    form.className = 'dialog__form';
    form.setAttribute('novalidate', 'novalidate');

    // Header
    var head = el('div', { class: 'dialog__head' }, [
      el('span', { class: 'dialog__icon' }, [App.ui.icon('folder', 19)]),
      el('h2', { id: titleId, class: 'dialog__title', text: 'Move folder' }),
      el('button', {
        class: 'dialog__close',
        type: 'button',
        'aria-label': 'Close',
        onclick: function () { dismiss(); },
      }, [App.ui.icon('close', 15)]),
    ]);
    form.appendChild(head);

    // Body
    var selectRoot = App.ui.select({
      label: 'Target workspace',
      value: others[0] ? others[0].id : '',
      options: others.map(function (w) { return { value: w.id, label: w.name }; }),
    });
    var body = el('div', { class: 'dialog__body' }, [
      el('p', { class: 'dialog__message', text: 'Move \u201c' + folder.name + '\u201d and everything inside it to another workspace.' }),
    ]);
    body.appendChild(el('label', { class: 'field__label', for: 'select-' + util.uuid().slice(0, 8), text: 'Target workspace' }));
    body.appendChild(selectRoot);
    form.appendChild(body);

    // Footer
    var cancelBtn = el('button', { class: 'btn', type: 'button', onclick: function () { dismiss(); } }, ['Cancel']);
    var confirmBtn = el('button', { class: 'btn btn--primary', type: 'submit' }, ['Move folder']);
    form.appendChild(el('div', { class: 'dialog__footer' }, [cancelBtn, confirmBtn]));

    node.appendChild(form);

    function dismiss() {
      node.classList.add('dialog--closing');
      setTimeout(function () {
        if (node.open) node.close();
        if (node.parentNode) node.parentNode.removeChild(node);
        document.activeElement && document.activeElement.focus();
      }, 140);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var targetId = selectRoot ? selectRoot.getValue() : null;
      if (!targetId) return;
      node.classList.add('dialog--closing');
      setTimeout(function () {
        if (node.open) node.close();
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 140);
      App.db.moveFolder(id, targetId).then(function () {
        // If the moved folder was selected, or an open note/file was inside it, fall back.
        var doomedIds = App.db.descendantFolderIds(id);
        if (state.selection.type === 'folder' && doomedIds.indexOf(state.selection.id) !== -1) {
          state.selection = { type: 'all', id: null };
        }
        if (state.activeNoteId) {
          var note = App.db.getNote(state.activeNoteId);
          if (note && doomedIds.indexOf(note.folder_id) !== -1) state.activeNoteId = null;
        }
        util.toast('Folder moved to \u201c' + (workspaces.filter(function (w) { return w.id === targetId; })[0] || { name: targetId }).name + '\u201d.', 'success');
        render();
      }).catch(function (err) {
        util.toast('Move failed: ' + err.message, 'error');
      });
    });

    document.body.appendChild(node);
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', '');
    document.getElementById('move-workspace-select').focus();
  }

  function deleteFolder(id) {
    var folders = App.db.listFolders(state.workspaceId);
    var folder = folders.filter(function (f) { return f.id === id; })[0];
    if (!folder) return;

    // Counts come from the subtree, so the dialog can say exactly what leaves with it
    // rather than asserting that "everything" will be deleted.
    var contents = App.db.countFolderContents(id);
    var consequences = [];
    if (contents.notes) consequences.push(contents.notes + ' note' + (contents.notes === 1 ? '' : 's') + ' inside it will be deleted.');
    if (contents.files) consequences.push(contents.files + ' attached file' + (contents.files === 1 ? '' : 's') + ' will be deleted.');
    if (contents.folders) consequences.push(contents.folders + ' subfolder' + (contents.folders === 1 ? '' : 's') + ' and their contents will be deleted.');
    if (!consequences.length) consequences.push('The folder is empty, so nothing else is lost.');
    consequences.push('Deleting cannot be undone.');

    App.ui.dialog({
      title: 'Delete \u201c' + folder.name + '\u201d?',
      icon: 'trash',
      danger: true,
      message: 'This removes the folder and everything nested under it.',
      consequences: consequences,
      confirmLabel: 'Delete folder',
    }).then(function (ok) {
      if (!ok) return;
      saveOpenNote.cancel();
      var doomed = App.db.descendantFolderIds(id);
      App.db.deleteFolder(id).then(function () {
        doomed.forEach(function (folderId) { delete state.expanded[folderId]; });
        // If what we were looking at is gone, fall back to the workspace root.
        if (state.selection.type === 'folder' && doomed.indexOf(state.selection.id) !== -1) {
          state.selection = { type: 'all', id: null };
        }
        if (state.activeNoteId) {
          var open = App.db.getNote(state.activeNoteId);
          if (open && doomed.indexOf(open.folder_id) !== -1) state.activeNoteId = null;
        }
        render();
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }

  // =============================================================== trash panel
  /**
   * The trash is a fullscreen panel rather than a pane, for two reasons. Recovering data
   * is a browsing task — scan the list, tick several rows, act once — and it has to stay
   * reachable while a note is open, which a main-pane view cannot do without throwing the
   * reader out of what they were reading. It is a <dialog>, so focus trapping, Escape and
   * scroll lock are the browser's job, exactly as for every other dialog in the app.
   *
   * The panel is built once per open and then *refreshed*: selection changes repaint the
   * list and the footer through `trashPanel.__refresh`, never a full render(). Rebuilding
   * the dialog on every checkbox click would reset the scroll position of the list you
   * are working through, which is the one thing a bulk-selection UI must not do.
   */
  function folderPaths() {
    return App.db.folderPaths(state.workspaceId);
  }

  /** item ids whose own folder is deleted as well, so the item is not visible on its own. */
  function cascadeHiddenIds(trash) {
    var trashedFolders = {};
    var allFolders = {};
    trash.folders.forEach(function (f) { trashedFolders[f.id] = true; });
    App.db.listFolders(state.workspaceId).forEach(function (f) { allFolders[f.id] = f; });
    trash.folders.forEach(function (f) { allFolders[f.id] = f; });

    var hidden = [];
    function parentIsTrashed(item) {
      var cursor = item.folder_id || null;
      var guard = 0;
      while (cursor && guard++ < 100) {
        if (trashedFolders[cursor]) return true;
        var folder = allFolders[cursor];
        cursor = folder ? (folder.parent_folder_id || null) : null;
      }
      return false;
    }
    trash.notes.forEach(function (n) { if (parentIsTrashed(n)) hidden.push(n.id); });
    trash.files.forEach(function (f) { if (parentIsTrashed(f)) hidden.push(f.id); });
    return hidden;
  }

  /** How many things a deleted folder still holds, for the row's own description. */
  function folderContentCounts(trash) {
    var counts = {};
    trash.folders.forEach(function (folder) {
      var ids = App.db.descendantFolderIdsAll(folder.id);
      var index = {};
      ids.forEach(function (id) { index[id] = true; });
      var notes = trash.notes.filter(function (n) { return n.folder_id && index[n.folder_id]; }).length;
      var files = trash.files.filter(function (f) { return f.folder_id && index[f.folder_id]; }).length;
      counts[folder.id] = (ids.length - 1) + notes + files;
    });
    return counts;
  }

  /** Everything the panel needs, derived fresh — the panel itself holds no state. */
  function trashModel() {
    var trash = App.db.listTrash(state.workspaceId);
    var known = {};
    trash.folders.forEach(function (f) { known['folder:' + f.id] = true; });
    trash.notes.forEach(function (n) { known['note:' + n.id] = true; });
    trash.files.forEach(function (f) { known['file:' + f.id] = true; });
    // A selection that points at something no longer listed is dropped here rather than
    // filtered at every use, so `trashSelected` is always a set of live rows.
    state.trashSelected = (state.trashSelected || []).filter(function (id) { return known[id]; });
    return {
      trash: trash,
      selected: state.trashSelected,
      view: state.trashView,
      term: state.trashTerm,
      paths: folderPaths(),
      cascadeIds: cascadeHiddenIds(trash),
      folderCounts: folderContentCounts(trash),
    };
  }

  function refreshTrash() {
    if (!trashPanel || !trashPanel.__refresh) return;
    trashPanel.__refresh(trashModel());
  }

  function openTrash() {
    if (trashPanel) return;
    flushPendingSave();

    // Every open starts from a full list: a filter left over from last time would hide
    // rows, and a panel that silently omits items is the one thing a trash view must not
    // do. The selection is cleared for the same reason — ids that are no longer listed
    // would otherwise sit in a bulk action.
    state.trashView = 'all';
    state.trashTerm = '';
    state.trashSelected = [];

    App.ui.dialog({
      title: 'Trash',
      fullscreen: true,
      // The panel draws its own header. The shell's header would put a second
      // "Trash" and a second close control on screen, the first of them outside the
      // surface the reader is looking at, which reads as leftover chrome rather than
      // as a way out.
      hideHeader: true,
      hideFooter: true,
      // The panel now fills the viewport, so there is no backdrop strip left to click —
      // but the setting stays explicit: a list you are halfway through must never be
      // dismissed by a click that misses a row.
      closeOnBackdrop: false,
      focus: '#trash-search',
      onOpen: function (api) {
        App.ui.renderTrashPanel(api.body, Object.assign(trashModel(), {
          onToggle: toggleTrashSelect,
          onSelectAll: selectAllTrash,
          onView: setTrashView,
          onSearch: setTrashSearch,
          onClose: closeTrash,
        }));
        trashPanel = api.body;
        trashPanel.__close = api.close;
      },
    }).then(function () {
      trashPanel = null;
      // Anything restored or purged while the panel was open has to be reflected in the
      // tree, the pane and the footer, all of which were frozen behind it.
      if (state.workspaceId) {
        render();
        renderFooter();
      }
    });
  }

  function closeTrash() {
    if (trashPanel && trashPanel.__close) trashPanel.__close(null);
  }

  function setTrashView(view) {
    state.trashView = view;
    refreshTrash();
  }

  function setTrashSearch(term) {
    state.trashTerm = String(term || '');
    refreshTrash();
  }

  function toggleTrashSelect(id, checked) {
    var next = state.trashSelected.filter(function (x) { return x !== id; });
    if (checked !== false) next.push(id);
    state.trashSelected = next;
    refreshTrash();
  }

  function selectAllTrash(ids, checked) {
    var set = {};
    state.trashSelected.forEach(function (id) { set[id] = true; });
    (ids || []).forEach(function (id) {
      if (checked === false) delete set[id];
      else set[id] = true;
    });
    state.trashSelected = Object.keys(set);
    refreshTrash();
  }

  function clearTrashSelection() {
    state.trashSelected = [];
    refreshTrash();
  }

  /** Split the `kind:id` keys into what the database layer wants. */
  function parseTrashIds(ids) {
    var out = { folders: [], notes: [], files: [] };
    (ids || []).forEach(function (key) {
      var parts = String(key).split(':');
      var kind = parts[0];
      var id = parts.slice(1).join(':');
      if (kind === 'folder') out.folders.push(id);
      else if (kind === 'note') out.notes.push(id);
      else if (kind === 'file') out.files.push(id);
    });
    return out;
  }

  /** Children of every folder in `set`, so a selection is closed under its own cascade. */
  /** Describe exactly what a permanent delete removes, before it happens. */
  function purgeSummary(ids) {
    var parsed = parseTrashIds(ids);
    var trash = App.db.listTrash(state.workspaceId);
    var records = [];
    trash.folders.forEach(function (f) { if (parsed.folders.indexOf(f.id) !== -1) records.push({ kind: 'folder', id: f.id, folder_id: f.parent_folder_id }); });
    trash.notes.forEach(function (n) { if (parsed.notes.indexOf(n.id) !== -1) records.push({ kind: 'note', id: n.id, folder_id: n.folder_id }); });
    trash.files.forEach(function (f) { if (parsed.files.indexOf(f.id) !== -1) records.push({ kind: 'file', id: f.id, folder_id: f.folder_id }); });

    // Deleting a folder takes its subtree with it, so the count that goes in the confirm
    // has to be the count of what actually disappears, not the number of rows ticked.
    var set = {};
    records.forEach(function (r) { set[r.kind + ':' + r.id] = true; });
    if (records.some(function (r) { return r.kind === 'folder'; })) {
      records.forEach(function (record) {
        if (record.kind === 'folder') {
          App.db.descendantFolderIdsAll(record.id).forEach(function (id) { set['folder:' + id] = true; });
        } else if (record.folder_id) {
          App.db.descendantFolderIdsAll(record.folder_id).forEach(function (id) { set['folder:' + id] = true; });
        }
      });
    }

    var counted = { folders: [], notes: [], files: [] };
    Object.keys(set).forEach(function (key) {
      var parts = key.split(':');
      counted[parts[0] === 'folder' ? 'folders' : parts[0] === 'note' ? 'notes' : 'files'].push(parts.slice(1).join(':'));
    });

    var bytes = 0;
    trash.files.forEach(function (f) {
      if (counted.files.indexOf(f.id) !== -1) bytes += Number(f.size) || 0;
    });
    var total = counted.folders.length + counted.notes.length + counted.files.length;
    return {
      records: records,
      folders: counted.folders.length,
      notes: counted.notes.length,
      files: counted.files.length,
      bytes: bytes,
      // Named only when the count exceeds what was ticked: a confirm that lists more
      // than the user selected has to be able to say why.
      expanded: total > records.length,
    };
  }

  function confirmPurge(ids, onDone) {
    var summary = purgeSummary(ids);
    if (!summary.records.length) return;

    var anything = summary.folders + summary.notes + summary.files;
    var consequences = [];
    if (summary.folders) consequences.push(summary.folders + ' folder' + (summary.folders === 1 ? '' : 's') + '.');
    if (summary.notes) consequences.push(summary.notes + ' note' + (summary.notes === 1 ? '' : 's') + ' and their text.');
    if (summary.files) {
      consequences.push(summary.files + ' stored file' + (summary.files === 1 ? '' : 's')
        + (summary.bytes ? ' (' + util.formatBytes(summary.bytes) + ')' : '') + '.');
    }
    // Ticking a folder removes its whole subtree, so the count can exceed what was
    // selected. Saying why is the difference between a confirm and a surprise.
    if (summary.expanded) {
      consequences.push('That is more than the ' + summary.records.length + ' you selected, '
        + 'because a folder takes everything inside it.');
    }
    consequences.push('There is no copy anywhere else, and this cannot be undone.');
    consequences.push('Export the database from Settings first if any of it matters.');

    App.ui.dialog({
      title: anything === 1 ? 'Delete this permanently?' : 'Delete ' + anything + ' items permanently?',
      icon: 'warning',
      danger: true,
      message: 'These leave the trash for good. Nothing here can be restored afterwards.',
      consequences: consequences,
      confirmLabel: 'Delete permanently',
      cancelLabel: 'Keep in trash',
    }).then(function (ok) {
      if (!ok) return;

      // A busy dialog while the writes land. The whole database is re-serialised and
      // pushed to IndexedDB by each write, so a purge of 40 items is 40 snapshots and
      // does take a moment; without this the panel would look frozen and a second click
      // would queue a second purge.
      var busy = null;
      App.ui.dialog({
        title: 'Removing ' + anything + ' item' + (anything === 1 ? '' : 's') + '\u2026',
        message: 'Writing the change to your database.',
        hideFooter: true,
        closeOnBackdrop: false,
        focus: false,
        onOpen: function (api) { busy = api; },
      });

      var jobs = summary.records.map(function (record) {
        if (record.kind === 'folder') return App.db.permanentDeleteFolder(record.id);
        if (record.kind === 'note') return App.db.permanentDeleteNote(record.id);
        return App.db.permanentDeleteFile(record.id);
      });

      Promise.all(jobs).then(function () {
        state.trashSelected = [];
        if (busy) busy.close(null);
        util.toast('Permanently deleted ' + anything + ' item' + (anything === 1 ? '' : 's') + '.', 'info');
        if (typeof onDone === 'function') onDone();
      }).catch(function (err) {
        if (busy) busy.close(null);
        util.toast('Permanent delete failed: ' + err.message, 'error');
      });
    });
  }

  function restoreTrashItems(ids) {
    var parsed = parseTrashIds(ids);
    if (!parsed.folders.length && !parsed.notes.length && !parsed.files.length) return;

    var jobs = [];
    parsed.folders.forEach(function (id) { jobs.push(App.db.restoreFolder(id)); });
    parsed.notes.forEach(function (id) { jobs.push(App.db.restoreWithAncestors('note', id)); });
    parsed.files.forEach(function (id) { jobs.push(App.db.restoreWithAncestors('file', id)); });

    var total = ids.length;
    Promise.all(jobs).then(function () {
      state.trashSelected = [];
      util.toast('Restored ' + total + ' item' + (total === 1 ? '' : 's') + ' to the workspace.', 'success');
      refreshTrash();
      render();
      renderFooter();
    }).catch(function (err) {
      util.toast('Restore failed: ' + err.message, 'error');
    });
  }

  function deleteTrashItem(id) {
    confirmPurge([id], function () { refreshTrash(); render(); renderFooter(); });
  }

  function emptyTrash() {
    var trash = App.db.listTrash(state.workspaceId);
    var all = trash.folders.map(function (f) { return 'folder:' + f.id; })
      .concat(trash.notes.map(function (n) { return 'note:' + n.id; }))
      .concat(trash.files.map(function (f) { return 'file:' + f.id; }));
    if (!all.length) {
      util.toast('The trash is already empty.', 'info');
      return;
    }
    confirmPurge(all, function () { refreshTrash(); render(); renderFooter(); });
  }

  function openTrashContextMenu(event, entries) {
    App.ui.trashContextMenu({
      x: event.clientX,
      y: event.clientY,
      entries: entries,
      onRestore: function (ids) { restoreTrashItems(ids); },
      onPurge: function (ids) {
        confirmPurge(ids, function () { refreshTrash(); render(); renderFooter(); });
      },
    });
  }

  /** One entry for the row the pointer is on, or every selected row if it is part of one. */
  function trashEntriesFor(rowNode) {
    var id = rowNode.getAttribute('data-trash-id');
    var selectedRows = Array.prototype.slice.call(
      document.querySelectorAll('.trash-row.is-selected[data-trash-id]')
    );
    var rows = (state.trashSelected.indexOf(id) !== -1 && selectedRows.length > 1)
      ? selectedRows
      : [rowNode];
    return rows.map(function (node) {
      return { id: node.getAttribute('data-trash-id'), label: node.getAttribute('data-label') };
    });
  }

  // --------------------------------------------------------------- file actions
  function openFile(id) {
    flushPendingSave();
    // A hit in another workspace takes the reader there before the file opens. See above.
    var meta = App.db.getFileMeta(id);
    if (meta) adoptWorkspaceOf(meta.workspace_id);
    state.view = 'notes';
    state.activeNoteId = null;
    state.activeFileId = id;
    render();
  }

  function downloadFile(id) {
    var resolved;
    try {
      resolved = App.db.getFileBlob(id);
    } catch (err) {
      util.toast('Could not read the file: ' + err.message, 'error');
      return;
    }
    if (!resolved) return;
    var url = URL.createObjectURL(resolved.blob);
    var link = el('a', { href: url, download: resolved.filename });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke on the next tick; revoking synchronously can cancel the download.
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function openFileInTab(id) {
    var resolved;
    try {
      resolved = App.db.getFileBlob(id);
    } catch (err) {
      util.toast('Could not read the file: ' + err.message, 'error');
      return;
    }
    if (!resolved) return;
    var url = URL.createObjectURL(resolved.blob);
    var win = null;
    try {
      win = window.open(url, '_blank');
    } catch (err) {
      win = null;
    }
    // Chrome refuses blob: URLs opened from a file:// document, so fall back to a download
    // rather than leaving the user with a dead button.
    if (!win) {
      URL.revokeObjectURL(url);
      util.toast('This browser will not open local files in a tab here. Downloading instead.', 'info');
      downloadFile(id);
      return;
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function renameFile(id) {
    var meta = App.db.getFileMeta(id);
    if (!meta) return;
    App.ui.prompt({
      title: 'Rename file',
      icon: 'file',
      label: 'File name',
      value: meta.filename,
      confirmLabel: 'Rename',
    }).then(function (next) {
      if (next === null) return;
      App.db.renameFile(id, next).then(render).catch(function (err) {
        util.toast('Rename failed: ' + err.message, 'error');
      });
    });
  }

  function deleteFile(id) {
    var meta = App.db.getFileMeta(id);
    if (!meta) return;
    App.ui.dialog({
      title: 'Delete this file?',
      icon: 'trash',
      danger: true,
      message: '\u201c' + meta.filename + '\u201d will be removed from the database.',
      consequences: [
        'The stored attachment (' + util.formatBytes(meta.size) + ') is deleted with it.',
        'Deleting cannot be undone.',
      ],
      confirmLabel: 'Delete file',
    }).then(function (ok) {
      if (!ok) return;
      App.db.deleteFile(id).then(function () {
        if (state.activeFileId === id) state.activeFileId = null;
        util.toast('File deleted.', 'info');
        render();
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }

  /**
   * Read a File into a Uint8Array and store it as a BLOB.
   * ArrayBuffer is used rather than FileReader.readAsDataURL so the bytes go into SQLite
   * exactly as they came off disk (no 33% base64 inflation before the value is even bound).
   */
  function uploadFiles(fileList, folderId) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var done = 0;
    App.ui.setUploadStatus('Uploading 0/' + files.length + '\u2026');

    files.forEach(function (file) {
      uploadQueue = uploadQueue.then(function () {
        return file.arrayBuffer().then(function (buffer) {
          return App.db.addFile(
            state.workspaceId,
            folderId || null,
            file.name,
            file.type || guessMime(file.name),
            new Uint8Array(buffer)
          );
        });
      }).then(function () {
        done++;
        App.ui.setUploadStatus(done < files.length ? 'Uploading ' + done + '/' + files.length + '\u2026' : '');
        if (done === files.length) {
          if (folderId) state.expanded[folderId] = true;
          util.toast(files.length === 1 ? 'Added \u201c' + files[0].name + '\u201d.' : 'Added ' + files.length + ' files.', 'success');
          render();
          renderFooter();
        }
      }).catch(function (err) {
        done++;
        App.ui.setUploadStatus('');
        util.toast('Upload of \u201c' + file.name + '\u201d failed: ' + err.message, 'error', 9000);
      });
    });
    return uploadQueue;
  }

  /** Minimal extension fallback for the (common) case of an empty File.type. */
  function guessMime(name) {
    var ext = String(name).split('.').pop().toLowerCase();
    var table = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
      pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
      csv: 'text/csv', json: 'application/json', html: 'text/html',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword', zip: 'application/zip',
    };
    return table[ext] || 'application/octet-stream';
  }

  // ------------------------------------------------------------ workspace actions
  function switchWorkspace(id) {
    flushPendingSave();
    // The workspace being left remembers where the reader was in it, and the one being entered
    // puts them back where they were there.
    savePlace();
    state.workspaceId = id;
    state.selection = { type: 'all', id: null };
    state.activeNoteId = null;
    state.activeFileId = null;
    state.expanded = {};
    state.searchTerm = '';
    if (dom.searchInput) dom.searchInput.value = '';
    App.prefs.set('lastWorkspaceId', id);
    restorePlace(id);
    render();
    renderFooter();
  }

  function addWorkspace() {
    App.ui.prompt({
      title: 'New workspace',
      icon: 'layers',
      label: 'Workspace name',
      value: 'Workspace',
      helper: 'A workspace has its own folders, notes and files. Search covers all of them.',
      confirmLabel: 'Create workspace',
    }).then(function (name) {
      if (name === null) return;
      App.db.createWorkspace(name).then(function (ws) {
        return refreshWorkspaces().then(function () { switchWorkspace(ws.id); });
      }).catch(function (err) {
        util.toast('Could not create the workspace: ' + err.message, 'error');
      });
    });
  }

  function renameWorkspace() {
    var ws = currentWorkspace();
    if (!ws) return;
    App.ui.prompt({
      title: 'Rename workspace',
      icon: 'layers',
      label: 'Workspace name',
      value: ws.name,
      confirmLabel: 'Rename',
    }).then(function (next) {
      if (next === null) return;
      App.db.renameWorkspace(ws.id, next).then(refreshWorkspaces).then(render).catch(function (err) {
        util.toast('Rename failed: ' + err.message, 'error');
      });
    });
  }

  function deleteWorkspace() {
    var ws = currentWorkspace();
    if (!ws) return;
    var counts = App.db.counts(ws.id);

    // Everything in a workspace goes at once, so this one asks the user to type the
    // name: an irreversible bulk delete should not be a single reflex click.
    var consequences = [];
    if (counts.notes) consequences.push(counts.notes + ' note' + (counts.notes === 1 ? '' : 's') + ' in this workspace.');
    if (counts.folders) consequences.push(counts.folders + ' folder' + (counts.folders === 1 ? '' : 's') + ' and everything nested inside them.');
    if (counts.files) consequences.push(counts.files + ' stored attachment' + (counts.files === 1 ? '' : 's') + '.');
    consequences.push('Other workspaces are not affected.');

    App.ui.dialog({
      title: 'Delete \u201c' + ws.name + '\u201d?',
      icon: 'warning',
      danger: true,
      message: 'This erases the workspace and everything in it. It cannot be undone.',
      consequences: consequences,
      gate: { label: 'Type the workspace name to confirm:', phrase: ws.name },
      confirmLabel: 'Delete workspace',
      onSubmit: function () {
        saveOpenNote.cancel();
        return App.db.deleteWorkspace(ws.id).then(function () {
          state.workspaceId = null;
          state.selection = { type: 'all', id: null };
          state.activeNoteId = null;
          state.activeFileId = null;
          state.expanded = {};
          return refreshWorkspaces();
        }).then(render);
      },
    }).catch(function (err) {
      util.toast('Delete failed: ' + err.message, 'error');
    });
  }

  // ---------------------------------------------------------------- search & view
  var runSearch = util.debounce(function (term) {
    state.searchTerm = term;
    // Search is a notebook answer, and its hits are drawn as notebook rows; a query typed
    // while the task list is in front is asking about notes and files, so the pane follows
    // the question.
    state.view = 'notes';
    render();
  }, 180);

  function focusEditorTitle() {
    var input = document.getElementById('note-title');
    if (input) {
      input.focus();
      input.select();
    }
  }

  // -------------------------------------------------------------------- settings
  function openSettings() {
    var info = storageInfo();

    App.ui.renderStorageInfo(dom.storageInfo, info);
    // The vault state is a fact about the database, not about this dialog, so it is read the
    // same way: fresh, every time the panel opens, rather than left from the last time.
    renderVaultSection();
    // The palette can be changed from more than one place in principle, so the dialog reads
    // the live attribute every time it opens instead of trusting what it left selected.
    syncPaletteControl();
    if (typeof dom.settingsDialog.showModal === 'function') dom.settingsDialog.showModal();
    else dom.settingsDialog.setAttribute('open', '');

    // The quota takes a tick to come back from the browser. When it lands, the panel and
    // the rail readout are both refreshed from the same object, so they cannot disagree.
    App.storage.estimate().then(function (est) {
      if (!est) return;
      state.estimate = est;
      var next = storageInfo();
      App.ui.renderStorageInfo(dom.storageInfo, next);
      renderFooter();
    });
  }

  function closeSettings() {
    if (typeof dom.settingsDialog.close === 'function') dom.settingsDialog.close();
    else dom.settingsDialog.removeAttribute('open');
  }

  /**
   * The one and only export path. Writes the raw SQLite bytes to disk — no transformation,
   * so the file is the database itself.
   */
  function exportDatabase() {
    try {
      var bytes = App.db.exportBytes();
      var blob = new Blob([bytes], { type: 'application/vnd.sqlite3' });
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      var url = URL.createObjectURL(blob);
      var link = el('a', { href: url, download: 'notes-' + stamp + '.db' });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      util.toast('Exported ' + util.formatBytes(bytes.length) + ' of SQLite data.', 'success');
    } catch (err) {
      util.toast('Export failed: ' + err.message, 'error');
    }
  }

  /**
   * The most destructive action in the app: every workspace, note and attachment in this
   * browser. Guarded by a typed phrase rather than two stacked "are you sure" prompts,
   * with the concrete losses listed and the backup route named in the same dialog.
   */
  function resetEverything() {
    var totals = App.db.listWorkspaces().reduce(function (acc, ws) {
      var c = App.db.counts(ws.id);
      acc.notes += c.notes;
      acc.folders += c.folders;
      acc.files += c.files;
      return acc;
    }, { notes: 0, folders: 0, files: 0 });

    closeSettings();

    App.ui.dialog({
      title: 'Delete everything?',
      icon: 'warning',
      danger: true,
      message: 'Every workspace in this browser is erased and the page reloads with an empty notebook.',
      consequences: [
        totals.notes + ' note' + (totals.notes === 1 ? '' : 's') + ', ' + totals.folders + ' folder' + (totals.folders === 1 ? '' : 's') + ' and ' + totals.files + ' stored file' + (totals.files === 1 ? '' : 's') + ' will be gone.',
        'This cannot be undone, and there is no server-side copy to restore from.',
        'Close this and use Export .db first if any of it matters.',
      ],
      gate: { label: 'Type', phrase: 'delete everything' },
      confirmLabel: 'Delete everything',
      cancelLabel: 'Keep my data',
      onSubmit: function () {
        return App.storage.clear().then(function () {
          Object.keys(window.localStorage)
            .filter(function (k) { return k.indexOf('noteapp.') === 0; })
            .forEach(function (k) { window.localStorage.removeItem(k); });
          App.db.destroy();
          window.location.reload();
        });
      },
    }).catch(function (err) {
      util.toast('Reset failed: ' + err.message, 'error');
    });
  }

  // ---------------------------------------------------------------------- vault
  /**
   * The shortest password this app will accept.
   *
   * PBKDF2 makes each guess expensive, but nothing makes a four-character password good, and
   * the only party who pays for a weak one is the person who chose it. The dialog states the
   * rule and the reason rather than silently accepting anything.
   */
  var MIN_PASSWORD = 8;

  /** Repaint the Security section from the database. Cheap enough to call after every change. */
  function renderVaultSection() {
    if (!dom.vaultInfo || !dom.vaultActions) return;
    App.ui.renderVaultSection(dom.vaultInfo, dom.vaultActions, App.db.vaultInfo());
  }

  /** A password field, using the dialog builder's own label/field/error contract. */
  function passwordField(label, helper, autocomplete) {
    return App.ui.field({
      label: label,
      type: 'password',
      autocomplete: autocomplete || 'off',
      helper: helper,
    });
  }

  /**
   * Clear the error paragraph the dialog builder appended on a previous failed attempt.
   *
   * The builder puts a failure at the end of the dialog body, which is the right place when it
   * owns the only field. These dialogs put their own fields in the body, so that paragraph is
   * appended after them — correct position, but a fresh one on every attempt, and two copies of
   * one error message reads as two problems.
   */
  function clearDialogError(host) {
    if (!host) return;
    Array.prototype.slice.call(host.children).forEach(function (node) {
      if (String(node.className || '').indexOf('field__message--error') !== -1) host.removeChild(node);
    });
  }

  /**
   * A modal, non-dismissable progress dialog around a bulk vault operation.
   *
   * Both conversions touch every row in the database and can take a visible moment, so the
   * panel says what is happening and cannot be dismissed out from under the work: a backdrop
   * click while every note is being rewritten is not a decision anyone means to make. The
   * dialog is closed by this function, on success or on failure, so a failed conversion cannot
   * leave a progress panel sitting over the app forever.
   */
  function runVaultConversion(title, job) {
    var fill = el('div', { class: 'progress__bar' });
    var label = el('p', { class: 'dialog__note', text: 'Preparing\u2026' });
    var api = null;

    App.ui.dialog({
      title: title,
      icon: 'database',
      message: 'Every stored note body and file is rewritten in one transaction. Leave this tab open until it finishes.',
      body: el('div', { class: 'progress-block' }, [el('div', { class: 'progress' }, [fill]), label]),
      hideFooter: true,
      closeOnBackdrop: false,
      focus: false,
      onOpen: function (open) { api = open; },
    });

    function report(done, total) {
      if (total) {
        fill.style.width = Math.round((done / total) * 100) + '%';
        label.textContent = 'Processed ' + done + ' of ' + total + ' records\u2026';
      } else {
        fill.style.width = '100%';
        label.textContent = 'Working\u2026';
      }
    }

    return Promise.resolve(job(report)).then(function (result) {
      if (api) api.close(null);
      return result;
    }, function (err) {
      if (api) api.close(null);
      throw err;
    });
  }

  /**
   * Turn encryption on.
   *
   * The two password fields are checked here rather than by the dialog builder, because the
   * builder owns one field and this asks for two. The statement about what happens if the
   * password is lost is in the consequences list, in the same words the danger dialogs use,
   * because it is the same kind of fact: there is no copy anywhere else.
   */
  function enableVaultFlow() {
    if (!App.crypto.isSupported()) {
      util.toast(App.crypto.unsupportedMessage(), 'error', 9000);
      return;
    }
    /**
     * The one place the success is reported, so the state and the Settings section are redrawn
     * identically however the conversion ended. It is a function rather than three calls in the
     * success handler because the failure path has to redraw too, and a second copy of them is a
     * second chance for one of them to be missed.
     */
    function afterEnable(result) {
      // Enabling encryption ends LOCKED: the key that did the sealing is dropped as the last
      // step of the flow, so the notebook is protected from the moment it is encrypted rather
      // than from the next reload. Without this the session that chose the password is the one
      // session that never has to prove it — the lock was real, but only after a reload.
      App.db.lockVault();
      render();
      renderFooter();
      renderVaultSection();
      util.toast('Encryption is on. ' + result.notes + ' note bod'
        + (result.notes === 1 ? 'y' : 'ies') + ' and ' + result.files + ' file'
        + (result.files === 1 ? '' : 's') + ' were encrypted, and the notebook is locked. '
        + 'Unlock it with your password to read them.', 'success', 12000);
    }

    var first = passwordField('Password', 'At least ' + MIN_PASSWORD + ' characters. It is not stored anywhere, and it cannot be recovered.', 'new-password');
    var again = passwordField('Password again', 'Spaces at the start and end are ignored.');
    var dialogBody = null;

    App.ui.dialog({
      title: 'Turn on encryption',
      icon: 'database',
      wide: true,
      message: 'Note bodies and stored files will be encrypted with a password you choose.',
      consequences: [
        'A forgotten password cannot be recovered: the encrypted bodies and files would be unreadable for good.',
        'Titles, file names, folder names, dates and sizes stay readable, which is what still lets you browse and search.',
        'The browser keeps its own copies of this database as it rewrites it, and reclaims them on its own schedule, so an earlier unencrypted copy may remain on this device until it does.',
        'Every note body and stored file is rewritten now, in one transaction. If it fails, the notebook is left exactly as it was.',
        'The notebook locks the moment encryption is on: reading the notes again asks for this password.',
        'One unlock is remembered for this tab, so a reload inside it stays unlocked; closing the tab locks the notebook again.',
      ],
      body: el('div', { class: 'field-stack' }, [first.root, again.root]),
      focus: first.input,
      confirmLabel: 'Encrypt this notebook',
      onOpen: function (api) { dialogBody = api.body; },
      onSubmit: function () {
        clearDialogError(dialogBody);
        var password = first.input.value.trim();
        if (password.length < MIN_PASSWORD) {
          return Promise.reject(new Error('Use at least ' + MIN_PASSWORD + ' characters. This password is the whole protection, so its length is what matters most.'));
        }
        if (password !== again.input.value.trim()) {
          return Promise.reject(new Error('The two passwords do not match.'));
        }
        // The last keystrokes must be in the database before the conversion reads it.
        // db.enableVault() waits for the write queue itself; flushing here is what stops the
        // 500 ms debounce from holding those keystrokes back until after the conversion.
        flushPendingSave();
        return runVaultConversion('Encrypting this notebook\u2026', function (report) {
          return App.db.enableVault(password, report);
        }).then(function (result) {
          afterEnable(result);
        }, function (err) {
          // Redrawn on BOTH paths, and the vault state read back out of the database rather than
          // inferred from the error. Past the commit the notebook IS encrypted and unlocked, so a
          // Settings section still reading "Encryption Off" over it would be a lie about the
          // user's own data, which is the one thing this panel must never print. When the
          // conversion stood, the failure is a warning and the dialog closes; when nothing was
          // changed, the error is rethrown so the dialog keeps it in front of the field.
          render();
          renderFooter();
          renderVaultSection();
          if (App.db.vaultState() === 'off') throw err;
          // Past the commit the notebook IS encrypted, and locked: the key is dropped here as
          // well, so what the toast says about the user's data stays true even on this path.
          App.db.lockVault();
          render();
          renderFooter();
          renderVaultSection();
          util.toast('Encryption is on, but the last step did not finish ('
            + err.message + '). Nothing was undone: the notebook is encrypted and locked.',
            'error', 14000);
        });
      },
    });
  }

  /**
   * Unlock, wherever it was asked from: the editor's lock notice, a file's, or Settings.
   *
   * The password goes straight to the data layer, which derives the key and proves it against
   * the vault's check string. A wrong password rejects, and the dialog builder writes that
   * rejection under the field it came from — which is why nothing here compares a password to
   * anything.
   */
  function unlockVaultFlow(reason) {
    if (!App.crypto.isSupported()) {
      util.toast(App.crypto.unsupportedMessage(), 'error', 9000);
      return Promise.resolve(false);
    }
    if (!App.crypto.isActive()) {
      util.toast('This notebook is not encrypted.', 'info');
      return Promise.resolve(false);
    }

    return App.ui.dialog({
      title: 'Unlock this notebook',
      icon: 'database',
      message: reason || 'Note bodies and stored files are encrypted. Enter your password to read them.',
      input: {
        label: 'Password',
        type: 'password',
        placeholder: 'Your notebook password',
        autocomplete: 'current-password',
        helper: 'Spaces at the start and end are ignored.',
        requireValue: true,
        emptyMessage: 'Enter your password to unlock.',
      },
      confirmLabel: 'Unlock',
      onSubmit: function (password) {
        return runVaultConversion('Unlocking\u2026', function (report) {
          return App.db.unlockVault(password, report);
        }).then(function (result) {
          render();
          renderFooter();
          renderVaultSection();
          if (result.failures.length) {
            // The key is right — the check string proved it — so this is damage, and it is
            // named rather than passed off as an empty note.
            util.toast(result.failures.length + ' stored record'
              + (result.failures.length === 1 ? '' : 's') + ' could not be read and '
              + (result.failures.length === 1 ? 'is' : 'are') + ' shown as damaged. Everything else is readable.',
              'error', 12000);
          } else {
            util.toast('Notebook unlocked. It stays unlocked in this tab until you lock it or close the tab.', 'success');
          }
        });
      },
    }).then(function (value) { return value === true; });
  }

  /**
   * Lock now.
   *
   * The pending autosave is flushed FIRST, and that order is the whole correctness of this
   * function: the debounced save encrypts with the key at the moment it is called, so letting
   * it run after the key was dropped would either reject or, worse, be the one write that
   * slipped through unencrypted. A page reload locks the notebook in exactly the same way —
   * nothing about the key survives a load, by design.
   */
  function lockVaultFlow() {
    flushPendingSave();
    App.db.lockVault();
    render();
    renderFooter();
    renderVaultSection();
    util.toast('Notebook locked. Note bodies and files stay unreadable until you unlock again.', 'info', 7000);
  }

  /** Turn encryption off. The password is required even when the notebook is already open. */
  function disableVaultFlow() {
    if (!App.crypto.isSupported()) {
      util.toast(App.crypto.unsupportedMessage(), 'error', 9000);
      return;
    }
    var field = passwordField('Password', 'Required to turn encryption off.');
    var dialogBody = null;

    App.ui.dialog({
      title: 'Turn off encryption',
      icon: 'warning',
      danger: true,
      message: 'Every note body and stored file is written back as plaintext, and the vault key is deleted.',
      consequences: [
        'The database \u2014 and any .db file you export \u2014 will hold readable note text and file contents again.',
        'Your password is required to confirm, even while the notebook is unlocked.',
        'No note and no file is deleted; only the encryption is removed.',
      ],
      body: el('div', { class: 'field-stack' }, [field.root]),
      focus: field.input,
      confirmLabel: 'Turn off encryption',
      onOpen: function (api) { dialogBody = api.body; },
      onSubmit: function () {
        clearDialogError(dialogBody);
        var password = field.input.value.trim();
        if (!password) return Promise.reject(new Error('Enter your password to turn encryption off.'));
        flushPendingSave();
        return runVaultConversion('Turning off encryption\u2026', function (report) {
          return App.db.disableVault(password, report);
        }).then(function (result) {
          render();
          renderFooter();
          renderVaultSection();
          util.toast('Encryption is off. ' + result.notes + ' note bod'
            + (result.notes === 1 ? 'y' : 'ies') + ' and ' + result.files + ' file'
            + (result.files === 1 ? '' : 's') + ' were written back as plaintext.', 'info', 9000);
        });
      },
    });
  }

  // ------------------------------------------------------------------- theming
  /** Swap a button's contents to a single icon from the app's set. */
  function setIcon(button, name, size) {
    if (!button) return;
    button.textContent = '';
    var node = App.ui.icon(name, size);
    if (node) button.appendChild(node);
  }

  /**
   * The six palettes the app ships, in the order the Settings chooser shows them.
   * 'indigo' is the default and is what the :root token block already declares, so it has
   * no override block in the stylesheet. Keeping the list here as well is what lets an
   * unknown name — an older build's palette, a hand-edited preference — resolve to the
   * default instead of to an attribute no rule matches.
   */
  var PALETTES = ['indigo', 'teal', 'amber', 'rose', 'violet', 'graphite'];

  /**
   * The tab icon is the one piece of the brand that lives outside the document: the
   * browser paints it from the SVG in the link's href, so it can never inherit a custom
   * property. Reading the resolved tokens out of getComputedStyle is what keeps the tab in
   * step with the palette *and* the mode instead of frozen at whatever the markup shipped.
   *
   * Every lookup is guarded: the link may be absent in a stripped-down build, and a custom
   * property that does not resolve comes back as the empty string, which would encode an
   * SVG with a hole where the colour should be. Leaving the existing icon alone is a better
   * failure than replacing it with a broken one.
   */
  function applyAppIcon() {
    var link = document.getElementById('app-icon');
    if (!link) return;
    var cs = window.getComputedStyle(document.documentElement);
    var accent = (cs.getPropertyValue('--accent') || '').trim();
    var inverse = (cs.getPropertyValue('--text-inverse') || '').trim();
    if (!accent || !inverse) return;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">' +
      '<rect width="22" height="22" rx="6" fill="' + accent + '"/>' +
      '<rect x="5.5" y="5.5" width="2" height="11" rx="1" fill="' + inverse + '"/>' +
      '<g fill="' + inverse + '" opacity="0.55">' +
        '<rect x="9.5" y="5.5" width="7" height="1"/>' +
        '<rect x="9.5" y="8.5" width="7" height="1"/>' +
        '<rect x="9.5" y="11.5" width="7" height="1"/>' +
        '<rect x="9.5" y="14.5" width="7" height="1"/>' +
      '</g>' +
    '</svg>';
    link.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    App.prefs.set('theme', theme);
    var dark = theme === 'dark';
    // The icon states what you will get by pressing it, matching the aria-label.
    setIcon(dom.themeToggle, dark ? 'sun' : 'moon', 16);
    if (dom.themeToggle) {
      dom.themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      dom.themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    // Dark redefines the accent, so the tab has to be redrawn here as well as in
    // applyPalette() — calling only one of the two leaves the tab a step behind the app.
    applyAppIcon();
  }

  /**
   * Select a palette. The attribute is normalised on the way in, so a value that is not in
   * PALETTES can never reach the document and the stored preference is always one the
   * stylesheet can actually paint.
   */
  function applyPalette(name) {
    var known = PALETTES.indexOf(name) === -1 ? 'indigo' : name;
    document.documentElement.setAttribute('data-palette', known);
    App.prefs.set('palette', known);
    applyAppIcon();
  }

  /**
   * Point the chooser at the palette the page is actually wearing. Read from the attribute
   * rather than remembered from the last click: the control then cannot disagree with the
   * document it describes, which is what a reopened dialog would otherwise do.
   */
  function syncPaletteControl() {
    if (!dom.paletteGroup) return;
    var live = document.documentElement.getAttribute('data-palette') || 'indigo';
    var inputs = dom.paletteGroup.querySelectorAll('input[type="radio"]');
    for (var i = 0; i < inputs.length; i++) inputs[i].checked = inputs[i].value === live;
  }

  function toggleTheme() {
    var now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(now);
  }

  /**
   * Fill in the markup that is pure iconography. Kept in one place so the shell HTML
   * stays readable and the icon set stays the single source for every glyph in the app.
   * Labels live in the markup (or in aria-label) and never depend on the icon.
   */
  function bootstrapIcons() {
    setIcon(document.getElementById('nav-toggle'), 'arrowLeft', 16);
    setIcon(document.getElementById('settings-open'), 'settings', 16);
    setIcon(document.getElementById('workspace-add'), 'plus', 15);
    // The corner trash control is icon-only; its count and visibility come from the
    // footer pass, because both depend on data that does not exist until the database
    // has opened.
    setIcon(document.getElementById('workspace-trash'), 'trash', 19);
    setIcon(document.getElementById('settings-close'), 'close', 15);
    // The sort control is icon-only; its label and its tooltip come from the live sort in
    // paintSortButton(), because both have to name the order that is currently showing.
    setIcon(dom.sortMenu, 'sort', 14);

    var settingsIcon = document.getElementById('settings-icon');
    if (settingsIcon) settingsIcon.appendChild(App.ui.icon('database'));

    var rename = document.getElementById('workspace-rename');
    if (rename) {
      rename.appendChild(App.ui.icon('pencil', 13.5));
      rename.appendChild(document.createTextNode('Rename'));
    }
    var remove = document.getElementById('workspace-delete');
    if (remove) {
      remove.appendChild(App.ui.icon('trash', 13.5));
      remove.appendChild(document.createTextNode('Delete'));
    }
  }

  // -------------------------------------------------------------- rail footer
  /**
   * How much is waiting in the trash of the workspace on screen.
   *
   * Scoped to the active workspace because that is exactly what the panel it opens lists: the
   * database-wide count showed a number over a panel with nothing in it the moment a second
   * workspace had something deleted — the one thing this badge must never do. It is not
   * `state.workspaces.map(listTrash)` either: that only sees workspaces the sidebar has
   * loaded, and answered zero over a panel with three items in it. The number is read from the
   * database, which sees every row.
   */
  function deletedCount() {
    try {
      return App.db.countTrash(state.workspaceId);
    } catch (err) {
      return 0;
    }
  }

  /**
   * The rail's floor: the two create actions plus a live storage readout.
   *
   * Deliberately *not* part of render(). The readout needs the size of the database, and
   * getting that means serialising the whole thing (`db.export()`), which render() would
   * otherwise do on every autosave burst — turning each keystroke into a full copy of the
   * database just to redraw a number. So the footer refreshes on the events that can
   * actually change it: boot, workspace switch, a completed upload, and anything the
   * trash panel did. The corner badge is much cheaper and is refreshed from render()
   * instead, so deleting one note lights it up immediately.
   */
  function renderFooter() {
    if (!dom.railActions || !dom.railStorage) return;
    App.ui.renderSidebarFooter({ actions: dom.railActions, storage: dom.railStorage }, {
      actions: dom.railActions,
      storage: dom.railStorage,
      info: storageInfo(),
    });
  }

  /**
   * The live facts the settings dialog renders. Kept in one place so the rail readout and
   * the panel behind it cannot disagree about what is stored.
   */
  function storageInfo() {
    var info = {
      backend: App.storage.backendName(),
      persistent: App.storage.isPersistent(),
      counts: { workspaces: state.workspaces.length, notes: 0, files: 0 },
      estimate: state.estimate,
      bytes: 0,
    };
    state.workspaces.forEach(function (ws) {
      var c = App.db.counts(ws.id);
      info.counts.notes += c.notes;
      info.counts.files += c.files;
    });
    try {
      info.bytes = App.db.exportBytes().length;
    } catch (err) {
      info.bytes = 0;
    }
    return info;
  }

  // --------------------------------------------------------------- event wiring
  var ACTIONS = {
    'select-all': function () {
      flushPendingSave();
      // Choosing something in the notebook is also choosing the notebook: staying on the
      // task list while a folder or a note is clicked would leave the reader looking at a
      // pane that ignores the thing they just pressed.
      state.view = 'notes';
      state.selection = { type: 'all', id: null };
      state.activeNoteId = null;
      state.activeFileId = null;
      render();
    },
    'select-folder': function (id) {
      flushPendingSave();
      // Asked before anything moves: "the reader is inside this folder" is a question about the
      // work that was in front of them when they pressed the row, not about the folder itself.
      var inside = holdsTheSelection(id);
      state.view = 'notes';
      state.selection = { type: 'folder', id: id };
      // The press moves the toggle to the folder itself: whatever inside it was open or selected
      // stops being the thing in front of the reader. That IS the interaction — the first press
      // takes the toggle off the folder's content, which is what leaves the folder closable by
      // the NEXT press, when nothing inside it is toggled any more. The pane follows the
      // selection, so it lands on the folder's contents rather than on the note it was showing.
      state.activeNoteId = null;
      state.activeFileId = null;
      // Clicking a folder also opens or closes it. The arrow is a 20px target; the row is
      // the whole width, and having to hit the arrow exactly to see what is in a folder is
      // the difference between a tree you browse and a tree you fight. The arrow stays as
      // the precision control that toggles *without* moving the selection.
      //
      // Opening always happens. Closing waits until nothing nested inside is toggled: a folder
      // that folded up over the row the reader was on would take that row, and their place in
      // the list, off the screen with it. Because this press is the one that takes the toggle
      // off the content, pressing it twice closes the folder and pressing it once never does.
      if (!(state.expanded[id] && inside)) state.expanded[id] = !state.expanded[id];
      render();
    },
    'toggle-folder': function (id) {
      // The precision control obeys the same rule, and it deliberately does not move the toggle
      // itself (that is its whole job). So while something inside is toggled the arrow only
      // opens: press the folder's row once to take the toggle off its content, and the arrow
      // closes the folder from the second press on.
      if (state.expanded[id] && holdsTheSelection(id)) return;
      state.expanded[id] = !state.expanded[id];
      render();
    },
    'open-note': function (id) { openNote(id); },
    'open-file': function (id) { openFile(id); },
    'new-note': function () { newNote(); },
    'new-folder': function () { newFolder(null); },
    'new-subfolder': function () { newFolder(state.selection.type === 'folder' ? state.selection.id : null); },
    'upload-file': function () { dom.fileInput.click(); },
    'rename-note': function () { if (state.activeNoteId) renameNote(state.activeNoteId); },
    'delete-note': function () { if (state.activeNoteId) deleteNote(state.activeNoteId); },
    'rename-folder': function () { if (state.selection.type === 'folder') renameFolder(state.selection.id); },
    'move-folder': function () { if (state.selection.type === 'folder') moveFolder(state.selection.id); },
    'delete-folder': function () { if (state.selection.type === 'folder') deleteFolder(state.selection.id); },
    'download-file': function (id) { downloadFile(id); },
    'open-file-tab': function (id) { openFileInTab(id); },
    'rename-file': function (id) { renameFile(id); },
    'delete-file': function (id) { deleteFile(id); },
    'view-trash': function () { openTrash(); },
    'close-trash': function () { closeTrash(); },
    'clear-trash-selection': function () { clearTrashSelection(); },
    'restore-selected-trash': function () { restoreTrashItems(state.trashSelected); },
    'delete-selected-trash': function () {
      confirmPurge(state.trashSelected, function () { refreshTrash(); render(); });
    },
    'restore-trash-item': function (id) { restoreTrashItems([id]); },
    'delete-trash-item': function (id) { deleteTrashItem(id); },
    'empty-trash': function () { emptyTrash(); },
    'open-settings': function () { openSettings(); },
    // The four vault actions. Every one of them is reached through this map — the Settings
    // buttons and the lock notice's Unlock button both carry a data-action — so there is one
    // implementation of each and no path that quietly skips the password.
    'vault-enable': function () { enableVaultFlow(); },
    'vault-disable': function () { disableVaultFlow(); },
    'vault-lock': function () { lockVaultFlow(); },
    'vault-unlock': function () { unlockVaultFlow(); },
    'toggle-nav': function () { showMobilePane('list'); },
    'sort-menu': function () { openSortMenu(); },
    // Pressing the rail's task row again hands the pane back to the notebook. A view that
    // could only be entered and never left would make the rail row a one-way door.
    'view-tasks': function () { showTasks(state.view !== 'tasks'); },
    // The Add button beside the quick-add field: the same filing, reached by hand.
    'add-task': function () { addTaskFromQuickAdd(); },
    'task-edit': function (id) { editTask(id); },
    'task-delete': function (id) { deleteTask(id); },
  };

  /** One delegated listener handles every [data-action] element in the app. */
  function onActionClick(event) {
    var node = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!node) return;
    var action = node.getAttribute('data-action');
    var handler = ACTIONS[action];
    if (!handler) return;
    event.preventDefault();
    handler(node.getAttribute('data-id'));
  }

  /**
   * The tree's twisty is a <button> nested inside a clickable row. Both would otherwise
   * fire on one press: the folder would toggle twice (once from the row, once from the
   * arrow) and also change the selection. Handle it here and stop the event, because the
   * arrow's whole purpose is the narrower intent: toggle this folder and leave the
   * selection where it is.
   */
  function onTreePointerDown(event) {
    var twisty = event.target.closest ? event.target.closest('.tree__twisty[data-action]') : null;
    if (!twisty) return;
    event.preventDefault();
    event.stopPropagation();
    ACTIONS['toggle-folder'](twisty.getAttribute('data-id'));
  }

  // ------------------------------------------------------------- context menu
  /**
   * Right-click.
   *
   * The browser's own menu is suppressed everywhere except inside text fields, where its
   * cut/copy/paste and spelling items are the ones the user actually wants; putting app
   * actions there instead would remove working functionality to add convenience.
   *
   * Everything an element can do is already expressed as a `data-action` attribute, and
   * the delegated click listener above is what executes those. So the menu does not carry
   * behaviour of its own: it invents a button with the right data-action and clicks it.
   * That is what keeps the menu from drifting out of step with the rest of the interface
   * — there is exactly one implementation of "delete folder", and the menu is one of its
   * two front doors.
   */
  function invokeAction(action, id) {
    var node = el('button', { type: 'button', dataset: { action: action } });
    if (id !== undefined && id !== null) node.setAttribute('data-id', id);
    document.body.appendChild(node);
    node.click();
    document.body.removeChild(node);
  }

  /**
   * Which menu belongs to which element. Order matters: the most specific surface wins,
   * so a row inside the trash panel gets the trash menu, not the tree menu.
   */
  function contextMenuFor(event) {
    var target = event.target;

    var trashRow = target.closest ? target.closest('.trash-row[data-trash-id]') : null;
    if (trashRow) {
      // Right-clicking a row that is part of a multi-row selection acts on the whole
      // selection, matching every file manager the muscle memory comes from.
      openTrashContextMenu(event, trashEntriesFor(trashRow));
      return;
    }

    var entryNode = target.closest ? target.closest('[data-ctx]') : null;
    if (entryNode) {
      var type = entryNode.getAttribute('data-ctx');
      var id = entryNode.getAttribute('data-id');
      var label = entryNode.getAttribute('data-ctx-label') || '';
      var overrides = {};
      // Whether the task under the pointer is already done: the one state-changing label in
      // its menu depends on it. Declared out here so the entry object below still carries the
      // flag whatever kind of row was clicked.
      var entryDone = false;

      if (type === 'folder') {
        // "New note inside" has to name the folder that was right-clicked, not whatever
        // happens to be selected: reading the menu and then acting on a different folder
        // is the failure mode this prevents.
        overrides = {
          'new-note': function () { newNoteIn(id); },
          'new-subfolder': function () { newFolder(id); },
          'upload-file': function () { uploadTo(id); },
          'rename-folder': function () { renameFolder(id); },
          'move-folder': function () { moveFolder(id); },
          'delete-folder': function () { deleteFolder(id); },
          'move-item-up': function () { reorderAction('folder', id, -1); },
          'move-item-down': function () { reorderAction('folder', id, 1); },
        };
      } else if (type === 'note') {
        overrides = {
          'rename-note': function () { renameNote(id); },
          'delete-note': function () { deleteNote(id); },
          'copy-note': function () { copyNoteText(id); },
          'move-item-up': function () { reorderAction('note', id, -1); },
          'move-item-down': function () { reorderAction('note', id, 1); },
          'upload-file': function () {
            var note = App.db.getNote(id);
            uploadTo(note ? note.folder_id : null);
          },
        };
      } else if (type === 'file') {
        overrides = {
          'open-file': function () { openFile(id); },
          'download-file': function () { downloadFile(id); },
          'open-file-tab': function () { openFileInTab(id); },
          'rename-file': function () { renameFile(id); },
          'delete-file': function () { deleteFile(id); },
          'move-item-up': function () { reorderAction('file', id, -1); },
          'move-item-down': function () { reorderAction('file', id, 1); },
        };
      } else if (type === 'task') {
        // Read once, when the menu opens: the commands that change state describe the row
        // as it was under the pointer, and the menu closes on the press that runs one.
        var menuTask = App.db.getTask(id);
        entryDone = !!(menuTask && menuTask.done);
        overrides = {
          'edit-task': function () { editTask(id); },
          'task-toggle-done': function () { toggleTaskDone(id, !entryDone); },
          'move-item-up': function () { reorderAction('task', id, -1); },
          'move-item-down': function () { reorderAction('task', id, 1); },
          'delete-task': function () { deleteTask(id); },
        };
      }

      var reorder = reorderFor(type, id);
      App.ui.menuOpen({
        x: event.clientX,
        y: event.clientY,
        entry: { type: type, id: id, label: label, done: entryDone },
        // Null when another key is active, which is what makes the move commands absent there
        // rather than present and pointless.
        reorder: reorder,
        on: function (action) {
          if (overrides[action]) return overrides[action];
          // Anything the overrides do not cover falls back to the same dispatch a click
          // would perform, which is what keeps the menu and the buttons in step.
          return function () { invokeAction(action, null); };
        },
      });
      return;
    }

    // The workspace switcher: the rail's own list, which is the one row outside the tree that
    // can be moved. It is recognised by where the pointer is rather than by a data-ctx
    // attribute, because its options are built by components.js and carry no app metadata.
    // The move commands and the workspace's own two commands are offered together so that the
    // menu still has something to say when another sort key is in force.
    var switcher = target.closest ? target.closest('#workspace-select') : null;
    if (switcher && state.workspaceId) {
      var switcherId = state.workspaceId;
      App.ui.menuOpen({
        x: event.clientX,
        y: event.clientY,
        entry: {
          type: 'workspace',
          id: switcherId,
          label: (currentWorkspace() || {}).name || 'Workspace',
        },
        reorder: reorderFor('workspace', switcherId),
        on: function (action) {
          if (action === 'rename-workspace') return renameWorkspace;
          if (action === 'delete-workspace') return deleteWorkspace;
          return function () { invokeAction(action, null); };
        },
      });
      return;
    }

    // Nothing specific under the cursor: offer what empty space can meaningfully do.
    App.ui.menuOpen({
      x: event.clientX,
      y: event.clientY,
      title: 'This workspace',
      items: [
        { label: 'New note', icon: 'note', onclick: function () { newNote(); } },
        { label: 'New folder', icon: 'folder', onclick: function () { newFolder(null); } },
        { label: 'Upload files\u2026', icon: 'upload', onclick: function () { dom.fileInput.click(); } },
        { sep: true },
        { label: 'Open the trash', icon: 'trash', onclick: openTrash },
        { label: 'Settings and export', icon: 'settings', onclick: openSettings },
      ],
    });
  }

  /**
   * Text fields keep the native menu — cut, copy, paste and spelling suggestions live
   * there, and replacing them to add app actions would remove working functionality to
   * add convenience. Everywhere else the native menu offers Back, Reload and Inspect,
   * none of which relate to the row under the cursor.
   */
  function isTextContext(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === 'TEXTAREA') return true;
    if (target.tagName !== 'INPUT') return false;
    var type = (target.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].indexOf(type) !== -1;
  }

  function onContextMenu(event) {
    if (isTextContext(event.target)) {
      App.ui.closeMenu();
      return;
    }
    // A second right-click while a menu is open re-targets it rather than stacking.
    App.ui.closeMenu();
    event.preventDefault();
    contextMenuFor(event);
  }

  // ---------------------------------------------------------------- sort control
  function paintSortButton() {
    var node = dom.sortMenu;
    if (!node) return;
    var sort = sortOf();
    // Manual order is the one state worth marking in colour: every other key describes the
    // data, while manual order describes a decision the reader made about this notebook, and
    // without a mark the button looks identical before and after that decision.
    node.classList.toggle('is-manual', sort.key === 'manual');
    var label = App.ui.sortKeyLabel(sort.key);
    node.setAttribute('aria-label',
      'Sort folders, notes and files \u00b7 ' + label + ' \u00b7 '
        + (sort.dir === 'asc' ? 'ascending' : 'descending'));
    node.title = 'Sorting by ' + label + (sort.dir === 'asc' ? ', ascending' : ', descending');
  }

  /**
   * The sort menu, anchored to its own button.
   *
   * The button is the only control that changes the sort, so the menu opens under it rather
   * than under the pointer: the press that opens it can be a keyboard activation, and a menu
   * placed at the last known mouse position would then appear somewhere unrelated.
   */
  function openSortMenu() {
    var node = dom.sortMenu;
    if (!node) return;
    var box = node.getBoundingClientRect();
    // aria-expanded rides the menu's lifetime rather than the press that opened it: the menu
    // also closes on Escape and on a click anywhere else, neither of which this button ever
    // hears about, and a control that says "menu open" afterwards is worse than one that
    // says nothing.
    node.setAttribute('aria-expanded', 'true');
    App.ui.menuOpenSort({
      x: Math.round(box.left),
      y: Math.round(box.bottom + 6),
      sort: sortOf(),
      onChoose: setSort,
      onClose: function () { node.setAttribute('aria-expanded', 'false'); },
    });
  }

  /**
   * Which scope a row belongs to, read from the row itself.
   *
   * Deliberately not taken from the selection: a right-click acts on the row under the
   * pointer, and reading the selection instead is how a menu ends up moving a different
   * folder than the one its title just named.
   */
  function scopeOfItem(type, id) {
    if (type === 'folder') {
      var folder = App.db.listFolders(state.workspaceId).filter(function (f) { return f.id === id; })[0];
      return { workspaceId: state.workspaceId, folderId: folder ? folder.parent_folder_id : null };
    }
    if (type === 'note') {
      var note = App.db.getNote(id);
      return { workspaceId: state.workspaceId, folderId: note ? note.folder_id : null };
    }
    // A task's scope is the folder it is filed under, which is what makes a move inside one
    // project leave every other project's arrangement alone.
    if (type === 'task') {
      var task = App.db.getTask(id);
      return {
        workspaceId: task ? task.workspace_id : state.workspaceId,
        folderId: task ? task.folder_id : null,
      };
    }
    var file = App.db.getFileMeta(id);
    return { workspaceId: state.workspaceId, folderId: file ? file.folder_id : null };
  }

  /**
   * Move one row one place, then keep looking at it.
   *
   * A reorder redraws the list, which throws away every row element — including the one the
   * reader just moved. Without putting focus back, the moved row becomes unreachable from the
   * keyboard; without scrolling it back into view, a move on a long list looks exactly like
   * nothing having happened.
   */
  function reorderAction(kind, id, delta) {
    if (sortOf().key !== 'manual') return;
    var scope = kind === 'workspace'
      ? { workspaceId: id, folderId: null }
      : scopeOfItem(kind, id);
    App.db.reorderWithin(kind, id, delta, scope.workspaceId, scope.folderId).then(function (moved) {
      if (!moved) return;
      // Remembered for the render below, which is where the row that has to be revealed
      // exists — and only for that render, so an unrelated repaint does not move the view.
      state.sortTouched = { kind: kind, id: id };
      // The rail is the one list with a second copy on screen (the dropdown and the rows it
      // orders), so it is the one that needs re-reading before the repaint.
      var refreshed = kind === 'workspace' ? refreshWorkspaces() : Promise.resolve(null);
      return refreshed.then(function () { render(); });
    }).catch(function (err) {
      util.toast('Could not move that item: ' + err.message, 'error');
    });
  }

  /** The move commands for one row, or null when manual order is not what is showing. */
  function reorderFor(type, id) {
    // Absent rather than disabled under any other key: a move command in a list sorted by
    // name would be undone by the very next render, which reads as a broken button.
    if (sortOf().key !== 'manual') return null;
    // Absent for a row with no id as well, which is the tree's "All notes" row: it describes
    // the whole workspace instead of standing for a row in a list, so it has no neighbour to
    // swap with and the command would do nothing at all.
    if (!id) return null;
    return {
      enabled: true,
      up: function () { reorderAction(type, id, -1); },
      down: function () { reorderAction(type, id, 1); },
    };
  }

  /**
   * Reveal the row that just moved.
   *
   * Done once per reorder, from the render that followed it, and then cleared: render() is
   * also what an unrelated change calls, and scrolling the list on those would be a jump the
   * reader never asked for.
   */
  function focusMovedRow(kind, id) {
    var found = document.querySelector('[data-ctx=' + kind + '][data-id=\u0022' + id + '\u0022]');
    if (!found) return;
    found.focus();
    if (typeof found.scrollIntoView === 'function') found.scrollIntoView({ block: 'nearest' });
  }

  /** A new note in a specific folder, from the menu rather than from the current view. */
  function newNoteIn(folderId) {
    flushPendingSave();
    App.db.createNote(state.workspaceId, folderId || null, 'Untitled note').then(function (note) {
      if (note.folder_id) expandAncestors(note.folder_id);
      state.activeFileId = null;
      state.activeNoteId = note.id;
      state.selection = note.folder_id ? { type: 'folder', id: note.folder_id } : state.selection;
      render();
      focusEditorTitle();
    }).catch(function (err) {
      util.toast('Could not create the note: ' + err.message, 'error');
    });
  }

  /**
   * Open the picker, remembering where the upload should land. The file input's change
   * handler reads `pendingUploadFolder` and then clears it, so a menu-driven upload and
   * the rail button cannot cross wires.
   */
  var pendingUploadFolder = null;
  function uploadTo(folderId) {
    pendingUploadFolder = folderId || null;
    dom.fileInput.click();
  }

  /** Copy a note's text, so a note can leave the app without being opened first. */
  function copyNoteText(id) {
    var note = App.db.getNote(id);
    if (!note) return;
    // A locked note has a title but no readable body. Copying it would put the title on the
    // clipboard and look like the note was empty, which is a worse answer than saying so.
    if (note.locked) {
      util.toast('This note is encrypted and the notebook is locked. Unlock it first.', 'info', 7000);
      return;
    }
    var text = (note.title ? note.title + '\n\n' : '') + (note.content || '');
    var done = function () {
      util.toast('Copied the note text.', 'success');
      // No read permission needed just to say it worked.
    };
    var failed = function () {
      util.toast('This browser blocked the clipboard. Open the note and copy from there.', 'error');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(failed);
    } else {
      failed();
    }
  }

  /**
   * Left/Right on a focused tree row: the standard disclosure-tree contract. Right opens a
   * closed folder or steps into an open one, Left closes an open folder or steps back out
   * to its parent.
   */
  function onTreeArrowKeys(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    var row = event.target.closest ? event.target.closest('.tree__row--folder[data-action]') : null;
    if (!row) return;

    var id = row.getAttribute('data-id');
    var open = row.getAttribute('aria-expanded') === 'true';
    event.preventDefault();

    if (event.key === 'ArrowRight') {
      if (!open) {
        ACTIONS['toggle-folder'](id);
        return;
      }
      var child = row.nextElementSibling;
      if (child && child.classList.contains('tree__row')) child.focus();
      return;
    }

    if (open) {
      ACTIONS['toggle-folder'](id);
      return;
    }
    // Step out to the parent folder, which is the nearest preceding row at a shallower
    // indent — computed from the rendered geometry rather than the (unavailable) parent id.
    var depth = parseInt(row.style.getPropertyValue('--indent'), 10) || 0;
    var previous = row.previousElementSibling;
    while (previous) {
      if (previous.classList.contains('tree__row')) {
        var previousDepth = parseInt(previous.style.getPropertyValue('--indent'), 10) || 0;
        if (previousDepth < depth) { previous.focus(); return; }
      }
      previous = previous.previousElementSibling;
    }
  }

  /**
   * Narrow viewports show one pane at a time. The list is the home screen, so anything
   * opened (a note, a file) moves to the canvas and the top-bar button comes back.
   *
   * The class is only ever set while the narrow media query matches: crossing the
   * breakpoint re-derives it, so a session that starts narrow and is then widened does
   * not leave a stale pane decision behind. A user who manually went back to the list is
   * remembered across a resize; the default is the canvas.
   */
  var narrow = null;
  // The list is the home screen, so the default before anything has rendered is the list.
  var mobilePanePinned = true;

  function applyMobilePane() {
    if (!dom.layout) return;
    dom.layout.classList.toggle('is-mobile-list', !!narrow && mobilePanePinned);
  }

  function syncMobilePane() {
    var next = !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
    if (next === narrow) return;
    narrow = next;
    // Crossing the breakpoint re-derives the pane: the list, unless something is open —
    // and the task list counts as open, because it is the pane the reader asked for.
    // Deciding by the note selection alone left a narrow session looking at the tree with
    // no way to reach the tasks pane it had just opened.
    mobilePanePinned = state.view !== 'tasks' && !state.activeNoteId && !state.activeFileId;
    applyMobilePane();
  }

  function showMobilePane(pane) {
    mobilePanePinned = pane === 'list';
    applyMobilePane();
  }

  function wireEvents() {
    document.addEventListener('click', onActionClick);
    // Capture phase: runs before the delegated click handler above.
    document.addEventListener('click', onTreePointerDown, true);
    // Right-click: the app's own menu, except inside text fields.
    document.addEventListener('contextmenu', onContextMenu);

    // Keyboard parity for the tree rows, which are focusable divs rather than buttons.
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        var node = event.target.closest ? event.target.closest('.tree__row[data-action], .tree__twisty[data-action]') : null;
        if (node) {
          event.preventDefault();
          // The actions mirror what a press does: the arrow toggles without selecting, a
          // folder row selects and toggles, a note or file row opens.
          var action = node.classList.contains('tree__twisty') ? 'toggle-folder' : node.getAttribute('data-action');
          ACTIONS[action](node.getAttribute('data-id'));
          return;
        }
      }
      onTreeArrowKeys(event);

      // Escape closes the trash panel, the menu, or clears an active search — in that
      // order, because that is the order of what is on top of the screen. The dialog's
      // own Escape handling covers the panel; this only has to stay out of its way.
      if (event.key === 'Escape' && !App.ui.menuIsOpen()
          && document.activeElement === dom.searchInput && dom.searchInput.value) {
        dom.searchInput.value = '';
        state.searchTerm = '';
        render();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      // Ctrl/Cmd+K focuses search.
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dom.searchInput.focus();
        dom.searchInput.select();
        return;
      }
      // A menu, a dialog or the trash panel owns the keyboard while it is open: a
      // shortcut that changes the view underneath a modal is a bug, not a feature.
      if (App.ui.menuIsOpen() || document.querySelector('dialog[open]')) return;

      // Ctrl/Cmd+N creates a note. The three-key form is deliberate: Ctrl+N alone is the
      // browser's "new window" and cannot be intercepted reliably.
      if (event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newNote();
        return;
      }
      // Ctrl/Cmd+U uploads. Chrome reserves Ctrl+U for view-source, so this is
      // opt-in-by-intent rather than a shortcut that silently fails.
      if (event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        uploadTo(targetFolderId());
      }
    });

    // ---- editor. Delegated on the container because the editor is re-rendered on open.
    dom.main.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !state.currentNote) return;
      if (target.id === 'note-title') {
        state.currentNote.title = target.value;
        state.editorDirty = true;
        setStatus('Unsaved\u2026');
        saveOpenNote();
      } else if (target.id === 'note-body') {
        state.currentNote.content = target.value;
        state.editorDirty = true;
        setStatus('Unsaved\u2026');
        saveOpenNote();
      }
    });

    // Tab inserts a tab character instead of leaving the textarea.
    dom.main.addEventListener('keydown', function (event) {
      if (event.key === 'Tab' && event.target && event.target.id === 'note-body') {
        event.preventDefault();
        var area = event.target;
        var start = area.selectionStart;
        var end = area.selectionEnd;
        area.value = area.value.slice(0, start) + '\t' + area.value.slice(end);
        area.selectionStart = area.selectionEnd = start + 1;
        state.currentNote.content = area.value;
        state.editorDirty = true;
        saveOpenNote();
      }
    });

    // ---- quick add. Delegated on the pane for the same reason the editor is: the field is
    // rebuilt by every render, so a listener bound to the element would be bound to a node
    // that is no longer on screen.
    dom.main.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'task-add') {
        state.taskDraft = event.target.value;
        // The Add button follows the field it belongs to: "is there anything to file?" is one
        // fact, and a repaint does not happen per keystroke, so it is spelled out here too.
        var submit = dom.main.querySelector('[data-action="add-task"]');
        if (submit) submit.disabled = !event.target.value.trim();
      }
    });
    dom.main.addEventListener('keydown', function (event) {
      var addField = event.target;
      if (!addField || addField.id !== 'task-add') return;

      if (event.key === 'Enter') {
        event.preventDefault();
        addTaskFromQuickAdd();
        return;
      }

      if (event.key === 'Escape') {
        // Escape empties the field and stops there. It is the way out of a half-typed task,
        // not a way out of the pane: clearing the field is the whole of what it does, so it
        // cannot be mistaken for the key that closes the list.
        event.preventDefault();
        addField.value = '';
        state.taskDraft = '';
      }
    });

    // ---- search
    dom.searchInput.addEventListener('input', function (event) {
      runSearch(event.target.value.trim());
    });

    // ---- workspace switcher (custom select; the handler is owned here so the widget
    // stays presentational)
    App.ui.onWorkspaceChange(dom.workspaceSelect, switchWorkspace);

    // ---- file picker. `pendingUploadFolder` is set by the rail button (null) or by a
    // folder's context menu (that folder), and is cleared here so the two cannot cross.
    dom.fileInput.addEventListener('change', function (event) {
      var destination = pendingUploadFolder;
      pendingUploadFolder = null;
      uploadFiles(event.target.files, destination !== null && destination !== undefined ? destination : targetFolderId());
      event.target.value = ''; // allow re-picking the same file
    });

    // ---- drag and drop, anywhere on the window
    var dragDepth = 0;
    window.addEventListener('dragenter', function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') === -1) return;
      event.preventDefault();
      dragDepth++;
      App.ui.setDragActive(true);
    });
    window.addEventListener('dragover', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) App.ui.setDragActive(false);
    });
    window.addEventListener('drop', function (event) {
      event.preventDefault();
      dragDepth = 0;
      App.ui.setDragActive(false);
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        uploadFiles(event.dataTransfer.files, targetFolderId());
      }
    });

    // ---- top bar / settings
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('settings-open').addEventListener('click', openSettings);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    // One delegated listener for the six choices: they are paint, not behaviour, so every
    // chip reaches applyPalette() down the same path and none of them needs its own handler.
    if (dom.paletteGroup) {
      dom.paletteGroup.addEventListener('change', function (event) {
        var input = event.target;
        if (input && input.type === 'radio') applyPalette(input.value);
      });
    }
    document.getElementById('export-db').addEventListener('click', exportDatabase);
    document.getElementById('reset-all').addEventListener('click', resetEverything);
    document.getElementById('workspace-rename').addEventListener('click', renameWorkspace);
    document.getElementById('workspace-delete').addEventListener('click', deleteWorkspace);
    document.getElementById('workspace-add').addEventListener('click', addWorkspace);
    // #sort-menu is deliberately not wired here: it carries data-action="sort-menu", which
    // the delegated listener above dispatches, and a second listener on the element would run
    // the whole open sequence twice for one press.

    // ---- never lose the last keystrokes
    window.addEventListener('beforeunload', flushPendingSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushPendingSave();
    });

    // ---- one pane or two: re-derived on a breakpoint crossing
    syncMobilePane();
    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 820px)');
      if (mq.addEventListener) mq.addEventListener('change', syncMobilePane);
    }
  }

  // ----------------------------------------------------------------------- boot
  function cacheDom() {
    dom.workspaceSelect = document.getElementById('workspace-select');
    dom.layout = document.querySelector('.layout');
    dom.tree = document.getElementById('tree');
    dom.main = document.getElementById('main');
    dom.searchInput = document.getElementById('search');
    dom.fileInput = document.getElementById('file-input');
    dom.railActions = document.getElementById('rail-actions');
    dom.railStorage = document.getElementById('rail-storage');
    dom.trashFab = document.getElementById('workspace-trash');
    dom.settingsDialog = document.getElementById('settings-dialog');
    dom.storageInfo = document.getElementById('storage-info');
    dom.vaultInfo = document.getElementById('vault-info');
    dom.vaultActions = document.getElementById('vault-actions');
    dom.themeToggle = document.getElementById('theme-toggle');
    dom.paletteGroup = document.getElementById('palette-group');
    dom.sortMenu = document.getElementById('sort-menu');
    dom.topbarViews = document.getElementById('topbar-views');
  }

  /**
   * Resolves once the database is open and the first render is done. Exposed so automated
   * checks (tools/) can wait for real readiness instead of sleeping and hoping.
   */
  function ready() {
    return bootPromise;
  }

  function boot() {
    cacheDom();
    // Icons first: applyTheme() writes into the theme button, and every other glyph on
    // the shell is injected from the same set.
    bootstrapIcons();
    // Theme before anything renders, so there is no flash of the wrong palette.
    applyTheme(App.prefs.get('theme', window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    // Palette after the theme: applyTheme() draws the tab icon from the accent, and the
    // accent is whatever the palette says, so this second call is what leaves the icon
    // correct rather than merely drawn.
    applyPalette(App.prefs.get('palette', 'indigo'));

    wireEvents();
    // Before the first render, so no list is ever painted in one order and then repainted in
    // another while the database opens.
    applySort();
    paintSortButton();

    App.ui.renderEmptyState(dom.main, { title: 'Opening your notebook\u2026', body: 'Loading the local SQLite database.' });

    var bootResult = null;
    bootPromise = App.db.init().then(function (result) {
      bootResult = result;
      state.ready = true;
      state.workspaceId = result.lastWorkspaceId;
      // Ask the browser to keep our data, once per install. Fire-and-forget: a refusal is
      // normal and does not block anything.
      var asked = App.prefs.get('askedPersistence', false);
      if (!asked) {
        App.prefs.set('askedPersistence', true);
        App.storage.requestPersistence().then(function (granted) {
          if (!granted) {
            util.toast('The browser did not grant persistent storage. Export a backup now and then.', 'info', 6000);
          }
          render();
        });
      }
      // Encryption before the first paint: if this tab unlocked the notebook earlier, the key
      // is adopted here, so a reload lands on the notes instead of on a lock notice that has to
      // be dismissed. A session that cannot be resumed is simply locked, which is the default.
      var resumed = App.db.vaultState() === 'locked'
        ? App.db.resumeVault()
        : Promise.resolve(null);
      return resumed.then(function () {
        return refreshWorkspaces().then(function () {
          // Last, and before the first paint: put the reader back where they were.
          restorePlace(state.workspaceId);
        });
      });
    }).then(function () {
      render();
      renderFooter();
      if (bootResult && wantsSelfTest()) runSelfTest();
    }).catch(function (err) {
      App.ui.renderEmptyState(dom.main, {
        title: 'The database could not start',
        body: err.message + '. Try reloading the page.',
      });
      util.toast('Startup failed: ' + err.message, 'error', 12000);
      // eslint-disable-next-line no-console
      console.error(err);
    });
  }

  /** `#selftest` runs a scripted pass over the storage layer, for automated checks. */
  function wantsSelfTest() {
    return window.location.hash === '#selftest';
  }

  function runSelfTest() {
    var marker = document.createElement('div');
    marker.id = 'marker';
    marker.style.display = 'none';
    document.body.appendChild(marker);
    var lines = [];
    var ws = App.db.listWorkspaces()[0];
    App.db.createNote(ws.id, null, 'Self test note')
      .then(function (note) {
        state.activeNoteId = note.id;
        state.selection = { type: 'all', id: null };
        render();
        return App.db.updateNote(note.id, 'Self test note', 'body written by the self test');
      })
      .then(function () {
        return App.db.createFolder(ws.id, 'Self test folder', null);
      })
      .then(function (folder) {
        return App.db.createFolder(ws.id, 'Nested', folder.id).then(function () { return folder; });
      })
      .then(function (folder) {
        var deep = App.db.listFolders(ws.id).filter(function (f) { return f.name === 'Nested'; })[0];
        return deep ? App.db.createFolder(ws.id, 'Deep', deep.id) : null;
      })
      .then(function () {
        lines.push('folders=' + App.db.counts(ws.id).folders);
        // Delete the top-level test folder and confirm the whole subtree goes with it.
        var top = App.db.listFolders(ws.id).filter(function (f) { return f.name === 'Self test folder'; })[0];
        return App.db.deleteFolder(top.id).then(function () {
          lines.push('foldersAfterCascade=' + App.db.counts(ws.id).folders);
        });
      })
      .then(function () {
        return App.db.search(ws.id, 'self test', 10);
      })
      .then(function (found) {
        lines.push('searchHits=' + found.notes.length);
        lines.push('bytes=' + App.db.exportBytes().length);
        lines.push('backend=' + App.storage.backendName());
        lines.push('notesRendered=' + document.querySelectorAll('.tree__row--note').length);
        lines.push('editorPresent=' + (document.getElementById('note-body') ? 'yes' : 'no'));
        lines.push('uploadedFile=' + (window.__selftestUpload || 'n/a'));
        marker.textContent = 'SELFTEST OK ' + lines.join(' | ');
      })
      .catch(function (err) {
        marker.textContent = 'SELFTEST FAIL ' + lines.join(' | ') + ' || ' + err.message;
      });
  }

  // Small hook so the browser harness can exercise the upload path too.
  window.NoteApp.__testUpload = function (name, bytes) {
    var blob = new Blob([bytes]);
    var file = new File([blob], name, { type: 'application/octet-stream' });
    return uploadFiles([file], null).then(function () {
      window.__selftestUpload = name + ':' + App.db.listFilesIn(state.workspaceId, null).length;
    });
  };

  App.app = {
    boot: boot,
    ready: ready,
    state: state,
    render: render,
    newNote: newNote,
    openNote: openNote,
    uploadFiles: uploadFiles,
    exportDatabase: exportDatabase,
  };

  var bootPromise = null;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.NoteApp);
