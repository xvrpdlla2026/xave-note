/**
 * shot-seed.js — sample notebook for tools/shots.js.
 *
 * Injected as a new-document preload, so it only defines a global; shots.js calls it
 * after the database is open. Everything is created through the app's own db API, which
 * means the screenshots exercise the real render path — and because the browser profile
 * is temporary, none of this touches a real notebook.
 */

window.__SEED__ = function () {
  var App = window.NoteApp;
  if (!App || !App.db || !App.db.isReady()) return 'db not ready';
  if (App.db.listWorkspaces().some(function (w) { return w.name === 'Field notes'; })) return 'already seeded';

  return App.db.createWorkspace('Field notes').then(function (ws) {
    App.prefs.set('lastWorkspaceId', ws.id);
    return Promise.all([
      App.db.createFolder(ws.id, 'Clients', null),
      App.db.createFolder(ws.id, 'Writing', null),
      App.db.createFolder(ws.id, 'Later', null),
    ]).then(function (folders) {
      var clients = folders[0];
      var writing = folders[1];
      var later = folders[2];
      return Promise.all([
        App.db.createFolder(ws.id, 'Aurora Labs', clients.id),
        App.db.createFolder(ws.id, 'Kestrel', clients.id),
        App.db.createFolder(ws.id, 'Interviews', writing.id),
        App.db.createFolder(ws.id, 'Scripts', writing.id),
      ]).then(function (sub) {
        return App.db.createFolder(ws.id, 'Kickoff call', sub[0].id).then(function (deep) {
          return Promise.all([
            App.db.createNote(ws.id, sub[0].id, 'Aurora Labs, scope questions'),
            App.db.createNote(ws.id, sub[0].id, 'Naming shortlist'),
            App.db.createNote(ws.id, deep.id, 'Kickoff call agenda'),
            App.db.createNote(ws.id, sub[1].id, 'Kestrel retainer terms'),
            App.db.createNote(ws.id, sub[2].id, 'Interview, warehouse lead'),
            App.db.createNote(ws.id, sub[3].id, 'Script drafts'),
            App.db.createNote(ws.id, null, 'Reading list'),
            App.db.createNote(ws.id, later.id, ''),
          ]).then(function (notes) {
            var body = [
              'Opening (10 min)',
              '',
              'Go around the room once, then hand the whiteboard to Priya. The goal is not to',
              'settle the migration today, it is to agree on what we are deciding and who owns',
              'each decision.',
              '',
              'Decisions to land',
              '',
              '  1. Cutover window: the last weekend of March, or the one after.',
              '  2. Whether the old dashboard stays read-only for a quarter.',
              '  3. Who signs off on the data reconciliation report.',
              '',
              'Open questions',
              '',
              'The reporting team still exports by hand every Monday. Nobody has said out loud',
              'whether that survives the migration, and I would rather ask now than discover it',
              'in April.',
              '',
            ].join('\n');
            return App.db.updateNote(notes[2].id, 'Kickoff call agenda', body);
          });
        });
      });
    }).then(function () {
      return App.db.addFile(
        ws.id, null, 'inventory-august.csv', 'text/csv',
        new Uint8Array([77, 111, 110, 116, 104, 44, 67, 111, 117, 110, 116, 44, 78, 111, 116, 101, 115])
      );
    }).then(function () {
      var folders = App.db.listFolders(ws.id);
      var byName = {};
      folders.forEach(function (f) { byName[f.name] = f; });
      var all = App.db.listAllNotes(ws.id);
      var agenda = all.filter(function (n) { return n.title === 'Kickoff call agenda'; })[0];

      App.app.state.workspaceId = ws.id;
      App.app.state.expanded[byName['Clients'].id] = true;
      App.app.state.expanded[byName['Aurora Labs'].id] = true;
      App.app.state.expanded[byName['Writing'].id] = true;
      App.app.state.selection = { type: 'all', id: null };
      App.app.state.activeNoteId = agenda ? agenda.id : null;
      App.app.render();
      return 'seeded ' + all.length + ' notes';
    });
  }).catch(function (e) { return 'seed error: ' + e.message; });
};
