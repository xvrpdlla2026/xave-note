window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var el = util.el;

  var liveObjectUrls = [];

  function revokeObjectUrls() {
    liveObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    liveObjectUrls = [];
  }

  function makeObjectUrl(blob) {
    var url = URL.createObjectURL(blob);
    liveObjectUrls.push(url);
    return url;
  }

  function markImageMissing(img) {
    img.classList.add('is-missing');
    img.removeAttribute('src');
    img.setAttribute('alt', 'Image unavailable');
  }

  function hydrateNoteImages(root) {
    var pills = root.querySelectorAll('img[data-file-id]');
    Array.prototype.forEach.call(pills, function (img) {
      var id = img.getAttribute('data-file-id');
      App.db.getFileBlob(id).then(function (resolved) {
        if (!img.isConnected) return;
        if (!resolved || !resolved.blob) {
          markImageMissing(img);
          return;
        }
        img.src = makeObjectUrl(resolved.blob);
        img.classList.remove('is-missing');
        if (resolved.filename) img.setAttribute('alt', resolved.filename);
      }, function () {
        if (img.isConnected) markImageMissing(img);
      });
    });
  }

  function recurrenceLabel(encoded) {
    var rule = null;
    try { rule = JSON.parse(encoded); } catch (err) { return ''; }
    if (!rule || !rule.freq) return '';
    var ones = {
      daily: 'Every day',
      weekdays: 'Every weekday',
      weekly: 'Every week',
      monthly: 'Every month',
      yearly: 'Every year',
    };
    var plurals = { daily: 'days', weekdays: 'weekdays', weekly: 'weeks', monthly: 'months', yearly: 'years' };
    if (!ones[rule.freq]) return '';
    var count = Number(rule.interval) || 1;
    return count > 1 ? 'Every ' + count + ' ' + plurals[rule.freq] : ones[rule.freq];
  }

  function reminderLabel(task) {
    var when = new Date(task.remind_at);
    if (isNaN(when.getTime())) return 'Reminder';
    var time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    var sameDay = when.toDateString() === new Date().toDateString();
    var text = sameDay
      ? time
      : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
    return (task.reminded_at ? 'Reminded ' : 'Reminder ') + text;
  }

  function renderWorkspaceSelect(host, workspaces, currentId) {
    var current = null;
    workspaces.forEach(function (ws) { if (String(ws.id) === String(currentId)) current = ws; });
    if (!current && workspaces.length) current = workspaces[0];
    var label = current ? current.name : 'No workspaces';

    host.textContent = '';
    var trigger = el('button', {
      class: 'select__trigger ws-trigger',
      type: 'button',
      'aria-haspopup': 'dialog',
      title: workspaces.length + (workspaces.length === 1 ? ' workspace' : ' workspaces') + ' \u00b7 switch workspace',
      onclick: function () {
        if (typeof host.__onOpenPicker === 'function') host.__onOpenPicker();
      },
    }, [
      el('span', { class: 'select__lead' }, [App.ui.icon('database', 15)]),
      el('span', { class: 'select__value', text: label }),
      el('span', { class: 'ws-trigger__count', text: String(workspaces.length) }),
    ]);

    host.appendChild(trigger);
    return trigger;
  }

  function onWorkspaceChange(host, handler) {
    host.__onChange = handler;
  }

  function onWorkspacePickerOpen(host, handler) {
    host.__onOpenPicker = handler;
  }

  function renderWorkspacePanel(host, ctx) {
    var workspaces = ctx.workspaces || [];
    var currentId = ctx.currentId != null ? String(ctx.currentId) : null;
    var term = String(ctx.term || '').trim().toLowerCase();
    var countsById = ctx.countsById || {};

    var form = el('div', { class: 'panel ws-panel' });

    var sub = workspaces.length
      ? workspaces.length + (workspaces.length === 1 ? ' workspace' : ' workspaces') + ' \u00b7 search to filter'
      : 'No workspaces yet';
    var closeBtn = el('button', {
      class: 'btn btn--sm panel__close', type: 'button',
      title: 'Close (Esc)',
      'aria-label': 'Close the workspace picker',
      onclick: function () { ctx.onClose(); },
    }, [App.ui.icon('close', 13), 'Close']);

    form.appendChild(el('header', { class: 'panel__head' }, [
      el('span', { class: 'panel__tile', 'aria-hidden': 'true' }, [App.ui.icon('layers')]),
      el('div', { class: 'panel__heading' }, [
        el('h2', { id: 'ws-title', class: 'panel__title', text: 'Workspaces' }),
        el('p', { class: 'panel__sub', text: sub }),
      ]),
      closeBtn,
    ]));

    var searchInput = el('input', {
      id: 'ws-search',
      type: 'search',
      placeholder: 'Filter workspaces',
      'aria-label': 'Filter workspaces by name',
      autocomplete: 'off',
    });
    searchInput.value = ctx.term || '';
    searchInput.addEventListener('input', function () { ctx.onSearch(searchInput.value); });

    form.appendChild(el('div', { class: 'panel__tools' }, [
      el('span', { class: 'ws-tools__hint', text: 'Switch workspace' }),
      el('span', { class: 'panel__spacer' }),
      el('div', { class: 'search-field' }, [
        App.ui.icon('search', 14),
        searchInput,
      ]),
    ]));

    var list = el('div', { class: 'panel__list ws-list', role: 'listbox', 'aria-labelledby': 'ws-title' });
    form.appendChild(list);

    var foot = el('div', { class: 'panel__foot' });
    form.appendChild(foot);

    function visible() {
      return workspaces.filter(function (ws) {
        if (term && String(ws.name || '').toLowerCase().indexOf(term) === -1) return false;
        return true;
      });
    }

    function wsMeta(ws) {
      var c = countsById[ws.id];
      if (!c) return 'workspace';
      var parts = [];
      if (c.folders) parts.push(c.folders + ' folder' + (c.folders === 1 ? '' : 's'));
      parts.push((c.notes || 0) + ' note' + ((c.notes || 0) === 1 ? '' : 's'));
      if (c.files) parts.push(c.files + ' file' + (c.files === 1 ? '' : 's'));
      return parts.join(' \u00b7 ') || 'empty workspace';
    }

    function paint() {
      var rows = visible();
      list.textContent = '';
      if (!rows.length) {
        list.appendChild(workspaces.length
          ? el('div', { class: 'trash-empty' }, [
              el('h3', { text: 'No matches' }),
              el('p', { text: 'No workspace matches \u201c' + ctx.term + '\u201d.' }),
            ])
          : el('div', { class: 'trash-empty' }, [
              el('h3', { text: 'No workspaces yet' }),
              el('p', { text: 'Create one to get organised.' }),
            ]));
      } else {
        rows.forEach(function (ws, i) {
          var active = String(ws.id) === currentId;
          list.appendChild(el('button', {
            class: 'ws-row' + (active ? ' is-selected' : ''),
            type: 'button',
            role: 'option',
            'aria-selected': active ? 'true' : 'false',
            title: ws.name,
            onclick: function () { ctx.onPick(ws.id); },
          }, [
            el('span', { class: 'trash-row__glyph' }, [App.ui.icon('database', 14)]),
            el('span', { class: 'trash-row__text' }, [
              el('span', { class: 'trash-row__name', text: ws.name || 'Untitled workspace', title: ws.name || '' }),
              el('span', { class: 'trash-row__meta' }, [
                el('span', { text: wsMeta(ws) }),
              ]),
            ]),
            active
              ? el('span', { class: 'ws-row__check', 'aria-hidden': 'true' }, [App.ui.icon('check', 14)])
              : null,
          ]));
          void i;
        });
      }

      foot.textContent = '';
      var sel = workspaces.filter(function (ws) { return String(ws.id) === currentId; })[0];
      foot.appendChild(el('p', { class: 'panel__count' }, [
        document.createTextNode(sel
          ? 'Current: ' + (sel.name || 'Untitled workspace') + (rows.length !== workspaces.length ? ' \u00b7 ' + rows.length + ' shown' : '')
          : rows.length + ' shown'),
      ]));
      foot.appendChild(el('button', {
        class: 'btn btn--sm', type: 'button',
        onclick: function () { ctx.onNew(); },
      }, [App.ui.icon('layers', 12), 'New workspace']));
      foot.appendChild(el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: function () { ctx.onClose(); },
      }, ['Back to workspace']));
    }

    paint();

    host.__refresh = function (next) {
      workspaces = next.workspaces || workspaces;
      currentId = next.currentId != null ? String(next.currentId) : currentId;
      ctx.term = next.term;
      term = String(next.term || '').trim().toLowerCase();
      countsById = next.countsById || countsById;
      if (document.activeElement !== searchInput) searchInput.value = next.term || '';
      var headSub = form.querySelector('.panel__sub');
      if (headSub) {
        headSub.textContent = workspaces.length
          ? workspaces.length + (workspaces.length === 1 ? ' workspace' : ' workspaces') + ' \u00b7 search to filter'
          : 'No workspaces yet';
      }
      paint();
    };

    host.textContent = '';
    host.appendChild(form);
  }

  function renderMovePanel(host, ctx) {
    var mode = ctx.mode || 'place';
    var workspaces = ctx.workspaces || [];
    var foldersByWs = ctx.foldersByWs || {};
    var countsByWs = ctx.countsByWs || {};
    var currentWsId = ctx.currentWsId != null ? String(ctx.currentWsId) : null;
    var currentFolderId = ctx.currentFolderId != null ? String(ctx.currentFolderId) : null;
    var term = String(ctx.term || '').trim().toLowerCase();
    var view = ctx.view || 'all';

    var form = el('div', { class: 'panel' });

    var closeBtn = el('button', {
      class: 'btn btn--sm panel__close', type: 'button',
      title: 'Close (Esc)',
      'aria-label': 'Close without moving',
      onclick: function () { ctx.onClose(); },
    }, [App.ui.icon('close', 13), 'Close']);

    form.appendChild(el('header', { class: 'panel__head' }, [
      el('span', { class: 'panel__tile', 'aria-hidden': 'true' }, [App.ui.icon(ctx.icon || 'layers')]),
      el('div', { class: 'panel__heading' }, [
        el('h2', { id: 'move-title', class: 'panel__title', text: ctx.title || 'Move' }),
        el('p', { class: 'panel__sub', text: ctx.sub || '' }),
      ]),
      closeBtn,
    ]));

    var searchInput = el('input', {
      id: 'move-search',
      type: 'search',
      placeholder: 'Filter destinations',
      'aria-label': 'Filter destinations by name',
      autocomplete: 'off',
    });
    searchInput.value = ctx.term || '';
    searchInput.addEventListener('input', function () { ctx.onSearch(searchInput.value); });

    var filters = null;
    if (mode === 'place') {
      filters = App.ui.radioGroup({
        name: 'move-view',
        value: view,
        options: [
          { value: 'all', label: 'All', badge: 0 },
          { value: 'workspace', label: 'Workspaces', badge: 0 },
          { value: 'folder', label: 'Folders', badge: 0 },
        ],
        onChange: function (value) { ctx.onView(value); },
      });
    }

    form.appendChild(el('div', { class: 'panel__tools' }, [
      filters || el('span', { class: 'ws-tools__hint', text: 'Choose destination' }),
      el('span', { class: 'panel__spacer' }),
      el('div', { class: 'search-field' }, [
        App.ui.icon('search', 14),
        searchInput,
      ]),
    ]));

    var list = el('div', { class: 'panel__list', role: 'listbox', 'aria-labelledby': 'move-title' });
    form.appendChild(list);

    var foot = el('div', { class: 'panel__foot' });
    form.appendChild(foot);

    function match(name) {
      return !term || String(name || '').toLowerCase().indexOf(term) !== -1;
    }

    function wsTotals(ws) {
      var c = countsByWs[ws.id];
      if (!c) return 'workspace';
      var parts = [];
      if (c.folders) parts.push(c.folders + ' folder' + (c.folders === 1 ? '' : 's'));
      parts.push((c.notes || 0) + ' note' + ((c.notes || 0) === 1 ? '' : 's'));
      if (c.files) parts.push(c.files + ' file' + (c.files === 1 ? '' : 's'));
      return parts.join(' \u00b7 ') || 'empty workspace';
    }

    function wsNameOf(wsId) {
      var hit = workspaces.filter(function (w) { return String(w.id) === String(wsId); })[0];
      return hit ? hit.name : 'Workspace';
    }

    function destCard(wsId, folder, isCurrent, flatWs) {
      var isRoot = !folder;
      var meta = isRoot
        ? 'Workspace root \u00b7 ' + wsTotals({ id: wsId })
        : (flatWs ? wsNameOf(wsId) : null);
      return el('button', {
        class: 'card' + (isRoot ? '' : ' card--folder') + (isCurrent ? ' is-active' : ''),
        type: 'button',
        role: 'option',
        'aria-selected': isCurrent ? 'true' : 'false',
        title: isRoot ? wsNameOf(wsId) + ' \u2014 workspace root' : (folder.name || 'Untitled folder'),
        onclick: function () { ctx.onPick(wsId, folder ? folder.id : null); },
      }, [
        el('span', { class: 'card__glyph' }, [App.ui.icon(isRoot ? 'database' : 'folder')]),
        el('span', { class: 'card__title', text: isRoot ? wsNameOf(wsId) : (folder.name || 'Untitled folder') }),
        meta ? el('span', { class: 'card__meta', text: meta }) : null,
      ]);
    }

    function paintFilterCounts(totals) {
      if (!filters) return;
      filters.inputs.forEach(function (input) {
        var item = input.parentNode;
        var badge = item ? item.querySelector('.segmented__badge') : null;
        if (badge) badge.textContent = String(totals[input.value] || 0);
      });
    }

    function paint() {
      list.textContent = '';
      var shown = 0;
      var totals = { all: 0, workspace: 0, folder: 0 };
      workspaces.forEach(function (ws) {
        totals.workspace += 1;
        if (mode === 'place') totals.folder += (foldersByWs[ws.id] || []).length;
      });
      totals.all = totals.workspace + totals.folder;
      paintFilterCounts(totals);
      if (filters) filters.setValue(view);

      function flatGrid(cards) {
        if (!cards.length) return;
        var grid = el('div', { class: 'card-grid' });
        cards.forEach(function (card) { grid.appendChild(card); });
        list.appendChild(grid);
        shown += cards.length;
      }

      if (mode === 'workspace' || (mode === 'place' && view === 'workspace')) {
        var roots = [];
        workspaces.forEach(function (ws) {
          if (!match(ws.name)) return;
          roots.push(destCard(ws.id, null, String(ws.id) === currentWsId));
        });
        flatGrid(roots);
      } else if (mode === 'place' && view === 'folder') {
        var flat = [];
        workspaces.forEach(function (ws) {
          (foldersByWs[ws.id] || []).forEach(function (f) {
            if (!match(f.name)) return;
            flat.push(destCard(ws.id, f,
              String(ws.id) === currentWsId && String(f.id) === currentFolderId, true));
          });
        });
        flatGrid(flat);
      } else {
        workspaces.forEach(function (ws) {
          var folders = (foldersByWs[ws.id] || []).filter(function (f) { return match(f.name); });
          var showRoot = !term || match(ws.name);
          if (!folders.length && !showRoot) return;
          list.appendChild(el('h3', { class: 'panel__group' }, [
            el('span', { text: ws.name }),
            el('span', { class: 'panel__group-count', text: String(folders.length + (showRoot ? 1 : 0)) }),
          ]));
          var grid = el('div', { class: 'card-grid' });
          if (showRoot) {
            grid.appendChild(destCard(ws.id, null,
              String(ws.id) === currentWsId && currentFolderId === null));
            shown += 1;
          }
          folders.forEach(function (f) {
            grid.appendChild(destCard(ws.id, f,
              String(ws.id) === currentWsId && String(f.id) === currentFolderId));
            shown += 1;
          });
          list.appendChild(grid);
        });
      }
      if (!shown) {
        list.appendChild(el('div', { class: 'trash-empty' }, [
          el('h3', { text: 'No matches' }),
          el('p', { text: 'No destination matches \u201c' + ctx.term + '\u201d.' }),
        ]));
      }

      foot.textContent = '';
      foot.appendChild(el('p', { class: 'panel__count' }, [
        document.createTextNode(ctx.footNote || (shown === 1 ? '1 destination' : shown + ' destinations')),
      ]));
      foot.appendChild(el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: function () { ctx.onClose(); },
      }, ['Back to workspace']));
    }

    paint();

    host.__refresh = function (next) {
      workspaces = next.workspaces || workspaces;
      foldersByWs = next.foldersByWs || foldersByWs;
      countsByWs = next.countsByWs || countsByWs;
      ctx.term = next.term;
      term = String(next.term || '').trim().toLowerCase();
      if (next.view) view = next.view;
      if (document.activeElement !== searchInput) searchInput.value = next.term || '';
      paint();
    };

    host.textContent = '';
    host.appendChild(form);
  }

  function sortKeyLabel(key) {
    var match = sortKeysFor().filter(function (entry) { return entry.key === key; })[0];
    return match ? match.label : key;
  }

  function sortKeysFor() {
    return App.db.sortKeysFor();
  }

  function reorderMenuItems(reorder) {
    if (!reorder || !reorder.enabled) return [];
    return [
      [
        { sep: true },
        { label: 'Move up', shortcut: '\u2191', onclick: reorder.up },
        { label: 'Move down', shortcut: '\u2193', onclick: reorder.down },
      ],
    ];
  }

  function menuOpenSort(cfg) {
    var selected = cfg.sort || { key: 'manual', dir: 'asc' };
    var items = App.db.sortKeysFor().map(function (entry) {
      return {
        label: entry.label,
        checked: entry.key === selected.key,
        onclick: function () { cfg.onChoose(entry.key, selected.dir); },
      };
    });
    items.push({ sep: true });
    items.push(sortDirectionItem(selected.dir, cfg.onChoose, selected.key));

    return App.ui.openMenu({
      x: cfg.x,
      y: cfg.y,
      title: 'Sort by',
      items: items,
      onClose: cfg.onClose,
    });
  }

  function sortDirectionItem(dir, onChoose, key) {
    var ascending = dir === 'asc';
    var size = key === 'size';
    var label = ascending
      ? (size ? 'Smallest first' : 'Ascending')
      : (size ? 'Largest first' : 'Descending');
    return {
      label: label,
      shortcut: ascending ? 'A \u2192 Z' : 'Z \u2192 A',
      onclick: function () { onChoose(key, ascending ? 'desc' : 'asc'); },
    };
  }
  function renderTree(host, model) {
    var frag = document.createDocumentFragment();

    frag.appendChild(rootRow(model));

    if (!model.folders.length && !model.rootNotes.length && !model.rootFiles.length) {
      frag.appendChild(el('p', { class: 'tree__hint', text: 'No folders yet. Create one to get organised.' }));
    }

    var counts = countDirectItems(model);
    buildFolderLevel(host, model.folders, null, model, counts, frag, 0);

    var firstLoose = model.rootNotes.length ? 'note' : (model.rootFiles.length ? 'file' : null);
    var separated = false;
    model.rootNotes.forEach(function (note) {
      var isBoundary = !separated && firstLoose === 'note';
      separated = separated || isBoundary;
      frag.appendChild(noteRow(host, note, model.activeNoteId, 0, isBoundary));
    });
    model.rootFiles.forEach(function (file) {
      var isBoundary = !separated && firstLoose === 'file';
      separated = separated || isBoundary;
      frag.appendChild(fileRow(host, file, model.activeFileId, 0, isBoundary));
    });
    host.textContent = '';
    host.appendChild(frag);
  }

  function countDirectItems(model) {
    var counts = {};
    function bump(folderId) {
      if (!folderId) return;
      counts[folderId] = (counts[folderId] || 0) + 1;
    }
    model.folders.forEach(function (f) { bump(f.parent_folder_id || null); });
    Object.keys(model.notesByFolder).forEach(function (id) {
      (model.notesByFolder[id] || []).forEach(function () { bump(id); });
    });
    Object.keys(model.filesByFolder).forEach(function (id) {
      (model.filesByFolder[id] || []).forEach(function () { bump(id); });
    });
    return counts;
  }

  var indentStep = null;

  function treeIndent(host) {
    if (indentStep === null) {
      var raw = host ? getComputedStyle(host).getPropertyValue('--tree-indent') : '';
      var px = parseFloat(raw);
      indentStep = px > 0 ? px : 16;
    }
    return indentStep;
  }

  function indentStyle(host, depth) {
    return '--indent:' + (depth * treeIndent(host)) + 'px';
  }

  function depthClass(depth) {
    return depth > 0 ? ' tree__row--nested' : '';
  }

  function groupStartClass(isGroupStart) {
    return isGroupStart ? ' tree__row--group-start' : '';
  }

  function glyph(name, extraClass) {
    var node = App.ui.icon(name);
    if (!node) return null;
    node.classList.add('tree__glyph');
    if (extraClass) node.classList.add(extraClass);
    return node;
  }

  function rootRow(model) {
    var active = model.selection.type === 'all' && !model.activeNoteId && !model.activeFileId;
    var total = model.counts.notes + model.counts.files;
    return el('div', {
      class: 'tree__row tree__row--root' + (active ? ' is-active' : ''),
      role: 'treeitem',
      tabindex: '0',
      'aria-selected': active ? 'true' : 'false',
      dataset: { action: 'select-all', ctx: 'workspace', ctxLabel: 'All notes' },
      title: 'Everything in this workspace',
    }, [
      glyph('layers'),
      el('span', { class: 'tree__label', text: 'All notes' }),
      el('span', { class: 'tree__badge', text: String(total) }),
    ]);
  }

  function noteRow(host, note, activeId, depth, looseStart, groupStart) {
    var title = note.title && note.title.trim() ? note.title : 'Untitled note';
    var active = note.id === activeId;
    return el('div', {
      class: 'tree__row tree__row--note' + depthClass(depth) + groupStartClass(groupStart)
        + (active ? ' is-active' : '') + (looseStart ? ' tree__row--loose-start' : ''),
      role: 'treeitem',
      tabindex: '0',
      'aria-selected': active ? 'true' : 'false',
      dataset: { action: 'open-note', id: note.id, ctx: 'note', ctxLabel: title },
      style: indentStyle(host, depth),
      title: title,
    }, [
      glyph('note', 'tree__glyph--note'),
      el('span', { class: 'tree__label', text: title }),
      active ? el('span', { class: 'tree__when', text: util.formatWhen(note.updated_at) }) : null,
    ]);
  }

  function fileRow(host, file, activeId, depth, looseStart, groupStart) {
    var active = file.id === activeId;
    var when = util.formatWhen(file.created_at);
    return el('div', {
      class: 'tree__row tree__row--file' + depthClass(depth) + groupStartClass(groupStart)
        + (active ? ' is-active' : '') + (looseStart ? ' tree__row--loose-start' : ''),
      role: 'treeitem',
      tabindex: '0',
      'aria-selected': active ? 'true' : 'false',
      dataset: { action: 'open-file', id: file.id, ctx: 'file', ctxLabel: file.filename },
      style: indentStyle(host, depth),
      title: file.filename + ' \u00b7 ' + util.formatBytes(file.size) + (when ? ' \u00b7 added ' + when : ''),
    }, [
      el('span', { class: 'tree__glyph tree__glyph--file', text: util.fileGlyph(file.filename, file.mime_type) }),
      el('span', { class: 'tree__label', text: file.filename }),
    ]);
  }

  function twisty(folder, expanded) {
    var label = (expanded ? 'Collapse ' : 'Expand ') + folder.name;
    return el('button', {
      type: 'button',
      class: 'tree__twisty' + (expanded ? ' is-expanded' : ''),
      dataset: { action: 'toggle-folder', id: folder.id },
      'aria-expanded': expanded ? 'true' : 'false',
      tabindex: '-1',
      title: expanded ? 'Collapse' : 'Expand',
    }, [
      el('span', { class: 'tree__glyph-chevron', 'aria-hidden': 'true' }),
      el('span', { class: 'visually-hidden', text: label }),
    ]);
  }

  function buildFolderLevel(host, folders, parentId, model, counts, frag, depth, takeOpening) {
    if (depth > 16) return;
    folders
      .filter(function (f) { return (f.parent_folder_id || null) === parentId; })
      .forEach(function (folder) {
        var expanded = !!model.expanded[folder.id];
        var active = model.selection.type === 'folder' && model.selection.id === folder.id
          && !model.activeNoteId && !model.activeFileId;
        var direct = counts[folder.id] || 0;

        frag.appendChild(el('div', {
          class: 'tree__row tree__row--folder' + depthClass(depth) + groupStartClass(takeOpening && takeOpening())
            + (active ? ' is-active' : '') + (expanded ? ' is-expanded' : ''),
          role: 'treeitem',
          tabindex: '0',
          'aria-selected': active ? 'true' : 'false',
          'aria-expanded': expanded ? 'true' : 'false',
          dataset: { action: 'select-folder', id: folder.id, ctx: 'folder', ctxLabel: folder.name },
          style: indentStyle(host, depth),
          title: folder.name,
        }, [
          twisty(folder, expanded),
          glyph('folder', 'tree__glyph--folder'),
          el('span', { class: 'tree__label', text: folder.name }),
          direct ? el('span', { class: 'tree__count', text: String(direct) }) : null,
        ]));

        if (expanded) {
          var childFolders = folders.filter(function (f) { return f.parent_folder_id === folder.id; });
          var childNotes = model.notesByFolder[folder.id] || [];
          var childFiles = model.filesByFolder[folder.id] || [];
          var opens = true;
          var takeOpening = function () {
            var isOpen = opens;
            opens = false;
            return isOpen;
          };

          buildFolderLevel(host, folders, folder.id, model, counts, frag, depth + 1, takeOpening);

          childNotes.forEach(function (note) {
            frag.appendChild(noteRow(host, note, model.activeNoteId, depth + 1, false, takeOpening()));
          });
          childFiles.forEach(function (file) {
            frag.appendChild(fileRow(host, file, model.activeFileId, depth + 1, false, takeOpening()));
          });

          if (!childFolders.length && !childNotes.length && !childFiles.length) {
            frag.appendChild(el('div', {
              class: 'tree__empty tree__row--nested tree__row--group-start',
              style: indentStyle(host, depth + 1),
              text: 'empty',
            }));
          }
        }
      });
  }

  function renderTabs(host, ctx) {
    var tabs = (ctx && ctx.tabs) || [];
    if (ctx && ctx.hidden) {
      host.classList.add('is-hidden');
      host.textContent = '';
      return;
    }
    host.classList.remove('is-hidden');
    host.textContent = '';
    var frag = document.createDocumentFragment();
    tabs.forEach(function (t) {
      var label = t.title || (t.kind === 'file' ? 'Untitled file' : 'Untitled note');
      var tab = el('div', {
        class: 'tab' + (t.active ? ' is-active' : '') + (t.pinned ? ' is-pinned' : ''),
        role: 'tab',
        tabindex: '0',
        draggable: 'true',
        'aria-selected': t.active ? 'true' : 'false',
        'aria-label': label + (t.pinned ? ' (pinned)' : ''),
        dataset: {
          action: 'activate-tab',
          id: t.kind + ':' + t.id,
          kind: t.kind,
          ctx: 'tab',
          ctxLabel: label,
        },
        title: label + (t.pinned ? ' \u00b7 pinned' : '')
          + (t.dirty ? ' \u00b7 unsaved changes' : '') + ' \u00b7 drag to reorder',
      });
      if (t.kind === 'new') {
        tab.appendChild(el('span', { class: 'tab__glyph', text: 'NEW' }));
      } else if (t.kind === 'file') {
        tab.appendChild(el('span', { class: 'tab__glyph', text: t.glyph || 'FILE' }));
      } else {
        var icon = App.ui.icon('note', 12);
        if (icon) {
          try { icon.classList.add('tab__glyph'); } catch (e) {  }
          tab.appendChild(icon);
        }
      }
      tab.appendChild(el('span', { class: 'tab__label', text: label }));
      if (t.dirty) tab.appendChild(el('span', { class: 'tab__dot', 'aria-hidden': 'true' }));
      if (!t.pinned) {
        tab.appendChild(el('button', {
          class: 'tab__close',
          type: 'button',
          dataset: { action: 'close-tab', id: t.kind + ':' + t.id, kind: t.kind },
          'aria-label': 'Close ' + label,
          title: 'Close ' + label,
          text: '\u00d7',
        }));
      }
      frag.appendChild(tab);
    });
    frag.appendChild(el('button', {
      class: 'tab-add',
      type: 'button',
      dataset: { action: 'new-tab' },
      'aria-label': 'New tab',
      'aria-keyshortcuts': 'Alt+N',
      title: 'New tab (Alt+N)',
    }, [App.ui.icon('plus', 20)]));
    host.appendChild(frag);
    try {
      var active = host.querySelector('.tab.is-active');
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (e) {  }
  }

  function renderFolderView(host, ctx) {
    var frag = document.createDocumentFragment();
    var list = ctx.paneView === 'list';
    var heading = ctx.kind === 'all' ? 'All notes' : ctx.folderName;
    var subtitle = ctx.kind === 'all'
      ? 'Everything in ' + ctx.workspaceName
      : (ctx.path && ctx.path.indexOf(' / ') !== -1 ? ctx.path : 'Folder');

    var viewToggle = App.ui.radioGroup({
      name: 'pane-view',
      value: list ? 'list' : 'tiles',
      className: 'pane-head__views',
      options: [
        { value: 'tiles', label: 'Tiles', icon: 'grid', title: 'Tiles: roomy cards' },
        { value: 'list', label: 'List', icon: 'list', title: 'List: one compact row per item' },
      ],
      onChange: function (value) { if (ctx.onSetPaneView) ctx.onSetPaneView(value); },
    });
    frag.appendChild(el('div', { class: 'pane-head' }, [
      el('h2', { class: 'pane-head__title', text: heading }),
      el('p', { class: 'pane-head__sub', text: subtitle }),
      viewToggle,
    ]));

    if (ctx.kind === 'folder') {
      var actions = el('div', { class: 'pane-actions' }, [
        el('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'new-note' } },
          [App.ui.icon('note', 14), 'New note here']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'new-subfolder' } },
          [App.ui.icon('folder', 14), 'New subfolder']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'upload-file' } },
          [App.ui.icon('upload', 14), 'Upload file']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'rename-folder' } },
          [App.ui.icon('pencil', 14), 'Rename']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'move-folder' } },
          [App.ui.icon('layers', 14), 'Move to workspace']),
        el('button', { class: 'btn btn--danger-ghost', type: 'button', dataset: { action: 'delete-folder' } },
          [App.ui.icon('trash', 14), 'Delete folder']),
      ]);
      frag.appendChild(actions);
    } else {
      frag.appendChild(el('div', { class: 'pane-actions' }, [
        el('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'new-note' } },
          [App.ui.icon('note', 14), 'New note']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'new-folder' } },
          [App.ui.icon('folder', 14), 'New folder']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'upload-file' } },
          [App.ui.icon('upload', 14), 'Upload file']),
      ]));
    }

    function isFocused(context, kind, id) {
      return !!(context.focused && context.focused.kind === kind
        && String(context.focused.id) === String(id));
    }

    function cardGrid(section) {
      return el('div', { class: 'card-grid card-grid--' + section + (list ? ' card-grid--list' : '') });
    }

    if ((ctx.subfolders || []).length || ctx.notes.length || ctx.files.length) {
      frag.appendChild(el('div', { class: 'card-grid' + (list ? ' card-grid--list' : '') }, [
        el('div', { class: 'card-list__head', 'aria-hidden': 'true' }, [
          el('div', { class: 'card card--head' }, [
            el('span', { class: 'card-list__cell', text: '' }),
            el('span', { class: 'card-list__cell', text: 'Name' }),
            el('span', { class: 'card-list__cell card-list__cell--num', text: 'Size' }),
            el('span', { class: 'card-list__cell', text: 'Modified' }),
          ]),
        ]),
      ]));
    }

    var bulk = ctx.bulkSelected || [];

    if (ctx.subfolders && ctx.subfolders.length) {
      var grid = cardGrid('folders');
      ctx.subfolders.forEach(function (folder) {
        grid.appendChild(el('button', {
          class: 'card card--folder' + (isFocused(ctx, 'folder', folder.id) ? ' is-focused' : '')
            + (bulk.indexOf(folder.id) !== -1 ? ' is-selected' : ''),
          type: 'button',
          dataset: { id: folder.id, ctx: 'folder', ctxLabel: folder.name },
        }, [
          el('span', { class: 'card__glyph' }, [App.ui.icon('folder')]),
          el('span', { class: 'card__title', text: folder.name }),
          el('span', {
            class: 'card__meta card__size',
            text: util.formatBytes((ctx.folderBytes || {})[folder.id] || 0),
          }),
        ]));
      });
      frag.appendChild(grid);
    }

    if (ctx.notes.length) {
      var noteCards = cardGrid('notes');
      ctx.notes.forEach(function (note) {
        var isChecked = bulk.indexOf(note.id) !== -1;
        noteCards.appendChild(el('div', {
          class: 'card-wrap' + (isChecked ? ' is-selected' : ''),
          dataset: { noteId: note.id },
        }, [
          el('button', {
            class: 'card card--note' + (note.id === ctx.activeNoteId ? ' is-active' : '')
              + (isFocused(ctx, 'note', note.id) ? ' is-focused' : ''),
            type: 'button',
            dataset: {
              id: note.id, ctx: 'note',
              ctxLabel: note.title && note.title.trim() ? note.title : 'Untitled note',
            },
          }, [
            el('span', { class: 'card__glyph' }, [App.ui.icon('note')]),
            el('span', { class: 'card__title', text: note.title && note.title.trim() ? note.title : 'Untitled note' }),
            el('span', { class: 'card__meta card__meta--split' }, [
              el('span', { class: 'card__size', text: util.formatBytes(note.bytes) }),
              el('span', { class: 'card__sep', 'aria-hidden': 'true', text: '\u00b7' }),
              el('span', { class: 'card__when', text: util.formatWhen(note.updated_at) }),
            ]),
          ]),
        ]));
      });
      frag.appendChild(noteCards);
    }

    if (ctx.files.length) {
      var fileCards = cardGrid('files');
      ctx.files.forEach(function (file) {
        fileCards.appendChild(el('button', {
          class: 'card card--file' + (file.id === ctx.activeFileId ? ' is-active' : '')
            + (isFocused(ctx, 'file', file.id) ? ' is-focused' : '')
            + (bulk.indexOf(file.id) !== -1 ? ' is-selected' : ''),
          type: 'button',
          dataset: { id: file.id, ctx: 'file', ctxLabel: file.filename },
        }, [
          el('span', { class: 'card__glyph', text: util.fileGlyph(file.filename, file.mime_type) }),
          el('span', { class: 'card__title', text: file.filename }),
          el('span', { class: 'card__meta card__meta--split' }, [
            el('span', { class: 'card__size', text: util.formatBytes(file.size) }),
            el('span', { class: 'card__sep', 'aria-hidden': 'true', text: '\u00b7' }),
            el('span', { class: 'card__when', text: util.formatWhen(file.created_at) }),
          ]),
        ]));
      });
      frag.appendChild(fileCards);
    }

    if (!ctx.notes.length && !ctx.files.length && !(ctx.subfolders || []).length) {
      frag.appendChild(el('div', { class: 'empty-state' }, [
        el('h3', { text: ctx.kind === 'all' ? 'This workspace is empty' : 'This folder is empty' }),
        el('p', {
          text: ctx.kind === 'all'
            ? 'Write the first note, or drop a file anywhere on the window to attach it.'
            : 'Add a note, drop a file here, or create a subfolder.',
        }),
        el('div', { class: 'empty-state__actions' }, [
          el('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'new-note' } }, ['New note']),
          el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'upload-file' } }, ['Upload file']),
        ]),
      ]));
    }

    var bulkCount = (ctx.bulkSelected || []).length;
    if (bulkCount > 1) {
      frag.appendChild(el('div', { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Bulk actions' }, [
        el('div', { class: 'bulk-bar__lead' }, [
          el('span', { class: 'bulk-bar__count', text: String(bulkCount) }),
          el('span', { class: 'bulk-bar__label', text: 'selected' }),
          el('button', {
            class: 'bulk-bar__clear',
            type: 'button',
            dataset: { action: 'bulk-clear' },
            'aria-label': 'Clear selection',
            title: 'Clear selection',
          }, [App.ui.icon('close', 13)]),
        ]),
        el('span', { class: 'bulk-bar__rule', 'aria-hidden': 'true' }),
        el('div', { class: 'bulk-bar__actions' }, [
          el('button', { class: 'btn btn--sm btn--primary', type: 'button', dataset: { action: 'bulk-move' } }, ['Move…']),
          el('button', { class: 'btn btn--sm btn--danger-ghost', type: 'button', dataset: { action: 'bulk-delete' } }, ['Delete…']),
        ]),
      ]));
    }

    host.textContent = '';
    host.appendChild(frag);
  }

  function applyPaneView(host, view) {
    if (!host) return;
    var list = view === 'list';
    var grids = host.querySelectorAll('.card-grid');
    for (var i = 0; i < grids.length; i++) grids[i].classList.toggle('card-grid--list', list);
  }

  function lockNotice(opts) {
    var o = opts || {};
    return el('div', { class: 'lock-notice' + (o.damaged ? ' lock-notice--damaged' : '') }, [
      el('span', { class: 'lock-notice__mark' }, [App.ui.icon(o.damaged ? 'warning' : 'database', 22)]),
      el('h2', { text: o.title }),
      el('p', { text: o.body }),
      o.action === false ? null : el('button', {
        class: 'btn btn--primary',
        type: 'button',
        dataset: { action: o.action || 'vault-unlock' },
        text: o.label || 'Unlock\u2026',
      }),
    ]);
  }

  var BROWSER_COPY_CLAUSE = 'The browser keeps its own copies of this database as it rewrites it, and reclaims them on its own schedule, so an earlier unencrypted copy may remain on this device until it does.';

  function breadcrumbs(chain, item) {
    var frag = document.createDocumentFragment();
    var steps = chain || [];
    function separator() {
      return el('span', { class: 'crumb__sep', text: ' / ' });
    }
    steps.forEach(function (step, index) {
      if (index) frag.appendChild(separator());
      frag.appendChild(el('button', {
        type: 'button',
        class: 'crumb',
        dataset: { action: 'goto-folder', id: step.id, ctx: 'folder', ctxLabel: step.name },
        text: step.name,
        title: 'Show ' + step.name + ' in the tree',
      }));
    });
    if (item) {
      if (steps.length) frag.appendChild(separator());
      frag.appendChild(el('span', { class: 'crumb crumb--current', text: item }));
    }
    return frag;
  }

  function renderEditor(host, ctx) {
    if (ctx.note.locked) {
      host.textContent = '';
      host.appendChild(el('div', { class: 'editor' }, [
        el('div', { class: 'pane-head' }, [
          el('span', { class: 'pane-head__glyph', text: '\u25a4' }),
          el('div', {}, [
            el('h2', { class: 'pane-head__title', text: ctx.note.title || 'Untitled note' }),
            el('p', { class: 'pane-head__sub', text: 'Encrypted \u00b7 title visible, body locked' }),
          ]),
        ]),
        lockNotice({
          title: 'This notebook is locked',
          body: 'Note bodies and stored files are encrypted. Enter your password to read them. '
            + 'Titles, file names, dates and sizes are not encrypted, which is why the notebook '
            + 'can still be browsed while it is locked. ' + BROWSER_COPY_CLAUSE,
        }),
      ]));
      return;
    }
    if (ctx.note.damaged) {
      host.textContent = '';
      host.appendChild(el('div', { class: 'editor' }, [
        lockNotice({
          damaged: true,
          title: 'This note could not be read',
          body: 'Its stored text is encrypted, but it could not be decrypted with this key. It may '
            + 'be damaged. Nothing has been changed and the encrypted text is still in your database.',
          action: false,
        }),
      ]));
      return;
    }

    var titleInput = el('input', {
      id: 'note-title',
      class: 'editor__title',
      type: 'text',
      value: ctx.note.title || '',
      placeholder: 'Note title',
      'aria-label': 'Note title',
      spellcheck: 'false',
    });
    var fmtBar = el('div', { class: 'fmt-bar', role: 'toolbar', 'aria-label': 'Text formatting' }, [
      el('button', { class: 'fmt-btn fmt-btn--b', type: 'button', dataset: { action: 'fmt-bold' }, title: 'Bold (Ctrl+B)', 'aria-label': 'Bold' }, ['B']),
      el('button', { class: 'fmt-btn fmt-btn--i', type: 'button', dataset: { action: 'fmt-italic' }, title: 'Italic (Ctrl+I)', 'aria-label': 'Italic' }, ['I']),
      el('button', { class: 'fmt-btn fmt-btn--h', type: 'button', dataset: { action: 'fmt-highlight' }, title: 'Highlight yellow', 'aria-label': 'Highlight yellow' }, ['H']),
      el('button', { class: 'fmt-btn', type: 'button', dataset: { action: 'fmt-bullets' }, title: 'Bullet list', 'aria-label': 'Bullet list' }, ['\u2630']),
      el('button', { class: 'fmt-btn', type: 'button', dataset: { action: 'fmt-checkbox' }, title: 'Insert checkbox', 'aria-label': 'Insert checkbox' }, ['\u2611']),
      el('button', { class: 'fmt-btn fmt-btn--clear', type: 'button', dataset: { action: 'fmt-clear' }, title: 'Clear formatting', 'aria-label': 'Clear formatting' }, ['A']),
      el('button', { class: 'fmt-btn', type: 'button', dataset: { action: 'save-as-template' }, title: 'Save as template', 'aria-label': 'Save as template' }, ['T']),
    ]);

    var body = el('div', {
      id: 'note-body',
      class: 'editor__body',
      contenteditable: 'true',
      role: 'textbox',
      'aria-label': 'Note content',
      'aria-multiline': 'true',
      spellcheck: 'true',
      dataset: { placeholder: 'Start writing\u2026' },
    });
    var rawBody = ctx.note.content || '';
    body.innerHTML = util.isRichHtml(rawBody)
      ? util.sanitizeRichHtml(rawBody)
      : (rawBody ? util.escapeHtml(rawBody).replace(/\n/g, '<br>') : '');
    util.linkifyWikiText(body);
    hydrateNoteImages(body);
    if (ctx.links && ctx.links.outgoing) {
      var resolved = {};
      ctx.links.outgoing.forEach(function (link) {
        if (link.noteId) resolved[link.norm] = true;
      });
      Array.prototype.forEach.call(body.querySelectorAll('.wikilink'), function (pill) {
        util.ensureWikiPillX(pill);
        var title = pill.getAttribute('data-title')
          || String(pill.textContent || '').replace(/\u00d7$/, '');
        var norm = util.normTitle(title);
        if (!resolved[norm]) pill.classList.add('is-missing');
        pill.setAttribute('data-ctx', 'wikilink');
        pill.setAttribute('data-ctx-label', title);
        pill.setAttribute('data-resolved', resolved[norm] ? 'true' : 'false');
      });
    }
    try {
      Object.defineProperty(body, 'value', {
        configurable: true,
        get: function () { return body.innerText; },
        set: function (v) { body.textContent = String(v === null || v === undefined ? '' : v); },
      });
    } catch (e) {  }

    var meta = el('div', { class: 'editor__meta' }, [
      el('span', { id: 'note-status', class: 'editor__status', text: 'Saved' }),
      el('span', {}, ctx.chain && ctx.chain.length
        ? ['in ', breadcrumbs(ctx.chain, null)]
        : ['at workspace root']),
      el('span', { class: 'editor__meta-when', text: 'created ' + util.formatWhen(ctx.note.created_at) }),
    ]);

    var toolbar = el('div', { class: 'editor__toolbar' }, [
      meta,
      el('div', { class: 'editor__buttons' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'rename-note' } }, ['Rename']),
        el('button', { class: 'btn btn--danger-ghost', type: 'button', dataset: { action: 'delete-note' } }, ['Delete']),
      ]),
    ]);

    var dejavuChip = ctx.dejavu && ctx.dejavu.matches && ctx.dejavu.matches.length
      ? renderDejavuChip(ctx.dejavu)
      : null;

    host.textContent = '';
    host.appendChild(el('div', { class: 'editor' }, [
      titleInput, dejavuChip, fmtBar, body, toolbar, renderNoteLinks(ctx.links),
    ]));
  }

  function renderNoteLinks(links) {
    if (!links) return null;
    var outgoing = links.outgoing || [];
    var backlinks = links.backlinks || [];
    if (!outgoing.length && !backlinks.length) return null;
    var wrap = el('div', { class: 'links' });
    if (outgoing.length) {
      wrap.appendChild(el('h3', { class: 'links__head' }, [
        el('span', { text: 'Links' }),
        el('span', { class: 'pane-section__count', text: String(outgoing.length) }),
      ]));
      var out = el('div', { class: 'links__row' });
      outgoing.forEach(function (link) {
        var chip = link.noteId
          ? el('button', {
              class: 'link-chip', type: 'button',
              dataset: { action: 'open-note', id: link.noteId, ctx: 'note', ctxLabel: link.raw },
              title: 'Open \u201c' + link.raw + '\u201d',
              text: link.raw,
            })
          : el('button', {
              class: 'link-chip link-chip--missing', type: 'button',
              dataset: { action: 'create-linked-note', id: encodeURIComponent(link.raw) },
              title: 'Create note \u201c' + link.raw + '\u201d',
            }, ['+\u2009', link.raw]);
        out.appendChild(el('span', { class: 'link-chip-wrap' }, [
          chip,
          el('button', {
            class: 'link-x', type: 'button',
            dataset: { action: 'remove-outgoing-link', id: encodeURIComponent(link.raw) },
            'aria-label': 'Remove link to ' + link.raw,
            title: 'Remove link to \u201c' + link.raw + '\u201d (keeps the note)',
            text: '\u00d7',
          }),
        ]));
      });
      wrap.appendChild(out);
    }
    if (backlinks.length) {
      wrap.appendChild(el('h3', { class: 'links__head' }, [
        el('span', { text: 'Linked from' }),
        el('span', { class: 'pane-section__count', text: String(backlinks.length) }),
      ]));
      var back = el('div', { class: 'links__row' });
      backlinks.forEach(function (hit) {
        back.appendChild(el('button', {
          class: 'link-chip', type: 'button',
          dataset: { action: 'open-note', id: hit.id, ctx: 'note', ctxLabel: hit.title },
          title: 'Open \u201c' + hit.title + '\u201d',
          text: hit.title,
        }));
      });
      wrap.appendChild(back);
    }
    return wrap;
  }

  function renderDejavuChip(dejavu) {
    var matches = (dejavu && dejavu.matches) || [];
    if (!matches.length) return null;
    var wrap = el('div', { class: 'dejavu', role: 'status' }, [
      el('span', { class: 'dejavu__label', text: matches.length === 1 ? 'Possible duplicate: ' : 'Possible duplicates: ' }),
    ]);
    matches.forEach(function (match) {
      wrap.appendChild(el('button', {
        class: 'link-chip', type: 'button',
        dataset: { action: 'dejavu-open', id: match.id, ctx: 'note', ctxLabel: match.title },
        title: 'Open \u201c' + match.title + '\u201d',
        text: match.title,
      }));
      wrap.appendChild(el('button', {
        class: 'btn btn--sm btn--ghost', type: 'button',
        dataset: { action: 'dejavu-dismiss', id: match.id },
        title: 'Not a duplicate of \u201c' + match.title + '\u201d \u2014 never suggest this again',
        text: 'Not a duplicate',
      }));
    });
    return wrap;
  }

  function renderLinkSuggest(items, activeIdx) {
    var list = el('div', {
      class: 'link-suggest', role: 'listbox', 'aria-label': 'Link to note',
    });
    if (!items.length) {
      list.appendChild(el('div', { class: 'link-suggest__empty', text: 'No matching note \u2014 keep typing' }));
    }
    items.forEach(function (item, i) {
      list.appendChild(el('button', {
        class: 'link-suggest__item' + (i === activeIdx ? ' is-active' : ''),
        type: 'button',
        role: 'option',
        'aria-selected': i === activeIdx ? 'true' : 'false',
        dataset: { action: 'link-suggest-pick', id: String(i) },
        title: item.title,
      }, [el('span', { class: 'link-suggest__title', text: item.title })]));
    });
    return list;
  }

  function previewMedia(mime, filename) {
    var type = String(mime || '').toLowerCase();
    if (type.indexOf('video/') === 0) {
      return el('video', { class: 'preview__video', controls: 'controls', playsinline: 'playsinline', preload: 'metadata' });
    }
    if (type.indexOf('audio/') === 0) {
      return el('audio', { class: 'preview__audio', controls: 'controls', preload: 'metadata' });
    }
    if (type.indexOf('image/') === 0) {
      return el('img', { class: 'preview__image', alt: filename, draggable: 'false' });
    }
    return null;
  }

  function renderFilePreview(host, ctx) {
    var file = ctx.file;
    var body = el('div', { class: 'preview__body' });

    var media = !ctx.locked && ctx.previewLoader ? previewMedia(file.mime_type, file.filename) : null;

    if (ctx.locked) {
      body.appendChild(lockNotice({
        title: 'This file is encrypted',
        body: 'Its contents are sealed with your notebook password, so there is nothing to show '
          + 'yet. The name, type and size above are not encrypted.',
      }));
    } else if (media) {
      var pending = el('div', { class: 'preview__loading', text: 'Loading preview…' });
      body.appendChild(pending);
      body.appendChild(media);
      Promise.resolve(ctx.previewLoader()).then(function (resolved) {
        if (!media.isConnected) return;
        if (!resolved || !resolved.blob) throw new Error('no blob');
        pending.remove();
        media.src = makeObjectUrl(resolved.blob);
      }, function () {
        if (!media.isConnected) return;
        media.remove();
        pending.textContent = 'This preview could not be loaded. Download it instead.';
      });
    } else {
      body.appendChild(el('div', { class: 'preview__placeholder' }, [
        el('span', { class: 'preview__glyph', text: util.fileGlyph(file.filename, file.mime_type) }),
        el('p', { text: 'No inline preview for this type. Download it, or open it in a new tab.' }),
      ]));
    }

    var actions = el('div', { class: 'preview__actions' }, ctx.locked
      ? [
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'rename-file', id: file.id } }, ['Rename']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'move-file', id: file.id } }, ['Move']),
        el('button', { class: 'btn btn--danger-ghost', type: 'button', dataset: { action: 'delete-file', id: file.id } }, ['Delete']),
      ]
      : [
        el('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'download-file', id: file.id } }, ['Download']),
        el('button', { class: 'btn', type: 'button', dataset: { action: 'open-file-tab', id: file.id } }, ['Open in new tab']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'rename-file', id: file.id } }, ['Rename']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'move-file', id: file.id } }, ['Move']),
        el('button', { class: 'btn btn--danger-ghost', type: 'button', dataset: { action: 'delete-file', id: file.id } }, ['Delete']),
      ]);

    host.textContent = '';
    host.appendChild(el('div', { class: 'preview' }, [
      el('div', { class: 'pane-head' }, [
        el('span', { class: 'pane-head__glyph', text: util.fileGlyph(file.filename, file.mime_type) }),
        el('div', {}, [
          el('h2', { class: 'pane-head__title', text: file.filename }),
          el('p', { class: 'pane-head__path' }, [breadcrumbs(ctx.chain, file.filename)]),
          el('p', { class: 'pane-head__sub', text: util.formatBytes(file.size) + ' \u00b7 ' + (file.mime_type || 'unknown type') + ' \u00b7 added ' + util.formatWhen(file.created_at) }),
        ]),
      ]),
      body,
      actions,
    ]));
  }

  function renderEmptyState(host, opts) {
    var o = opts || {};
    host.textContent = '';
    host.appendChild(el('div', { class: 'empty-state empty-state--big' }, [
      o.mark === false ? null : el('span', { class: 'empty-state__mark', 'aria-hidden': 'true', text: o.mark || '\u25a4' }),
      el('h2', { text: o.title || 'Nothing selected' }),
      el('p', { text: o.body || 'Pick a note on the left, or create a new one.' }),
      o.actions === false ? null : el('div', { class: 'empty-state__actions' }, [
        el('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'new-note' } }, ['New note']),
        el('button', { class: 'btn btn--ghost', type: 'button', dataset: { action: 'upload-file' } }, ['Upload file']),
      ]),
    ]));
  }

  function renderSearchResults(host, ctx) {
    var frag = document.createDocumentFragment();
    var total = ctx.results.notes.length + ctx.results.files.length;
    function homeOf(row) {
      if (!row.workspace_id || row.workspace_id === ctx.currentWorkspaceId) return null;
      return row.workspace_name || 'Another workspace';
    }

    function labelHome(row, label) {
      if (!label) return row;
      var when = row.querySelector('.tree__when');
      if (when && when.parentNode) when.parentNode.removeChild(when);
      row.appendChild(el('span', { class: 'tree__ws', text: label }));
      row.title = (row.title ? row.title + ' \u00b7 ' : '') + label;
      return row;
    }

    frag.appendChild(el('div', { class: 'search-head' }, [
      total
        ? el('span', {}, [
            el('strong', { text: String(total) }),
            document.createTextNode((total === 1 ? ' result for ' : ' results for ') + '\u201c' + ctx.term + '\u201d'),
          ])
        : el('span', { text: 'No results for \u201c' + ctx.term + '\u201d' }),
    ]));

    if (!total) {
      frag.appendChild(el('p', {
        class: 'tree__hint',
        text: ctx.results.locked
          ? 'Nothing matches a title or file name. Note text is not searched while the notebook is locked.'
          : 'Nothing in any workspace matches. Search covers note titles, note text and file names.',
      }));
    } else if (ctx.results.locked) {
      frag.appendChild(el('p', {
        class: 'tree__hint',
        text: 'Titles and file names only \u2014 note text is encrypted while the notebook is locked.',
      }));
    } else if (ctx.results.contentTruncated) {
      frag.appendChild(el('p', {
        class: 'tree__hint',
        text: 'Note text was searched in the ' + ctx.results.contentScanned + ' most recently edited '
          + 'notes; older notes were matched on their titles only.',
      }));
    }

    ctx.results.notes.forEach(function (note) {
      frag.appendChild(labelHome(noteRow(host, note, ctx.activeNoteId, 0), homeOf(note)));
    });
    ctx.results.files.forEach(function (file) {
      frag.appendChild(labelHome(fileRow(host, file, ctx.activeFileId, 0), homeOf(file)));
    });

    host.textContent = '';
    host.appendChild(frag);
  }

  function renderStorageInfo(host, info) {
    host.textContent = '';
    var rows = [
      ['Storage backend', info.backend === 'indexeddb' ? 'IndexedDB' : info.backend === 'localstorage' ? 'localStorage (fallback)' : info.backend],
      ['Persistent storage', info.persistent ? 'Granted' : 'Not granted',
        info.persistent ? '' : 'The browser may evict this data under storage pressure.'],
      ['Workspaces', String(info.counts.workspaces)],
      ['Notes', String(info.counts.notes)],
      ['Files', String(info.counts.files)],
    ];
    if (info.estimate) {
      rows.push(['Browser storage used', util.formatBytes(info.estimate.usage) + ' of about ' + util.formatBytes(info.estimate.quota)]);
    }
    rows.push(['Database size', util.formatBytes(info.bytes)]);
    appendInfoRows(host, rows);
  }

  function appendInfoRows(host, rows) {
    rows.forEach(function (row) {
      host.appendChild(el('div', { class: 'info-row' }, [
        el('span', { class: 'info-row__key', text: row[0] }),
        el('span', { class: 'info-row__col' }, [
          el('span', { class: 'info-row__val', text: row[1] }),
          row[2] ? el('span', { class: 'info-row__hint', text: row[2] }) : null,
        ]),
      ]));
    });
  }

  function renderVaultSection(host, actionsHost, info) {
    if (!host || !actionsHost) return;
    var rows = [];

    if (!info.supported) {
      rows.push(['Encryption', 'Unavailable in this browser',
        'This browser does not expose WebCrypto (crypto.subtle), so nothing can be encrypted or decrypted here. Your notes are untouched.']);
    } else if (info.state === 'off') {
      rows.push(['Encryption', 'Off', 'Note bodies and stored files are kept as plaintext in the database.']);
    } else if (info.state === 'locked') {
      rows.push(['Encryption', 'Locked',
        'Note bodies and stored files are encrypted and stay unreadable until you unlock. Titles, file names, dates and sizes are still visible. ' + BROWSER_COPY_CLAUSE]);
    } else {
      rows.push(['Encryption', 'Unlocked for this session',
        'Kept for this tab: a reload stays unlocked, and closing the tab locks the notebook again.']);
    }

    if (info.iterations) {
      rows.push(['Key derivation',
        'PBKDF2-SHA-256, ' + Number(info.iterations).toLocaleString() + ' iterations']);
    }
    if (info.created_at) rows.push(['Encrypted since', util.formatWhen(info.created_at)]);

    host.textContent = '';
    appendInfoRows(host, rows);

    actionsHost.textContent = '';
    if (!info.supported) return;
    if (info.state === 'off') {
      actionsHost.appendChild(el('button', {
        class: 'btn btn--primary', type: 'button', dataset: { action: 'vault-enable' },
      }, ['Turn on encryption']));
    } else if (info.state === 'locked') {
      actionsHost.appendChild(el('button', {
        class: 'btn btn--primary', type: 'button', dataset: { action: 'vault-unlock' },
      }, ['Unlock\u2026']));
    } else {
      actionsHost.appendChild(el('button', {
        class: 'btn', type: 'button', dataset: { action: 'vault-lock' },
      }, ['Lock now']));
      actionsHost.appendChild(el('button', {
        class: 'btn btn--danger-ghost', type: 'button', dataset: { action: 'vault-disable' },
      }, ['Turn off encryption']));
    }
  }

  function setDragActive(active) {
    document.body.classList.toggle('is-dragging', !!active);
  }

  function setUploadStatus(text) {
    var node = document.getElementById('upload-status');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('is-hidden', !text);
  }

  var TRASH_GROUPS = [
    { kind: 'folder', label: 'Folders', icon: 'folder' },
    { kind: 'note', label: 'Notes', icon: 'note' },
    { kind: 'file', label: 'Files', icon: 'file' },
  ];

  function trashId(kind, id) {
    return kind + ':' + id;
  }

  function trashLabel(item, kind) {
    if (kind === 'file') return item.filename || 'Untitled file';
    if (kind === 'folder') return item.name || 'Untitled folder';
    return item.title && item.title.trim() ? item.title : 'Untitled note';
  }

  function renderTrashPanel(host, ctx) {
    var trash = ctx.trash || { folders: [], notes: [], files: [] };
    var selected = ctx.selected || [];
    var view = ctx.view || 'all';
    var term = String(ctx.term || '').trim().toLowerCase();

    var items = [];
    TRASH_GROUPS.forEach(function (group) {
      (trash[group.kind === 'note' ? 'notes' : group.kind === 'file' ? 'files' : 'folders'] || [])
        .forEach(function (item) {
          items.push({
            id: trashId(group.kind, item.id),
            recordId: item.id,
            kind: group.kind,
            item: item,
            label: trashLabel(item, group.kind),
            selected: selected.indexOf(trashId(group.kind, item.id)) !== -1,
          });
        });
    });

    var visible = items.filter(function (entry) {
      if (view !== 'all' && entry.kind !== view) return false;
      if (term && entry.label.toLowerCase().indexOf(term) === -1) return false;
      return true;
    });

    var counts = { all: items.length, folder: 0, note: 0, file: 0 };
    items.forEach(function (entry) { counts[entry.kind] += 1; });

    var selectAll = App.ui.checkbox({
      label: 'Select all',
      checked: false,
      disabled: true,
      onChange: function (checked) {
        ctx.onSelectAll(visible.map(function (e) { return e.id; }), checked);
      },
    });

    var filters = App.ui.radioGroup({
      name: 'trash-view',
      value: view,
      options: [
        { value: 'all', label: 'All', badge: counts.all },
        { value: 'folder', label: 'Folders', badge: counts.folder },
        { value: 'note', label: 'Notes', badge: counts.note },
        { value: 'file', label: 'Files', badge: counts.file },
      ],
      onChange: function (value) { ctx.onView(value); },
    });

    var searchInput = el('input', {
      id: 'trash-search',
      type: 'search',
      placeholder: 'Filter by name',
      'aria-label': 'Filter trash by name',
      autocomplete: 'off',
    });
    searchInput.value = ctx.term || '';
    searchInput.addEventListener('input', function () { ctx.onSearch(searchInput.value); });

    var form = el('div', { class: 'panel' });

    var sub = items.length
      ? items.length + (items.length === 1 ? ' item' : ' items') + ' \u00b7 kept until you remove them'
      : 'Nothing has been deleted';
    var closeBtn = el('button', {
      class: 'btn btn--sm panel__close', type: 'button',
      title: 'Close (Esc)',
      'aria-label': 'Close the trash and go back to the workspace',
      onclick: function () { ctx.onClose(); },
    }, [App.ui.icon('close', 13), 'Close']);

    form.appendChild(el('header', { class: 'panel__head' }, [
      el('span', { class: 'panel__tile', 'aria-hidden': 'true' }, [App.ui.icon('trash')]),
      el('div', { class: 'panel__heading' }, [
        el('h2', { id: 'trash-title', class: 'panel__title', text: 'Trash' }),
        el('p', { class: 'panel__sub', text: sub }),
      ]),
      closeBtn,
    ]));

    form.appendChild(el('div', { class: 'panel__tools' }, [
      selectAll,
      el('span', { class: 'panel__sep' }),
      filters,
      el('span', { class: 'panel__spacer' }),
      el('div', { class: 'search-field' }, [
        App.ui.icon('search', 14),
        searchInput,
      ]),
    ]));

    var list = el('div', { class: 'panel__list' });
    form.appendChild(list);

    var foot = el('div', { class: 'panel__foot' });
    form.appendChild(foot);

    function paintFilterCounts() {
      filters.inputs.forEach(function (input) {
        var item = input.parentNode;
        var badge = item ? item.querySelector('.segmented__badge') : null;
        if (badge) badge.textContent = String(counts[input.value] || 0);
      });
    }

    function paint() {
      list.textContent = '';
      if (!visible.length) {
        list.appendChild(items.length
          ? trashEmpty('No matches', 'No deleted item in this view matches \u201c' + ctx.term + '\u201d.')
          : trashEmpty('Trash is empty', 'Deleted folders, notes and files wait here. Right-click a row in the list to send something to the trash, or select items above to restore or remove them for good.'));
      } else {
        TRASH_GROUPS.forEach(function (group) {
          var rows = visible.filter(function (e) { return e.kind === group.kind; });
          if (!rows.length) return;
          list.appendChild(el('h3', { class: 'panel__group' }, [
            el('span', { text: group.label }),
            el('span', { class: 'panel__group-count', text: String(rows.length) }),
          ]));
          rows.forEach(function (entry) { list.appendChild(trashRow(entry, ctx)); });
        });
      }

      foot.textContent = '';
      if (selected.length) {
        var insideSelected = visible.reduce(function (sum, entry) {
          if (!entry.selected) return sum;
          if (entry.kind !== 'folder') return sum;
          var n = ctx.folderCounts ? (ctx.folderCounts[entry.recordId] || 0) : 0;
          return sum + n;
        }, 0);

        foot.appendChild(el('p', { class: 'panel__count panel__count--has' }, [
          el('strong', { text: String(selected.length) }),
          document.createTextNode(selected.length === 1 ? ' item selected' : ' items selected'),
          insideSelected
            ? document.createTextNode(' \u00b7 ' + insideSelected + ' more inside the selected folder'
                + (insideSelected === 1 ? '' : 's') + ', restored or removed with them')
            : document.createTextNode(' \u00b7 restoring a note or file whose folder is also deleted brings the folder back with it.'),
        ]));
        foot.appendChild(el('button', {
          class: 'btn btn--sm', type: 'button', dataset: { action: 'clear-trash-selection' },
        }, [App.ui.icon('close', 12), 'Clear']));
        foot.appendChild(el('button', {
          class: 'btn btn--primary', type: 'button', dataset: { action: 'restore-selected-trash' },
        }, [App.ui.icon('restore', 13), 'Restore']));
        foot.appendChild(el('button', {
          class: 'btn btn--danger', type: 'button', dataset: { action: 'delete-selected-trash' },
        }, [App.ui.icon('trash', 13), 'Delete permanently\u2026']));
      } else {
        var cascaded = 0;
        visible.forEach(function (entry) { if (entry.kind === 'folder') cascaded += ctx.folderCounts ? (ctx.folderCounts[entry.recordId] || 0) : 0; });
        var nounCount = items.length;
        foot.appendChild(el('p', { class: 'panel__count' }, [
          document.createTextNode(!nounCount
            ? 'Nothing to act on.'
            : 'Select items to restore or remove them. Right-click any row for its actions.'
              + (cascaded ? ' Deleting a folder also deletes the ' + cascaded + ' item'
                + (cascaded === 1 ? '' : 's') + ' inside it.' : '')),
        ]));
        foot.appendChild(el('button', {
          class: 'btn btn--primary', type: 'button', dataset: { action: 'close-trash' },
        }, ['Back to workspace']));
      }

      selectAll.input.checked = visible.length > 0 && visible.every(function (e) { return e.selected; });
      selectAll.input.indeterminate = visible.some(function (e) { return e.selected; })
        && !visible.every(function (e) { return e.selected; });
      selectAll.input.disabled = !visible.length;
    }

    paint();

    host.__refresh = function (next) {
      trash = next.trash || { folders: [], notes: [], files: [] };
      selected = next.selected || [];
      ctx.term = next.term;
      ctx.view = next.view;
      ctx.paths = next.paths;
      ctx.cascadeIds = next.cascadeIds;
      ctx.folderCounts = next.folderCounts;
      view = next.view;
      term = String(next.term || '').trim().toLowerCase();
      items = [];
      TRASH_GROUPS.forEach(function (group) {
        (trash[group.kind === 'note' ? 'notes' : group.kind === 'file' ? 'files' : 'folders'] || [])
          .forEach(function (item) {
            items.push({
              id: trashId(group.kind, item.id),
              recordId: item.id,
              kind: group.kind,
              item: item,
              label: trashLabel(item, group.kind),
              selected: selected.indexOf(trashId(group.kind, item.id)) !== -1,
            });
          });
      });
      visible = items.filter(function (entry) {
        if (view !== 'all' && entry.kind !== view) return false;
        if (term && entry.label.toLowerCase().indexOf(term) === -1) return false;
        return true;
      });
      counts = { all: items.length, folder: 0, note: 0, file: 0 };
      items.forEach(function (entry) { counts[entry.kind] += 1; });
      paintFilterCounts();
      var headSub = form.querySelector('.panel__sub');
      if (headSub) {
        headSub.textContent = items.length
          ? items.length + (items.length === 1 ? ' item' : ' items') + ' \u00b7 kept until you remove them'
          : 'Nothing has been deleted';
      }
      paint();
    };

    host.textContent = '';
    host.appendChild(form);
  }

  function trashRow(entry, ctx) {
    var item = entry.item;
    var when = util.formatWhen(item.deleted_at);
    var origin = item.folder_id && ctx.paths ? ctx.paths[item.folder_id] : '';

    var meta = [el('span', { text: when ? 'deleted ' + when : 'in the trash' })];
    if (entry.kind === 'file' && item.size) meta.push(el('span', { text: util.formatBytes(item.size) }));
    if (entry.kind === 'folder') {
      var inside = ctx.folderCounts ? ctx.folderCounts[item.id] : null;
      meta.push(el('span', { text: inside ? inside + ' item' + (inside === 1 ? '' : 's') + ' inside' : 'empty folder' }));
    } else if (origin && ctx.cascadeIds && ctx.cascadeIds.indexOf(item.id) !== -1) {
      meta.push(el('span', { text: 'folder \u201c' + origin.split(' / ').pop() + '\u201d also deleted' }));
    } else if (origin) {
      meta.push(el('span', { text: 'from ' + origin }));
    }

    var glyph = entry.kind === 'file'
      ? el('span', { class: 'trash-row__glyph trash-row__glyph--file', text: util.fileGlyph(item.filename, item.mime_type) })
      : el('span', { class: 'trash-row__glyph' }, [
          App.ui.icon(entry.kind === 'folder' ? 'folder' : 'note', 14),
        ]);

    return el('div', {
      class: 'trash-row' + (entry.selected ? ' is-selected' : ''),
      dataset: { trashId: entry.id, kind: entry.kind, label: entry.label },
    }, [
      App.ui.checkbox({
        hideLabel: true,
        checked: entry.selected,
        label: 'Select ' + entry.label,
        onChange: function (checked) { ctx.onToggle(entry.id, checked); },
      }),
      glyph,
      el('span', { class: 'trash-row__text' }, [
        el('span', { class: 'trash-row__name', text: entry.label, title: entry.label }),
        el('span', { class: 'trash-row__meta' }, meta),
      ]),
      el('span', { class: 'trash-row__actions' }, [
        el('button', {
          class: 'btn btn--sm btn--ghost', type: 'button',
          dataset: { action: 'restore-trash-item', id: entry.id },
          title: 'Restore ' + entry.label,
        }, [App.ui.icon('restore', 13), 'Restore']),
        el('button', {
          class: 'btn btn--sm btn--icon-danger', type: 'button',
          dataset: { action: 'delete-trash-item', id: entry.id },
          'aria-label': 'Delete ' + entry.label + ' permanently',
          title: 'Delete permanently',
        }, [App.ui.icon('trash', 13)]),
      ]),
    ]);
  }

  function trashEmpty(title, body) {
    return el('div', { class: 'trash-empty' }, [
      el('span', { class: 'trash-empty__mark', 'aria-hidden': 'true' }, [App.ui.icon('emptyTrash', 20)]),
      el('h3', { text: title }),
      el('p', { text: body }),
    ]);
  }

  function renderSidebarFooter(host, ctx) {
    var info = ctx.info || { counts: {}, bytes: 0, estimate: null };
    var counts = info.counts || {};
    var files = counts.files || 0;
    var notes = counts.notes || 0;

    if (ctx.actions) {
      ctx.actions.textContent = '';
      ctx.actions.appendChild(el('button', {
        class: 'btn btn--primary btn--rail', type: 'button', dataset: { action: 'new-note' },
        title: 'New note (Ctrl+N)',
      }, [App.ui.icon('note', 13.5), 'New note']));
      ctx.actions.appendChild(el('button', {
        class: 'btn btn--rail', type: 'button', dataset: { action: 'upload-file' },
        title: 'Attach files to this workspace',
      }, [App.ui.icon('upload', 13.5), 'Upload']));
      ctx.actions.appendChild(el('button', {
        class: 'btn btn--rail', type: 'button', dataset: { action: 'new-from-template' },
        title: 'New note from a template',
      }, [App.ui.icon('copy', 13.5), 'Template']));
    }

    var storage = ctx.storage;
    if (!storage) return;
    storage.textContent = '';

    var used = info.estimate && info.estimate.usage ? info.estimate.usage : (info.bytes || 0);
    var quota = info.estimate && info.estimate.quota ? info.estimate.quota : 0;
    var share = quota ? Math.min(1, used / quota) : 0;
    var pct = quota ? Math.max(2, Math.round(share * 100)) : 0;

    var readout = el('button', {
      class: 'rail-storage' + (share >= 0.8 ? ' rail-storage--near' : ''),
      type: 'button',
      dataset: { action: 'open-settings' },
      title: 'Storage and export. ' + notes + ' note' + (notes === 1 ? '' : 's')
        + ', ' + files + ' file' + (files === 1 ? '' : 's') + ' in ' + (counts.workspaces || 0)
        + ' workspace' + (counts.workspaces === 1 ? '' : 's') + '.',
    }, [
      el('span', { class: 'rail-storage__icon' }, [App.ui.icon('database', 13)]),
      el('span', { class: 'rail-storage__text' }, [
        el('span', { class: 'rail-storage__size', text: util.formatBytes(used) }),
        el('span', { class: 'rail-storage__label', text: notes + ' note' + (notes === 1 ? '' : 's') }),
      ]),
      quota
        ? el('span', { class: 'rail-storage__meter' }, [
            el('span', { class: 'rail-storage__fill', style: 'width:' + pct + '%' }),
          ])
        : null,
      el('span', {
        class: quota ? 'rail-storage__pct' : 'rail-storage__value',
        text: quota ? (pct < 1 ? '<1%' : pct + '%') : String(files) + ' file' + (files === 1 ? '' : 's'),
      }),
    ]);

    storage.appendChild(readout);
  }

  function menuOpen(cfg) {
    App.ui.openMenu({
      x: cfg.x,
      y: cfg.y,
      title: cfg.entry ? cfg.entry.label : cfg.title,
      items: buildMenuItems(cfg),
    });
  }

  function buildMenuItems(cfg) {
    var entry = cfg.entry;
    var folderSelected = cfg.folderSelected;

    if (!entry) {
      return [
        { label: 'New note', icon: 'note', shortcut: '\u21b5', onclick: cfg.on('new-note') },
        { label: 'New folder', icon: 'folder', onclick: cfg.on('new-folder') },
        { label: 'Upload files\u2026', icon: 'upload', shortcut: 'Ctrl+U', onclick: cfg.on('upload-file') },
        { sep: true },
        { label: 'Open the trash', icon: 'trash', onclick: cfg.on('view-trash') },
        { label: 'Settings and export', icon: 'settings', shortcut: 'Ctrl+,', onclick: cfg.on('open-settings') },
      ];
    }

    if (entry.type === 'folder') {
      var items = [
        { label: 'New note', icon: 'note', onclick: cfg.on('new-note') },
        { label: 'New subfolder', icon: 'folder', onclick: cfg.on('new-subfolder') },
        { label: 'Upload files\u2026', icon: 'upload', onclick: cfg.on('upload-file') },
        { sep: true },
        { label: 'Rename\u2026', icon: 'pencil', shortcut: 'F2', onclick: cfg.on('rename-folder') },
        { label: 'Move to another workspace\u2026', icon: 'layers', onclick: cfg.on('move-folder') },
      ];
      reorderMenuItems(cfg.reorder).forEach(function (group) {
        group.forEach(function (item) { items.push(item); });
      });
      items.push({ sep: true });
      items.push({ label: 'Delete folder and its contents\u2026', icon: 'trash', danger: true, shortcut: 'Del', onclick: cfg.on('delete-folder') });
      return items;
    }

    if (entry.type === 'file') {
      var items = [
        { label: 'Preview', icon: 'eye', onclick: cfg.on('open-file') },
        { label: 'Download', icon: 'download', onclick: cfg.on('download-file') },
        { label: 'Open in a new tab', icon: 'external', onclick: cfg.on('open-file-tab') },
        { sep: true },
        { label: 'Rename\u2026', icon: 'pencil', shortcut: 'F2', onclick: cfg.on('rename-file') },
        { label: 'Move to another folder\u2026', icon: 'layers', onclick: cfg.on('move-file') },
      ];
      reorderMenuItems(cfg.reorder).forEach(function (group) {
        group.forEach(function (item) { items.push(item); });
      });
      [
        { label: 'Delete file\u2026', icon: 'trash', danger: true, shortcut: 'Del', onclick: cfg.on('delete-file') },
      ].forEach(function (item) { items.push(item); });
      return items;
    }

    if (entry.type === 'workspace' && entry.id) {
      var workspaceItems = [
        { label: 'Rename\u2026', icon: 'pencil', onclick: cfg.on('rename-workspace') },
      ];
      reorderMenuItems(cfg.reorder).forEach(function (group) {
        group.forEach(function (item) { workspaceItems.push(item); });
      });
      workspaceItems.push({ sep: true });
      workspaceItems.push({
        label: 'Delete workspace\u2026', icon: 'trash', danger: true,
        onclick: cfg.on('delete-workspace'),
      });
      return workspaceItems;
    }

    if (entry.type === 'task') {
      var taskItems = [
        { label: 'Edit\u2026', icon: 'pencil', shortcut: 'F2', onclick: cfg.on('edit-task') },
        {
          label: entry.done ? 'Mark not done' : 'Mark done',
          icon: 'check',
          onclick: cfg.on('task-toggle-done'),
        },
      ];
      reorderMenuItems(cfg.reorder).forEach(function (group) {
        group.forEach(function (item) { taskItems.push(item); });
      });
      taskItems.push({ sep: true });
      taskItems.push({
        label: 'Delete task\u2026', icon: 'trash', danger: true, shortcut: 'Del',
        onclick: cfg.on('delete-task'),
      });
      return taskItems;
    }

    var items = [
      { label: 'Rename\u2026', icon: 'pencil', shortcut: 'F2', onclick: cfg.on('rename-note') },
      { label: 'Move to another folder\u2026', icon: 'layers', onclick: cfg.on('move-note') },
      { label: 'Copy the note text', icon: 'copy', onclick: cfg.on('copy-note') },
    ];
    reorderMenuItems(cfg.reorder).forEach(function (group) {
      group.forEach(function (item) { items.push(item); });
    });
    [
      { sep: true },
      { label: 'Add a file to this folder\u2026', icon: 'upload', onclick: cfg.on('upload-file') },
      { sep: true },
      { label: 'Delete note\u2026', icon: 'trash', danger: true, shortcut: 'Del', onclick: cfg.on('delete-note') },
    ].forEach(function (item) { items.push(item); });
    return items;
  }

  function trashContextMenu(cfg) {
    var entries = cfg.entries || [];
    var multi = entries.length > 1;
    var title = multi
      ? entries.length + ' items selected'
      : (entries[0] ? entries[0].label : 'Trash');

    return App.ui.openMenu({
      x: cfg.x,
      y: cfg.y,
      title: title,
      items: [
        {
          label: multi ? 'Restore ' + entries.length + ' items' : 'Restore',
          icon: 'restore',
          onclick: function () { cfg.onRestore(entries.map(function (e) { return e.id; })); },
        },
        { sep: true },
        {
          label: multi ? 'Delete ' + entries.length + ' items permanently\u2026' : 'Delete permanently\u2026',
          icon: 'trash',
          danger: true,
          onclick: function () { cfg.onPurge(entries.map(function (e) { return e.id; })); },
        },
      ],
    });
  }

  function setTrashButton(node, count) {
    if (!node) return;
    var n = Number(count) || 0;
    var badge = node.querySelector('.trash-fab__badge');
    if (!badge) {
      badge = el('span', { class: 'trash-fab__badge', 'aria-hidden': 'true' });
      node.appendChild(badge);
    }
    badge.textContent = n > 99 ? '99+' : String(n);
    if (n > 0) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
    node.setAttribute('aria-label', n
      ? 'Open the trash, ' + n + ' item' + (n === 1 ? '' : 's') + ' waiting'
      : 'Open the trash');
    node.title = n
      ? 'Trash \u00b7 ' + n + ' item' + (n === 1 ? '' : 's')
      : 'Trash is empty';
  }

function renderTopbarViews(host, ctx) {
  if (!host) return;
  host.textContent = '';
  var active = ctx.view === 'tasks';
  host.appendChild(el('button', {
    class: 'view-btn' + (active ? ' is-active' : ''),
    type: 'button',
    dataset: { action: 'view-tasks' },
    'aria-label': 'Tasks \u00b7 ' + ctx.open + ' open',
    title: 'The task list \u00b7 ' + ctx.open + ' open',
  }, [
    glyph('checkCircle', 'view-btn__glyph'),
    el('span', { class: 'view-btn__label', text: 'Tasks' }),
    el('span', { class: 'tree__badge', text: String(ctx.open) }),
  ]));

}

var TASK_BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
];

function taskBucket(task, bounds) {
  if (!task.due_at) return 'none';
  if (task.due_at < bounds.todayStart) return 'overdue';
  if (task.due_at < bounds.tomorrowStart) return 'today';
  if (task.due_at < bounds.dayAfterTomorrowStart) return 'tomorrow';
  if (task.due_at < bounds.weekEnd) return 'week';
  return 'later';
}

function dueLabel(task, bounds) {
  var when = new Date(task.due_at);
  if (isNaN(when.getTime())) return '';
  var day;
  if (task.due_at < bounds.todayStart) {
    day = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } else if (task.due_at < bounds.tomorrowStart) {
    day = 'Today';
  } else if (task.due_at < bounds.dayAfterTomorrowStart) {
    day = 'Tomorrow';
  } else if (task.due_at < bounds.weekEnd) {
    day = when.toLocaleDateString(undefined, { weekday: 'long' });
  } else {
    day = when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  if (task.due_has_time) {
    day += ', ' + when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return day;
}

function taskRow(task, ctx) {
  var bucket = task.done ? 'done' : taskBucket(task, ctx.bounds);
  var check = App.ui.checkbox({
    checked: !!task.done,
    hideLabel: true,
    className: 'task-row__check',
    onChange: function (checked) { ctx.onToggle(task.id, checked); },
  });
  check.input.setAttribute('aria-label', 'Mark \u201c' + task.title + '\u201d '
    + (task.done ? 'not done' : 'done'));

  var meta = el('span', { class: 'task-row__meta' });
  if (task.due_at) {
    meta.appendChild(el('span', {
      class: 'task-chip task-chip--' + bucket,
      text: dueLabel(task, ctx.bounds),
    }));
  }
  if (task.recurrence) {
    meta.appendChild(el('span', {
      class: 'task-chip',
      title: 'Repeating task',
      text: recurrenceLabel(task.recurrence),
    }));
  }
  if (task.remind_at) {
    meta.appendChild(el('span', {
      class: 'task-chip task-chip--reminder' + (task.reminded_at ? ' is-fired' : ''),
      text: reminderLabel(task),
    }));
  }
  if (task.folder_id && ctx.projectNames[task.folder_id]) {
    meta.appendChild(el('span', { class: 'task-chip', text: ctx.projectNames[task.folder_id] }));
  }
  if (task.done && task.done_at) {
    meta.appendChild(el('span', { class: 'task-chip', text: 'Done ' + util.formatWhen(task.done_at) }));
  }

  return el('div', {
    class: 'task-row' + (task.done ? ' is-done' : ''),
    dataset: { ctx: 'task', id: task.id, ctxLabel: task.title },
  }, [
    check,
    el('div', { class: 'task-row__text' }, [
      el('button', {
        class: 'task-row__title',
        type: 'button',
        dataset: { action: 'task-edit', id: task.id },
        title: 'Edit this task',
        text: task.title,
      }),
      meta.childNodes.length ? meta : null,
    ]),
    task.priority >= 2
      ? el('span', { class: 'task-row__priority', title: 'High priority', text: 'High' })
      : null,
    el('div', { class: 'task-row__actions' }, [
      el('button', {
        class: 'icon-btn icon-btn--sm task-row__action',
        type: 'button',
        dataset: { action: 'task-edit', id: task.id },
        'aria-label': 'Edit \u201c' + task.title + '\u201d',
        title: 'Edit',
      }, [App.ui.icon('pencil', 13)]),
      el('button', {
        class: 'icon-btn icon-btn--sm task-row__action task-row__action--danger',
        type: 'button',
        dataset: { action: 'task-delete', id: task.id },
        'aria-label': 'Delete \u201c' + task.title + '\u201d',
        title: 'Delete',
      }, [App.ui.icon('trash', 13)]),
    ]),
  ]);
}

function taskGroup(bucket, rows, ctx) {
  var ordered = ctx.manual
    ? rows.slice().sort(function (a, b) {
      var delta = (Number(a.position) || 0) - (Number(b.position) || 0);
      if (delta) return delta;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    })
    : rows;
  var group = el('div', { class: 'task-group', dataset: { bucket: bucket.key } });
  group.appendChild(paneSection(bucket.label, ordered.length));
  ordered.forEach(function (task) { group.appendChild(taskRow(task, ctx)); });
  return group;
}

function emptyTasks(ctx) {
  var scope = ctx.folderName ? 'in ' + ctx.folderName : 'in this workspace';
  if (ctx.view === 'done') {
    return el('div', { class: 'empty-state' }, [
      el('h3', { text: 'Nothing finished yet' }),
      el('p', { text: 'Tasks you tick off collect here, newest first, so this view is a record of the week rather than a second list to tend.' }),
    ]);
  }
  if (ctx.view === 'today') {
    return el('div', { class: 'empty-state' }, [
      el('h3', { text: 'Nothing due today' }),
      el('p', { text: 'Nothing is dated today and nothing has run over. The Upcoming view has what is next.' }),
    ]);
  }
  if (ctx.view === 'upcoming') {
    return el('div', { class: 'empty-state' }, [
      el('h3', { text: 'Nothing coming up' }),
      el('p', { text: 'No dated task is still ahead of you ' + scope + '. Add one above, then give it a date from the edit dialog.' }),
    ]);
  }
  return el('div', { class: 'empty-state' }, [
    el('h3', { text: 'No tasks yet' }),
    el('p', { text: 'Type a task above and press Enter \u2014 it is filed ' + scope + ' the moment you do.' }),
  ]);
}

function renderTasks(host, ctx) {
  var frag = document.createDocumentFragment();
  var counts = ctx.counts || { all: 0, today: 0, upcoming: 0, done: 0, overdue: 0 };

  var subtitle = ctx.open + ' open';
  subtitle += ctx.overdue ? ' \u00b7 ' + ctx.overdue + ' overdue' : ' \u00b7 none overdue';
  if (ctx.folderName) subtitle += ' \u00b7 in ' + ctx.folderName;

  frag.appendChild(el('div', { class: 'pane-head' }, [
    el('h2', { class: 'pane-head__title', text: 'Tasks' }),
    el('p', { class: 'pane-head__sub', text: subtitle }),
  ]));

  frag.appendChild(el('div', { class: 'task-add' }, [
    el('span', { class: 'task-add__glyph' }, [App.ui.icon('checkCircle', 15)]),
    el('input', {
      id: 'task-add',
      class: 'task-add__input',
      type: 'text',
      value: ctx.draft || '',
      placeholder: 'Add a task\u2026',
      'aria-label': 'Add a task',
      autocomplete: 'off',
      spellcheck: 'false',
    }),
    el('button', {
      class: 'task-add__submit',
      type: 'button',
      dataset: { action: 'add-task' },
      disabled: !String(ctx.draft || '').trim(),
      title: 'Add this task (or press Enter)',
      'aria-label': 'Add this task',
    }, ['Add']),
  ]));

  frag.appendChild(el('div', { class: 'task-filters' }, [
    App.ui.radioGroup({
      name: 'task-view',
      value: ctx.view,
      className: 'task-filters__group',
      options: [
        { value: 'all', label: 'All', badge: counts.all, title: 'Every task still open' },
        { value: 'today', label: 'Today', badge: counts.today, title: 'Due today, plus anything overdue' },
        { value: 'upcoming', label: 'Upcoming', badge: counts.upcoming, title: 'Dated tomorrow or later' },
        { value: 'done', label: 'Done', badge: counts.done, title: 'Finished, newest first' },
      ],
      onChange: function (value) { ctx.onView(value); },
    }),
  ]));

  if (ctx.view === 'done') {
    if (ctx.tasks.length) frag.appendChild(taskGroup({ key: 'done', label: 'Done' }, ctx.tasks, ctx));
  } else {
    var byBucket = {};
    ctx.tasks.forEach(function (task) {
      var key = taskBucket(task, ctx.bounds);
      (byBucket[key] = byBucket[key] || []).push(task);
    });
    TASK_BUCKETS.forEach(function (bucket) {
      var rows = byBucket[bucket.key];
      if (rows && rows.length) frag.appendChild(taskGroup(bucket, rows, ctx));
    });
  }

  if (!ctx.tasks.length) frag.appendChild(emptyTasks(ctx));

  host.textContent = '';
  host.appendChild(frag);
}

App.ui = Object.assign(App.ui || {}, {
    renderWorkspaceSelect: renderWorkspaceSelect,
    onWorkspaceChange: onWorkspaceChange,
    onWorkspacePickerOpen: onWorkspacePickerOpen,
    renderWorkspacePanel: renderWorkspacePanel,
    renderMovePanel: renderMovePanel,
    renderTree: renderTree,
    renderTabs: renderTabs,
    renderNoteLinks: renderNoteLinks,
    renderDejavuChip: renderDejavuChip,
    renderLinkSuggest: renderLinkSuggest,
    renderFolderView: renderFolderView,
    applyPaneView: applyPaneView,
    renderTasks: renderTasks,
    renderTopbarViews: renderTopbarViews,
    renderEditor: renderEditor,
    renderFilePreview: renderFilePreview,
    renderEmptyState: renderEmptyState,
    renderSearchResults: renderSearchResults,
    renderStorageInfo: renderStorageInfo,
    renderVaultSection: renderVaultSection,
    renderSidebarFooter: renderSidebarFooter,
    renderTrashPanel: renderTrashPanel,
    setTrashButton: setTrashButton,
    trashLabel: trashLabel,
    setDragActive: setDragActive,
    setUploadStatus: setUploadStatus,
    revokeObjectUrls: revokeObjectUrls,
    makeObjectUrl: makeObjectUrl,
    menuOpen: menuOpen,
    menuOpenSort: menuOpenSort,
    sortKeysFor: sortKeysFor,
    sortKeyLabel: sortKeyLabel,
    trashContextMenu: trashContextMenu,
  });
})(window.NoteApp);
