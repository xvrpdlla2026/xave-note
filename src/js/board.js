window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var BOARD_ID = 'xave';
  var MIN_Z = 0.3;
  var MAX_Z = 2.5;
  var STEP = 1.15;
  var SIZES = { note: [268, 176], todo: [256, 196], link: [264, 128], image: [288, 216], comment: [232, 144], ref: [244, 168] };

  var board = {
    open: false,
    items: [],
    view: { x: 0, y: 0, z: 1 },
    selectedId: null,
    space: false,
    pan: null,
    drag: null,
    resize: null,
    viewTimer: null,
    picker: null,
    pickerCount: null,
    pickChecked: {},
    pickExpanded: {},
    root: null,
    stage: null,
    canvas: null,
    grid: null,
    zoomLabel: null,
    hint: null,
  };

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  function defaultData(kind) {
    if (kind === 'todo') return { title: '', items: [{ text: '', done: false }] };
    if (kind === 'link') return { title: '', url: '' };
    if (kind === 'image') return { name: '', src: '' };
    return { text: '' };
  }

  function centerOfView(offset) {
    var rect = board.stage.getBoundingClientRect();
    var step = (offset || 0) % 7;
    return {
      x: Math.round((rect.width / 2 - board.view.x) / board.view.z - 130 + step * 28),
      y: Math.round((rect.height / 2 - board.view.y) / board.view.z - 90 + step * 24),
    };
  }

  function nextZ() {
    var top = 0;
    board.items.forEach(function (item) { if (item.z > top) top = item.z; });
    return top + 1;
  }

  function findItem(id) {
    for (var i = 0; i < board.items.length; i++) {
      if (String(board.items[i].id) === String(id)) return board.items[i];
    }
    return null;
  }

  function saveItem(item) {
    item.updated_at = util.nowIso();
    try { App.db.boardUpdateItem(item); } catch (e) { }
  }

  function queueItemSave(item) {
    if (item.saveTimer) clearTimeout(item.saveTimer);
    item.saveTimer = setTimeout(function () { item.saveTimer = null; saveItem(item); }, 400);
  }

  function flushItem(item) {
    if (!item.saveTimer) return;
    clearTimeout(item.saveTimer);
    item.saveTimer = null;
    saveItem(item);
  }

  function applyView() {
    var view = board.view;
    board.canvas.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.z + ')';
    board.grid.style.backgroundSize = (26 * view.z) + 'px ' + (26 * view.z) + 'px';
    board.grid.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    board.zoomLabel.textContent = Math.round(view.z * 100) + '%';
    queueViewSave();
  }

  function queueViewSave() {
    if (!board.open) return;
    if (board.viewTimer) clearTimeout(board.viewTimer);
    board.viewTimer = setTimeout(function () {
      board.viewTimer = null;
      try { App.db.boardSaveView(BOARD_ID, board.view.x, board.view.y, board.view.z); } catch (e) { }
    }, 320);
  }

  function zoomAt(factor, point) {
    var view = board.view;
    var next = clamp(view.z * factor, MIN_Z, MAX_Z);
    if (next === view.z) return;
    var rect = board.stage.getBoundingClientRect();
    var px = point ? point.x - rect.left : rect.width / 2;
    var py = point ? point.y - rect.top : rect.height / 2;
    view.x = px - (px - view.x) * (next / view.z);
    view.y = py - (py - view.y) * (next / view.z);
    view.z = next;
    applyView();
  }

  function resetView() {
    board.view = { x: 0, y: 0, z: 1 };
    applyView();
  }

  function fitView() {
    if (!board.items.length) { resetView(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    board.items.forEach(function (item) {
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.w);
      maxY = Math.max(maxY, item.y + item.h);
    });
    var rect = board.stage.getBoundingClientRect();
    var pad = 80;
    var scale = clamp(Math.min((rect.width - pad * 2) / Math.max(maxX - minX, 1), (rect.height - pad * 2) / Math.max(maxY - minY, 1)), MIN_Z, 1);
    board.view.z = scale;
    board.view.x = rect.width / 2 - (minX + (maxX - minX) / 2) * scale;
    board.view.y = rect.height / 2 - (minY + (maxY - minY) / 2) * scale;
    applyView();
  }

  function select(item) {
    board.selectedId = item ? item.id : null;
    board.items.forEach(function (other) {
      if (other.node) other.node.classList.toggle('is-selected', other === item);
    });
  }

  function placeItem(item) {
    item.node.style.left = item.x + 'px';
    item.node.style.top = item.y + 'px';
    item.node.style.width = item.w + 'px';
    item.node.style.height = item.h + 'px';
    item.node.style.zIndex = String(item.z || 1);
  }

  function field(item, key, tag, cls, placeholder) {
    var input = node(tag, cls || 'bd-field');
    input.setAttribute('data-board-field', key);
    if (placeholder) input.setAttribute('placeholder', placeholder);
    if (item.data && item.data[key]) input.value = item.data[key];
    input.addEventListener('input', function () {
      item.data[key] = input.value;
      queueItemSave(item);
    });
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    return input;
  }

  function textArea(item, key, placeholder) {
    var box = node('div', 'bd-text');
    box.setAttribute('contenteditable', 'true');
    box.setAttribute('data-board-field', key);
    if (placeholder) box.setAttribute('data-placeholder', placeholder);
    box.textContent = (item.data && item.data[key]) || '';
    box.addEventListener('input', function () {
      item.data[key] = box.textContent;
      queueItemSave(item);
    });
    box.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    return box;
  }

  function todoBody(item) {
    var wrap = node('div', 'bd-todo');
    var rows = node('div', 'bd-todo__rows');
    function paint() {
      rows.textContent = '';
      item.data.items.forEach(function (entry, index) {
        var row = node('label', 'bd-todo__row');
        var box = node('input', 'bd-check');
        box.type = 'checkbox';
        box.checked = !!entry.done;
        box.addEventListener('change', function () {
          entry.done = box.checked;
          row.classList.toggle('is-done', entry.done);
          queueItemSave(item);
        });
        var text = node('input', 'bd-todo__text');
        text.type = 'text';
        text.value = entry.text || '';
        text.setAttribute('placeholder', 'To-do');
        text.addEventListener('input', function () { entry.text = text.value; queueItemSave(item); });
        text.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          item.data.items.splice(index + 1, 0, { text: '', done: false });
          saveItem(item);
          paint();
          var boxes = rows.querySelectorAll('.bd-todo__text');
          if (boxes[index + 1]) boxes[index + 1].focus();
        });
        var drop = node('button', 'bd-todo__x', '\u00d7');
        drop.type = 'button';
        drop.addEventListener('click', function (event) {
          event.stopPropagation();
          item.data.items.splice(index, 1);
          if (!item.data.items.length) item.data.items.push({ text: '', done: false });
          saveItem(item);
          paint();
        });
        row.appendChild(box);
        row.appendChild(text);
        row.appendChild(drop);
        rows.appendChild(row);
      });
    }
    paint();
    item.data.paintTodo = null;
    var title = field(item, 'title', 'input', 'bd-title', 'To-do List Name');
    wrap.appendChild(title);
    wrap.appendChild(rows);
    var add = node('button', 'bd-todo__add', '+ Add item');
    add.type = 'button';
    add.addEventListener('click', function (event) {
      event.stopPropagation();
      item.data.items.push({ text: '', done: false });
      saveItem(item);
      paint();
    });
    wrap.appendChild(add);
    return wrap;
  }

  function linkBody(item) {
    var wrap = node('div', 'bd-link');
    wrap.appendChild(field(item, 'title', 'input', 'bd-title', 'Link title'));
    wrap.appendChild(field(item, 'url', 'input', 'bd-url', 'https://'));
    var open = node('a', 'bd-link__open', 'Open link');
    open.setAttribute('data-board-nodrag', '1');
    open.setAttribute('rel', 'noreferrer noopener');
    open.setAttribute('target', '_blank');
    function sync() {
      var url = (item.data.url || '').trim();
      open.setAttribute('href', url || '#', );
      open.style.display = url ? '' : 'none';
    }
    sync();
    item.data.syncLink = sync;
    wrap.appendChild(open);
    return wrap;
  }

  function imageBody(item) {
    var wrap = node('div', 'bd-image');
    if (item.data.src) {
      var img = node('img', 'bd-image__img');
      img.src = item.data.src;
      img.alt = item.data.name || '';
      wrap.appendChild(img);
    } else {
      var empty = node('div', 'bd-image__empty');
      empty.appendChild(node('span', 'bd-image__glyph', 'Image'));
      var pick = node('button', 'btn btn--ghost', 'Choose image');
      pick.type = 'button';
      pick.addEventListener('click', function (event) {
        event.stopPropagation();
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            item.data.src = String(reader.result);
            item.data.name = file.name;
            saveItem(item);
            repaintBody(item);
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
      empty.appendChild(pick);
      wrap.appendChild(empty);
    }
    return wrap;
  }

  function refBody(item) {
    var wrap = node('div', 'bd-ref');
    var data = item.data || {};
    var glyph = node('span', 'bd-ref__glyph');
    glyph.appendChild(App.ui.icon(item.ref_kind === 'folder' ? 'folder' : item.ref_kind === 'file' ? 'file' : 'note', 16));
    var head = node('div', 'bd-ref__head');
    head.appendChild(glyph);
    head.appendChild(node('span', 'bd-ref__title', data.title || 'Untitled'));
    wrap.appendChild(head);
    wrap.appendChild(node('span', 'bd-ref__meta', data.meta || ''));
    if (data.snippet) wrap.appendChild(node('p', 'bd-ref__snippet', data.snippet));
    if (data.src) {
      var img = node('img', 'bd-ref__img');
      img.src = data.src;
      img.alt = data.title || '';
      wrap.appendChild(img);
    }
    wrap.appendChild(node('span', 'bd-ref__badge', 'from ' + (data.workspace || 'notes')));
    return wrap;
  }

  function bodyFor(item) {
    if (item.kind === 'todo') return todoBody(item);
    if (item.kind === 'link') return linkBody(item);
    if (item.kind === 'image') return imageBody(item);
    if (item.kind === 'ref') return refBody(item);
    if (item.kind === 'comment') return textArea(item, 'text', 'Comment');
    return textArea(item, 'text', 'Start typing...');
  }

  function repaintBody(item) {
    if (!item.node) return;
    var body = item.node.querySelector('.bd-item__body');
    if (!body) return;
    body.textContent = '';
    body.appendChild(bodyFor(item));
  }

  function paintItem(item) {
    var box = node('div', 'bd-item bd-item--' + item.kind);
    box.setAttribute('data-board-id', item.id);
    var bar = node('div', 'bd-item__bar');
    bar.appendChild(node('span', 'bd-item__kind', item.kind === 'ref' ? (item.ref_kind || 'item') : item.kind));
    var remove = node('button', 'bd-item__x', '\u00d7');
    remove.type = 'button';
    remove.setAttribute('data-board-del', item.id);
    remove.setAttribute('aria-label', 'Remove from board');
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      removeItem(item);
    });
    bar.appendChild(remove);
    box.appendChild(bar);
    var body = node('div', 'bd-item__body');
    body.appendChild(bodyFor(item));
    box.appendChild(body);
    var grip = node('div', 'bd-item__resize');
    grip.setAttribute('data-board-resize', item.id);
    box.appendChild(grip);
    box.addEventListener('pointerdown', onItemDown);
    item.node = box;
    placeItem(item);
    board.canvas.appendChild(box);
    return box;
  }

  function addItem(kind, payload) {
    var now = util.nowIso();
    var size = SIZES[kind] || SIZES.note;
    var at = centerOfView(board.items.length);
    var item = {
      id: util.uuid(),
      board_id: BOARD_ID,
      kind: kind,
      ref_kind: payload && payload.ref_kind ? payload.ref_kind : null,
      ref_id: payload && payload.ref_id ? payload.ref_id : null,
      x: at.x,
      y: at.y,
      w: payload && payload.w ? payload.w : size[0],
      h: payload && payload.h ? payload.h : size[1],
      z: nextZ(),
      data: payload && payload.data ? payload.data : defaultData(kind),
      created_at: now,
      updated_at: now,
    };
    board.items.push(item);
    paintItem(item);
    select(item);
    try { App.db.boardAddItem(item); } catch (e) { }
    return item;
  }

  function removeItem(item) {
    if (item.saveTimer) { clearTimeout(item.saveTimer); item.saveTimer = null; }
    if (item.node && item.node.parentNode) item.node.parentNode.removeChild(item.node);
    board.items = board.items.filter(function (other) { return other !== item; });
    if (board.selectedId === item.id) board.selectedId = null;
    try { App.db.boardDeleteItem(item.id); } catch (e) { }
  }

  function onItemDown(event) {
    if (event.button !== 0) return;
    var target = event.target;
    if (target.closest && target.closest('input, textarea, [contenteditable="true"], a, button')) return;
    var box = target.closest ? target.closest('.bd-item') : null;
    if (!box) return;
    var item = findItem(box.getAttribute('data-board-id'));
    if (!item) return;
    select(item);
    event.stopPropagation();
    var grip = target.closest('.bd-item__resize');
    var start = { x: event.clientX, y: event.clientY, w: item.w, h: item.h, ix: item.x, iy: item.y };
    if (grip) {
      board.resize = { item: item, start: start };
    } else {
      board.drag = { item: item, start: start };
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
  }

  function onStageDown(event) {
    if (event.button !== 0) return;
    var target = event.target;
    if (target.closest && target.closest('.bd-item')) return;
    if (target.closest && target.closest('.board__rail, .board__hint, .board__picker')) return;
    select(null);
    board.pan = { x: event.clientX, y: event.clientY, vx: board.view.x, vy: board.view.y };
    board.stage.classList.add('is-panning');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
  }

  function onPointerMove(event) {
    var scale = board.view.z;
    if (board.pan) {
      board.view.x = board.pan.vx + (event.clientX - board.pan.x);
      board.view.y = board.pan.vy + (event.clientY - board.pan.y);
      applyView();
      return;
    }
    if (board.drag) {
      var drag = board.drag;
      drag.item.x = Math.round(drag.start.ix + (event.clientX - drag.start.x) / scale);
      drag.item.y = Math.round(drag.start.iy + (event.clientY - drag.start.y) / scale);
      placeItem(drag.item);
      return;
    }
    if (board.resize) {
      var size = board.resize;
      size.item.w = Math.max(170, Math.round(size.start.w + (event.clientX - size.start.x) / scale));
      size.item.h = Math.max(110, Math.round(size.start.h + (event.clientY - size.start.y) / scale));
      placeItem(size.item);
    }
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    board.stage.classList.remove('is-panning');
    if (board.drag) { saveItem(board.drag.item); board.drag = null; }
    if (board.resize) { saveItem(board.resize.item); board.resize = null; }
    board.pan = null;
  }

  function onWheel(event) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? STEP : 1 / STEP, { x: event.clientX, y: event.clientY });
      return;
    }
    event.preventDefault();
    board.view.x -= event.deltaX;
    board.view.y -= event.deltaY;
    applyView();
  }

  function onKeyDown(event) {
    if (!board.open) return;
    var editing = event.target && event.target.closest && event.target.closest('input, textarea, [contenteditable="true"]');
    if (event.key === 'Escape') {
      if (board.picker) { closePicker(); return; }
      if (editing) { event.target.blur(); return; }
      event.preventDefault();
      close();
      return;
    }
    if (event.code === 'Space' && !editing) {
      board.space = true;
      board.stage.classList.add('is-space');
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+' || event.key === '-')) {
      event.preventDefault();
      zoomAt(event.key === '-' ? 1 / STEP : STEP, null);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '0') {
      event.preventDefault();
      fitView();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !editing && board.selectedId) {
      var item = findItem(board.selectedId);
      if (item) { event.preventDefault(); removeItem(item); }
    }
  }

  function onKeyUp(event) {
    if (event.code !== 'Space') return;
    board.space = false;
    if (board.stage) board.stage.classList.remove('is-space');
  }

  function railButton(icon, label, action) {
    var button = node('button', 'board__tool');
    button.type = 'button';
    button.appendChild(App.ui.icon(icon, 17));
    button.appendChild(node('span', 'board__tool-label', label));
    button.addEventListener('click', action);
    return button;
  }

  function buildRail() {
    var rail = node('div', 'board__rail');
    var group = node('div', 'board__rail-group');
    group.appendChild(railButton('note', 'Note', function () { addItem('note'); }));
    group.appendChild(railButton('check', 'To-do', function () { addItem('todo'); }));
    group.appendChild(railButton('external', 'Link', function () { addItem('link'); }));
    group.appendChild(railButton('eye', 'Image', function () { addItem('image'); }));
    group.appendChild(railButton('info', 'Comment', function () { addItem('comment'); }));
    rail.appendChild(group);
    var source = node('div', 'board__rail-group');
    source.appendChild(railButton('layers', 'From notes', openPicker));
    source.appendChild(railButton('grid', 'Tidy up', function () { tidy(); }));
    source.appendChild(railButton('restore', 'Fit', fitView));
    rail.appendChild(source);
    var foot = node('div', 'board__rail-group board__rail--foot');
    foot.appendChild(railButton('arrowLeft', 'Back', close));
    rail.appendChild(foot);
    return rail;
  }

  function tidy() {
    var columns = Math.max(1, Math.ceil(Math.sqrt(board.items.length)));
    board.items.forEach(function (item, index) {
      item.x = (index % columns) * 300;
      item.y = Math.floor(index / columns) * 240;
      placeItem(item);
      saveItem(item);
    });
    fitView();
  }

  function buildRoot() {
    var root = node('div', 'board');
    root.setAttribute('data-board', 'root');
    root.appendChild(buildRail());
    var stage = node('div', 'board__stage');
    var grid = node('div', 'board__grid');
    var canvas = node('div', 'board__canvas');
    stage.appendChild(grid);
    stage.appendChild(canvas);
    stage.addEventListener('pointerdown', onStageDown);
    stage.addEventListener('wheel', onWheel, { passive: false });
    root.appendChild(stage);
    var top = node('div', 'board__top');
    top.appendChild(node('span', 'board__title', 'Xave'));
    top.appendChild(node('span', 'board__sub', 'Infinite board'));
    var zoom = node('div', 'board__zoom');
    var out = node('button', 'board__zoom-btn', '\u2212');
    out.type = 'button';
    out.addEventListener('click', function () { zoomAt(1 / STEP, null); });
    var label = node('button', 'board__zoom-btn board__zoom-label', '100%');
    label.type = 'button';
    label.title = 'Reset zoom';
    label.addEventListener('click', function () { resetView(); });
    var inside = node('button', 'board__zoom-btn', '+');
    inside.type = 'button';
    inside.addEventListener('click', function () { zoomAt(STEP, null); });
    zoom.appendChild(out);
    zoom.appendChild(label);
    zoom.appendChild(inside);
    root.appendChild(zoom);
    root.appendChild(top);
    var hint = node('div', 'board__hint', 'Space + drag to pan \u00b7 Ctrl + scroll to zoom \u00b7 Ctrl + 0 to fit');
    root.appendChild(hint);
    board.root = root;
    board.stage = stage;
    board.canvas = canvas;
    board.grid = grid;
    board.zoomLabel = label;
    board.hint = hint;
    return root;
  }

  function openPicker() {
    if (board.picker) return;
    var panel = node('div', 'board__picker');
    var head = node('div', 'board__picker-head');
    head.appendChild(node('span', 'board__picker-title', 'Add from your notes'));
    var shut = node('button', 'board__picker-x', '\u00d7');
    shut.type = 'button';
    shut.addEventListener('click', closePicker);
    head.appendChild(shut);
    panel.appendChild(head);
    var body = node('div', 'board__picker-body');
    panel.appendChild(body);
    var foot = node('div', 'board__picker-foot');
    var count = node('span', 'board__picker-count', 'Nothing selected');
    var cancel = node('button', 'btn btn--ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', closePicker);
    var add = node('button', 'btn btn--primary', 'Add to board');
    add.type = 'button';
    add.addEventListener('click', function () { commitPicker(panel); });
    foot.appendChild(count);
    foot.appendChild(cancel);
    foot.appendChild(add);
    panel.appendChild(foot);
    board.picker = panel;
    board.pickerCount = count;
    board.root.appendChild(panel);
    paintPicker();
  }

  function pickGlyph(kind) {
    if (kind === 'folder') return 'dir';
    if (kind === 'note') return 'note';
    if (kind === 'file') return 'file';
    return '';
  }

  function pickNode(spec) {
    var wrap = node('div', 'pk-node');
    var row = node('div', 'pk-row');
    if (spec.kids) {
      var twisty = node('button', 'pk-twisty' + (spec.open ? ' is-open' : ''));
      twisty.type = 'button';
      twisty.setAttribute('aria-expanded', spec.open ? 'true' : 'false');
      twisty.setAttribute('aria-label', (spec.open ? 'Collapse ' : 'Expand ') + spec.name);
      twisty.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (spec.open) delete board.pickExpanded[spec.key];
        else board.pickExpanded[spec.key] = true;
        paintPicker();
      });
      row.appendChild(twisty);
    } else {
      row.appendChild(node('span', 'pk-twisty pk-twisty--none'));
    }
    var hit = node('label', 'pk-hit');
    var box = node('input', 'board__pick-box');
    box.type = 'checkbox';
    box.checked = !!board.pickChecked[spec.key];
    box.addEventListener('change', function () {
      if (box.checked) board.pickChecked[spec.key] = { kind: spec.kind || null, id: spec.id || null, ws: spec.ws };
      else delete board.pickChecked[spec.key];
      updatePickCount();
    });
    hit.appendChild(box);
    hit.appendChild(node('span', 'pk-glyph', pickGlyph(spec.kind)));
    hit.appendChild(node('span', 'board__pick-name', spec.name));
    row.appendChild(hit);
    if (spec.meta) row.appendChild(node('span', 'pk-meta', spec.meta));
    wrap.appendChild(row);
    if (spec.kids && spec.open) wrap.appendChild(spec.kids());
    return wrap;
  }

  function noteNode(space, note) {
    var title = note.title && note.title.trim() ? note.title : 'Untitled note';
    return pickNode({ key: 'note:' + note.id, kind: 'note', id: note.id, ws: space.id, name: title, meta: util.formatWhen(note.updated_at) });
  }

  function fileNode(space, file) {
    return pickNode({ key: 'file:' + file.id, kind: 'file', id: file.id, ws: space.id, name: file.filename || 'file', meta: util.formatBytes(file.size) });
  }

  function folderNode(space, folder, folders, notes, filesByFolder) {
    var subs = folders.filter(function (row) { return row.parent_folder_id === folder.id; });
    var inner = notes.filter(function (row) { return row.folder_id === folder.id; });
    var key = 'folder:' + folder.id;
    var open = !!board.pickExpanded[key];
    var direct = subs.length + inner.length;
    var kids = function () {
      var host = node('div', 'pk-kids');
      subs.forEach(function (sub) { host.appendChild(folderNode(space, sub, folders, notes)); });
      inner.forEach(function (note) { host.appendChild(noteNode(space, note)); });
      (filesByFolder[folder.id] || []).forEach(function (file) { host.appendChild(fileNode(space, file)); });
      return host;
    };
    return pickNode({
      key: key,
      kind: 'folder',
      id: folder.id,
      ws: space.id,
      name: folder.name || 'Untitled folder',
      meta: direct ? String(direct) : '',
      kids: direct ? kids : null,
      open: open,
    });
  }

  function paintPicker() {
    var panel = board.picker;
    if (!panel) return;
    var body = panel.querySelector('.board__picker-body');
    body.textContent = '';
    var spaces = [];
    try { spaces = App.db.listWorkspaces() || []; } catch (e) { spaces = []; }
    if (!spaces.length) body.appendChild(node('p', 'board__picker-empty', 'No workspaces yet.'));
    spaces.forEach(function (space) {
      var folders = [];
      var notes = [];
      var rootFiles = [];
      try { folders = App.db.listFolders(space.id) || []; } catch (e) { folders = []; }
      try { notes = App.db.listAllNotes(space.id) || []; } catch (e) { notes = []; }
      try { rootFiles = App.db.listFilesIn(space.id, null) || []; } catch (e) { rootFiles = []; }
      var filesByFolder = {};
      var nestedFiles = 0;
      folders.forEach(function (folder) {
        var list = [];
        try { list = App.db.listFilesIn(space.id, folder.id) || []; } catch (e) { list = []; }
        filesByFolder[folder.id] = list;
        nestedFiles += list.length;
      });
      var key = 'ws:' + space.id;
      var kids = function () {
        var host = node('div', 'pk-kids');
        folders.filter(function (row) { return !row.parent_folder_id; }).forEach(function (folder) {
          host.appendChild(folderNode(space, folder, folders, notes, filesByFolder));
        });
        notes.filter(function (row) { return !row.folder_id; }).forEach(function (note) { host.appendChild(noteNode(space, note)); });
        rootFiles.forEach(function (file) { host.appendChild(fileNode(space, file)); });
        return host;
      };
      var group = node('div', 'pk-group');
      group.appendChild(pickNode({
        key: key,
        kind: null,
        id: null,
        ws: space.id,
        name: space.name || 'Workspace',
        meta: folders.length + notes.length + rootFiles.length + nestedFiles + ' items',
        kids: kids,
        open: board.pickExpanded[key] !== false,
      }));
      body.appendChild(group);
    });
    updatePickCount();
  }

  function expandWorkspace(wsId, picks) {
    var folders = [];
    var notes = [];
    try { folders = App.db.listFolders(wsId) || []; } catch (e) { folders = []; }
    try { notes = App.db.listAllNotes(wsId) || []; } catch (e) { notes = []; }
    folders.forEach(function (folder) {
      picks.push({ kind: 'folder', id: folder.id, ws: wsId });
      try {
        (App.db.listFilesIn(wsId, folder.id) || []).forEach(function (file) { picks.push({ kind: 'file', id: file.id, ws: wsId }); });
      } catch (e) { }
    });
    notes.forEach(function (note) { picks.push({ kind: 'note', id: note.id, ws: wsId }); });
    try {
      (App.db.listFilesIn(wsId, null) || []).forEach(function (file) { picks.push({ kind: 'file', id: file.id, ws: wsId }); });
    } catch (e) { }
  }

  function collectPicks() {
    var picks = [];
    Object.keys(board.pickChecked).forEach(function (key) {
      var entry = board.pickChecked[key];
      if (!entry) return;
      if (entry.kind && entry.id) {
        picks.push({ kind: entry.kind, id: entry.id, ws: entry.ws });
        return;
      }
      expandWorkspace(entry.ws, picks);
    });
    return picks;
  }

  function updatePickCount() {
    if (!board.pickerCount) return;
    var total = collectPicks().length;
    board.pickerCount.textContent = total ? total + ' selected' : 'Nothing selected';
  }

  function closePicker() {
    if (!board.picker) return;
    if (board.picker.parentNode) board.picker.parentNode.removeChild(board.picker);
    board.picker = null;
    board.pickerCount = null;
    board.pickChecked = {};
    board.pickExpanded = {};
  }
  function snapshotFor(kind, id, wsId) {
    var space = null;
    try {
      (App.db.listWorkspaces() || []).forEach(function (row) { if (String(row.id) === String(wsId)) space = row; });
    } catch (e) { }
    var data = { workspace: space ? space.name : '', title: '', meta: '', snippet: '' };
    if (kind === 'folder') {
      var folder = null;
      try {
        (App.db.listFolders(wsId) || []).forEach(function (row) { if (String(row.id) === String(id)) folder = row; });
      } catch (e) { }
      data.title = folder ? folder.name : 'Folder';
      var notes = [];
      var subs = [];
      try { notes = App.db.listNotesIn(wsId, id) || []; } catch (e) { notes = []; }
      try {
        (App.db.listFolders(wsId) || []).forEach(function (row) { if (String(row.parent_folder_id) === String(id)) subs.push(row); });
      } catch (e) { }
      data.meta = notes.length + ' notes \u00b7 ' + subs.length + ' folders';
      data.snippet = notes.slice(0, 3).map(function (note) { return note.title || 'Untitled note'; }).join(', ');
      return data;
    }
    if (kind === 'note') {
      var note = null;
      try { note = App.db.getNote(id); } catch (e) { note = null; }
      data.title = note && note.title && note.title.trim() ? note.title : 'Untitled note';
      data.meta = note ? util.formatWhen(note.updated_at) : '';
      try { data.snippet = util.htmlToText(note && note.content ? note.content : '').slice(0, 180); } catch (e) { data.snippet = ''; }
      return data;
    }
    var file = null;
    try { file = App.db.getFileMeta(id); } catch (e) { file = null; }
    data.title = file ? file.filename : 'File';
    data.meta = file ? util.formatBytes(file.size) + ' \u00b7 ' + util.formatWhen(file.created_at) : '';
    data.snippet = file ? file.mime_type || '' : '';
    if (file && util.isImageMime(file.mime_type) && typeof App.db.getFileBlob === 'function') {
      try {
        var blob = App.db.getFileBlob(id);
        if (blob) {
          var reader = new FileReader();
          reader.onload = function () {
            var target = findItem(data.__itemId);
            if (target) { target.data.src = String(reader.result); saveItem(target); repaintBody(target); }
          };
          reader.readAsDataURL(blob);
        }
      } catch (e) { }
    }
    return data;
  }

  function commitPicker(panel) {
    var picks = collectPicks();
    closePicker();
    if (!picks.length) return;
    var base = centerOfView(0);
    var columns = Math.ceil(Math.sqrt(picks.length));
    picks.slice(0, 120).forEach(function (pick, index) {
      var snapshot = snapshotFor(pick.kind, pick.id, pick.ws);
      var item = addItem('ref', {
        ref_kind: pick.kind,
        ref_id: pick.id,
        data: snapshot,
        w: SIZES.ref[0],
        h: SIZES.ref[1],
      });
      snapshot.__itemId = item.id;
      item.x = Math.round(base.x + (index % columns) * 272 - 120);
      item.y = Math.round(base.y + Math.floor(index / columns) * 196 - 60);
      placeItem(item);
      saveItem(item);
    });
    fitView();
    util.toast(picks.length + ' items added to the board');
  }

  function load() {
    board.items = [];
    board.canvas.textContent = '';
    var stored = [];
    try { stored = App.db.boardItems(BOARD_ID) || []; } catch (e) { stored = []; }
    stored.forEach(function (row) {
      var item = row;
      item.data = row.data || {};
      board.items.push(item);
      paintItem(item);
    });
    var view = null;
    try { view = App.db.boardGet(BOARD_ID); } catch (e) { view = null; }
    board.view = view ? { x: view.vx || 0, y: view.vy || 0, z: view.vz || 1 } : { x: 0, y: 0, z: 1 };
    applyView();
  }

  function open() {
    if (board.open) return;
    board.open = true;
    if (!board.root) document.body.appendChild(buildRoot());
    board.root.classList.add('is-open');
    document.body.classList.add('is-board');
    try { App.db.boardEnsure(BOARD_ID, 'Xave'); } catch (e) { }
    load();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', applyView);
  }

  function close() {
    if (!board.open) return;
    board.items.forEach(flushItem);
    closePicker();
    board.open = false;
    board.selectedId = null;
    board.root.classList.remove('is-open');
    document.body.classList.remove('is-board');
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', applyView);
    try { App.db.boardSaveView(BOARD_ID, board.view.x, board.view.y, board.view.z); } catch (e) { }
  }

  App.board = {
    open: open,
    close: close,
    isOpen: function () { return board.open; },
    state: board,
    addItem: addItem,
  };
})(window.NoteApp);
