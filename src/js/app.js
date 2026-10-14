window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var el = util.el;

  var state = {
    ready: false,
    workspaceId: null,
    selection: { type: 'all', id: null }, 
    activeNoteId: null,
    activeFileId: null,

    dejavu: null,                         
    tabs: [],
    newTabPending: false,
    tabFocus: false,                     
    tabHistory: [],                      
    closedTabs: [],                      
    expanded: {},                          
    sort: { key: 'manual', dir: 'asc' },
    paneView: 'tiles',                     
    sortTouched: null,
    searchTerm: '',
    view: 'notes',                         
    taskView: 'all',                       
    taskDraft: '',
    taskAddFocus: false,                   
    taskScrollReset: false,                
    railFocus: false,                      
    trashOpen: false,
    trashSelected: [],
    bulkSelected: [],
    bulkFloat: null,
    bulkKinds: {},
    focused: null,
    bulkAnchor: null,
    bulkScope: null,
    bulkFocusId: null,                     
    trashView: 'all',                      
    trashTerm: '',
    estimate: null,                        
  };

  var dom = {};            
  var uploadQueue = Promise.resolve(); 
  var trashPanel = null;               
  var wsPickerPanel = null;            
  var movePanel = null;                

  var MAX_TABS = 20;

  function parseTabRef(ref) {
    var s = String(ref || '');
    var cut = s.indexOf(':');
    if (cut === -1) return null;
    var kind = s.slice(0, cut);
    var id = s.slice(cut + 1);
    if (kind === 'new') return { kind: 'new', id: '' };
    if ((kind !== 'note' && kind !== 'file') || !id) return null;
    return { kind: kind, id: id };
  }

  function tabIndexOf(kind, id) {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].kind === kind && String(state.tabs[i].id) === String(id)) return i;
    }
    return -1;
  }

  function pendingTabIndex() {
    return tabIndexOf('new', '');
  }

  function pendingTabActive() {
    return pendingTabIndex() !== -1 && !state.activeNoteId && !state.activeFileId;
  }

  function tabRecord(kind, id) {
    try {
      if (kind === 'note') {
        var note = App.db.getNote(id);
        return note && note.workspace_id === state.workspaceId ? note : null;
      }
      var meta = App.db.getFileMeta(id);
      return meta && meta.workspace_id === state.workspaceId ? meta : null;
    } catch (err) {
      return null;
    }
  }

  function makeRoom() {
    while (state.tabs.length >= MAX_TABS) {
      var activeKey = state.activeNoteId ? 'note:' + state.activeNoteId
        : state.activeFileId ? 'file:' + state.activeFileId : null;
      var dropAt = -1;
      for (var i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].pinned || state.tabs[i].kind === 'new') continue;
        if (state.tabs[i].kind + ':' + state.tabs[i].id !== activeKey) { dropAt = i; break; }
      }
      if (dropAt === -1) break;
      state.tabs.splice(dropAt, 1);
    }
  }

  function ensureTab(kind, id) {
    if (!kind || !id) return;
    if (tabIndexOf(kind, id) !== -1) return;
    var pending = pendingTabIndex();
    if (pending !== -1 && state.newTabPending) {
      state.tabs[pending] = { kind: kind, id: id, pinned: !!state.tabs[pending].pinned };
      state.newTabPending = false;
      return;
    }
    makeRoom();
    state.tabs.push({ kind: kind, id: id, pinned: false });
    settlePinned();
  }

  function settlePinned() {
    var pinned = state.tabs.filter(function (t) { return t.pinned; });
    if (!pinned.length) return;
    var rest = state.tabs.filter(function (t) { return !t.pinned; });
    state.tabs = pinned.concat(rest);
  }

  function setTabPinned(ref, pinned) {
    var parsed = parseTabRef(ref);
    if (!parsed) return false;
    var at = tabIndexOf(parsed.kind, parsed.id);
    if (at === -1) return false;
    state.tabs[at].pinned = !!pinned;
    settlePinned();
    render();
    focusTabRef(ref);
    return true;
  }

  function pushTabHistory(kind, id) {
    if (!kind || !id) return;
    var key = kind + ':' + id;
    state.tabHistory = state.tabHistory.filter(function (k) { return k !== key; });
    state.tabHistory.push(key);
    if (state.tabHistory.length > 40) state.tabHistory = state.tabHistory.slice(-40);
  }

  function jumpToPreviousTab() {
    var current = state.activeNoteId ? 'note:' + state.activeNoteId
      : state.activeFileId ? 'file:' + state.activeFileId : null;
    for (var i = state.tabHistory.length - 1; i >= 0; i--) {
      if (state.tabHistory[i] === current) continue;
      var parsed = parseTabRef(state.tabHistory[i]);
      if (parsed && tabRecord(parsed.kind, parsed.id)) {
        activateTab(parsed.kind, parsed.id);
        return true;
      }
    }
    return false;
  }

  function pushClosedTab(kind, id) {
    if (!kind || !id) return;
    var key = kind + ':' + id;
    state.closedTabs = state.closedTabs.filter(function (k) { return k !== key; });
    state.closedTabs.push(key);
    if (state.closedTabs.length > 10) state.closedTabs = state.closedTabs.slice(-10);
  }

  function reopenClosedTab() {
    while (state.closedTabs.length) {
      var parsed = parseTabRef(state.closedTabs.pop());
      if (!parsed) continue;
      var record = tabRecord(parsed.kind, parsed.id);
      if (!record) continue;
      if (record.workspace_id !== state.workspaceId) adoptWorkspaceOf(record.workspace_id);
      ensureTab(parsed.kind, parsed.id);
      activateTab(parsed.kind, parsed.id);
      return true;
    }
    util.toast('Nothing to reopen.', 'info');
    return false;
  }

  function lastClosedTitle() {
    for (var i = state.closedTabs.length - 1; i >= 0; i--) {
      var parsed = parseTabRef(state.closedTabs[i]);
      var record = parsed && tabRecord(parsed.kind, parsed.id);
      if (!record) continue;
      return parsed.kind === 'note'
        ? (record.title && record.title.trim() ? record.title : 'Untitled note')
        : record.filename;
    }
    return null;
  }

  function pruneTabs() {
    state.tabs = state.tabs.filter(function (t) { return t.kind === 'new' || !!tabRecord(t.kind, t.id); });
    var seen = {};
    state.tabs = state.tabs.filter(function (t) {
      var key = t.kind + ':' + t.id;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function tabsViewModel() {
    pruneTabs();
    if (state.activeNoteId && tabIndexOf('note', state.activeNoteId) === -1
        && tabRecord('note', state.activeNoteId)) {
      ensureTab('note', state.activeNoteId);
    }
    if (state.activeFileId && tabIndexOf('file', state.activeFileId) === -1
        && tabRecord('file', state.activeFileId)) {
      ensureTab('file', state.activeFileId);
    }
    return state.tabs.map(function (t) {
      if (t.kind === 'new') {
        return {
          kind: 'new',
          id: '',
          pinned: false,
          title: 'New tab',
          glyph: null,
          dirty: false,
          active: !state.activeNoteId && !state.activeFileId,
        };
      }
      var record = tabRecord(t.kind, t.id);
      if (!record) return null;
      var isActive = t.kind === 'note'
        ? String(t.id) === String(state.activeNoteId)
        : String(t.id) === String(state.activeFileId);
      return {
        kind: t.kind,
        id: t.id,
        pinned: !!t.pinned,
        title: t.kind === 'note'
          ? (record.title && record.title.trim() ? record.title : 'Untitled note')
          : record.filename,
        glyph: t.kind === 'file' ? util.fileGlyph(record.filename, record.mime_type) : null,
        dirty: isActive && t.kind === 'note' && !!state.editorDirty,
        active: isActive,
      };
    }).filter(Boolean);
  }

  function focusActiveTab() {
    var active = dom.tabs && dom.tabs.querySelector('.tab.is-active');
    if (active) active.focus();
  }

  function activateTab(kind, id, opts) {
    if (kind === 'new') { openNewTab(); return; }
    var record = tabRecord(kind, id);
    if (!record) { pruneTabs(); render(); return; }
    flushPendingSave();
    state.newTabPending = false;
    if (record.workspace_id !== state.workspaceId) adoptWorkspaceOf(record.workspace_id);
    followSelection(record.folder_id || null);
    state.view = 'notes';
    if (kind === 'note') { state.activeNoteId = id; state.activeFileId = null; }
    else { state.activeFileId = id; state.activeNoteId = null; }
    if (record.folder_id) expandAncestors(record.folder_id);
    ensureTab(kind, id);
    pushTabHistory(kind, id);
    if (!opts || opts.focus !== false) state.tabFocus = true;
    render();
  }

  function openNewTab() {
    flushPendingSave();
    clearSearch();
    state.view = 'notes';
    if (pendingTabIndex() === -1) {
      makeRoom();
      state.tabs.push({ kind: 'new', id: '', pinned: false });
    }
    state.activeNoteId = null;
    state.activeFileId = null;
    state.currentNote = null;
    state.newTabPending = true;
    state.tabFocus = true;
    render();
  }

  function closeTabRef(ref) {
    var parsed = parseTabRef(ref);
    if (!parsed) return;
    flushPendingSave();
    var at = tabIndexOf(parsed.kind, parsed.id);
    if (at === -1) return;
    var wasActive = (parsed.kind === 'new' && !state.activeNoteId && !state.activeFileId)
      || (parsed.kind === 'note' && String(state.activeNoteId) === String(parsed.id))
      || (parsed.kind === 'file' && String(state.activeFileId) === String(parsed.id));
    if (parsed.kind !== 'new') pushClosedTab(parsed.kind, parsed.id);
    state.tabs.splice(at, 1);
    if (wasActive) {
      state.activeNoteId = null;
      state.activeFileId = null;
      state.currentNote = null;
      var next = state.tabs[Math.min(at, state.tabs.length - 1)];
      if (next) {
        var record = tabRecord(next.kind, next.id);
        if (record) {
          followSelection(record.folder_id || null);
          if (next.kind === 'note') state.activeNoteId = next.id;
          else state.activeFileId = next.id;
          if (record.folder_id) expandAncestors(record.folder_id);
        } else {
          pruneTabs();
        }
      }
      state.tabFocus = true;
    }
    state.newTabPending = pendingTabActive();
    render();
  }

  function closeOtherTabs(ref) {
    var parsed = parseTabRef(ref);
    if (!parsed || tabIndexOf(parsed.kind, parsed.id) === -1) return;
    flushPendingSave();
    var keeper = state.tabs[tabIndexOf(parsed.kind, parsed.id)];
    state.tabs.forEach(function (t) {
      if (!t.pinned && t !== keeper) pushClosedTab(t.kind, t.id);
    });
    state.tabs = state.tabs.filter(function (t) { return t.pinned || t === keeper; });
    activateTab(parsed.kind, parsed.id);
  }

  function closeAllTabs() {
    flushPendingSave();
    state.tabs.forEach(function (t) { if (!t.pinned) pushClosedTab(t.kind, t.id); });
    state.tabs = state.tabs.filter(function (t) { return t.pinned; });
    var stillOpen = state.activeNoteId ? tabIndexOf('note', state.activeNoteId) !== -1
      : state.activeFileId ? tabIndexOf('file', state.activeFileId) !== -1 : false;
    if (!stillOpen) {
      var first = state.tabs[0];
      var record = first && tabRecord(first.kind, first.id);
      state.activeNoteId = record && first.kind === 'note' ? first.id : null;
      state.activeFileId = record && first.kind === 'file' ? first.id : null;
      state.currentNote = null;
      if (record) pushTabHistory(first.kind, first.id);
    }
    state.view = 'notes';
    state.newTabPending = pendingTabActive();
    render();
  }

  function moveTab(ref, delta) {
    var parsed = parseTabRef(ref);
    if (!parsed) return false;
    var at = tabIndexOf(parsed.kind, parsed.id);
    var to = at + delta;
    if (at === -1 || to < 0 || to >= state.tabs.length) return false;
    var moved = state.tabs.splice(at, 1)[0];
    state.tabs.splice(to, 0, moved);
    settlePinned();
    render();
    focusTabRef(ref);
    return true;
  }

  function reorderTabs(dragRef, targetRef, before) {
    var drag = parseTabRef(dragRef);
    var target = parseTabRef(targetRef);
    if (!drag || !target) return false;
    var from = tabIndexOf(drag.kind, drag.id);
    if (from === -1) return false;
    var beforeKeys = state.tabs.map(function (t) { return t.kind + ':' + t.id; }).join('\u0001');
    var moved = state.tabs.splice(from, 1)[0];
    var at = tabIndexOf(target.kind, target.id);
    if (at === -1) {
      state.tabs.push(moved);
    } else {
      state.tabs.splice(before ? at : at + 1, 0, moved);
    }
    settlePinned();
    var afterKeys = state.tabs.map(function (t) { return t.kind + ':' + t.id; }).join('\u0001');
    if (afterKeys === beforeKeys) return false;
    render();
    focusTabRef(dragRef);
    return true;
  }

  function moveTabToEnd(ref) {
    var parsed = parseTabRef(ref);
    if (!parsed) return false;
    var at = tabIndexOf(parsed.kind, parsed.id);
    if (at === -1 || at === state.tabs.length - 1) return false;
    var moved = state.tabs.splice(at, 1)[0];
    state.tabs.push(moved);
    settlePinned();
    render();
    focusTabRef(ref);
    return true;
  }

  function focusTabRef(ref) {
    if (!dom.tabs) return;
    var node = dom.tabs.querySelector('.tab[data-id="' + String(ref).replace(/"/g, '') + '"]');
    if (node) node.focus();
  }

  function cycleTab(delta) {
    if (state.tabs.length < 2) return;
    pruneTabs();
    if (state.tabs.length < 2) return;
    var activeKey = state.activeNoteId ? 'note:' + state.activeNoteId
      : state.activeFileId ? 'file:' + state.activeFileId : null;
    var at = -1;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].kind + ':' + state.tabs[i].id === String(activeKey)) { at = i; break; }
    }
    var next = state.tabs[(at + delta + state.tabs.length) % state.tabs.length];
    if (next) activateTab(next.kind, next.id);
  }

  function paintTabDirty() {
    if (!dom.tabs) return;
    var active = dom.tabs.querySelector('.tab.is-active');
    if (!active) return;
    var isNoteTab = (active.getAttribute('data-id') || '').indexOf('note:') === 0;
    var dot = active.querySelector('.tab__dot');
    if (state.editorDirty && isNoteTab && state.activeNoteId) {
      if (!dot) {
        var close = active.querySelector('.tab__close');
        var mark = el('span', { class: 'tab__dot', 'aria-hidden': 'true' });
        if (close) active.insertBefore(mark, close);
        else active.appendChild(mark);
      }
      return;
    }
    if (dot) active.removeChild(dot);
  }

  var savedRange = null;

  function saveSelection() {
    try {
      var sel = window.getSelection();
      var body = document.getElementById('note-body');
      if (sel && sel.rangeCount && body && body.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    } catch (e) {  }
  }

  function restoreSelection() {
    var body = document.getElementById('note-body');
    if (!body) return false;
    body.focus();
    try {
      var sel = window.getSelection();
      if (sel.rangeCount) {
        var live = sel.getRangeAt(0);
        if (body.contains(live.commonAncestorContainer) && body.contains(sel.anchorNode)) {
          savedRange = live.cloneRange();
          return true;
        }
      }
      sel.removeAllRanges();
      if (savedRange && body.contains(savedRange.commonAncestorContainer)) {
        sel.addRange(savedRange);
      } else {
        var end = document.createRange();
        end.selectNodeContents(body);
        end.collapse(false);
        sel.addRange(end);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function readEditorBody() {
    var body = document.getElementById('note-body');
    if (!body || !state.currentNote) return false;
    if (body.textContent === '' && body.innerHTML !== '' && !body.querySelector('img')) {
      body.innerHTML = '';
    }
    state.currentNote.content = body.innerHTML;
    state.editorDirty = true;
    setStatus('Unsaved\u2026');
    paintTabDirty();
    saveOpenNote();
    return true;
  }

  function fmtCommand(cmd, value) {
    var body = document.getElementById('note-body');
    if (!state.currentNote || !body) return;
    if (typeof document.execCommand !== 'function') {
      util.toast('Formatting is not supported in this browser.', 'error');
      return;
    }
    if (!restoreSelection()) return;
    var before = body.innerHTML;
    document.execCommand(cmd, false, value === undefined ? null : value);
    saveSelection();
    if (body.innerHTML === before) { body.focus(); return; }
    readEditorBody();
  }

  function fmtHighlight() {
    if (!state.currentNote) return;
    var body = document.getElementById('note-body');
    if (!body || !restoreSelection()) return;
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) {
      util.toast('Select the text to highlight first.', 'info');
      return;
    }
    var range = sel.getRangeAt(0);
    var ancestor = range.commonAncestorContainer;
    ancestor = ancestor.nodeType === 3 ? ancestor.parentNode : ancestor;
    var mark = ancestor.closest ? ancestor.closest('mark') : null;
    if (mark && body.contains(mark)) {
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    } else {
      var m = document.createElement('mark');
      try {
        range.surroundContents(m);
      } catch (e) {
        m.appendChild(range.extractContents());
        range.insertNode(m);
      }
    }
    saveSelection();
    readEditorBody();
  }

  function fmtCheckbox() {
    var body = document.getElementById('note-body');
    if (!state.currentNote || !body || !restoreSelection()) return;
    var sel = window.getSelection();
    var text = '';
    try { text = sel.rangeCount ? String(sel.toString() || '') : ''; } catch (e) {  }
    var row = document.createElement('div');
    row.className = 'task-row';
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.tabIndex = -1;
    var label = document.createElement('span');
    label.textContent = text || ' ';
    row.appendChild(box);
    row.appendChild(label);
    var range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (range) {
      range.deleteContents();
      range.insertNode(row);
    } else {
      body.appendChild(row);
    }
    var caret = document.createRange();
    caret.selectNodeContents(label);
    caret.collapse(false);
    sel.removeAllRanges();
    sel.addRange(caret);
    saveSelection();
    readEditorBody();
  }

  function createLinkedNote(rawTitle) {
    var title = String(rawTitle || '').trim().slice(0, 200);
    if (!title) return Promise.resolve(null);
    var existing = App.db.resolveLinkTarget(state.workspaceId, util.normTitle(title));
    if (existing) {
      openNote(existing.id);
      return Promise.resolve(existing);
    }
    flushPendingSave();
    state.view = 'notes';
    var folderId = state.currentNote ? state.currentNote.folder_id : targetFolderId();
    return App.db.createNote(state.workspaceId, folderId || null, title).then(function (note) {
      openNote(note.id);
      util.toast('Created \u201c' + title + '\u201d.', 'success');
      return note;
    }).catch(function (err) {
      util.toast('Could not create the note: ' + err.message, 'error');
      return null;
    });
  }

  function removeLinkFromNote(noteId, rawTitle) {
    var norm = util.normTitle(rawTitle);
    if (!norm) return;
    var note = App.db.getNote(noteId);
    if (!note || typeof note.content !== 'string') return;
    var box = document.createElement('div');
    box.innerHTML = note.content;
    var changed = false;
    Array.prototype.forEach.call(box.querySelectorAll('.wikilink'), function (pill) {
      var pillTitle = pill.getAttribute('data-title')
        || String(pill.textContent || '').replace(/\u00d7$/, '');
      if (util.normTitle(pillTitle) !== norm) return;
      var prev = pill.previousSibling;
      var next = pill.nextSibling;
      pill.parentNode.removeChild(pill);
      if (prev && prev.nodeType === 3 && next && next.nodeType === 3
          && / $/.test(prev.nodeValue) && /^ /.test(next.nodeValue)) {
        next.nodeValue = next.nodeValue.replace(/^ /, '');
      }
      changed = true;
    });
    var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (textNode) {
      if (!textNode.parentNode) return;
      if (textNode.parentNode.closest && textNode.parentNode.closest('.wikilink')) return;
      var src = textNode.nodeValue;
      var pattern = /\[\[([^\[\]\n]{1,200})\]\]/g;
      var out = '';
      var last = 0;
      var match = pattern.exec(src);
      var hit = false;
      while (match) {
        if (util.normTitle(match[1]) === norm) {
          out += src.slice(last, match.index);
          last = match.index + match[0].length;
          hit = true;
        }
        match = pattern.exec(src);
      }
      if (!hit) return;
      out += src.slice(last);
      textNode.nodeValue = out.replace(/  +/g, ' ');
      changed = true;
    });
    if (!changed) {
      util.toast('That link is not in this note.', 'info');
      return;
    }
    var next = box.innerHTML;
    if (util.htmlToText(next).trim() === '') next = '';
    if (next === note.content) return;
    App.db.updateNote(noteId, note.title, next).then(function () {
      if (state.currentNote && state.currentNote.id === noteId) state.currentNote.content = next;
      render();
    }).catch(function (err) {
      util.toast('Could not remove the link: ' + err.message, 'error');
    });
  }

  function linkCandidates(query) {
    var q = util.normTitle(query);
    var all = App.db.listAllNotes(state.workspaceId);
    var items = [];
    for (var i = 0; i < all.length; i++) {
      if (state.currentNote && String(all[i].id) === String(state.currentNote.id)) continue;
      var title = all[i].title || '';
      if (!q || util.normTitle(title).indexOf(q) !== -1) {
        items.push({ id: all[i].id, title: title || 'Untitled note' });
        if (items.length >= 8) break;
      }
    }
    return items;
  }

  function openLinkSuggest(range, query, items) {
    closeLinkSuggest();
    var startNode = range.startContainer;
    if (!startNode || startNode.nodeType !== 3) return;
    var node = App.ui.renderLinkSuggest(items, items.length ? 0 : -1);
    node.addEventListener('mousedown', function (event) { event.preventDefault(); });
    var caret = range.getBoundingClientRect();
    node.style.position = 'fixed';
    node.style.left = Math.max(8, Math.round(caret.left)) + 'px';
    var below = Math.round(caret.bottom + 6);
    var room = window.innerHeight - below;
    node.style.top = (room < 120 ? Math.max(8, Math.round(caret.top - 250)) : below) + 'px';
    node.style.zIndex = 60;
    document.body.appendChild(node);
    state.linkSuggest = {
      query: query,
      items: items,
      active: items.length ? 0 : -1,
      anchorNode: startNode,
      anchorOffset: range.startOffset,
      node: node,
    };
  }

  function paintLinkSuggest() {
    var s = state.linkSuggest;
    if (!s || !s.node) return;
    var rows = s.node.querySelectorAll('.link-suggest__item');
    Array.prototype.forEach.call(rows, function (row, i) {
      var on = i === s.active;
      row.classList.toggle('is-active', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && typeof row.scrollIntoView === 'function') {
        try { row.scrollIntoView({ block: 'nearest' }); } catch (e) {  }
      }
    });
  }

  function closeLinkSuggest() {
    var s = state.linkSuggest;
    state.linkSuggest = null;
    if (s && s.node && s.node.parentNode) s.node.parentNode.removeChild(s.node);
  }

  function updateLinkSuggest() {
    var body = document.getElementById('note-body');
    if (!body || !state.currentNote) { closeLinkSuggest(); return; }
    var sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) { closeLinkSuggest(); return; }
    var range = sel.getRangeAt(0);
    var node = range.startContainer;
    if (!node || node.nodeType !== 3 || !body.contains(node)) { closeLinkSuggest(); return; }
    var match = /\[\[([^\[\]\n]{0,80})$/.exec(node.textContent.slice(0, range.startOffset));
    if (!match) { closeLinkSuggest(); return; }
    var query = match[1];
    var items = linkCandidates(query);
    var s = state.linkSuggest;
    if (s && s.query === query && s.anchorNode === node && s.items.length === items.length
        && s.items.every(function (item, i) { return items[i] && items[i].id === item.id; })) {
      return;
    }
    openLinkSuggest(range, query, items);
  }

  function completeLinkSuggest(index) {
    var s = state.linkSuggest;
    if (!s) return false;
    var item = s.items[index];
    if (!item) { closeLinkSuggest(); return false; }
    var body = document.getElementById('note-body');
    if (!body || !body.contains(s.anchorNode)) { closeLinkSuggest(); return false; }
    var start = s.anchorOffset - s.query.length - 2;
    if (start < 0) { closeLinkSuggest(); return false; }
    closeLinkSuggest();
    try {
      body.focus();
      var range = document.createRange();
      range.setStart(s.anchorNode, start);
      range.setEnd(s.anchorNode, s.anchorOffset);
      range.deleteContents();
      var pill = util.buildWikiPill(document, item.title);
      range.insertNode(pill);
      range.setStartAfter(pill);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      return false;
    }
    saveSelection();
    readEditorBody();
    return true;
  }

  function followWikiPill(title) {
    if (title === null || title === undefined) return;
    createLinkedNote(title);
  }

  function paintLinksBlock() {
    var editor = dom.main ? dom.main.querySelector('.editor') : null;
    var body = document.getElementById('note-body');
    if (!editor || !body || !state.currentNote) return;
    var note = App.db.getNote(state.currentNote.id);
    if (!note || note.locked || note.damaged || typeof note.content !== 'string') return;
    var fresh = App.ui.renderNoteLinks({
      outgoing: App.db.getOutgoingLinks(note.id),
      backlinks: App.db.getBacklinks(note.id),
    });
    var old = null;
    Array.prototype.forEach.call(editor.children, function (child) {
      if (child.classList && child.classList.contains('links')) old = child;
    });
    if (!fresh && old) old.parentNode.removeChild(old);
    else if (fresh && old) old.parentNode.replaceChild(fresh, old);
    else if (fresh && !old) {
      var toolbar = editor.querySelector('.editor__toolbar');
      if (toolbar) editor.insertBefore(fresh, toolbar);
      else editor.appendChild(fresh);
    }
  }

  var TABS_KEY = 'noteapp.tabs:';
  var CHECKPOINT_MAX = 20;

  function checkpointRead(workspaceId) {
    if (!workspaceId) return null;
    try {
      var raw = window.localStorage.getItem(TABS_KEY + workspaceId);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function checkpointWrite() {
    if (!state.ready || !state.workspaceId) return;
    try {
      window.localStorage.setItem(TABS_KEY + state.workspaceId, JSON.stringify({
        tabs: state.tabs.slice(0, CHECKPOINT_MAX).map(function (t) {
          return { kind: t.kind, id: t.id, pinned: !!t.pinned };
        }),
        noteId: state.activeNoteId,
        fileId: state.activeFileId,
      }));
    } catch (err) {
      util.toast('Could not remember the open tabs for this workspace.', 'error');
    }
  }

  function restoreCheckpoint(workspaceId) {
    var saved = checkpointRead(workspaceId);
    if (!saved) return;
    var have = {};
    state.tabs.forEach(function (t) { have[t.kind + ':' + t.id] = true; });
    (saved.tabs || [])
      .filter(function (t) { return t && (t.kind === 'note' || t.kind === 'file') && t.id && !have[t.kind + ':' + t.id]; })
      .filter(function (t) { return !!tabRecord(t.kind, t.id); })
      .slice(0, Math.max(0, CHECKPOINT_MAX - state.tabs.length))
      .forEach(function (t) {
        have[t.kind + ':' + t.id] = true;
        state.tabs.push({ kind: t.kind, id: t.id, pinned: !!t.pinned });
      });
    if (!state.activeNoteId && !state.activeFileId) {
      var note = saved.noteId ? tabRecord('note', saved.noteId) : null;
      if (note) {
        state.activeNoteId = saved.noteId;
        if (tabIndexOf('note', saved.noteId) === -1) state.tabs.push({ kind: 'note', id: saved.noteId });
      } else {
        var file = saved.fileId ? tabRecord('file', saved.fileId) : null;
        if (file) {
          state.activeFileId = saved.fileId;
          if (tabIndexOf('file', saved.fileId) === -1) state.tabs.push({ kind: 'file', id: saved.fileId });
        }
      }
    }
  }

  function restoreTabsOnly(workspaceId) {
    var place = App.prefs.get(PLACE_PREF + workspaceId, null);
    var stored = (place && place.tabs) || [];
    state.tabs = stored
      .filter(function (t) { return t && (t.kind === 'new' ? !t.id : (t.kind === 'note' || t.kind === 'file') && !!t.id); })
      .filter(function (t) { return t.kind === 'new' || !!tabRecord(t.kind, t.id); })
      .slice(0, MAX_TABS)
      .map(function (t) { return { kind: t.kind, id: t.kind === 'new' ? '' : t.id, pinned: !!t.pinned }; });
    state.newTabPending = pendingTabActive();
  }

  var DEJAVU_KEY = 'noteapp.dejavu';
  var DEJAVU_THRESHOLD = 0.6;
  var DEJAVU_MAX = 5;

  function dejavuIgnores() {
    try {
      var raw = window.localStorage.getItem(DEJAVU_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function dejavuIgnore(noteId, otherId) {
    try {
      var all = dejavuIgnores();
      all[String(noteId) + '>' + String(otherId)] = 1;
      window.localStorage.setItem(DEJAVU_KEY, JSON.stringify(all));
    } catch (err) {  }
  }

  function dejavuIgnored(noteId, otherId) {
    var all = dejavuIgnores();
    return !!all[String(noteId) + '>' + String(otherId)]
      || !!all[String(otherId) + '>' + String(noteId)];
  }

  function checkDejaVu(noteId, title) {
    state.dejavu = null;
    if (!noteId || !state.workspaceId || !App.trigram) return;
    var text = String(title || '');
    if (App.trigram.isGenericTitle(text)) return;
    var words = App.trigram.significantWords(text).slice(0, 3);
    if (!words.length) return;
    var candidates = [];
    try {
      candidates = App.db.titlesLike(state.workspaceId, words);
    } catch (err) {
      candidates = [];
    }
    var self = App.trigram.trigrams(text);
    var matches = [];
    for (var i = 0; i < candidates.length && matches.length < DEJAVU_MAX; i++) {
      var cand = candidates[i];
      if (!cand || String(cand.id) === String(noteId)) continue;
      if (App.trigram.isGenericTitle(cand.title)) continue;
      if (dejavuIgnored(noteId, cand.id)) continue;
      if (App.trigram.jaccard(self, cand.title) > DEJAVU_THRESHOLD) {
        matches.push({ id: cand.id, title: cand.title || 'Untitled note' });
      }
    }
    if (matches.length) state.dejavu = { noteId: noteId, matches: matches };
  }

  function paintDejaVuChip() {
    var title = document.getElementById('note-title');
    if (!title || !title.parentNode || !state.currentNote) return;
    var host = title.parentNode;
    var old = null;
    Array.prototype.forEach.call(host.children, function (child) {
      if (child.classList && child.classList.contains('dejavu')) old = child;
    });
    var fresh = state.dejavu && String(state.dejavu.noteId) === String(state.currentNote.id)
      ? App.ui.renderDejavuChip(state.dejavu)
      : null;
    if (old && fresh) host.replaceChild(fresh, old);
    else if (old) host.removeChild(old);
    else if (fresh) host.insertBefore(fresh, title.nextSibling);
  }

  var saveOpenNote = util.debounce(function () {
    var note = state.currentNote;
    if (!note || !state.editorDirty) return Promise.resolve();

    var id = note.id;
    note.updated_at = util.nowIso();
    state.editorDirty = false;
    setStatus('Saving\u2026');

    return App.db.updateNote(id, note.title, note.content).then(function (res) {
      if (state.currentNote && state.currentNote.id === id) {
        note.updated_at = res.updated_at;
        setStatus('Saved ' + new Date().toLocaleTimeString());
        paintLinksBlock();
      }
      paintTabDirty();
    }).catch(function (err) {
      state.editorDirty = true;
      setStatus('Save failed');
      paintTabDirty();
      util.toast('Could not save the note: ' + err.message, 'error');
    });
  }, 500);

  function setStatus(text) {
    var node = document.getElementById('note-status');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('editor__status--dirty', /Saving|Unsaved/.test(text));
    node.classList.toggle('editor__status--error', /failed/i.test(text));
  }

  function flushPendingSave() {
    if (saveOpenNote.pending()) saveOpenNote.flush();
    savePlace();
  }

  function currentWorkspace() {
    return state.workspaces.filter(function (w) { return w.id === state.workspaceId; })[0] || null;
  }

  var SORT_PREF = 'sortOrder';

  var SORT_TABLES = {
    workspaces: 'workspaces',
    tree: 'notes',
    pane: 'notes',
    files: 'files',
  };

  var SORT_PICKER = ['manual', 'name', 'created', 'updated', 'size'];

  function sortOf() {
    return state.sort || { key: 'manual', dir: 'asc' };
  }

  function positionComparator(dir) {
    var sign = dir === 'desc' ? -1 : 1;
    return function (a, b) {
      var delta = ((Number(a.position) || 0) - (Number(b.position) || 0)) * sign;
      if (delta) return delta;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    };
  }

  function serialiseSort(sort) {
    return { key: sort.key, direction: sort.dir };
  }

  function applySort() {
    var stored = App.prefs.get(SORT_PREF, null);
    var key = stored && typeof stored.key === 'string' && SORT_PICKER.indexOf(stored.key) !== -1
      ? stored.key : 'manual';
    var dir = stored && stored.direction === 'desc' ? 'desc' : 'asc';
    state.sort = { key: key, dir: dir };
    return state.sort;
  }

  var PANE_VIEW_PREF = 'paneView';

  function applyPaneView() {
    state.paneView = App.prefs.get(PANE_VIEW_PREF, null) === 'list' ? 'list' : 'tiles';
    return state.paneView;
  }

  function setPaneView(view) {
    var next = view === 'list' ? 'list' : 'tiles';
    if (next === state.paneView) return;
    state.paneView = next;
    App.prefs.set(PANE_VIEW_PREF, next);
    App.ui.applyPaneView(dom.main, next);
  }

  var SIDEBAR_W_PREF = 'sidebarWidth';
  var SIDEBAR_W_DEFAULT = 296;
  var SIDEBAR_W_MIN = 220;
  var SIDEBAR_W_MAX = 560;

  function sidebarWidthLimit() {
    return Math.max(SIDEBAR_W_MIN + 60, Math.min(SIDEBAR_W_MAX, window.innerWidth - 420));
  }

  function setSidebarWidth(px) {
    var width = Math.round(Math.max(SIDEBAR_W_MIN, Math.min(sidebarWidthLimit(), px)));
    document.documentElement.style.setProperty('--sidebar-w', width + 'px');
    if (dom.splitter) {
      dom.splitter.setAttribute('aria-valuenow', String(width));
      dom.splitter.setAttribute('aria-valuemax', String(sidebarWidthLimit()));
    }
    return width;
  }

  function storedSidebarWidth() {
    var saved = Number(App.prefs.get(SIDEBAR_W_PREF, SIDEBAR_W_DEFAULT));
    return isFinite(saved) && saved > 0 ? saved : SIDEBAR_W_DEFAULT;
  }

  function sidebarWidthNow() {
    return dom.sidebar ? dom.sidebar.getBoundingClientRect().width : storedSidebarWidth();
  }

  function applySidebarWidth() {
    return setSidebarWidth(storedSidebarWidth());
  }

  function commitSidebarWidth(px) {
    var width = setSidebarWidth(typeof px === 'number' ? px : sidebarWidthNow());
    App.prefs.set(SIDEBAR_W_PREF, width);
    return width;
  }

  function wireSplitter() {
    var splitter = dom.splitter;
    if (!splitter) return;
    splitter.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      var startX = event.clientX;
      var startWidth = sidebarWidthNow();
      splitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      function move(moveEvent) {
        setSidebarWidth(startWidth + moveEvent.clientX - startX);
      }
      function stop() {
        splitter.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        commitSidebarWidth();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    });
    splitter.addEventListener('dblclick', function () {
      commitSidebarWidth(SIDEBAR_W_DEFAULT);
    });
    splitter.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') commitSidebarWidth(sidebarWidthNow() - 12);
      else if (event.key === 'ArrowRight') commitSidebarWidth(sidebarWidthNow() + 12);
      else if (event.key === 'Home' || event.key === 'Enter') commitSidebarWidth(SIDEBAR_W_DEFAULT);
      else return;
      event.preventDefault();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth <= 820) return;
      applySidebarWidth();
    });
  }

  function setSort(key, direction) {
    if (SORT_PICKER.indexOf(key) === -1) return;
    state.sort = {
      key: key,
      dir: direction === 'asc' || direction === 'desc' ? direction : sortOf().dir,
    };
    App.prefs.set(SORT_PREF, serialiseSort(state.sort));
    refreshWorkspaces();
    render();
    paintSortButton();
  }

  function refreshWorkspaces() {
    state.workspaces = App.db.listWorkspaces(sortOf());
    if (!state.workspaces.length) {
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

  var PLACE_PREF = 'place.';

  function savePlace() {
    if (!state.ready || !state.workspaceId) return;
    var open = [];
    Object.keys(state.expanded).forEach(function (id) { if (state.expanded[id]) open.push(id); });
    App.prefs.set(PLACE_PREF + state.workspaceId, {
      expanded: open,
      selection: state.selection,
      noteId: state.activeNoteId,
      fileId: state.activeFileId,

      tabs: state.tabs.map(function (t) { return { kind: t.kind, id: t.id, pinned: !!t.pinned }; }),
      view: state.view,
      taskView: state.taskView,
    });
    checkpointWrite();
  }
  var savePlaceSoon = util.debounce(savePlace, 400);

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
    } else {
      var file = place.fileId ? App.db.getFileMeta(place.fileId) : null;
      if (file && file.workspace_id === workspaceId) {
        state.activeFileId = file.id;
        if (file.folder_id) {
          state.expanded[file.folder_id] = true;
          expandAncestors(file.folder_id);
        }
      }
    }
    state.tabs = (place.tabs || [])
      .filter(function (t) { return t && (t.kind === 'new' ? !t.id : (t.kind === 'note' || t.kind === 'file') && !!t.id); })
      .filter(function (t) { return t.kind === 'new' || !!tabRecord(t.kind, t.id); })
      .slice(0, MAX_TABS)
      .map(function (t) { return { kind: t.kind, id: t.id, pinned: !!t.pinned }; });
    if (state.activeNoteId && tabIndexOf('note', state.activeNoteId) === -1) {
      state.tabs.push({ kind: 'note', id: state.activeNoteId });
    }
    if (state.activeFileId && tabIndexOf('file', state.activeFileId) === -1) {
      state.tabs.push({ kind: 'file', id: state.activeFileId });
    }
    restoreCheckpoint(workspaceId);
    state.newTabPending = pendingTabActive();
  }

  function render() {
    if (!state.ready) return;
    closeLinkSuggest();
    var wsId = state.workspaceId;

    var sort = sortOf();
    var folders = App.db.listFolders(wsId, sort);
    var notes = App.db.listAllNotes(wsId, sort);

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
      sort: sort,
    };

    App.ui.renderWorkspaceSelect(dom.workspaceSelect, state.workspaces, wsId);

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

    if (dom.tabs) {
      App.ui.renderTabs(dom.tabs, {
        tabs: tabsViewModel(),
        hidden: state.view === 'tasks',
      });
    }

    App.ui.renderTopbarViews(dom.topbarViews, { view: state.view, open: openTaskCount() });

    App.ui.setTrashButton(dom.trashFab, deletedCount());

    deriveMobilePane();

    paintSortButton();

    if (state.sortTouched) {
      var touched = state.sortTouched;
      state.sortTouched = null;
      focusMovedRow(touched.kind, touched.id);
    }

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
    if (state.tabFocus) {
      state.tabFocus = false;
      focusActiveTab();
    }

    savePlaceSoon();
  }

  function renderMainPane(treeModel) {
    App.ui.revokeObjectUrls();

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
          dejavu: state.dejavu && String(state.dejavu.noteId) === String(note.id) ? state.dejavu : null,
          chain: note.folder_id ? App.db.folderChains(state.workspaceId)[note.folder_id] : [],
          links: note.locked || note.damaged || typeof note.content !== 'string' ? null : {
            outgoing: App.db.getOutgoingLinks(note.id),
            backlinks: App.db.getBacklinks(note.id),
          },
        });
        return;
      }
      state.activeNoteId = null;
    }

    if (state.activeFileId) {
      var meta = App.db.getFileMeta(state.activeFileId);
      if (meta) {
        state.currentFile = meta;
        var fileLocked = App.db.locked();
        App.ui.renderFilePreview(dom.main, {
          file: meta,
          previewLoader: fileLocked ? null : function () { return App.db.getFileBlob(meta.id); },
          preview: filePreviewFor(meta),
          locked: fileLocked,
          chain: meta.folder_id ? App.db.folderChains(state.workspaceId)[meta.folder_id] : [],
        });
        return;
      }
      state.activeFileId = null;
    }

    if (state.bulkScope !== bulkScopeKey()) {
      state.bulkSelected = [];
      state.bulkKinds = {};
      state.bulkScope = bulkScopeKey();
    } else if (state.bulkSelected.length) {
      var liveBulk = {};
      treeModel.folders.forEach(function (f) { liveBulk[f.id] = true; });
      treeModel.rootNotes.forEach(function (n) { liveBulk[n.id] = true; });
      treeModel.rootFiles.forEach(function (f) { liveBulk[f.id] = true; });
      Object.keys(treeModel.notesByFolder).forEach(function (fid) {
        treeModel.notesByFolder[fid].forEach(function (n) { liveBulk[n.id] = true; });
      });
      Object.keys(treeModel.filesByFolder).forEach(function (fid) {
        treeModel.filesByFolder[fid].forEach(function (f) { liveBulk[f.id] = true; });
      });
      var prunedBulk = state.bulkSelected.filter(function (id) { return !!liveBulk[id]; });
      if (prunedBulk.length !== state.bulkSelected.length) {
        state.bulkSelected = prunedBulk;
        var keptKinds = {};
        prunedBulk.forEach(function (id) { if (state.bulkKinds[id]) keptKinds[id] = state.bulkKinds[id]; });
        state.bulkKinds = keptKinds;
      }
    }
    var folderBytes = App.db.subtreeBytes(state.workspaceId);
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
          folderBytes: folderBytes,
          activeNoteId: state.activeNoteId,
          activeFileId: state.activeFileId,
          bulkSelected: state.bulkSelected,
      bulkFloat: state.bulkFloat,
          bulkFloat: state.bulkFloat,
          focused: state.focused,
          paneView: state.paneView,
          onSetPaneView: setPaneView,
          preview: previewFor(treeModel),
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
      folderBytes: folderBytes,
      notes: treeModel.rootNotes,
      files: treeModel.rootFiles,
      activeNoteId: state.activeNoteId,
      activeFileId: state.activeFileId,
      bulkSelected: state.bulkSelected,
      bulkFloat: state.bulkFloat,
      focused: state.focused,
      paneView: state.paneView,
      onSetPaneView: setPaneView,
      preview: previewFor(treeModel),
    });
  }

  function taskTargetFolder() {
    return state.selection.type === 'folder' ? state.selection.id : null;
  }

  function openTaskCount() {
    try {
      return App.db.countOpenTasks(state.workspaceId);
    } catch (err) {
      return 0;
    }
  }

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

  function renderTasksPane() {
    var keep = state.taskScrollReset ? 0 : dom.main.scrollTop;
    state.taskScrollReset = false;
    App.ui.renderTasks(dom.main, taskModel());
    dom.main.scrollTop = keep;
  }

  function showTasks(on) {
    flushPendingSave();
    state.view = on ? 'tasks' : 'notes';
    if (on) {
      state.taskScrollReset = true;
      state.railFocus = true;
    }
    render();
  }

  var TASK_VIEWS = ['all', 'today', 'upcoming', 'done'];

  function setTaskView(view) {
    if (TASK_VIEWS.indexOf(view) === -1) return;
    if (view === state.taskView) return;
    state.taskView = view;
    state.taskScrollReset = true;
    render();
  }

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
    if (!text) return Promise.resolve(null);
    return App.db.createTask(state.workspaceId, taskTargetFolder(), text, {}).then(function (task) {
      state.taskDraft = '';
      state.taskAddFocus = true;
      if (task && task.folder_id) expandAncestors(task.folder_id);
      render();
      return task;
    }).catch(function (err) {
      util.toast('Could not add the task: ' + err.message, 'error');
      return null;
    });
  }

  function toggleTaskDone(id, done) {
    App.db.setTaskDone(id, done).then(function (result) {
      render();
      if (result && result.repeated) {
        util.toast('Repeating task moved to ' + util.formatWhen(result.repeated) + '.', 'success', 8000);
      }
    }).catch(function (err) {
      util.toast('Could not update the task: ' + err.message, 'error');
    });
  }

  function taskField(label, control, id) {
    return el('div', { class: 'field' }, [
      id
        ? el('label', { class: 'field__label', for: id, text: label })
        : el('span', { class: 'field__label', text: label }),
      control,
    ]);
  }

  function dateInputValue(iso) {
    var when = new Date(iso);
    if (!iso || isNaN(when.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate());
  }

  function timeInputValue(iso) {
    var when = new Date(iso);
    if (!iso || isNaN(when.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(when.getHours()) + ':' + pad(when.getMinutes());
  }

  function reminderPreset(dueAt, remindAt) {
    if (!dueAt || !remindAt) return '';
    var due = new Date(dueAt).getTime();
    var remind = new Date(remindAt).getTime();
    if (isNaN(due) || isNaN(remind)) return '';
    var minutes = Math.round((due - remind) / 60000);
    return minutes < 0 ? '' : String(minutes);
  }
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
    dueTime.disabled = allDay.input.checked;
    allDay.input.addEventListener('change', function () {
      dueTime.disabled = allDay.input.checked;
      if (!dueTime.disabled && !dueTime.value) dueTime.value = '09:00';
    });

    var repeat = App.ui.select({
      label: 'Repeat',
      value: repeatFreq(task.recurrence),
      options: [
        { value: '', label: 'Does not repeat' },
        { value: 'daily', label: 'Every day' },
        { value: 'weekdays', label: 'Every weekday' },
        { value: 'weekly', label: 'Every week' },
        { value: 'monthly', label: 'Every month' },
        { value: 'yearly', label: 'Every year' },
      ],
    });
    var remind = App.ui.select({
      label: 'Remind me',
      value: reminderPreset(task.due_at, task.remind_at),
      options: [
        { value: '', label: 'No reminder' },
        { value: '0', label: 'At the due time' },
        { value: '10', label: '10 minutes before' },
        { value: '60', label: '1 hour before' },
        { value: '1440', label: '1 day before' },
      ],
    });
    var hints = ['A reminder is measured from the due date, so a task without one cannot remind.'];
    if (typeof Notification === 'undefined') {
      hints.push('This browser has no notifications, so reminders are announced inside the app.');
    } else if (Notification.permission === 'denied') {
      hints.push('Notifications are blocked for this page, so reminders are announced inside the app.');
    }
    var reminderHint = el('p', { class: 'task-form__hint', text: hints.join(' ') });
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
      el('div', { class: 'task-form__row' }, [
        taskField('Repeat', repeat, null),
        taskField('Remind me', remind, null),
      ]),
      reminderHint,
      reminderHint,
    ]);
    return {
      root: root,
      read: function () {
        var hasTime = !allDay.input.checked;
        var due = null;
        if (dueDate.value) {
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
          due_has_time: due && hasTime ? 1 : 0,
          priority: Number(priority.getValue()) || 0,
          remind_at: due && remind.getValue() !== ''
            ? new Date(new Date(due).getTime() - Number(remind.getValue()) * 60000).toISOString()
            : null,
          recurrence: repeat.getValue() ? { freq: repeat.getValue() } : null,
        };
      },
    };
  }

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
        var fields = form.read();
        var ready = fields.remind_at ? ensureNotifyPermission() : Promise.resolve(null);
        return ready.then(function () {
          return App.db.updateTask(id, fields);
        }).then(function (ok) {
          if (!ok) throw new Error('That task is no longer in the list.');
          return true;
        });
      },
    }).then(function (saved) {
      if (!saved) return;
      render();
    });
  }

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
  function targetFolderId() {
    return state.selection.type === 'folder' ? state.selection.id : null;
  }

  function newNote() {
    flushPendingSave();
    clearSearch();
    state.view = 'notes';
    return App.db.createNote(state.workspaceId, targetFolderId(), 'Untitled note').then(function (note) {
      if (note.folder_id) expandAncestors(note.folder_id);
      state.activeFileId = null;
      state.activeNoteId = null;
      state.selection = note.folder_id ? { type: 'folder', id: note.folder_id } : state.selection;
      selectNewItem('note', note.id);
    }).catch(function (err) {
      util.toast('Could not create the note: ' + err.message, 'error');
    });
  }

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

  function holdsTheSelection(folderId) {
    if (!folderId) return false;
    var subtree = App.db.descendantFolderIdsAll(folderId);
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

  function adoptWorkspaceOf(workspaceId) {
    if (!workspaceId || workspaceId === state.workspaceId) return;
    flushPendingSave();
    savePlace();
    state.workspaceId = workspaceId;
    state.selection = { type: 'all', id: null };
    state.expanded = {};
    state.activeNoteId = null;
    state.activeFileId = null;
    state.currentNote = null;
    restoreTabsOnly(workspaceId);
    App.prefs.set('lastWorkspaceId', workspaceId);
  }

  function followSelection(homeFolderId) {
    var home = homeFolderId || null;
    if (state.selection.type !== 'folder' || state.selection.id === home) return;
    if (!home) delete state.expanded[state.selection.id];
    state.selection = home ? { type: 'folder', id: home } : { type: 'all', id: null };
  }

  function goToFolder(id) {
    if (!id || !App.db.folderPaths(state.workspaceId)[id]) return;
    flushPendingSave();
    clearSearch();
    expandAncestors(id);
    state.expanded[id] = true;
    state.view = 'notes';
    state.selection = { type: 'folder', id: id };
    state.activeNoteId = null;
    state.activeFileId = null;
    render();
    focusMovedRow('folder', id);
  }

  function clearSearch() {
    if (!state.searchTerm) {
      if (dom.searchInput && dom.searchInput.value) dom.searchInput.value = '';
      return;
    }
    if (runSearch && runSearch.cancel) runSearch.cancel();
    state.searchTerm = '';
    if (dom.searchInput) dom.searchInput.value = '';
  }

  function openNote(id, opts) {
    flushPendingSave();
    var note = App.db.getNote(id);
    if (!note) { pruneTabs(); render(); return; }
    clearSearch();
    adoptWorkspaceOf(note.workspace_id);
    followSelection(note.folder_id);
    state.dejavu = null;
    state.view = 'notes';
    state.activeFileId = null;
    state.activeNoteId = id;
    if (note.folder_id) expandAncestors(note.folder_id);
    ensureTab('note', id);
    if (!opts || !opts.background) pushTabHistory('note', id);
    mobilePaneKey = null;
    if (opts && opts.background) { render(); return; }
    render();
  }

  function deleteNote(id) {
    var note = App.db.getNote(id);
    if (!note) return;
    var label = note.title && note.title.trim() ? note.title : 'Untitled note';
    var words = util.htmlToText(note.content || '').trim().split(/\s+/).filter(Boolean).length;

    App.ui.dialog({
      title: 'Delete this note?',
      icon: 'trash',
      danger: true,
      message: '\u201c' + label + '\u201d will be removed from this browser.',
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
        state.tabs = state.tabs.filter(function (t) {
          return !(t.kind === 'note' && String(t.id) === String(id));
        });
        util.toast('Note deleted.', 'info');
        render();
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }

  function deleteBulkItems(items) {
    var list = (items || []).filter(function (item) { return item && item.id; });
    if (!list.length) return;
    var notes = list.filter(function (i) { return i.kind === 'note'; });
    var files = list.filter(function (i) { return i.kind === 'file'; });
    var folders = list.filter(function (i) { return i.kind === 'folder'; });
    var parts = [];
    if (folders.length) parts.push(folders.length + ' folder' + (folders.length === 1 ? '' : 's'));
    if (notes.length) parts.push(notes.length + ' note' + (notes.length === 1 ? '' : 's'));
    if (files.length) parts.push(files.length + ' file' + (files.length === 1 ? '' : 's'));
    var label = parts.join(', ');
    App.ui.dialog({
      title: 'Delete ' + label + '?',
      icon: 'trash',
      danger: true,
      message: label + ' will be removed from this browser.',
      consequences: [
        'They stay in the trash until removed for good, and can be restored from there.',
        folders.length
          ? 'Everything inside a deleted folder goes with it.'
          : 'Export the database from Settings first if any of it matters.',
      ],
      confirmLabel: 'Delete ' + label,
    }).then(function (ok) {
      if (!ok) return;
      saveOpenNote.cancel();
      var work = [];
      if (notes.length) work.push(App.db.bulkDeleteNotes(notes.map(function (i) { return i.id; })));
      files.forEach(function (i) { work.push(App.db.deleteFile(i.id)); });
      folders.forEach(function (i) { work.push(App.db.deleteFolder(i.id)); });
      Promise.all(work).then(function () {
        var gone = {};
        list.forEach(function (i) { gone[i.id] = i.kind; });
        if (state.activeNoteId && gone[state.activeNoteId] === 'note') {
          state.activeNoteId = null;
          state.currentNote = null;
        }
        if (state.activeFileId && gone[state.activeFileId] === 'file') state.activeFileId = null;
        folders.forEach(function (i) {
          var doomed = App.db.descendantFolderIds(i.id) || [];
          if (state.selection.type === 'folder' && doomed.indexOf(state.selection.id) !== -1) {
            state.selection = { type: 'all', id: null };
          }
          if (state.activeNoteId) {
            var openNote = App.db.getNote(state.activeNoteId);
            if (openNote && doomed.indexOf(openNote.folder_id) !== -1) {
              state.activeNoteId = null;
              state.currentNote = null;
            }
          }
          if (state.activeFileId) {
            var openFile = App.db.getFileMeta(state.activeFileId);
            if (openFile && doomed.indexOf(openFile.folder_id) !== -1) state.activeFileId = null;
          }
        });
        state.tabs = state.tabs.filter(function (t) { return !(t.kind === 'note' && gone[t.id] === 'note'); });
        clearBulkSelection();
        util.toast(label + ' deleted.', 'info');
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
        checkDejaVu(id, next);
        render();
      }).catch(function (err) {
        util.toast('Rename failed: ' + err.message, 'error');
      });
    });
  }

  function openMovePanel(kind, id) {
    if (movePanel) return;
    var itemList = Array.isArray(id) && id.length && typeof id[0] === 'object' ? id : null;
    if (itemList) id = null;
    var ids = !itemList && Array.isArray(id) ? id.filter(function (nid) { return !!App.db.getNote(nid); }) : null;
    if (ids && !ids.length) return;
    if (itemList && !itemList.length) return;
    if (!ids && !itemList) {
      if (kind === 'folder') {
        var folderList = App.db.listFolders(state.workspaceId);
        var exists = folderList.some(function (f) { return f.id === id; });
        if (!exists) return;
        if (App.db.listWorkspaces().length < 2) {
          util.toast('No other workspace exists to move to.', 'info');
          return;
        }
      } else if (kind === 'note') {
        if (!App.db.getNote(id)) return;
      } else {
        if (!App.db.getFileMeta(id)) return;
      }
    }
    state.moveKind = kind;
    state.moveId = ids ? null : id;
    state.moveIds = ids;
    state.moveItems = itemList;
    state.moveTerm = '';
    state.moveView = 'all';

    App.ui.dialog({
      title: itemList ? 'Move ' + itemList.length + ' item' + (itemList.length === 1 ? '' : 's')
        : ids ? 'Move ' + ids.length + ' notes' : kind === 'note' ? 'Move note' : kind === 'file' ? 'Move file' : 'Move folder',
      fullscreen: true,
      hideHeader: true,
      hideFooter: true,
      closeOnBackdrop: false,
      focus: '#move-search',
      onOpen: function (api) {
        App.ui.renderMovePanel(api.body, Object.assign(moveModel(), {
          onPick: pickMoveDestination,
          onSearch: function (term) {
            state.moveTerm = String(term || '');
            refreshMovePanel();
          },
          onView: function (view) {
            state.moveView = view;
            refreshMovePanel();
          },
          onClose: closeMovePanel,
        }));
        movePanel = api.body;
        movePanel.__close = api.close;
      },
    }).then(function () {
      movePanel = null;
      state.moveTerm = '';
      state.moveIds = null;
      state.moveItems = null;
    });
  }

  function moveModel() {
    var kind = state.moveKind;
    var id = state.moveId;
    var workspaces = App.db.listWorkspaces();
    var countsByWs = {};
    workspaces.forEach(function (ws) {
      try { countsByWs[ws.id] = App.db.counts(ws.id); } catch (e) { countsByWs[ws.id] = null; }
    });
    if (kind === 'folder') {
      var theirs = App.db.listFolders(state.workspaceId);
      var folder = theirs.filter(function (f) { return f.id === id; })[0];
      return {
        mode: 'workspace', icon: 'folder',
        title: 'Move folder',
        sub: 'Move \u201c' + (folder ? folder.name : 'folder') + '\u201d and everything inside it to another workspace.',
        workspaces: workspaces, foldersByWs: {}, countsByWs: countsByWs,
        currentWsId: state.workspaceId,
        term: state.moveTerm || '',
        view: state.moveView || 'all',
        footNote: 'The whole subtree moves with it.',
      };
    }
    if (state.moveItems && state.moveItems.length) {
      var foldersByWsItems = {};
      workspaces.forEach(function (ws) {
        foldersByWsItems[ws.id] = App.db.listFolders(ws.id);
      });
      return {
        mode: 'place', icon: 'note',
        title: 'Move ' + state.moveItems.length + ' item' + (state.moveItems.length === 1 ? '' : 's'),
        sub: 'Move the selection to another folder or workspace.',
        workspaces: workspaces, foldersByWs: foldersByWsItems, countsByWs: countsByWs,
        currentWsId: null,
        currentFolderId: null,
        term: state.moveTerm || '',
        view: state.moveView || 'all',
      };
    }
    if (state.moveIds && state.moveIds.length) {
      var foldersByWsBulk = {};
      workspaces.forEach(function (ws) {
        foldersByWsBulk[ws.id] = App.db.listFolders(ws.id);
      });
      return {
        mode: 'place', icon: 'note',
        title: 'Move ' + state.moveIds.length + ' notes',
        sub: 'Move ' + state.moveIds.length + ' notes to another folder or workspace.',
        workspaces: workspaces, foldersByWs: foldersByWsBulk, countsByWs: countsByWs,
        currentWsId: null,
        currentFolderId: null,
        term: state.moveTerm || '',
        view: state.moveView || 'all',
      };
    }
    var item = kind === 'note' ? App.db.getNote(id) : App.db.getFileMeta(id);
    var label = kind === 'note'
      ? (item && item.title && item.title.trim() ? item.title : 'Untitled note')
      : (item ? item.filename : 'file');
    var foldersByWs = {};
    workspaces.forEach(function (ws) {
      foldersByWs[ws.id] = App.db.listFolders(ws.id);
    });
    return {
      mode: 'place', icon: kind,
      title: kind === 'note' ? 'Move note' : 'Move file',
      sub: 'Move \u201c' + label + '\u201d to another folder or workspace.',
      workspaces: workspaces, foldersByWs: foldersByWs, countsByWs: countsByWs,
      currentWsId: item ? item.workspace_id : null,
      currentFolderId: item ? (item.folder_id || null) : null,
      term: state.moveTerm || '',
      view: state.moveView || 'all',
    };
  }

  function refreshMovePanel() {
    if (!movePanel || !movePanel.__refresh) return;
    movePanel.__refresh(moveModel());
  }

  function closeMovePanel() {
    if (movePanel && movePanel.__close) movePanel.__close(null);
  }

  function pickMoveDestination(wsId, folderId) {
    var kind = state.moveKind;
    var id = state.moveId;
    var targetFolder = folderId || null;
    closeMovePanel();
    if (state.moveItems && state.moveItems.length) {
      var chosen = state.moveItems.slice();
      var noteIds = chosen.filter(function (i) { return i.kind === 'note'; }).map(function (i) { return i.id; });
      var moves = [];
      if (noteIds.length) moves.push(App.db.bulkMoveNotes(noteIds, wsId, targetFolder));
      chosen.forEach(function (i) {
        if (i.kind === 'file') {
          var meta = App.db.getFileMeta(i.id);
          if (meta && (String(meta.workspace_id) !== String(wsId) || String(meta.folder_id || '') !== String(targetFolder || ''))) {
            moves.push(App.db.moveFile(i.id, wsId, targetFolder));
          }
        } else if (i.kind === 'folder') {
          moves.push(App.db.moveFolderTo(i.id, wsId, targetFolder));
        }
      });
      Promise.all(moves).then(function () {
        if (targetFolder && wsId === state.workspaceId) state.expanded[targetFolder] = true;
        if (state.activeNoteId && noteIds.some(function (nid) { return String(nid) === String(state.activeNoteId); })
          && wsId !== state.workspaceId) {
          state.activeNoteId = null;
          state.currentNote = null;
        }
        clearBulkSelection();
        util.toast(chosen.length + (chosen.length === 1 ? ' item moved.' : ' items moved.'), 'success');
        render();
      }).catch(function (err) {
        util.toast('Move failed: ' + err.message, 'error');
      });
      return;
    }
    if (state.moveIds && state.moveIds.length) {
      var todo = state.moveIds.filter(function (nid) {
        var n = App.db.getNote(nid);
        return n && (String(n.workspace_id) !== String(wsId) || String(n.folder_id || '') !== String(targetFolder || ''));
      });
      if (!todo.length) return;
      App.db.bulkMoveNotes(todo, wsId, targetFolder).then(function () {
        if (state.activeNoteId && todo.some(function (nid) { return String(nid) === String(state.activeNoteId); }) && wsId !== state.workspaceId) {
          state.activeNoteId = null;
          state.currentNote = null;
        }
        if (targetFolder && wsId === state.workspaceId) state.expanded[targetFolder] = true;
        clearBulkSelection();
        util.toast(todo.length + (todo.length === 1 ? ' note moved.' : ' notes moved.'), 'success');
        render();
      }).catch(function (err) {
        util.toast('Move failed: ' + err.message, 'error');
      });
      return;
    }
    if (kind === 'note') {
      var note = App.db.getNote(id);
      if (!note) return;
      if (String(note.workspace_id) === String(wsId) && String(note.folder_id || '') === String(targetFolder || '')) return;
      App.db.moveNote(id, wsId, targetFolder).then(function () {
        if (state.activeNoteId === id && wsId !== state.workspaceId) state.activeNoteId = null;
        if (targetFolder && wsId === state.workspaceId) state.expanded[targetFolder] = true;
        util.toast('Note moved.', 'success');
        render();
      }).catch(function (err) {
        util.toast('Move failed: ' + err.message, 'error');
      });
      return;
    }
    if (kind === 'file') {
      var meta = App.db.getFileMeta(id);
      if (!meta) return;
      if (String(meta.workspace_id) === String(wsId) && String(meta.folder_id || '') === String(targetFolder || '')) return;
      App.db.moveFile(id, wsId, targetFolder).then(function () {
        if (state.activeFileId === id && wsId !== state.workspaceId) state.activeFileId = null;
        if (targetFolder && wsId === state.workspaceId) state.expanded[targetFolder] = true;
        util.toast('File moved.', 'success');
        render();
      }).catch(function (err) {
        util.toast('Move failed: ' + err.message, 'error');
      });
      return;
    }
    if (String(wsId) === String(state.workspaceId)) return;
    var allWorkspaces = App.db.listWorkspaces();
    App.db.moveFolder(id, wsId).then(function () {
      var doomedIds = App.db.descendantFolderIds(id);
      if (state.selection.type === 'folder' && doomedIds.indexOf(state.selection.id) !== -1) {
        state.selection = { type: 'all', id: null };
      }
      if (state.activeNoteId) {
        var openNote = App.db.getNote(state.activeNoteId);
        if (openNote && doomedIds.indexOf(openNote.folder_id) !== -1) state.activeNoteId = null;
      }
      if (state.activeFileId) {
        var openFile = App.db.getFileMeta(state.activeFileId);
        if (openFile && doomedIds.indexOf(openFile.folder_id) !== -1) state.activeFileId = null;
      }
      util.toast('Folder moved to \u201c' + (allWorkspaces.filter(function (w) { return w.id === wsId; })[0] || { name: wsId }).name + '\u201d.', 'success');
      render();
    }).catch(function (err) {
      util.toast('Move failed: ' + err.message, 'error');
    });
  }

  function moveNote(id) { openMovePanel('note', id); }

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
        selectNewItem('folder', folder.id);
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

  function moveFolder(id) { openMovePanel('folder', id); }

  function deleteFolder(id) {
    var folders = App.db.listFolders(state.workspaceId);
    var folder = folders.filter(function (f) { return f.id === id; })[0];
    if (!folder) return;

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

  function folderPaths() {
    return App.db.folderPaths(state.workspaceId);
  }

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

  function trashModel() {
    var trash = App.db.listTrash(state.workspaceId);
    var known = {};
    trash.folders.forEach(function (f) { known['folder:' + f.id] = true; });
    trash.notes.forEach(function (n) { known['note:' + n.id] = true; });
    trash.files.forEach(function (f) { known['file:' + f.id] = true; });
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

    state.trashView = 'all';
    state.trashTerm = '';
    state.trashSelected = [];

    App.ui.dialog({
      title: 'Trash',
      fullscreen: true,
      hideHeader: true,
      hideFooter: true,
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

  function bulkScopeKey() {
    return state.workspaceId + '|' + state.selection.type + '|' + (state.selection.id || '')
      + '|' + state.view + '|' + (state.searchTerm || '');
  }

  function clearBulkSelection() {
    state.bulkSelected = [];
    state.bulkKinds = {};
    state.bulkScope = bulkScopeKey();
  }

  function bulkItems() {
    return state.bulkSelected.map(function (id) {
      return { id: id, kind: state.bulkKinds[id] || 'note' };
    });
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

  function purgeSummary(ids) {
    var parsed = parseTrashIds(ids);
    var trash = App.db.listTrash(state.workspaceId);
    var records = [];
    trash.folders.forEach(function (f) { if (parsed.folders.indexOf(f.id) !== -1) records.push({ kind: 'folder', id: f.id, folder_id: f.parent_folder_id }); });
    trash.notes.forEach(function (n) { if (parsed.notes.indexOf(n.id) !== -1) records.push({ kind: 'note', id: n.id, folder_id: n.folder_id }); });
    trash.files.forEach(function (f) { if (parsed.files.indexOf(f.id) !== -1) records.push({ kind: 'file', id: f.id, folder_id: f.folder_id }); });

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

  function openFile(id, opts) {
    flushPendingSave();
    var meta = App.db.getFileMeta(id);
    if (!meta) { pruneTabs(); render(); return; }
    clearSearch();
    adoptWorkspaceOf(meta.workspace_id);
    followSelection(meta.folder_id);
    state.view = 'notes';
    state.activeNoteId = null;
    state.activeFileId = id;
    ensureTab('file', id);
    if (!opts || !opts.background) pushTabHistory('file', id);
    mobilePaneKey = null;
    if (opts && opts.background) { render(); return; }
    render();
  }

  function writeBlobDownload(resolved) {
    var url = URL.createObjectURL(resolved.blob);
    var link = el('a', { href: url, download: resolved.filename });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function downloadFile(id) {
    App.db.getFileBlob(id).then(function (resolved) {
      if (resolved) writeBlobDownload(resolved);
    }, function (err) {
      util.toast('Could not read the file: ' + err.message, 'error');
    });
  }

  function openFileInTab(id) {
    var openResolved = function (target) {
      var url = URL.createObjectURL(target.blob);
      var win = null;
      try {
        win = window.open(url, '_blank');
      } catch (err) {
        win = null;
      }
      if (!win) {
        URL.revokeObjectURL(url);
        util.toast('This browser will not open local files in a tab here. Downloading instead.', 'info');
        downloadFile(id);
        return;
      }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    };
    App.db.getFileBlob(id).then(function (resolved) {
      if (resolved) openResolved(resolved);
    }, function (err) {
      util.toast('Could not read the file: ' + err.message, 'error');
    });
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
        state.tabs = state.tabs.filter(function (t) {
          return !(t.kind === 'file' && String(t.id) === String(id));
        });
        util.toast('File deleted.', 'info');
        render();
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }

  function moveFile(id) { openMovePanel('file', id); }

  function attachmentProbe(blob) {
    var head = Math.min(65536, blob.size);
    return Promise.all([
      blob.slice(0, head).arrayBuffer(),
      blob.slice(Math.max(0, blob.size - head)).arrayBuffer(),
    ]);
  }

  function sameAttachment(ours, theirs) {
    for (var i = 0; i < ours.length; i++) {
      var a = new Uint8Array(ours[i]);
      var b = new Uint8Array(theirs[i]);
      if (a.length !== b.length) return false;
      for (var j = 0; j < a.length; j++) {
        if (a[j] !== b[j]) return false;
      }
    }
    return true;
  }

  function duplicateAttachment(workspaceId, folderId, name, payload) {
    var file = payload && typeof payload.slice === 'function' ? payload : new Blob([payload]);
    var size = file.size;
    var rows = App.db.listFilesIn(workspaceId, folderId || null) || [];
    var same = rows.filter(function (row) {
      return row.filename === name && Number(row.size) === size;
    });
    if (!same.length) return Promise.resolve(null);
    var mine = attachmentProbe(file);
    var chain = Promise.resolve(null);
    same.forEach(function (row) {
      chain = chain.then(function (found) {
        if (found) return found;
        return App.db.getFileBlob(row.id).then(function (stored) {
          if (!stored || !stored.blob || stored.blob.size !== size) return null;
          return attachmentProbe(stored.blob).then(function (theirs) {
            return mine.then(function (ours) {
              return sameAttachment(ours, theirs) ? row : null;
            });
          });
        }, function () {
          return null;
        });
      });
    });
    return chain;
  }

  function uploadFiles(fileList, folderId) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var done = 0;
    var added = 0;
    var addedIds = [];
    var addedName = '';
    var repeated = 0;
    var repeatedName = '';
    App.ui.setUploadStatus('Uploading 0/' + files.length + '\u2026');

    files.forEach(function (file) {
      uploadQueue = uploadQueue.then(function () {
        return duplicateAttachment(state.workspaceId, folderId, file.name, file).then(function (already) {
          if (already) {
            repeated++;
            if (!repeatedName) repeatedName = file.name;
            return null;
          }
          return App.db.addFile(
            state.workspaceId,
            folderId || null,
            file.name,
            file.type || guessMime(file.name),
            file
          ).then(function (row) {
            added++;
            addedIds.push(row && row.id);
            if (!addedName) addedName = file.name;
          });
        });
      }).then(function () {
        done++;
        App.ui.setUploadStatus(done < files.length ? 'Uploading ' + done + '/' + files.length + '\u2026' : '');
        if (done === files.length) {
          if (folderId) state.expanded[folderId] = true;
          if (added) {
            util.toast(added === 1 ? 'Added \u201c' + addedName + '\u201d.' : 'Added ' + added + ' files.', 'success');
          }
          if (repeated) {
            util.toast(repeated === 1
              ? '\u201c' + repeatedName + '\u201d is already attached.'
              : repeated + ' files were already attached.', 'info');
          }
          if (addedIds.length) selectNewItems('file', addedIds.filter(Boolean));
          else render();
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

  function switchWorkspace(id) {
    flushPendingSave();
    savePlace();
    state.workspaceId = id;
    state.selection = { type: 'all', id: null };
    state.activeNoteId = null;
    state.activeFileId = null;
    state.currentNote = null;
    state.tabs = [];
    state.expanded = {};
    clearSearch();
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

  function wsPickerModel() {
    var countsById = {};
    state.workspaces.forEach(function (ws) {
      try { countsById[ws.id] = App.db.counts(ws.id); } catch (e) { countsById[ws.id] = null; }
    });
    return {
      workspaces: state.workspaces,
      currentId: state.workspaceId,
      term: state.wsPickerTerm || '',
      countsById: countsById,
    };
  }

  function refreshWsPicker() {
    if (!wsPickerPanel || !wsPickerPanel.__refresh) return;
    wsPickerPanel.__refresh(wsPickerModel());
  }

  function openWorkspacePicker() {
    if (wsPickerPanel) return;
    state.wsPickerTerm = '';
    App.ui.dialog({
      title: 'Workspaces',
      fullscreen: true,
      hideHeader: true,
      hideFooter: true,
      closeOnBackdrop: false,
      focus: '#ws-search',
      onOpen: function (api) {
        App.ui.renderWorkspacePanel(api.body, Object.assign(wsPickerModel(), {
          onPick: function (id) {
            if (api.body && api.body.__close) api.body.__close(null);
            if (id && id !== state.workspaceId) switchWorkspace(id);
          },
          onNew: function () {
            if (api.body && api.body.__close) api.body.__close(null);
            addWorkspace();
          },
          onSearch: function (term) {
            state.wsPickerTerm = String(term || '');
            refreshWsPicker();
          },
          onClose: function () {
            if (api.body && api.body.__close) api.body.__close(null);
          },
        }));
        wsPickerPanel = api.body;
        wsPickerPanel.__close = api.close;
      },
    }).then(function () {
      wsPickerPanel = null;
      state.wsPickerTerm = '';
    });
  }

  function deleteWorkspace() {
    var ws = currentWorkspace();
    if (!ws) return;
    var counts = App.db.counts(ws.id);

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
          state.currentNote = null;
          state.tabs = [];
          state.expanded = {};
          return refreshWorkspaces();
        }).then(render);
      },
    }).catch(function (err) {
      util.toast('Delete failed: ' + err.message, 'error');
    });
  }

  var runSearch = util.debounce(function (term) {
    state.searchTerm = term;
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

  function openSettings() {
    var info = storageInfo({ withBytes: true });

    App.ui.renderStorageInfo(dom.storageInfo, info);
    renderVaultSection();
    syncPaletteControl();
    if (typeof dom.settingsDialog.showModal === 'function') dom.settingsDialog.showModal();
    else dom.settingsDialog.setAttribute('open', '');

    App.storage.estimate().then(function (est) {
      if (!est) return;
      state.estimate = est;
      var next = storageInfo({ withBytes: true });
      App.ui.renderStorageInfo(dom.storageInfo, next);
      renderFooter();
    });
  }

  function closeSettings() {
    if (typeof dom.settingsDialog.close === 'function') dom.settingsDialog.close();
    else dom.settingsDialog.removeAttribute('open');
  }

  function exportDatabase() {
    App.db.exportSnapshot().then(function (bytes) {
      downloadDatabase(bytes);
    }, function (err) {
      util.toast('Export failed: ' + err.message, 'error');
    });
  }

  function downloadDatabase(bytes) {
    try {
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

  var MIN_PASSWORD = 8;

  function renderVaultSection() {
    if (!dom.vaultInfo || !dom.vaultActions) return;
    App.ui.renderVaultSection(dom.vaultInfo, dom.vaultActions, App.db.vaultInfo());
  }

  function passwordField(label, helper, autocomplete) {
    return App.ui.field({
      label: label,
      type: 'password',
      autocomplete: autocomplete || 'off',
      helper: helper,
    });
  }

  function clearDialogError(host) {
    if (!host) return;
    Array.prototype.slice.call(host.children).forEach(function (node) {
      if (String(node.className || '').indexOf('field__message--error') !== -1) host.removeChild(node);
    });
  }

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

  function enableVaultFlow() {
    if (!App.crypto.isSupported()) {
      util.toast(App.crypto.unsupportedMessage(), 'error', 9000);
      return;
    }
    var settingsWasOpen = !!(dom.settingsDialog && dom.settingsDialog.open);
    if (settingsWasOpen) closeSettings();
    function afterEnable(result) {
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
    var again = passwordField('Confirm password', 'Enter the same password once more. Spaces at the start and end are ignored.');
    var stepHost = el('div');
    var api = null;

    function stepFooter(buttons) {
      var footer = el('div', { class: 'dialog__footer' });
      buttons.forEach(function (btn) { footer.appendChild(btn); });
      return footer;
    }

    function cancelBtn() {
      return el('button', {
        class: 'btn', type: 'button',
        onclick: function () { if (api) api.close(null); },
      }, ['Cancel']);
    }

    function showStep1() {
      stepHost.textContent = '';
      stepHost.appendChild(el('p', { class: 'dialog__note', text: 'Step 1 of 2 \u2014 choose a password.' }));
      stepHost.appendChild(first.root);
      stepHost.appendChild(stepFooter([cancelBtn(),
        el('button', {
          class: 'btn btn--primary', type: 'button',
          onclick: function () { checkStep1(); },
        }, ['Continue']),
      ]));
      first.input.focus();
    }

    function checkStep1() {
      var password = first.input.value.trim();
      if (password.length < MIN_PASSWORD) {
        App.ui.setFieldError(first, 'Use at least ' + MIN_PASSWORD + ' characters. This password is the whole protection, so its length is what matters most.');
        first.input.focus();
        return;
      }
      App.ui.setFieldError(first, null);
      showStep2();
    }

    function showStep2() {
      stepHost.textContent = '';
      stepHost.appendChild(el('p', { class: 'dialog__note', text: 'Step 2 of 2 \u2014 confirm it.' }));
      stepHost.appendChild(again.root);
      stepHost.appendChild(stepFooter([
        el('button', {
          class: 'btn', type: 'button',
          onclick: function () { showStep1(); },
        }, ['Back']),
        el('button', {
          class: 'btn btn--primary', type: 'button',
          onclick: function () { submitEncrypt(); },
        }, ['Encrypt this notebook']),
      ]));
      again.input.focus();
    }

    function submitEncrypt() {
      var password = first.input.value.trim();
      if (password !== again.input.value.trim()) {
        App.ui.setFieldError(again, 'The two passwords do not match. Go back if you need to change the first one.');
        again.input.focus();
        return;
      }
      App.ui.setFieldError(again, null);
      flushPendingSave();
      runVaultConversion('Encrypting this notebook\u2026', function (report) {
        return App.db.enableVault(password, report);
      }).then(function (result) {
        if (api) api.close(null);
        afterEnable(result);
      }, function (err) {
        render();
        renderFooter();
        renderVaultSection();
        if (App.db.vaultState() === 'off') {
          App.ui.setFieldError(again, err.message || 'That did not work.');
          return;
        }
        App.db.lockVault();
        render();
        renderFooter();
        renderVaultSection();
        if (api) api.close(null);
        util.toast('Encryption is on, but the last step did not finish ('
          + err.message + '). Nothing was undone: the notebook is encrypted and locked.',
          'error', 14000);
      });
    }

    [[first, checkStep1], [again, submitEncrypt]].forEach(function (pair) {
      pair[0].input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          pair[1]();
        }
      });
    });

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
      body: stepHost,
      hideFooter: true,
      focus: false,
      onOpen: function (open) {
        api = open;
        showStep1();
      },
    }).then(function () {
      if (settingsWasOpen) openSettings();
    });
  }

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
          App.db.rebuildLinks().catch(function () {  });
          if (result.failures.length) {
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

  function lockVaultFlow() {
    flushPendingSave();
    App.db.lockVault();
    render();
    renderFooter();
    renderVaultSection();
    util.toast('Notebook locked. Note bodies and files stay unreadable until you unlock again.', 'info', 7000);
  }

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

  function setIcon(button, name, size) {
    if (!button) return;
    button.textContent = '';
    var node = App.ui.icon(name, size);
    if (node) button.appendChild(node);
  }

  var PALETTES = ['indigo', 'teal', 'amber', 'rose', 'violet', 'graphite'];

  function applyAppIcon() {
    var link = document.getElementById('app-icon');
    if (!link) return;
    var cs = window.getComputedStyle(document.documentElement);
    var accent = (cs.getPropertyValue('--accent') || '').trim();
    var inverse = (cs.getPropertyValue('--text-inverse') || '').trim();
    if (!accent || !inverse) return;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">' +
      '<rect width="22" height="22" rx="6" fill="' + accent + '"/>' +
      '<g fill="' + inverse + '">' +
        '<rect x="5.9" y="8.3" width="10.2" height="2.2" rx="1.1" transform="rotate(45 11 9.4)"/>' +
        '<rect x="5.9" y="8.3" width="10.2" height="2.2" rx="1.1" transform="rotate(-45 11 9.4)"/>' +
        '<rect x="6.2" y="16" width="9.6" height="2" rx="1"/>' +
      '</g>' +
    '</svg>';
    link.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
  }

  function applyManifest() {
    if (window.location.protocol === 'file:') return;
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.json';
    document.head.appendChild(link);
  }

  function sidebarHidden() {
    return App.prefs.get('sidebarHidden', false) === true;
  }

  function applySidebarHidden(hidden) {
    if (dom.layout) dom.layout.classList.toggle('is-sidebar-hidden', !!hidden);
    var button = document.getElementById('sidebar-toggle');
    if (button) {
      button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      button.setAttribute('aria-label', hidden ? 'Show the sidebar' : 'Hide the sidebar');
      button.title = (hidden ? 'Show the sidebar' : 'Hide the sidebar') + ' (Ctrl+B)';
    }
    App.prefs.set('sidebarHidden', !!hidden);
  }

  function toggleSidebar() {
    applySidebarHidden(!sidebarHidden());
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    App.prefs.set('theme', theme);
    var dark = theme === 'dark';
    setIcon(dom.themeToggle, dark ? 'sun' : 'moon', 16);
    if (dom.themeToggle) {
      dom.themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      dom.themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    applyAppIcon();
  }

  function applyPalette(name) {
    var known = PALETTES.indexOf(name) === -1 ? 'indigo' : name;
    document.documentElement.setAttribute('data-palette', known);
    App.prefs.set('palette', known);
    applyAppIcon();
  }

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

  function bootstrapIcons() {
    setIcon(document.getElementById('nav-toggle'), 'arrowLeft', 16);
    setIcon(document.getElementById('sidebar-toggle'), 'panel', 16);
    setIcon(document.getElementById('settings-open'), 'settings', 16);
    setIcon(document.getElementById('workspace-add'), 'plus', 15);
    setIcon(document.getElementById('workspace-trash'), 'trash', 19);
    setIcon(document.getElementById('settings-close'), 'close', 15);
    setIcon(document.getElementById('template-close'), 'close', 15);
    setIcon(dom.sortMenu, 'sort', 14);

    var settingsIcon = document.getElementById('settings-icon');
    if (settingsIcon) settingsIcon.appendChild(App.ui.icon('database'));
    var templateIcon = document.getElementById('template-icon');
    if (templateIcon) templateIcon.appendChild(App.ui.icon('layers'));

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

  function deletedCount() {
    try {
      return App.db.countTrash(state.workspaceId);
    } catch (err) {
      return 0;
    }
  }

  var estimateAt = 0;
  var estimatePending = false;

  function refreshEstimate() {
    if (estimatePending) return;
    estimatePending = true;
    App.storage.estimate().then(function (est) {
      estimatePending = false;
      if (!est) return;
      state.estimate = est;
      estimateAt = Date.now();
      renderFooter();
    }, function () { estimatePending = false; });
  }

  function renderFooter() {
    if (!dom.railActions || !dom.railStorage) return;
    if (!estimatePending && (!state.estimate || Date.now() - estimateAt > 15000)) refreshEstimate();
    App.ui.renderSidebarFooter({ actions: dom.railActions, storage: dom.railStorage }, {
      actions: dom.railActions,
      storage: dom.railStorage,
      info: storageInfo(),
    });
  }

  function storageInfo(options) {
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
    if (!options || options.withBytes || !(info.estimate && info.estimate.usage)) {
      try {
        info.bytes = App.db.exportBytes().length;
      } catch (err) {
        info.bytes = 0;
      }
    }
    return info;
  }

  var selectedTemplateId = null;
  function templateFilterText() {
    var f = document.getElementById('template-filter');
    return f ? f.value.trim().toLowerCase() : '';
  }
  function paintTemplateList(host) {
    var rows = [];
    try { rows = App.db.listTemplates(state.workspaceId) || []; } catch (e) { rows = []; }
    var q = templateFilterText();
    if (q) rows = rows.filter(function (t) { return (t.name || '').toLowerCase().indexOf(q) !== -1; });
    if (selectedTemplateId && !rows.some(function (t) { return String(t.id) === String(selectedTemplateId); })) {
      selectedTemplateId = null;
    }
    host.innerHTML = rows.length ? rows.map(function (t) {
      var label = t.name || 'Untitled';
      var sel = String(t.id) === String(selectedTemplateId) ? ' is-selected' : '';
      return '<div class="tpl-row' + sel + '">' +
        '<button class="tpl-row__pick" type="button" role="option" aria-selected="' + (sel ? 'true' : 'false') + '" data-action="preview-template" data-id="' +
        util.escapeHtml(t.id) + '"><span class="tpl-row__check" aria-hidden="true">✓</span>' +
        '<span class="tpl-row__label">' + util.escapeHtml(label) + '</span></button>' +
        '<button class="tpl-row__delete" type="button" data-action="delete-template" data-id="' +
        util.escapeHtml(t.id) + '" aria-label="Delete template ' + util.escapeHtml(label) + '" title="Delete template">' +
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="font-size:12px"><path d="M6.5 6.5 17.5 17.5"/><path d="M17.5 6.5 6.5 17.5"/></svg></button></div>';
    }).join('') : (q ? '<p class="dialog__note">No templates match “' + util.escapeHtml(templateFilterText()) + '”.</p>'
      : '<div class="empty-state"><span class="empty-state__mark" aria-hidden="true">▤</span>' +
      '<h2>No templates yet</h2><p>Open a note and press T in the format bar to save one.</p></div>');
    paintTemplatePreview();
    var use = document.getElementById('template-use');
    if (use) { if (selectedTemplateId) use.removeAttribute('disabled'); else use.setAttribute('disabled', ''); }
  }
  function paintTemplatePreview() {
    var prev = document.getElementById('template-preview');
    if (!prev) return;
    var found = selectedTemplateId ? findTemplate(selectedTemplateId) : null;
    if (!found) { prev.innerHTML = ''; prev.classList.add('is-hidden'); return; }
    prev.innerHTML = '<h3 class="template-preview__title">' + util.escapeHtml(found.name || 'Untitled') + '</h3>' +
      '<div class="template-preview__body">' + util.sanitizeRichHtml(found.content || '') + '</div>';
    prev.classList.remove('is-hidden');
  }

  function findTemplate(id) {
    var found = null;
    try {
      (App.db.listTemplates(state.workspaceId) || []).forEach(function (t) {
        if (String(t.id) === String(id)) found = t;
      });
    } catch (e) { found = null; }
    return found;
  }

  var ACTIONS = {
    'save-as-template': function () {
      var n = state.currentNote;
      if (!n) { util.toast('Open a note first, then save it as a template.', 'info'); return; }
      var name = (n.title || 'Untitled').trim() || 'Untitled';
      App.db.saveTemplate(null, state.workspaceId, name, n.content || '').then(function () {
        util.toast('Template saved.', 'success');
      }).catch(function (err) { util.toast('Could not save the template: ' + err.message, 'error'); });
    },
    'new-from-template': function () {
      var host = document.getElementById('template-list');
      var dlg = document.getElementById('template-picker');
      if (!host || !dlg) return;
      var filter = document.getElementById('template-filter');
      if (filter) filter.value = '';
      selectedTemplateId = null;
      paintTemplateList(host);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      if (filter) filter.focus();
      else { var first = host.querySelector('button'); if (first) first.focus(); }
    },
    'close-template-picker': function () {
      var dlg = document.getElementById('template-picker');
      if (dlg && dlg.open) dlg.close();
    },
    'delete-template': function (id) {
      var rows = [];
      try { rows = App.db.listTemplates(state.workspaceId) || []; } catch (e) { rows = []; }
      var at = 0;
      rows.forEach(function (t, i) { if (String(t.id) === String(id)) at = i; });
      var label = ((rows[at] && rows[at].name)) || 'Untitled';
      App.ui.confirm({
        title: 'Delete template?',
        consequences: ['“' + label + '” will be permanently removed. Notes made from it are untouched.'],
        confirmLabel: 'Delete',
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        return App.db.deleteTemplate(id).then(function () {
          var host = document.getElementById('template-list');
          if (host) {
            paintTemplateList(host);
            var remaining = host.querySelectorAll('.tpl-row__pick');
            var next = remaining.length ? remaining[Math.min(at, remaining.length - 1)] : host.querySelector('button');
            if (next) next.focus();
          }
          util.toast('Template deleted.', 'info');
        });
      }).catch(function (err) { util.toast('Could not delete the template: ' + err.message, 'error'); });
    },
    'preview-template': function (id) {
      var found = findTemplate(id);
      if (!found) { util.toast('That template is gone.', 'info'); return; }
      selectedTemplateId = found.id;
      var host = document.getElementById('template-list');
      if (host) paintTemplateList(host);
      if (host) {
        var btn = host.querySelector('.tpl-row__pick[data-id="' + found.id + '"]');
        if (btn) btn.focus();
      }
    },
    'use-template': function (id) {
      var found = id ? findTemplate(id) : null;
      if (!found && selectedTemplateId) found = findTemplate(selectedTemplateId);
      if (!found) { util.toast('Pick a template first.', 'info'); return; }
      flushPendingSave();
      state.view = 'notes';
      var dlg = document.getElementById('template-picker');
      if (dlg && dlg.open) dlg.close();
      App.db.createNote(state.workspaceId, targetFolderId(), found.name || 'Untitled note').then(function (note) {
        return App.db.updateNote(note.id, note.title, found.content || '').then(function () {
          openNote(note.id);
        });
      }).catch(function (err) { util.toast('Could not create the note: ' + err.message, 'error'); });
    },
    'select-all': function () {
      flushPendingSave();
      state.view = 'notes';
      state.selection = { type: 'all', id: null };
      state.activeNoteId = null;
      state.activeFileId = null;
      state.focused = null;
      state.bulkAnchor = null;
      if (narrow) { mobilePanePinned = false; applyMobilePane(); }
      render();
    },
    'goto-folder': function (id) { goToFolder(id); },
    'select-folder': function (id) {
      flushPendingSave();
      var already = state.selection.type === 'folder' && String(state.selection.id) === String(id)
        && !state.activeNoteId && !state.activeFileId;
      state.view = 'notes';
      state.selection = { type: 'folder', id: id };
      state.activeNoteId = null;
      state.activeFileId = null;
      state.focused = null;
      state.bulkAnchor = null;
      if (already) state.expanded[id] = !state.expanded[id];
      else state.expanded[id] = true;
      if (narrow) { mobilePanePinned = false; applyMobilePane(); }
      render();
    },

    'toggle-folder': function (id) {
      if (state.expanded[id] && holdsTheSelection(id)) return;
      state.expanded[id] = !state.expanded[id];
      render();
    },
    'open-note': function (id) { openNote(id); },
    'open-file': function (id) { openFile(id); },
    'activate-tab': function (id) {
      var parsed = parseTabRef(id);
      if (parsed) activateTab(parsed.kind, parsed.id);
    },
    'new-tab': function () { openNewTab(); },
    'close-tab': function (id) { closeTabRef(id); },
    'close-other-tabs': function (id) { closeOtherTabs(id); },
    'close-all-tabs': function () { closeAllTabs(); },
    'create-linked-note': function (id) {
      try { createLinkedNote(decodeURIComponent(id)); }
      catch (e) { createLinkedNote(id); }
    },
    'remove-outgoing-link': function (id) {
      if (!state.currentNote) return;
      try { removeLinkFromNote(state.currentNote.id, decodeURIComponent(id)); }
      catch (e) { removeLinkFromNote(state.currentNote.id, id); }
    },
    'link-suggest-pick': function (id) { completeLinkSuggest(Number(id)); },
    'dejavu-open': function (id) { openNote(id); },
    'dejavu-dismiss': function (id) {
      if (!state.dejavu) return;
      dejavuIgnore(state.dejavu.noteId, id);
      state.dejavu.matches = state.dejavu.matches.filter(function (m) {
        return String(m.id) !== String(id);
      });
      if (!state.dejavu.matches.length) state.dejavu = null;
      render();
    },
    'fmt-bold': function () { fmtCommand('bold'); },
    'fmt-italic': function () { fmtCommand('italic'); },
    'fmt-bullets': function () { fmtCommand('insertUnorderedList'); },
    'fmt-highlight': function () { fmtHighlight(); },
    'fmt-checkbox': function () { fmtCheckbox(); },
    'fmt-clear': function () {
      var body = document.getElementById('note-body');
      if (!state.currentNote || !body || !restoreSelection()) return;
      var before = body.innerHTML;
      if (typeof document.execCommand === 'function') document.execCommand('removeFormat');
      Array.prototype.slice.call(body.querySelectorAll('mark')).forEach(function (m) {
        var parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
      });
      saveSelection();
      if (body.innerHTML === before) { body.focus(); return; }
      readEditorBody();
    },
    'new-note': function () { newNote(); },
    'new-folder': function () { newFolder(null); },
    'new-subfolder': function () { newFolder(state.selection.type === 'folder' ? state.selection.id : null); },
    'upload-file': function () { dom.fileInput.click(); },
    'bulk-move': function () { if (state.bulkSelected.length) openMovePanel('items', bulkItems()); },
    'bulk-delete': function () { if (state.bulkSelected.length) deleteBulkItems(bulkItems()); },
    'bulk-clear': function () { clearBulkSelection(); render(); },
    'rename-note': function () { if (state.activeNoteId) renameNote(state.activeNoteId); },
    'delete-note': function () { if (state.activeNoteId) deleteNote(state.activeNoteId); },
    'toggle-private': function (id) { toggleNotePrivate(id || state.activeNoteId); },
    'rename-folder': function () { if (state.selection.type === 'folder') renameFolder(state.selection.id); },
    'move-folder': function () { if (state.selection.type === 'folder') moveFolder(state.selection.id); },
    'delete-folder': function () { if (state.selection.type === 'folder') deleteFolder(state.selection.id); },
    'folder-menu': function (id, node) {
      var folderId = state.selection.type === 'folder' ? state.selection.id : id;
      if (!folderId) return;
      var rect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      openFolderMenu(folderId, rect ? Math.max(12, rect.right - 232) : 12, rect ? rect.bottom + 6 : 12);
    },
    'download-file': function (id) { downloadFile(id); },
    'open-file-tab': function (id) { openFileInTab(id); },
    'rename-file': function (id) { renameFile(id); },
    'move-file': function (id) { moveFile(id); },
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
    'vault-enable': function () { enableVaultFlow(); },
    'vault-disable': function () { disableVaultFlow(); },
    'vault-lock': function () { lockVaultFlow(); },
    'vault-unlock': function () { unlockVaultFlow(); },
    'toggle-nav': function () {
      mobilePanePinned = true;
      applyMobilePane();
    },
    'sort-menu': function () { openSortMenu(); },
    'view-tasks': function () { showTasks(state.view !== 'tasks'); },
    'toggle-sidebar': function () { toggleSidebar(); },
    'add-task': function () { addTaskFromQuickAdd(); },
    'task-edit': function (id) { editTask(id); },
    'task-delete': function (id) { deleteTask(id); },
  };

  function onActionClick(event) {
    var node = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!node) return;
    var action = node.getAttribute('data-action');
    var handler = ACTIONS[action];
    if (!handler) return;
    event.preventDefault();
    handler(node.getAttribute('data-id'), node);
  }

  function onTreePointerDown(event) {
    var twisty = event.target.closest ? event.target.closest('.tree__twisty[data-action]') : null;
    if (!twisty) return;
    event.preventDefault();
    event.stopPropagation();
    ACTIONS['toggle-folder'](twisty.getAttribute('data-id'));
  }

  var marqueeDrag = null;
  var suppressPaneClick = null;

  function marqueeAllows(target) {
    if (!dom.main || !target || !dom.main.contains(target)) return false;
    if (!dom.main.querySelector('.card-grid')) return false;
    if (document.body.classList.contains('is-resizing')) return false;
    if (target.closest && target.closest('input, textarea, select, [contenteditable="true"], .bulk-bar, .editor, .pane-preview__text, .pane-preview__facts, .pane-preview__sheetwrap, .pane-preview__docx, .pane-preview__pdf, .pane-preview__stack, pre, code')) return false;
    return true;
  }

  function onPanePointerDown(event) {
    suppressPaneClick = null;
    state.bulkFloat = null;
    if (event.button !== 0 || marqueeDrag) return;
    if (!marqueeAllows(event.target)) return;
    marqueeDrag = {
      x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY,
      add: !!(event.ctrlKey || event.metaKey || event.shiftKey),
      base: state.bulkSelected.slice(),
      baseKinds: Object.assign({}, state.bulkKinds),
      active: false,
      band: null,
      ids: [],
    };
  }

  function marqueeBox() {
    return {
      left: Math.min(marqueeDrag.x0, marqueeDrag.x1),
      top: Math.min(marqueeDrag.y0, marqueeDrag.y1),
      right: Math.max(marqueeDrag.x0, marqueeDrag.x1),
      bottom: Math.max(marqueeDrag.y0, marqueeDrag.y1),
    };
  }

  function marqueeApply() {
    var box = marqueeBox();
    var selected = marqueeDrag.add ? marqueeDrag.base.slice() : [];
    var kinds = marqueeDrag.add ? Object.assign({}, marqueeDrag.baseKinds) : {};
    var nodes = dom.main.querySelectorAll('.card[data-id]');
    Array.prototype.forEach.call(nodes, function (node) {
      var rect = node.getBoundingClientRect();
      var hit = rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
      var id = String(node.getAttribute('data-id'));
      if (hit && selected.indexOf(id) === -1) selected.push(id);
      if (hit) kinds[id] = paneCardKind(node);
      var mark = node.parentNode && node.parentNode.classList && node.parentNode.classList.contains('card-wrap')
        ? node.parentNode
        : node;
      mark.classList.toggle('is-selected', hit || (marqueeDrag.add && marqueeDrag.base.indexOf(id) !== -1));
    });
    marqueeDrag.ids = selected;
    state.bulkSelected = selected;
    state.bulkKinds = kinds;
  }

  function onDocumentMouseMove(event) {
    if (!marqueeDrag) return;
    marqueeDrag.x1 = event.clientX;
    marqueeDrag.y1 = event.clientY;
    if (!marqueeDrag.active) {
      if (Math.abs(marqueeDrag.x1 - marqueeDrag.x0) < 4 && Math.abs(marqueeDrag.y1 - marqueeDrag.y0) < 4) return;
      if (!(event.buttons & 1)) {
        marqueeDrag = null;
        return;
      }
      marqueeDrag.active = true;
      document.body.classList.add('is-marquee');
      marqueeDrag.band = document.createElement('div');
      marqueeDrag.band.className = 'marquee';
      marqueeDrag.band.setAttribute('aria-hidden', 'true');
      document.body.appendChild(marqueeDrag.band);
    }
    event.preventDefault();
    var box = marqueeBox();
    marqueeDrag.band.style.left = box.left + 'px';
    marqueeDrag.band.style.top = box.top + 'px';
    marqueeDrag.band.style.width = (box.right - box.left) + 'px';
    marqueeDrag.band.style.height = (box.bottom - box.top) + 'px';
    marqueeApply();
  }

  function placeBulkBar() {
    var point = state.bulkFloat;
    var bar = dom.main && dom.main.querySelector('.bulk-bar');
    if (!point || !bar) return;
    var width = bar.offsetWidth;
    var height = bar.offsetHeight;
    var pad = 12;
    var gap = 16;
    var maxLeft = window.innerWidth - pad - width;
    var maxTop = window.innerHeight - pad - height;
    var left = point.x + gap;
    if (left > maxLeft) left = point.x - gap - width;
    left = Math.min(left, maxLeft);
    var top = point.y + gap;
    if (top > maxTop) top = point.y - gap - height;
    top = Math.min(top, maxTop);
    bar.style.left = Math.round(Math.max(pad, left)) + 'px';
    bar.style.top = Math.round(Math.max(pad, top)) + 'px';
  }

  function endMarquee() {
    var drag = marqueeDrag;
    marqueeDrag = null;
    if (!drag) return false;
    if (drag.band && drag.band.parentNode) drag.band.parentNode.removeChild(drag.band);
    document.body.classList.remove('is-marquee');
    if (!drag.active) return false;
    suppressPaneClick = { x: drag.x1, y: drag.y1 };
    if (state.bulkSelected.length) state.bulkAnchor = state.bulkSelected[state.bulkSelected.length - 1];
    state.bulkFloat = { x: drag.x1, y: drag.y1 };
    render();
    placeBulkBar();
    return true;
  }

  function onDocumentMouseUp(event) {
    if (!marqueeDrag) return;
    if (event.button !== 0 && !marqueeDrag.active) return;
    endMarquee();
  }

  function paneCardFrom(event) {
    if (!event.target || !event.target.closest) return null;
    var card = event.target.closest('.card--folder, .card--note, .card--file');
    return card && dom.main.contains(card) ? card : null;
  }

  function paneCardKind(card) {
    if (card.classList.contains('card--folder')) return 'folder';
    if (card.classList.contains('card--file')) return 'file';
    return 'note';
  }

  function paneOrder() {
    var nodes = dom.main.querySelectorAll('.card--folder[data-id], .card--note[data-id], .card--file[data-id]');
    return Array.prototype.map.call(nodes, function (node) {
      return { id: String(node.getAttribute('data-id')), kind: paneCardKind(node) };
    });
  }

  function syncBulkKinds(id, kind) {
    var keep = {};
    state.bulkSelected.forEach(function (x) {
      if (String(x) === String(id)) keep[x] = kind;
      else if (state.bulkKinds[x]) keep[x] = state.bulkKinds[x];
    });
    state.bulkKinds = keep;
  }

  function openPaneItem(kind, id) {
    if (!id) return;
    if (kind === 'folder') { ACTIONS['select-folder'](id); return; }
    if (kind === 'file') { openFile(id); return; }
    openNote(id);
  }

  function revealPaneItem(kind, id, parentId) {
    if (!id) return;
    flushPendingSave();
    state.view = 'notes';
    state.selection = parentId ? { type: 'folder', id: parentId } : { type: 'all', id: null };
    state.activeNoteId = null;
    state.activeFileId = null;
    state.focused = { kind: kind, id: id };
    state.bulkSelected = [];
    state.bulkKinds = {};
    state.bulkAnchor = null;
    if (parentId) state.expanded[parentId] = true;
    render();
  }

  function focusPaneItem(kind, id, selectionMoved) {
    var same = state.focused && state.focused.kind === kind && String(state.focused.id) === String(id);
    state.focused = { kind: kind, id: id };
    if (same && !selectionMoved) return;
    state.bulkScope = bulkScopeKey();
    render();
  }

  function selectNewItem(kind, id) {
    state.bulkSelected = [id];
    state.bulkKinds = {};
    state.bulkAnchor = id;
    syncBulkKinds(id, kind);
    focusPaneItem(kind, id, true);
  }

  function plainPreview(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  var TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.log', '.yml', '.yaml', '.ini', '.xml', '.html', '.css', '.js', '.ts'];

  function filePreviewFor(meta) {
    var mime = meta.mime_type || '';
    var ext = (String(meta.filename || '').match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    return {
      kind: 'file',
      title: meta.filename,
      id: meta.id,
      mime: meta.mime_type || '',
      bytes: meta.size || 0,
      when: meta.created_at,
      image: /^image\//.test(mime),
      video: /^video\//.test(mime),
      audio: /^audio\//.test(mime),
      pdf: mime === 'application/pdf' || ext === '.pdf',
      docx: ext === '.docx' || mime.indexOf('wordprocessingml') !== -1,
      xlsx: ext === '.xlsx' || mime.indexOf('spreadsheetml') !== -1,
      csv: ext === '.csv' || ext === '.tsv',
      text: /^text\//.test(mime) || TEXT_EXTENSIONS.indexOf(ext) !== -1,
    };
  }

  function previewFor(treeModel) {
    var target = state.focused;
    if (!target && state.bulkSelected.length === 1) {
      var only = state.bulkSelected[0];
      target = { kind: state.bulkKinds[only] || 'note', id: only };
    }
    if (!target && state.selection && state.selection.type === 'folder') {
      target = { kind: 'folder', id: state.selection.id };
    }
    if (!target) {
      return state.bulkSelected.length > 1 ? { kind: 'many', count: state.bulkSelected.length } : null;
    }
    if (target.kind === 'folder') {
      var folder = treeModel.folders.filter(function (f) { return f.id === target.id; })[0];
      if (!folder) return null;
      var items = [];
      var total = 0;
      (function walk(id, levels) {
        var kids = [];
        treeModel.folders.forEach(function (f) {
          if (f.parent_folder_id === id) kids.push({ name: f.name, kind: 'folder', id: f.id });
        });
        (treeModel.notesByFolder[id] || []).forEach(function (n) {
          kids.push({ name: n.title && n.title.trim() ? n.title : 'Untitled note', kind: 'note', id: n.id });
        });
        (treeModel.filesByFolder[id] || []).forEach(function (f) {
          kids.push({ name: f.filename, kind: 'file', id: f.id });
        });
        total += kids.length;
        kids.forEach(function (kid, i) {
          if (items.length >= 200) return;
          var last = i === kids.length - 1;
          items.push({
            kind: kid.kind,
            id: kid.id,
            name: kid.name,
            parent: id,
            levels: levels,
            last: last,
          });
          if (kid.kind === 'folder') walk(kid.id, levels.concat([!last]));
        });
      })(folder.id, []);
      return {
        kind: 'folder',
        title: folder.name,
        items: items,
        total: total,
        focused: state.focused,
        bytes: App.db.subtreeBytes(state.workspaceId)[folder.id] || 0,
      };
    }
    if (target.kind === 'file') {
      var meta = App.db.getFileMeta(target.id);
      return meta ? filePreviewFor(meta) : null;
    }
    var note = App.db.getNote(target.id);
    if (!note) return null;
    return {
      kind: 'note',
      title: note.title && note.title.trim() ? note.title : 'Untitled note',
      text: plainPreview(note.content),
      when: note.updated_at || note.created_at,
      bytes: (note.content || '').length,
    };
  }

  function selectNewItems(kind, ids) {
    if (!ids.length) return;
    state.bulkFloat = null;
    state.bulkSelected = ids.slice();
    state.bulkKinds = {};
    ids.forEach(function (id) { state.bulkKinds[id] = kind; });
    state.bulkAnchor = ids[ids.length - 1];
    focusPaneItem(kind, ids[ids.length - 1], true);
  }

  function openBulkMenu(x, y) {
    var count = state.bulkSelected.length;
    if (count < 2) return false;
    App.ui.openMenu({
      x: x,
      y: y,
      title: count + ' items selected',
      items: [
        { label: 'Move ' + count + ' items\u2026', icon: 'layers', onclick: function () { openMovePanel('items', bulkItems()); } },
        { sep: true },
        { label: 'Delete ' + count + ' items\u2026', icon: 'trash', danger: true, shortcut: 'Del', onclick: function () { deleteBulkItems(bulkItems()); } },
        { label: 'Clear selection', icon: 'close', onclick: function () { clearBulkSelection(); render(); } },
      ],
    });
    return true;
  }

  function onPaneItemClick(card, event) {
    var kind = paneCardKind(card);
    var id = card.getAttribute('data-id');
    if (!id) return;
    if (event.type === 'click' && (event.detail === 0 || event.detail > 1)) { openPaneItem(kind, id); return; }

    var add = event.ctrlKey || event.metaKey;
    var range = event.shiftKey;

    if (range && state.bulkAnchor) {
      var order = paneOrder();
      var from = -1;
      var to = -1;
      order.forEach(function (entry, index) {
        if (String(entry.id) === String(state.bulkAnchor)) from = index;
        if (String(entry.id) === String(id)) to = index;
      });
      if (from !== -1 && to !== -1) {
        var slice = from <= to ? order.slice(from, to + 1) : order.slice(to, from + 1);
        var kinds = {};
        slice.forEach(function (entry) { kinds[entry.id] = entry.kind; });
        state.bulkSelected = slice.map(function (entry) { return entry.id; });
        state.bulkKinds = kinds;
        focusPaneItem(kind, id);
        return;
      }
    }

    var before = state.bulkSelected.join(',');
    var next = state.bulkSelected.filter(function (x) { return String(x) !== String(id); });
    if (add) {
      if (next.length === state.bulkSelected.length) next.push(id);
      state.bulkSelected = next;
    } else {
      state.bulkSelected = [id];
    }
    state.bulkAnchor = id;
    syncBulkKinds(id, kind);
    focusPaneItem(kind, id, before !== state.bulkSelected.join(','));
  }

  function onPaneItemClickEvent(event) {
    var swallowed = suppressPaneClick
      && Math.abs(event.clientX - suppressPaneClick.x) < 6
      && Math.abs(event.clientY - suppressPaneClick.y) < 6;
    suppressPaneClick = null;
    if (swallowed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    var card = paneCardFrom(event);
    if (!card) {
      var blank = event.target === dom.main
        || (event.target && event.target.closest && event.target.closest('.card-grid, .pane-section'));
      if (blank && (state.bulkSelected.length || state.focused)) {
        clearBulkSelection();
        state.focused = null;
        render();
      }
      return;
    }
    onPaneItemClick(card, event);
  }

  function onPaneItemDblClick(event) {
    var card = paneCardFrom(event);
    if (!card) return;
    event.preventDefault();
    openPaneItem(paneCardKind(card), card.getAttribute('data-id'));
  }

  function onPaneItemContextMenu(event) {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
    var card = paneCardFrom(event);
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    onPaneItemClick(card, event);
  }

  function invokeAction(action, id) {
    var node = el('button', { type: 'button', dataset: { action: action } });
    if (id !== undefined && id !== null) node.setAttribute('data-id', id);
    document.body.appendChild(node);
    node.click();
    document.body.removeChild(node);
  }

  function openFolderMenu(folderId, x, y) {
    var titleNode = dom.main ? dom.main.querySelector('.pane-head__title') : null;
    var label = (titleNode && titleNode.textContent) || 'This folder';
    App.ui.menuOpen({
      x: x,
      y: y,
      title: label,
      entry: { type: 'folder', id: folderId, label: label },
      reorder: reorderFor('folder', folderId),
      on: function (action) { return function () { invokeAction(action, folderId); }; },
    });
  }

  function contextMenuFor(event) {
    var target = event.target;

    var paneCard = paneCardFrom(event);
    if (paneCard) {
      var paneKind = paneCardKind(paneCard);
      var paneId = paneCard.getAttribute('data-id');
      if (paneId) {
        var paneHeld = state.bulkSelected.some(function (x) { return String(x) === String(paneId); });
        if (!paneHeld) {
          state.bulkSelected = [paneId];
          state.bulkKinds = {};
          state.bulkAnchor = paneId;
          syncBulkKinds(paneId, paneKind);
        }
        focusPaneItem(paneKind, paneId, !paneHeld);
      }
      if (openBulkMenu(event.clientX, event.clientY)) return;
    }

    if (!paneCard && state.bulkSelected.length > 1
        && dom.main && dom.main.contains(target)
        && openBulkMenu(event.clientX, event.clientY)) {
      return;
    }

    var trashRow = target.closest ? target.closest('.trash-row[data-trash-id]') : null;
    if (trashRow) {
      openTrashContextMenu(event, trashEntriesFor(trashRow));
      return;
    }

    var stripBg = target.closest ? target.closest('#tabs') : null;
    if (stripBg && !(target.closest && target.closest('#tabs .tab'))) {
      var closedTitle = lastClosedTitle();
      var stripItems = [];
      if (closedTitle) {
        stripItems.push({ label: 'Reopen \u201c' + closedTitle + '\u201d', onclick: function () { reopenClosedTab(); } });
      }
      stripItems.push({ label: 'Jump to previous tab', onclick: function () { jumpToPreviousTab(); } });
      stripItems.push({ sep: true });
      stripItems.push({ label: 'Close all tabs', icon: 'trash', onclick: function () { closeAllTabs(); } });
      App.ui.openMenu({
        x: event.clientX,
        y: event.clientY,
        title: 'Open tabs',
        items: stripItems,
      });
      return;
    }

    var pillNode = target.closest ? target.closest('[data-ctx="wikilink"]') : null;
    if (pillNode) {
      var pillTitle = pillNode.getAttribute('data-ctx-label')
        || pillNode.getAttribute('data-title') || 'This link';
      var pillResolved = pillNode.getAttribute('data-resolved') === 'true';
      App.ui.openMenu({
        x: event.clientX,
        y: event.clientY,
        title: pillTitle,
        items: [
          pillResolved
            ? { label: 'Open \u201c' + pillTitle + '\u201d', icon: 'note', onclick: function () { createLinkedNote(pillTitle); } }
            : { label: 'Create \u201c' + pillTitle + '\u201d', icon: 'plus', onclick: function () { createLinkedNote(pillTitle); } },
          { sep: true },
          { label: 'Remove link', icon: 'close', onclick: function () {
            if (state.currentNote) removeLinkFromNote(state.currentNote.id, pillTitle);
          } },
        ],
      });
      return;
    }

    var tabNode = target.closest ? target.closest('[data-ctx="tab"]') : null;
    if (tabNode) {
      var tabRef = tabNode.getAttribute('data-id');
      var tabLabel = tabNode.getAttribute('data-ctx-label') || 'This tab';
      var tabParsed = parseTabRef(tabRef);
      var tabAt = tabParsed ? tabIndexOf(tabParsed.kind, tabParsed.id) : -1;
      var tabPinned = tabAt !== -1 && !!state.tabs[tabAt].pinned;
      var tabItems = [];
      if (!tabParsed || tabParsed.kind !== 'new') {
        tabItems.push(tabPinned
          ? { label: 'Unpin tab', onclick: function () { setTabPinned(tabRef, false); } }
          : { label: 'Pin tab', onclick: function () { setTabPinned(tabRef, true); } });
      }
      if (tabAt > 0) {
        tabItems.push({ label: 'Move tab left', onclick: function () { moveTab(tabRef, -1); } });
      }
      if (tabAt !== -1 && tabAt < state.tabs.length - 1) {
        tabItems.push({ label: 'Move tab right', onclick: function () { moveTab(tabRef, 1); } });
      }
      if (tabItems.length) tabItems.push({ sep: true });
      tabItems.push({ label: 'Close tab', icon: 'close', onclick: function () { closeTabRef(tabRef); } });
      tabItems.push({ label: 'Close other tabs', icon: 'layers', onclick: function () { closeOtherTabs(tabRef); } });
      tabItems.push({ sep: true });
      tabItems.push({ label: 'Close all tabs', icon: 'trash', onclick: function () { closeAllTabs(); } });
      App.ui.openMenu({
        x: event.clientX,
        y: event.clientY,
        title: tabLabel,
        items: tabItems,
      });
      return;
    }

    var entryNode = target.closest ? target.closest('[data-ctx]') : null;
    if (entryNode) {
      var type = entryNode.getAttribute('data-ctx');
      var id = entryNode.getAttribute('data-id');
      var label = entryNode.getAttribute('data-ctx-label') || '';
      if (type === 'workspace' && !id) {
        openWorkspaceMenu(event.clientX, event.clientY);
        return;
      }
      var overrides = {};
      var entryDone = false;
      var entryPrivate = false;

      if (type === 'folder') {
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
        var menuNote = null;
        try { menuNote = App.db.getNote(id); } catch (err) { menuNote = null; }
        entryPrivate = !!(menuNote && menuNote.is_private);
        overrides = {
          'rename-note': function () { renameNote(id); },
          'move-note': function () { moveNote(id); },
          'delete-note': function () { deleteNote(id); },
          'copy-note': function () { copyNoteText(id); },
          'toggle-private': function () { toggleNotePrivate(id); },
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
          'move-file': function () { moveFile(id); },
          'delete-file': function () { deleteFile(id); },
          'move-item-up': function () { reorderAction('file', id, -1); },
          'move-item-down': function () { reorderAction('file', id, 1); },
        };
      } else if (type === 'task') {
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
        reorder: reorder,
        on: function (action) {
          if (overrides[action]) return overrides[action];
          return function () { invokeAction(action, null); };
        },
      });
      return;
    }

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

    if (state.selection.type === 'folder' && dom.main && dom.main.contains(target)) {
      openFolderMenu(state.selection.id, event.clientX, event.clientY);
      return;
    }

    openWorkspaceMenu(event.clientX, event.clientY);
  }

  function openWorkspaceMenu(x, y) {
    App.ui.openMenu({
      x: x,
      y: y,
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
    App.ui.closeMenu();
    event.preventDefault();
    contextMenuFor(event);
  }

  function paintSortButton() {
    var node = dom.sortMenu;
    if (!node) return;
    var sort = sortOf();
    node.classList.toggle('is-manual', sort.key === 'manual');
    var label = App.ui.sortKeyLabel(sort.key);
    node.setAttribute('aria-label',
      'Sort folders, notes and files \u00b7 ' + label + ' \u00b7 '
        + (sort.dir === 'asc' ? 'ascending' : 'descending'));
    node.title = 'Sorting by ' + label + (sort.dir === 'asc' ? ', ascending' : ', descending');
  }

  function openSortMenu() {
    var node = dom.sortMenu;
    if (!node) return;
    var box = node.getBoundingClientRect();
    node.setAttribute('aria-expanded', 'true');
    App.ui.menuOpenSort({
      x: Math.round(box.left),
      y: Math.round(box.bottom + 6),
      sort: sortOf(),
      onChoose: setSort,
      onClose: function () { node.setAttribute('aria-expanded', 'false'); },
    });
  }

  function scopeOfItem(type, id) {
    if (type === 'folder') {
      var folder = App.db.listFolders(state.workspaceId).filter(function (f) { return f.id === id; })[0];
      return { workspaceId: state.workspaceId, folderId: folder ? folder.parent_folder_id : null };
    }
    if (type === 'note') {
      var note = App.db.getNote(id);
      return { workspaceId: state.workspaceId, folderId: note ? note.folder_id : null };
    }
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

  function reorderAction(kind, id, delta) {
    if (sortOf().key !== 'manual') return;
    var scope = kind === 'workspace'
      ? { workspaceId: id, folderId: null }
      : scopeOfItem(kind, id);
    App.db.reorderWithin(kind, id, delta, scope.workspaceId, scope.folderId).then(function (moved) {
      if (!moved) return;
      state.sortTouched = { kind: kind, id: id };
      var refreshed = kind === 'workspace' ? refreshWorkspaces() : Promise.resolve(null);
      return refreshed.then(function () { render(); });
    }).catch(function (err) {
      util.toast('Could not move that item: ' + err.message, 'error');
    });
  }

  function reorderFor(type, id) {
    if (sortOf().key !== 'manual') return null;
    if (!id) return null;
    return {
      enabled: true,
      up: function () { reorderAction(type, id, -1); },
      down: function () { reorderAction(type, id, 1); },
    };
  }

  function focusMovedRow(kind, id) {
    var found = document.querySelector('[data-ctx=' + kind + '][data-id=\u0022' + id + '\u0022]');
    if (!found) return;
    found.focus();
    if (typeof found.scrollIntoView === 'function') found.scrollIntoView({ block: 'nearest' });
  }

  function newNoteIn(folderId) {
    flushPendingSave();
    clearSearch();
    App.db.createNote(state.workspaceId, folderId || null, 'Untitled note').then(function (note) {
      if (note.folder_id) expandAncestors(note.folder_id);
      state.view = 'notes';
      state.activeFileId = null;
      state.activeNoteId = null;
      state.selection = note.folder_id ? { type: 'folder', id: note.folder_id } : state.selection;
      selectNewItem('note', note.id);
    }).catch(function (err) {
      util.toast('Could not create the note: ' + err.message, 'error');
    });
  }

  var pendingUploadFolder = null;
  function uploadTo(folderId) {
    pendingUploadFolder = folderId || null;
    dom.fileInput.click();
  }

  function copyNoteText(id) {
    var note = App.db.getNote(id);
    if (!note) return;
    if (note.locked) {
      util.toast('This note is encrypted and the notebook is locked. Unlock it first.', 'info', 7000);
      return;
    }
    if (note.damaged) {
      util.toast('This note could not be read, so there is nothing to copy.', 'info');
      return;
    }
    var body = util.noteToPlainText(note.content || '');
    var text = (note.title && String(note.title).trim() ? String(note.title).trim() + '\n\n' : '') + body;
    var failed = function () {
      util.toast('This browser blocked the clipboard. Open the note and copy from there.', 'error');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        util.toast('Copied the note text.', 'success');
      }).catch(failed);
    } else {
      failed();
    }
  }

  function toggleNotePrivate(id) {
    var target = id || state.activeNoteId;
    if (!target) return;
    var note = null;
    try {
      note = App.db.getNote(target);
    } catch (err) {
      note = null;
    }
    if (!note) return;
    var next = note.is_private ? 0 : 1;
    App.db.setNotePrivate(target, next).then(function () {
      if (state.currentNote && String(state.currentNote.id) === String(target)) {
        state.currentNote.is_private = next;
      }
      render();
      util.toast(next ? 'Marked private \u2014 skipped in bulk export.'
        : 'Made public \u2014 included in bulk export.', 'success');
    }).catch(function (err) {
      util.toast('Could not change that note: ' + err.message, 'error');
    });
  }

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

  var narrow = null;
  var mobilePanePinned = true;
  var mobilePaneKey = null;

  function applyMobilePane() {
    if (!dom.layout) return;
    dom.layout.classList.toggle('is-mobile-list', !!narrow && mobilePanePinned);
  }

  function syncMobilePane() {
    var next = !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
    if (next === narrow) return;
    narrow = next;
    mobilePaneKey = null;
    deriveMobilePane();
  }

  function deriveMobilePane() {
    var key = state.view + '|' + (state.searchTerm || '') + '|'
      + (state.activeNoteId || '') + '|' + (state.activeFileId || '');
    if (key === mobilePaneKey) return;
    mobilePaneKey = key;
    mobilePanePinned = state.view !== 'tasks'
      && (!!state.searchTerm || (!state.activeNoteId && !state.activeFileId));
    applyMobilePane();
  }

  function wireEvents() {
    document.addEventListener('click', onActionClick);
    document.addEventListener('click', onTreePointerDown, true);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('contextmenu', onPaneItemContextMenu, true);
    dom.main.addEventListener('click', onPaneItemClickEvent);
    dom.main.addEventListener('dblclick', onPaneItemDblClick);
    document.addEventListener('mousedown', onPanePointerDown);
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mouseup', onDocumentMouseUp);
    window.addEventListener('blur', endMarquee);
    document.addEventListener('selectstart', function (event) {
      if (marqueeDrag && marqueeDrag.active) event.preventDefault();
    }, true);
    document.addEventListener('dragstart', function (event) {
      if (marqueeDrag && marqueeDrag.active) event.preventDefault();
    }, true);

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && !(event.ctrlKey || event.metaKey || event.altKey)) {
        if (event.target.closest && event.target.closest('.tab__close[data-action]')) return;
        var pill = event.target.closest ? event.target.closest('.wikilink[data-title]') : null;
        if (pill && document.getElementById('note-body')
            && document.getElementById('note-body').contains(pill)) {
          event.preventDefault();
          followWikiPill(pill.getAttribute('data-title'));
          return;
        }
        var node = event.target.closest ? event.target.closest('.tree__row[data-action], .tree__twisty[data-action], .tab[data-action]') : null;
        if (node) {
          event.preventDefault();
          var action = node.classList.contains('tree__twisty') ? 'toggle-folder' : node.getAttribute('data-action');
          if (ACTIONS[action]) ACTIONS[action](node.getAttribute('data-id'));
          return;
        }
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey
          && event.key.toLowerCase() === 'w'
          && !App.ui.menuIsOpen() && !document.querySelector('dialog[open]')) {
        if (state.activeNoteId) { event.preventDefault(); closeTabRef('note:' + state.activeNoteId); return; }
        if (state.activeFileId) { event.preventDefault(); closeTabRef('file:' + state.activeFileId); return; }
        if (pendingTabActive()) { event.preventDefault(); closeTabRef('new:'); return; }
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
          && event.key.toLowerCase() === 'n'
          && !App.ui.menuIsOpen() && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        openNewTab();
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey
          && !App.ui.menuIsOpen() && !document.querySelector('dialog[open]')
          && !isTextContext(event.target)) {
        if (!event.shiftKey && event.key.toLowerCase() === 'q') {
          event.preventDefault();
          jumpToPreviousTab();
          return;
        }
        if (event.shiftKey && event.key.toLowerCase() === 't') {
          event.preventDefault();
          reopenClosedTab();
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey
          && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          && !App.ui.menuIsOpen() && !document.querySelector('dialog[open]')
          && !isTextContext(event.target)) {
        event.preventDefault();
        cycleTab(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
          && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          && !App.ui.menuIsOpen() && !document.querySelector('dialog[open]')) {
        var activeRef = state.activeNoteId ? 'note:' + state.activeNoteId
          : state.activeFileId ? 'file:' + state.activeFileId : null;
        if (activeRef) {
          event.preventDefault();
          moveTab(activeRef, event.key === 'ArrowRight' ? 1 : -1);
          return;
        }
      }
      onTreeArrowKeys(event);

      if (event.key === 'Escape' && !App.ui.menuIsOpen()
          && document.activeElement === dom.searchInput && dom.searchInput.value) {
        clearSearch();
        render();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dom.searchInput.focus();
        dom.searchInput.select();
        return;
      }
      if (App.ui.menuIsOpen() || document.querySelector('dialog[open]')) return;

      if (event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newNote();
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        uploadTo(targetFolderId());
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
          && event.key.toLowerCase() === 'n'
          && !App.ui.menuIsOpen() && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        openNewTab();
      }
    });

    dom.main.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !state.currentNote) return;
      if (target.id === 'note-title') {
        state.currentNote.title = target.value;
        state.editorDirty = true;
        setStatus('Unsaved\u2026');
        paintTabDirty();
        saveOpenNote();
      } else if (target.id === 'note-body'
          || (target.closest && target.closest('#note-body'))) {
        saveSelection();
        readEditorBody();
      }
    });

    dom.main.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || target.id !== 'note-title' || !state.currentNote) return;
      checkDejaVu(state.currentNote.id, target.value);
      paintDejaVuChip();
    });

    document.addEventListener('selectionchange', function () {
      var body = document.getElementById('note-body');
      if (!body) return;
      try {
        var sel = window.getSelection();
        if (sel && sel.rangeCount && body.contains(sel.anchorNode)) saveSelection();
      } catch (e) {  }
      updateLinkSuggest();
    });

    dom.main.addEventListener('change', function (event) {
      var box = event.target;
      if (!box || box.type !== 'checkbox' || !box.closest || !box.closest('.task-row')) return;
      if (!state.currentNote) return;
      if (box.checked) box.setAttribute('checked', '');
      else box.removeAttribute('checked');
      readEditorBody();
    });

    dom.main.addEventListener('click', function (event) {
      var x = event.target && event.target.closest ? event.target.closest('.wikilink__x') : null;
      if (x) {
        var host = document.getElementById('note-body');
        var owner = x.closest ? x.closest('.wikilink') : null;
        if (host && owner && host.contains(owner) && state.currentNote) {
          event.preventDefault();
          removeSingleWikiPill(owner);
        }
        return;
      }
      var pill = event.target && event.target.closest
        ? event.target.closest('.wikilink[data-title]') : null;
      if (!pill) return;
      var body = document.getElementById('note-body');
      if (!body || !body.contains(pill)) return;
      event.preventDefault();
      followWikiPill(pill.getAttribute('data-title'));
    });

    function removeSingleWikiPill(pill) {
      var body = document.getElementById('note-body');
      if (!body || !state.currentNote) return;
      var parent = pill.parentNode;
      if (!parent) return;
      var prev = pill.previousSibling;
      var next = pill.nextSibling;
      var index = Array.prototype.indexOf.call(parent.childNodes, pill);
      parent.removeChild(pill);
      if (prev && prev.nodeType === 3 && next && next.nodeType === 3
          && / $/.test(prev.nodeValue) && /^ /.test(next.nodeValue)) {
        next.nodeValue = next.nodeValue.replace(/^ /, '');
      }
      try {
        body.focus();
        var range = document.createRange();
        range.setStart(parent, Math.min(index, parent.childNodes.length));
        range.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {  }
      saveSelection();
      readEditorBody();
    }

    dom.main.addEventListener('copy', function (event) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !event.clipboardData) return;
      var body = document.getElementById('note-body');
      if (!body || !state.currentNote) return;
      var anchor = sel.anchorNode;
      var focus = sel.focusNode;
      if (!anchor || !body.contains(anchor) || !focus || !body.contains(focus)) return;
      if (sel.isCollapsed) return;
      try {
        var holder = document.createElement('div');
        holder.appendChild(sel.getRangeAt(0).cloneContents());
        var text = util.noteToPlainText(holder.innerHTML);
        event.clipboardData.setData('text/plain', text);
      } catch (e) {
        return;
      }
      event.preventDefault();
    });

    dom.main.addEventListener('cut', function (event) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !event.clipboardData) return;
      var body = document.getElementById('note-body');
      if (!body || !state.currentNote) return;
      var anchor = sel.anchorNode;
      var focus = sel.focusNode;
      if (!anchor || !body.contains(anchor) || !focus || !body.contains(focus)) return;
      if (sel.isCollapsed) return;
      try {
        var holder = document.createElement('div');
        holder.appendChild(sel.getRangeAt(0).cloneContents());
        var text = util.noteToPlainText(holder.innerHTML);
        event.clipboardData.setData('text/plain', text);
      } catch (e) {
        return;
      }
      event.preventDefault();
      try {
        var range = sel.getRangeAt(0);
        if (!range.collapsed) range.deleteContents();
      } catch (e) {  }
      saveSelection();
      readEditorBody();
    });

    document.addEventListener('paste', function (event) {
      if (!state.currentNote || App.ui.menuIsOpen() || document.querySelector('dialog[open]')) return;
      var body = document.getElementById('note-body');
      if (!body) return;
      var pictures = clipboardImages(event.clipboardData);
      var inline = pictures.length ? null : markupImageUrl(event.clipboardData);
      if (pictures.length || inline) {
        event.preventDefault();
        restoreSelection();
        insertPastedImages(body, pictures.length ? pictures : [inline]);
        return;
      }
      var target = event.target;
      if (!target || (target !== body && !body.contains(target))) return;
      event.preventDefault();
      var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
      if (!text) return;
      restoreSelection();
      if (typeof document.execCommand === 'function') {
        document.execCommand('insertText', false, text);
      } else {
        body.textContent += text;
      }
      saveSelection();
      readEditorBody();
    });

    dom.main.addEventListener('keydown', function (event) {
      if (!state.linkSuggest) return;
      var body = event.target && event.target.closest ? event.target.closest('#note-body') : null;
      if (!body) return;
      var s = state.linkSuggest;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!s.items.length) return;
        event.preventDefault();
        event.stopPropagation();
        s.active = (s.active + (event.key === 'ArrowDown' ? 1 : -1) + s.items.length) % s.items.length;
        paintLinkSuggest();
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        if (s.active >= 0 && s.items[s.active]) {
          event.preventDefault();
          event.stopPropagation();
          completeLinkSuggest(s.active);
        } else {
          closeLinkSuggest();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeLinkSuggest();
      }
    }, true);

    dom.main.addEventListener('keydown', function (event) {
      var inBody = event.target && event.target.closest
        ? event.target.closest('#note-body') : null;
      if (event.key === 'Tab' && inBody) {
        event.preventDefault();
        if (state.currentNote && typeof document.execCommand === 'function') {
          restoreSelection();
          document.execCommand('insertText', false, '\t');
          saveSelection();
          readEditorBody();
        }
      }
    });

    dom.main.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'task-add') {
        state.taskDraft = event.target.value;
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
        event.preventDefault();
        addField.value = '';
        state.taskDraft = '';
      }
    });

    dom.searchInput.addEventListener('input', function (event) {
      runSearch(event.target.value.trim());
    });

    App.ui.onWorkspaceChange(dom.workspaceSelect, switchWorkspace);
    App.ui.onWorkspacePickerOpen(dom.workspaceSelect, openWorkspacePicker);

    dom.fileInput.addEventListener('change', function (event) {
      var destination = pendingUploadFolder;
      pendingUploadFolder = null;
      uploadFiles(event.target.files, destination !== null && destination !== undefined ? destination : targetFolderId());
      event.target.value = ''; 
    });

    var dragDepth = 0;
    window.addEventListener('dragenter', function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') === -1) return;
      event.preventDefault();
      dragDepth++;
      App.ui.setDragActive(true);
    });
    window.addEventListener('dragover', function (event) {
      if (!event.dataTransfer) return;
      if (Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') === -1) return;
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
      var types = event.dataTransfer ? event.dataTransfer.types : null;
      if (!types || Array.prototype.indexOf.call(types, 'Files') === -1) return;
      if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
      var files = Array.prototype.slice.call(event.dataTransfer.files);
      var body = document.getElementById('note-body');
      var onNote = !!body && !!state.currentNote
        && (body.contains(event.target) || (dom.main && dom.main.contains(event.target)));
      if (onNote) {
        var pictures = files.filter(looksLikePicture);
        if (pictures.length) {
          var rest = files.filter(function (file) { return pictures.indexOf(file) === -1; });
          restoreSelection();
          insertPastedImages(body, pictures).then(function (taken) {
            if (!taken) uploadFiles(pictures, targetFolderId());
            if (rest.length) uploadFiles(rest, targetFolderId());
          });
          return;
        }
      }
      uploadFiles(files, targetFolderId());
    });

    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('settings-open').addEventListener('click', openSettings);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
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
    var templateClose = document.getElementById('template-close');
    if (templateClose) templateClose.addEventListener('click', function () {
      var dlg = document.getElementById('template-picker');
      if (dlg && dlg.open) dlg.close();
    });
    var templateFilter = document.getElementById('template-filter');
    if (templateFilter) templateFilter.addEventListener('input', function () {
      var host = document.getElementById('template-list');
      if (host) paintTemplateList(host);
    });

    if (dom.tabs) {
      dom.tabs.addEventListener('auxclick', function (event) {
        if (event.button !== 1) return;
        var tab = event.target.closest ? event.target.closest('.tab[data-id]') : null;
        if (!tab) return;
        event.preventDefault();
        closeTabRef(tab.getAttribute('data-id'));
      });
    }

    if (dom.tabs) {
      var dragTabRef = null;

      function clearTabDrop() {
        Array.prototype.forEach.call(
          dom.tabs.querySelectorAll('.is-drop-before, .is-drop-after'),
          function (node) { node.classList.remove('is-drop-before', 'is-drop-after'); }
        );
      }

      dom.tabs.addEventListener('dragstart', function (event) {
        var tab = event.target.closest ? event.target.closest('.tab[data-id]') : null;
        if (!tab) return;
        dragTabRef = tab.getAttribute('data-id');
        try {
          event.dataTransfer.setData('text/plain', dragTabRef);
          event.dataTransfer.effectAllowed = 'move';
        } catch (e) {  }
        tab.classList.add('is-dragging');
      });

      dom.tabs.addEventListener('dragover', function (event) {
        if (!dragTabRef) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = 'move'; } catch (e) {  }
        try {
          var strip = dom.tabs.getBoundingClientRect();
          if (event.clientX - strip.left < 28) dom.tabs.scrollLeft -= 10;
          else if (strip.right - event.clientX < 28) dom.tabs.scrollLeft += 10;
        } catch (e) {  }
        clearTabDrop();
        var tab = event.target.closest ? event.target.closest('.tab[data-id]') : null;
        if (!tab || tab.getAttribute('data-id') === dragTabRef) return;
        var box = tab.getBoundingClientRect();
        tab.classList.add(event.clientX < box.left + box.width / 2 ? 'is-drop-before' : 'is-drop-after');
      });

      dom.tabs.addEventListener('dragleave', function (event) {
        if (!dom.tabs.contains(event.relatedTarget)) clearTabDrop();
      });

      dom.tabs.addEventListener('drop', function (event) {
        if (!dragTabRef) return;
        event.preventDefault();
        var tab = event.target.closest ? event.target.closest('.tab[data-id]') : null;
        var ref = dragTabRef;
        if (tab && tab.getAttribute('data-id') !== ref) {
          var box = tab.getBoundingClientRect();
          reorderTabs(ref, tab.getAttribute('data-id'), event.clientX < box.left + box.width / 2);
        } else if (!tab) {
          moveTabToEnd(ref);
        }
        clearTabDrop();
      });

      dom.tabs.addEventListener('dragend', function () {
        dragTabRef = null;
        clearTabDrop();
        Array.prototype.forEach.call(
          dom.tabs.querySelectorAll('.is-dragging'),
          function (node) { node.classList.remove('is-dragging'); }
        );
      });
    }

    window.addEventListener('beforeunload', function () {
      flushPendingSave();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushPendingSave();
    });

    syncMobilePane();
    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 820px)');
      if (mq.addEventListener) mq.addEventListener('change', syncMobilePane);
    }
  }

  function cacheDom() {
    dom.workspaceSelect = document.getElementById('workspace-select');
    dom.layout = document.querySelector('.layout');
    dom.sidebar = document.getElementById('sidebar');
    dom.splitter = document.getElementById('sidebar-splitter');
    dom.tree = document.getElementById('tree');
    dom.tabs = document.getElementById('tabs');
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

  function ready() {
    return bootPromise;
  }


  var IMAGE_DATA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'];
  var PICTURE_EMBED_LIMIT = 400 * 1024;
  var PICTURE_MAX_EDGE = 1400;
  var IMAGE_SIGNATURES = [
    { type: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    { type: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
    { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
    { type: 'image/bmp', bytes: [0x42, 0x4D] },
  ];

  function looksLikePicture(file) {
    var type = String((file && file.type) || '').toLowerCase();
    return type.indexOf('image/') === 0 || type === '' || type === 'application/octet-stream';
  }

  function clipboardImages(data) {
    var out = [];
    if (!data) return out;
    function wanted(type) {
      return looksLikePicture({ type: type });
    }
    var items = data.items || [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i];
      if (entry.kind === 'file' && wanted(entry.type)) {
        var picked = entry.getAsFile ? entry.getAsFile() : null;
        if (picked) out.push(picked);
      }
    }
    if (!out.length && data.files) {
      for (var j = 0; j < data.files.length; j++) {
        if (wanted(data.files[j].type)) out.push(data.files[j]);
      }
    }
    return out;
  }

  function markupImageUrl(data) {
    if (!data || !data.getData) return null;
    var markup = '';
    try { markup = String(data.getData('text/html') || ''); } catch (e) { return null; }
    if (markup.indexOf('<img') === -1) return null;
    var match = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(markup);
    var url = String((match && (match[2] || match[3] || match[4])) || '');
    return /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(url) ? url : null;
  }

  function sniffImageType(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var head = new Uint8Array(reader.result || new ArrayBuffer(0));
          var ascii = function (at) {
            return String.fromCharCode(head[at], head[at + 1], head[at + 2], head[at + 3]);
          };
          if (head.length >= 12 && ascii(0) === 'RIFF' && ascii(8) === 'WEBP') {
            resolve('image/webp');
            return;
          }
          if (head.length >= 12 && ascii(4) === 'ftyp' && ascii(8) === 'avif') {
            resolve('image/avif');
            return;
          }
          for (var i = 0; i < IMAGE_SIGNATURES.length; i++) {
            var signature = IMAGE_SIGNATURES[i];
            var hit = head.length >= signature.bytes.length;
            for (var j = 0; hit && j < signature.bytes.length; j++) {
              if (head[j] !== signature.bytes[j]) hit = false;
            }
            if (hit) {
              resolve(signature.type);
              return;
            }
          }
          resolve(null);
        } catch (e) {
          resolve(null);
        }
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsArrayBuffer(file.slice(0, 16));
    });
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('the picture could not be read')); };
      reader.readAsDataURL(file);
    });
  }
  
  function shrinkPicture(file, type) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      function settle(err, value) {
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(value);
      }
      image.onload = function () {
        try {
          var edge = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
          if (!edge || edge <= PICTURE_MAX_EDGE) { settle(null, null); return; }
          var scale = PICTURE_MAX_EDGE / edge;
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((image.naturalWidth || 0) * scale));
          canvas.height = Math.max(1, Math.round((image.naturalHeight || 0) * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          var kind = type === 'image/png' ? 'image/png' : 'image/jpeg';
          settle(null, canvas.toDataURL(kind, 0.85));
        } catch (err) {
          settle(err);
        }
      };
      image.onerror = function () { settle(new Error('the picture could not be decoded')); };
      image.src = url;
    });
  }

  function pictureDataUrl(file, type) {
    var declared = String(type || file.type || '').toLowerCase();
    var large = Number(file.size) > PICTURE_EMBED_LIMIT;
    return (large ? shrinkPicture(file, declared) : Promise.resolve(null)).then(function (shrunk) {
      if (shrunk) return shrunk;
      return readAsDataUrl(file).then(function (url) {
        if (!declared || url.indexOf('data:' + declared) === 0) return url;
        return url.replace(/^data:[^;,]*/, 'data:' + declared);
      });
    });
  }

  function insertPastedImages(body, sources) {
    var chain = Promise.resolve(0);
    var inserted = 0;
    var skipped = 0;
    sources.forEach(function (source) {
      chain = chain.then(function () {
        if (typeof source === 'string') return source;
        if (IMAGE_DATA_TYPES.indexOf(String(source.type || '').toLowerCase()) !== -1) {
          return pictureDataUrl(source);
        }
        return sniffImageType(source).then(function (sniffed) {
          if (!sniffed) {
            skipped++;
            return null;
          }
          return pictureDataUrl(source, sniffed);
        });
      }).then(function (url) {
        if (!url) return null;
        var pill = util.buildImagePill(document, url);
        var range = savedRange;
        if (range && body.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(pill);
          range.setStartAfter(pill);
          range.collapse(true);
          var sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
          savedRange = range.cloneRange();
        } else {
          body.appendChild(pill);
        }
        inserted++;
        return null;
      });
    });
    return chain.then(function () {
      if (!inserted) {
        util.toast(skipped
          ? 'That is not a picture this editor can show.'
          : 'No picture was found to add.', 'error');
        return false;
      }
      saveSelection();
      readEditorBody();
      util.toast(inserted === 1
        ? 'Picture added to the note.'
        : inserted + ' pictures added to the note.', 'success');
      return true;
    }).catch(function (err) {
      util.toast('Could not add the picture: ' + err.message, 'error', 9000);
      return false;
    });
  }



  var reminderTimer = null;

  function ensureNotifyPermission() {
    if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    try {
      var asked = Notification.requestPermission();
      return asked && typeof asked.then === 'function'
        ? asked.catch(function () { return 'denied'; })
        : Promise.resolve('default');
    } catch (err) {
      return Promise.resolve('denied'); 
    }
  }

  function openRemindedTask(id) {
    try { window.focus(); } catch (err) {  }
    if (!App.db.getTask(id)) return;
    showTasks(true);
    editTask(id);
  }

  function announceReminder(task) {
    var body = task.due_at
      ? 'Due ' + util.formatWhen(task.due_at)
      : (task.notes ? String(task.notes).slice(0, 140) : 'Reminder');
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        var notice = new Notification(task.title || 'Task', {
          body: body,
          tag: 'noteapp-task-' + task.id,
        });
        notice.onclick = function () { openRemindedTask(task.id); };
        return;
      } catch (err) {  }
    }
    util.toast('Reminder: ' + (task.title || 'Task'), 'info', 12000);
  }

  function checkReminders() {
    if (!state.ready || !state.workspaceId) return;
    var due = [];
    try {
      due = App.db.dueReminders();
    } catch (err) {
      return;
    }
    due.forEach(function (task) {
      App.db.markReminderFired(task.id).then(function () {
        announceReminder(task);
      }).catch(function () {  });
    });
  }

  function startReminders() {
    if (reminderTimer) return;
    reminderTimer = window.setInterval(checkReminders, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkReminders();
    });
    window.addEventListener('focus', checkReminders);
    checkReminders();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;
    try {
      navigator.serviceWorker.register('sw.js').catch(function () {
      });
    } catch (err) {  }
  }
  function boot() {
    cacheDom();
    applyManifest();
    applySidebarHidden(sidebarHidden());
    bootstrapIcons();
    applyTheme(App.prefs.get('theme', window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    applyPalette(App.prefs.get('palette', 'indigo'));
    applySidebarWidth();

    wireEvents();
    wireSplitter();
    applySort();
    paintSortButton();
    applyPaneView();

    App.ui.renderEmptyState(dom.main, { title: 'Opening your notebook\u2026', body: 'Loading the local SQLite database.' });

    var bootResult = null;
    bootPromise = App.db.init().then(function (result) {
      bootResult = result;
      state.ready = true;
      window.setTimeout(function () { App.db.sweep().catch(function () {  }); }, 2500);
      state.workspaceId = result.lastWorkspaceId;
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
      var resumed = App.db.vaultState() === 'locked'
        ? App.db.resumeVault()
        : Promise.resolve(null);
      return resumed.then(function () {
        return refreshWorkspaces().then(function () {
          restorePlace(state.workspaceId);
        });
      });
    }).then(function () {
      render();
      renderFooter();
      startReminders();
      registerServiceWorker();
      App.db.rebuildLinks().catch(function () {  });
      if (bootResult && wantsSelfTest()) runSelfTest();
    }).catch(function (err) {
      App.ui.renderEmptyState(dom.main, {
        title: 'The database could not start',
        body: err.message + '. Try reloading the page.',
      });
      util.toast('Startup failed: ' + err.message, 'error', 12000);
      console.error(err);
    });
  }

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
    openFile: openFile,
    activateTab: activateTab,
    openNewTab: openNewTab,
    closeTabRef: closeTabRef,
    closeOtherTabs: closeOtherTabs,
    closeAllTabs: closeAllTabs,
    cycleTab: cycleTab,
    moveTab: moveTab,
    moveTabToEnd: moveTabToEnd,
    reorderTabs: reorderTabs,
    setTabPinned: setTabPinned,
    jumpToPreviousTab: jumpToPreviousTab,
    reopenClosedTab: reopenClosedTab,
    uploadFiles: uploadFiles,
    revealPaneItem: revealPaneItem,
    exportDatabase: exportDatabase,
  };

  var bootPromise = null;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.NoteApp);
