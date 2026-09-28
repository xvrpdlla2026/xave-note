/* __place-check.js - does the reader's place survive a reload?
 * Driven by tools/browser-check.js --reload: the first session arranges a real place
 * (a folder open, a note open, text typed, the tasks pane in front), the second session
 * reports what came back. Every line here is short on purpose: this file is a check, and
 * a check that has to be read slowly is one nobody re-runs. */
window.__CHECK__ = function () {
  var App = window.NoteApp;
  if (!App || !App.app) return 'no app';
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var row = function (label) {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#tree .tree__row'));
    var hit = rows.filter(function (r) {
      var n = r.querySelector('.tree__label');
      return n && n.textContent === label;
    })[0];
    return hit || null;
  };
  var noteByTitle = function (title) {
    var all = App.db.listAllNotes(App.app.state.workspaceId);
    return all.filter(function (n) { return n.title === title; })[0] || null;
  };
  var report = function () {
    var S = App.app.state;
    var open = Object.keys(S.expanded).filter(function (k) { return S.expanded[k]; });
    var note = noteByTitle('Place test');
    var pref = App.prefs.get('place.' + S.workspaceId, null);
    var body = note ? App.db.getNote(note.id).content : 'MISSING';
    return 'CHECK'
      + ' openFolders=' + open.length
      + ' selection=' + S.selection.type
      + ' noteOpen=' + !!S.activeNoteId
      + ' view=' + S.view
      + ' taskView=' + S.taskView
      + ' prefStored=' + !!pref
      + ' noteText=' + JSON.stringify(body);
  };
  var setup = function () {
    var ws = App.app.state.workspaceId;
    return App.db.createFolder(ws, 'Place folder', null).then(function (folder) {
      return App.db.createNote(ws, folder.id, 'Place test');
    }).then(function () {
      App.app.render();
      return wait(400);
    }).then(function () {
      row('Place folder').click();
      return wait(400);
    }).then(function () {
      row('Place test').click();
      return wait(400);
    }).then(function () {
      var body = document.getElementById('note-body');
      body.value = 'typed text that must survive';
      body.dispatchEvent(new Event('input', { bubbles: true }));
      return wait(900);
    }).then(function () {
      document.querySelector('.view-btn').click();
      return wait(400);
    }).then(function () {
      var chip = document.querySelector('#main .segmented__input[value="upcoming"]');
      if (chip) chip.click();
      return wait(500);
    }).then(function () {
      return 'CHECK SETUP done :: ' + report().slice(6);
    });
  };
  /* Two modes, chosen by the URL hash so --reload carries it into both sessions:
   *   no hash   arrange a place, reload, report what came back
   *   #poison   arrange a place, delete the note behind it, reload, report again: the
   *             stored id has to be dropped rather than restored as an empty pane. */
  var poison = function () {
    var note = noteByTitle('Place test');
    window.localStorage.setItem('placeCheck.poisoned', '1');
    return App.db.deleteNote(note.id).then(function () {
      App.app.render();
      return wait(400);
    }).then(function () {
      return 'CHECK POISONED :: ' + report().slice(6);
    });
  };
  return App.app.ready().then(function () {
    var poisoned = window.localStorage.getItem('placeCheck.poisoned');
    if (poisoned) return report();
    if (noteByTitle('Place test')) return report();
    return setup().then(function (out) {
      return location.hash === '#poison' ? poison() : out;
    });
  }).catch(function (e) {
    return 'CHECK THREW ' + e.message;
  });
};