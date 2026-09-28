/**
 * flow-check.js — end-to-end verification of the real index.html.
 *
 * Round A (fresh profile) drives the app like a user: a workspace, nested folders, a note
 * typed into the editor, and a file upload. Round B reloads the same profile and asserts
 * that every one of those survived — which is the whole claim of the storage architecture.
 *
 * Driven by tools/run-flow.js, which prepends `window.__FLOW_MODE__`.
 */

function setNativeValue(el, value) {
  // Dispatching a real `input` event is what the app listens for, so drive the DOM the
  // way a user's keystrokes would.
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function wait(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

var out = [];
function log(k, v) { out.push(k + '=' + v); return v; }

// Exposed as a global: tools/run-flow.js injects this file via page preload, so the body
// has to be callable later (after the app has booted) rather than run immediately.
window.__FLOW__ = function () {
  // Session 1 is the fresh profile; session 2 is a browser restarted on that same profile.
  // The gate is essential: the preload is re-injected into every new document, so without it
  // round A would run twice and round B would recreate the very data it is meant to verify.
  var mode = window.__HARNESS_SESSION__ === 2 ? 'B' : 'A';
  var App = window.NoteApp;

  // Wait for the database to be open and the first render to have happened.
  return App.app.ready().then(function () {
  return (async function () {
  try {
    if (mode === 'A') {
      // ---- 1. a workspace, created the way the UI creates one
      var ws = await App.db.createWorkspace('Flow workspace');
      App.app.state.workspaceId = ws.id;
      App.prefs.set('lastWorkspaceId', ws.id);
      log('createdWorkspace', ws.name);

      // ---- 2. nested folders: Flow folder > Inner
      var outer = await App.db.createFolder(ws.id, 'Flow folder', null);
      var inner = await App.db.createFolder(ws.id, 'Inner', outer.id);
      log('subtreeIds', App.db.descendantFolderIds(outer.id).length);

      // ---- 3. a note created through the UI action, then typed into
      App.app.state.selection = { type: 'folder', id: inner.id };
      await App.app.newNote();
      log('editorPresent', !!document.getElementById('note-body'));
      setNativeValue(document.getElementById('note-title'), 'Flow note');
      setNativeValue(document.getElementById('note-body'), 'typed by the flow check');

      // Autosave is debounced by 500 ms; give it room, then confirm the write landed.
      await wait(1500);
      log('statusAfterTyping', document.getElementById('note-status').textContent.trim());

      // ---- 4. upload a file as a BLOB
      await App.__testUpload('flow-upload.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      log('uploaded', window.__selftestUpload || 'none');

      // ---- 5. read it all back out of SQLite
      log('folders', App.db.listFolders(ws.id).length);
      var flowNote = App.db.listAllNotes(ws.id).filter(function (n) { return n.title === 'Flow note'; })[0];
      log('noteSaved', !!flowNote);
      log('noteInFolder', flowNote ? (flowNote.folder_id === inner.id) : 'n/a');
      log('noteBody', flowNote ? JSON.stringify(App.db.getNote(flowNote.id).content) : 'n/a');

      var files = App.db.listFilesIn(ws.id, null);
      log('files', files.length);
      if (files.length) {
        var resolved = App.db.getFileBlob(files[0].id);
        log('blobBytes', resolved ? resolved.blob.size : -1);
      }
      log('searchHits', App.db.search(ws.id, 'flow', 20).notes.length);
      // The nested note must be visible in the sidebar tree: creating a note has to expand
      // its ancestors, otherwise it exists but cannot be found in the UI.
      log('treeNoteRows', document.querySelectorAll('.tree__row--note').length);
      log('visibleAncestors', Object.keys(App.app.state.expanded).length);
      log('exportBytes', App.db.exportBytes().length);

      // A note at the workspace root must render as a top-level row (not inside any folder).
      var loose = await App.db.createNote(ws.id, null, 'Loose note');
      App.app.state.selection = { type: 'all', id: null };
      App.app.state.activeNoteId = loose.id;
      App.app.render();
      log('rootNoteRows', document.querySelectorAll('.tree__row--note').length);
      return 'FLOW A OK ' + out.join(' | ');
    }

    if (mode === 'B') {
      // Nothing is created here: everything must already exist after the reload.
      var list = App.db.listWorkspaces();
      log('workspaces', list.length);
      var ws = list.filter(function (w) { return w.name === 'Flow workspace'; })[0];
      log('workspaceRestored', !!ws);
      if (!ws) return 'FLOW B FAIL ' + out.join(' | ');

      var folders = App.db.listFolders(ws.id);
      log('foldersRestored', folders.length);
      var outer = folders.filter(function (f) { return f.name === 'Flow folder'; })[0];
      var inner = folders.filter(function (f) { return f.name === 'Inner'; })[0];
      log('nestingRestored', !!(outer && inner && inner.parent_folder_id === outer.id));

      var flowNote = App.db.listAllNotes(ws.id).filter(function (n) { return n.title === 'Flow note'; })[0];
      log('noteRestored', !!flowNote);
      log('noteBodyRestored', flowNote ? JSON.stringify(App.db.getNote(flowNote.id).content) : 'n/a');
      log('noteStillInFolder', flowNote ? !!flowNote.folder_id : 'n/a');

      var files = App.db.listFilesIn(ws.id, null);
      log('filesRestored', files.length);
      if (files.length) {
        var resolved = App.db.getFileBlob(files[0].id);
        log('blobBytesRestored', resolved ? resolved.blob.size : -1);
      }
      log('searchRestored', App.db.search(ws.id, 'flow', 20).notes.length);
      // The UI must have rendered from the restored database, not from an empty one.
      log('sidebarRows', document.querySelectorAll('.tree__row').length);
      log('activeWorkspaceSelected', document.getElementById('workspace-select').value === ws.id);
      return 'FLOW B OK ' + out.join(' | ');
    }

    return 'FLOW unknown mode';
  } catch (err) {
    return 'FLOW EXCEPTION ' + out.join(' | ') + ' || ' + err.message + ' @ ' + String(err.stack || '').split('\n')[1];
  }
  })();
  });
};
