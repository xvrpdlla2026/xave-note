window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var DEFAULT_BOARD_ID = 'xave';
  var BOARD_ID = DEFAULT_BOARD_ID;
  var MIN_Z = 0.15;
  var MAX_Z = 2.5;
  var STEP = 1.15;
  var SIZES = { note: [268, 176], todo: [256, 196], link: [268, 96], image: [288, 216], comment: [268, 132], ref: [244, 168], column: [420, 320], table: [320, 208], group: [232, 62], file: [300, 236], draw: [380, 280] };

  var board = {
    marks: [],
    marking: false,
    railMarks: false,
    plans: [],
    planner: null,
    plannerEl: null,
    open: false,
    items: [],
    view: { x: 0, y: 0, z: 1 },
    viewZ: null,
    selectedId: null,
    selectedIds: [],
    redo: [],
    mode: 'grab',
    marquee: null,
    modeButton: null,
    space: false,
    pan: null,
    drag: null,
    resize: null,
    viewTimer: null,
    glide: null,
    glideTimer: null,
    bin: [],
    binButton: null,
    picker: null,
    pickerCount: null,
    pickChecked: {},
    pickExpanded: {},
    pickModel: [],
    root: null,
    stage: null,
    canvas: null,
    grid: null,
    zoomLabel: null,
    menuAt: null,
    undo: [],
    bg: 'dots',
    bound: false,
    links: null,
    batch: false,
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
    if (kind === 'group') return { title: 'Folder', lines: true };
    if (kind === 'column') return {};
    if (kind === 'draw') return { strokes: [] };
    if (kind === 'table') return { cells: [['', '', ''], ['', '', ''], ['', '', '']] };
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
    if (item.__planDraft) return;
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

  function applyView(lite) {
    var view = board.view;
    if (board.viewZ !== view.z) {
      board.viewZ = view.z;
      board.canvas.style.setProperty('--bd-z', view.z);
      board.grid.style.backgroundSize = (26 * view.z) + 'px ' + (26 * view.z) + 'px';
      board.zoomLabel.textContent = Math.round(view.z * 100) + '%';
    }
    board.canvas.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.z + ')';
    board.grid.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    richFollow();
    if (lite === true) return;
    cullPass();
    inkRepaintCards();
    scaleMarks();
    mapDraw();
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

  var CULL_PAD = 420;

  function stageSize() {
    if (board.size) return board.size;
    var rect = board.stage ? board.stage.getBoundingClientRect() : null;
    if (!rect || !rect.width || !rect.height) return { w: 0, h: 0 };
    board.size = { w: rect.width, h: rect.height };
    return board.size;
  }

  function materializeItem(item) {
    if (item.node) return;
    try {
      paintItem(item);
    } catch (err) {
      if (item.node && item.node.parentNode) item.node.parentNode.removeChild(item.node);
      delete item.node;
      return;
    }
    if (board.selectedIds.indexOf(item.id) >= 0) item.node.classList.add('is-selected');
  }

  function cullPass() {
    if (!board.open || !board.canvas || !board.stage) return;
    if (board.editors.length || board.drag || board.marquee) return;
    var active = document.activeElement;
    if (active && active !== document.body && board.canvas.contains(active)) return;
    var size = stageSize();
    if (!size.w || !size.h) return;
    var view = board.view;
    var z = view.z || 1;
    var at = board.cullAt;
    if (at && !board.cullForce && at.z === view.z && board.items.length === at.n && Math.abs(at.x - view.x) + Math.abs(at.y - view.y) < 280) return;
    var pad = CULL_PAD / z;
    var x1 = -view.x / z - pad;
    var y1 = -view.y / z - pad;
    var x2 = (size.w - view.x) / z + pad;
    var y2 = (size.h - view.y) / z + pad;
    var items = board.items;
    var keep = null;
    var item, data, i;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      data = item.data;
      if (item.kind === 'column' || item.kind === 'group' || (data && (data.parent || data.group))) {
        if (!keep) keep = {};
        keep[item.id] = true;
        if (data.parent) keep[data.parent] = true;
      }
    }
    var sel = board.selectedIds;
    if (sel.length) {
      if (!keep) keep = {};
      for (i = 0; i < sel.length; i++) keep[sel[i]] = true;
    }
    for (i = 0; i < items.length; i++) {
      item = items[i];
      if (keep && keep[item.id]) { materializeItem(item); continue; }
      if (item.x + item.w > x1 && item.x < x2 && item.y + item.h > y1 && item.y < y2) { materializeItem(item); continue; }
      if (!item.node) continue;
      if (item.node.parentNode) item.node.parentNode.removeChild(item.node);
      delete item.node;
    }
    board.cullAt = { x: view.x, y: view.y, z: view.z, n: items.length };
    board.cullForce = false;
  }

  function zoomAt(factor, point) {
    cancelViewGlide();
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
    cancelViewGlide();
    var view = board.view;
    if (view.z === 1) return;
    var rect = board.stage.getBoundingClientRect();
    var k = 1 / view.z;
    view.x = rect.width / 2 - (rect.width / 2 - view.x) * k;
    view.y = rect.height / 2 - (rect.height / 2 - view.y) * k;
    view.z = 1;
    applyView();
  }

  function fitView() {
    cancelViewGlide();
    if (!board.items.length) {
      board.view.x = 0;
      board.view.y = 0;
      board.view.z = 1;
      applyView();
      return;
    }
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

  var MAP_W = 200;
  var MAP_H = 132;

  function setMapHidden(on) {
    board.mapHidden = !!on;
    try { App.prefs.set('board.mapHidden', board.mapHidden); } catch (e) { }
    if (board.root) board.root.classList.toggle('is-maphidden', board.mapHidden);
    var button = board.mapToggle;
    if (button) {
      var label = board.mapHidden ? 'Show the minimap' : 'Hide the minimap';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', board.mapHidden ? 'true' : 'false');
      button.textContent = '';
      var mark = App.ui.icon(board.mapHidden ? 'eye' : 'eyeOff', 14);
      if (mark) button.appendChild(mark);
    }
    if (!board.mapHidden) mapDraw();
  }

  function mapFit() {
    var rect = board.stage.getBoundingClientRect();
    var view = board.view;
    var box = {
      x: -view.x / view.z,
      y: -view.y / view.z,
      w: Math.max(rect.width / view.z, 1),
      h: Math.max(rect.height / view.z, 1),
    };
    var grow = function (x, y, w, h) {
      var x2 = Math.max(box.x + box.w, x + w);
      var y2 = Math.max(box.y + box.h, y + h);
      box.x = Math.min(box.x, x);
      box.y = Math.min(box.y, y);
      box.w = x2 - box.x;
      box.h = y2 - box.y;
    };
    board.items.forEach(function (item) {
      grow(item.x, item.y, Math.max(item.w, 1), Math.max(item.h, 1));
    });
    board.marks.forEach(function (mark) {
      grow(mark.x - 24, mark.y - 24, 48, 48);
    });
    var pad = Math.max(box.w, box.h) * 0.08 + 24;
    box.x -= pad;
    box.y -= pad;
    box.w += pad * 2;
    box.h += pad * 2;
    var k = Math.min(MAP_W / box.w, MAP_H / box.h);
    return {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      k: k,
      ox: (MAP_W - box.w * k) / 2 - box.x * k,
      oy: (MAP_H - box.h * k) / 2 - box.y * k,
    };
  }

  function mapDraw() {
    if (!board.mapCtx || !board.open || board.mapHidden) return;
    if (board.mapFrame) return;
    board.mapFrame = window.requestAnimationFrame(function () {
      board.mapFrame = null;
      mapPaint();
    });
  }

  function mapColor(name, fallback) {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function mapLayer() {
    var items = board.items;
    var marks = board.marks;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sum = 0;
    var i, item, mark;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.x + item.w > maxX) maxX = item.x + item.w;
      if (item.y + item.h > maxY) maxY = item.y + item.h;
      sum += item.x * 7 + item.y * 13 + item.w * 3 + item.h * 5;
    }
    for (i = 0; i < marks.length; i++) {
      mark = marks[i];
      if (mark.x - 24 < minX) minX = mark.x - 24;
      if (mark.y - 24 < minY) minY = mark.y - 24;
      if (mark.x + 24 > maxX) maxX = mark.x + 24;
      if (mark.y + 24 > maxY) maxY = mark.y + 24;
      sum += mark.x * 11 + mark.y * 17;
    }
    if (!isFinite(minX) || !isFinite(minY)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    var accent = mapColor('--accent', 'rgb(125, 141, 255)');
    var sig = items.length + ':' + marks.length + ':' + Math.round(sum) + ':' + Math.round(maxX - minX) + 'x' + Math.round(maxY - minY) + ':' + accent;
    if (board.mapLayer && board.mapLayer.sig === sig) return board.mapLayer;
    var box = { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
    var pad = Math.max(box.w, box.h) * 0.08 + 24;
    box.x -= pad;
    box.y -= pad;
    box.w += pad * 2;
    box.h += pad * 2;
    var k = Math.min(MAP_W / box.w, MAP_H / box.h);
    var ox = (MAP_W - box.w * k) / 2 - box.x * k;
    var oy = (MAP_H - box.h * k) / 2 - box.y * k;
    var canvas = board.mapLayerCanvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      board.mapLayerCanvas = canvas;
    }
    var dpr = window.devicePixelRatio || 1;
    var wide = Math.round(MAP_W * dpr);
    var tall = Math.round(MAP_H * dpr);
    if (canvas.width !== wide || canvas.height !== tall) {
      canvas.width = wide;
      canvas.height = tall;
    }
    var lctx = canvas.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, MAP_W, MAP_H);
    var lx = function (x) { return ox + x * k; };
    var ly = function (y) { return oy + y * k; };
    for (i = 0; i < items.length; i++) {
      item = items[i];
      lctx.fillStyle = item.kind === 'draw' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(125, 141, 255, 0.32)';
      lctx.fillRect(lx(item.x), ly(item.y), Math.max(item.w * k, 2), Math.max(item.h * k, 2));
    }
    if (marks.length) {
      lctx.fillStyle = accent;
      for (i = 0; i < marks.length; i++) {
        mark = marks[i];
        lctx.beginPath();
        lctx.arc(lx(mark.x), ly(mark.y), 2.6, 0, Math.PI * 2);
        lctx.fill();
      }
    }
    board.mapLayer = { canvas: canvas, k: k, ox: ox, oy: oy, sig: sig };
    return board.mapLayer;
  }

  function mapPaint() {
    var ctx = board.mapCtx;
    var canvas = board.mapCanvas;
    if (!ctx || !canvas || !board.stage) return;
    var fit = mapFit();
    board.mapFit = fit;
    var dpr = window.devicePixelRatio || 1;
    var wide = Math.round(MAP_W * dpr);
    var tall = Math.round(MAP_H * dpr);
    if (canvas.width !== wide || canvas.height !== tall) {
      canvas.width = wide;
      canvas.height = tall;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    var mx = function (x) { return fit.ox + x * fit.k; };
    var my = function (y) { return fit.oy + y * fit.k; };
    var layer = mapLayer();
    if (layer) {
      var lift = fit.k / layer.k;
      ctx.drawImage(layer.canvas, fit.ox - layer.ox * lift, fit.oy - layer.oy * lift, MAP_W * lift, MAP_H * lift);
    }
    var view = board.view;
    var rect = board.stage.getBoundingClientRect();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(-view.x / view.z), my(-view.y / view.z), Math.max((rect.width / view.z) * fit.k, 3), Math.max((rect.height / view.z) * fit.k, 3));
    if (board.mapHover) {
      var hx = board.mapHover.x;
      var hy = board.mapHover.y;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx + 0.5, 0);
      ctx.lineTo(hx + 0.5, MAP_H);
      ctx.moveTo(0, hy + 0.5);
      ctx.lineTo(MAP_W, hy + 0.5);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function mapCenter(worldX, worldY) {
    var rect = board.stage.getBoundingClientRect();
    board.view.x = rect.width / 2 - worldX * board.view.z;
    board.view.y = rect.height / 2 - worldY * board.view.z;
    applyView();
  }

  function cancelViewGlide() {
    if (board.glideTimer) {
      clearTimeout(board.glideTimer);
      board.glideTimer = null;
    }
    if (board.glide) {
      cancelAnimationFrame(board.glide);
      board.glide = null;
    }
    if (!board.canvas) return;
    board.canvas.classList.remove('is-gliding');
    board.grid.classList.remove('is-gliding');
    board.canvas.style.transition = '';
    board.grid.style.transition = '';
  }

  function glideViewTo(x, y, ms) {
    cancelViewGlide();
    var view = board.view;
    var fromX = view.x;
    var fromY = view.y;
    var dx = x - fromX;
    var dy = y - fromY;
    var still = !dx && !dy;
    var calm = false;
    try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
    if (still || calm || !ms) {
      view.x = Math.round(x);
      view.y = Math.round(y);
      applyView();
      return;
    }
    var easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
    board.canvas.classList.add('is-gliding');
    board.grid.classList.add('is-gliding');
    view.x = x;
    view.y = y;
    cullPass();
    view.x = fromX;
    view.y = fromY;
    var finish = function () {
      if (board.glideTimer) {
        clearTimeout(board.glideTimer);
        board.glideTimer = null;
      }
      board.canvas.classList.remove('is-gliding');
      board.grid.classList.remove('is-gliding');
      board.canvas.style.transition = '';
      board.grid.style.transition = '';
      view.x = Math.round(x);
      view.y = Math.round(y);
      applyView();
    };
    board.glideTimer = setTimeout(finish, ms + 40);
    // Give the destination one frame to exist before the transition starts, so the
    // first animated frame is not also paying to build and paint what just arrived.
    board.glide = requestAnimationFrame(function () {
      board.glide = null;
      if (!board.canvas || !board.canvas.classList.contains('is-gliding')) return;
      board.canvas.style.transition = 'transform ' + ms + 'ms ' + easing;
      board.grid.style.transition = 'background-position ' + ms + 'ms ' + easing;
      view.x = Math.round(x);
      view.y = Math.round(y);
      applyView(true);
    });
  }

  function mapToWorld(event) {
    var fit = board.mapFit || mapFit();
    var rect = board.mapCanvas.getBoundingClientRect();
    var scale = MAP_W / Math.max(rect.width, 1);
    return {
      x: (event.clientX - rect.left) * scale / fit.k + (0 - fit.ox) / fit.k,
      y: (event.clientY - rect.top) * scale / fit.k + (0 - fit.oy) / fit.k,
    };
  }

  function mapDrag(event) {
    var at = mapToWorld(event);
    mapCenter(at.x, at.y);
  }

  function select(item) {
    setSelection(item ? [item.id] : [], item ? item.id : null);
  }

  function setSelection(ids, primary) {
    board.selectedIds = (ids || []).slice();
    board.selectedId = primary || board.selectedIds[board.selectedIds.length - 1] || null;
    paintSelection();
  }

  function paintSelection() {
    board.items.forEach(function (item) {
      if (item.node) item.node.classList.toggle('is-selected', board.selectedIds.indexOf(item.id) >= 0);
    });
  }

  function itemScreenRect(item) {
    var view = board.view;
    return { x: view.x + item.x * view.z, y: view.y + item.y * view.z, w: item.w * view.z, h: item.h * view.z };
  }

  function placeItem(item) {
    if (isChild(item) || !item.node) return;
    item.node.style.left = item.x + 'px';
    item.node.style.top = item.y + 'px';
    item.node.style.width = item.w + 'px';
    item.node.style.height = item.h + 'px';
    item.node.style.zIndex = String(item.z || 1);
    mapDraw();
  }

  function field(item, key, tag, cls, placeholder) {
    var input = node(tag, cls || 'bd-field');
    input.setAttribute('data-board-field', key);
    if (placeholder) input.setAttribute('placeholder', placeholder);
    if (item.data && item.data[key]) input.value = item.data[key];
    input.addEventListener('input', function () {
      if (lockOf(item)) return;
      item.data[key] = input.value;
      queueItemSave(item);
      if (item.data.syncLink) item.data.syncLink();
    });
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    input.addEventListener('focus', function () { pushUndo('edit'); });
    return input;
  }

  function relTime(iso) {
    var then = Date.parse(iso || '');
    if (!then) return 'just now';
    var secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.round(secs / 60) + 'm ago';
    if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
    return Math.round(secs / 86400) + 'd ago';
  }

  function fitBody(item) {
    if (!item.node || !item.node.isConnected) return;
    var wrap = item.node.querySelector('.bd-item__body > *');
    var bar = item.node.querySelector('.bd-item__bar');
    if (!wrap) return;
    if (item.data.fitH && Math.abs(item.h - item.data.fitH) > 4) return;
    var want = clamp(wrap.offsetHeight + (bar ? bar.offsetHeight : 26) + 22, 92, 520);
    item.data.fitH = want;
    if (Math.abs(want - item.h) < 4) return;
    item.h = want;
    placeItem(item);
    saveItem(item);
  }

  function avatarNode() {
    return node('span', 'bd-comment__avatar', 'Y');
  }

  function commentBody(item) {
    var data = item.data;
    if (!data.comments) data.comments = [];
    data.comments.forEach(function (row) { row.editing = false; });
    var wrap = node('div', 'bd-comment');
    var list = node('div', 'bd-comment__list');
    wrap.appendChild(list);
    var composer = node('div', 'bd-comment__composer');
    composer.appendChild(avatarNode());
    var input = node('input', 'bd-comment__input');
    input.type = 'text';
    input.placeholder = 'Write a comment...';
    input.addEventListener('focus', function () { pushUndo('edit'); });
    var send = node('button', 'bd-comment__send', 'Send');
    send.type = 'button';
    send.disabled = true;
    composer.appendChild(input);
    composer.appendChild(send);
    wrap.appendChild(composer);

    function act(label, handler) {
      var button = node('button', 'bd-comment__act', label);
      button.type = 'button';
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        if (lockOf(item)) return;
        handler();
      });
      return button;
    }

    function finishEdit(row, value, keep) {
      if (lockOf(item)) { row.editing = false; paint(); return; }
      var text = String(value || '').trim();
      if (keep && text) {
        row.text = text;
        row.edited = true;
        saveItem(item);
      }
      row.editing = false;
      paint();
    }

    function paint() {
      list.textContent = '';
      if (!data.comments.length) list.appendChild(node('p', 'bd-comment__empty', 'No comments yet'));
      data.comments.forEach(function (row, index) {
        var box = node('div', 'bd-comment__row');
        box.appendChild(avatarNode());
        var main = node('div', 'bd-comment__main');
        var head = node('div', 'bd-comment__head');
        head.appendChild(node('span', 'bd-comment__who', 'You'));
        head.appendChild(node('span', 'bd-comment__when', relTime(row.at) + (row.edited ? ' \u00b7 edited' : '')));
        main.appendChild(head);
        if (row.editing) {
          var field = node('textarea', 'bd-comment__edit');
          field.addEventListener('focus', function () { pushUndo('edit'); });
          field.value = row.text;
          field.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
          field.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finishEdit(row, field.value, true); }
            if (event.key === 'Escape') { event.preventDefault(); finishEdit(row, field.value, false); }
          });
          main.appendChild(field);
          var editing = node('div', 'bd-comment__acts');
          editing.appendChild(act('Save', function () { finishEdit(row, field.value, true); }));
          editing.appendChild(act('Cancel', function () { finishEdit(row, field.value, false); }));
          main.appendChild(editing);
          box.appendChild(main);
          list.appendChild(box);
          setTimeout(function () { field.focus(); }, 0);
          return;
        }
        main.appendChild(node('p', 'bd-comment__text', row.text));
        var links = node('div', 'bd-comment__acts');
        if (index === data.comments.length - 1) links.appendChild(act('Reply', function () { input.focus(); }));
        links.appendChild(act('Edit', function () { row.editing = true; paint(); }));
        main.appendChild(links);
        box.appendChild(main);
        list.appendChild(box);
      });
      fitBody(item);
      applyReadOnly(item);
    }

    function submit() {
      if (lockOf(item)) return;
      var text = input.value.trim();
      if (!text) return;
      data.comments.push({ id: util.uuid(), text: text, at: util.nowIso() });
      input.value = '';
      send.disabled = true;
      saveItem(item);
      paint();
    }

    input.addEventListener('input', function () { send.disabled = !input.value.trim(); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    });
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    send.addEventListener('click', submit);
    paint();
    return wrap;
  }

  function textArea(item, key, placeholder) {
    var box = node('div', 'bd-text');
    box.setAttribute('contenteditable', 'true');
    box.setAttribute('data-board-field', key);
    if (placeholder) box.setAttribute('data-placeholder', placeholder);
    var value = (item.data && item.data[key]) || '';
    box.innerHTML = util.isRichHtml(value) ? util.sanitizeRichHtml(value) : util.escapeHtml(value);
    Array.prototype.forEach.call(box.querySelectorAll('img'), function (img) {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
    box.addEventListener('input', function () {
      if (lockOf(item)) return;
      item.data[key] = box.innerHTML;
      queueItemSave(item);
      planRelabel(item);
    });
    box.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    box.addEventListener('focus', function () { pushUndo('edit'); });
    return box;
  }

  var FONTS = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 72];

  function fontBox(item) {
    return item.node ? item.node.querySelector('.bd-text') : null;
  }

  function fontNow(item) {
    var box = fontBox(item);
    var size = item.data && item.data.fs ? item.data.fs : (box ? parseFloat(getComputedStyle(box).fontSize) : 13);
    return isNaN(size) ? 13 : size;
  }

  function applyFont(item) {
    var box = fontBox(item);
    var size = fontNow(item);
    if (box) box.style.fontSize = item.data && item.data.fs ? item.data.fs + 'px' : '';
    if (item.node) {
      Array.prototype.forEach.call(item.node.querySelectorAll('.bd-item__font'), function (button) {
        button.title = Math.round(size) + ' px';
      });
    }
  }

  function bumpFont(item, dir) {
    if (lockOf(item)) return;
    var now = fontNow(item);
    var next = dir > 0 ? FONTS[FONTS.length - 1] : FONTS[0];
    for (var i = 0; i < FONTS.length; i++) {
      if (dir > 0 && FONTS[i] > now + 0.01) { next = FONTS[i]; break; }
      if (dir < 0 && FONTS[i] < now - 0.01) next = FONTS[i];
    }
    if (next === now) return;
    pushUndo('edit');
    item.data.fs = next;
    applyFont(item);
    saveItem(item);
  }

  var RICH_STYLE = { bold: ['font-weight', '700'], italic: ['font-style', 'italic'], underline: ['text-decoration', 'underline'] };
  var RICH_INLINE = /^(B|I|U|S|EM|STRONG|SPAN|FONT|MARK|SMALL|BIG|SUB|SUP|STRIKE|TT)$/i;
  var RICH_COLORS = [
    ['', 'Default'],
    ['var(--accent)', 'Accent'],
    ['var(--success)', 'Green'],
    ['var(--warning)', 'Amber'],
    ['var(--danger)', 'Red'],
    ['var(--text-muted)', 'Muted'],
  ];
  var richBar = null;
  var richCtx = null;
  var richSaved = null;

  function richRecents() {
    var list = App.prefs.get('board.textRecents', []);
    return Array.isArray(list) ? list : [];
  }

  function richCollection() {
    var list = App.prefs.get('board.textColors', []);
    return Array.isArray(list) ? list : [];
  }

  function richRemember(value) {
    if (!value) return;
    var list = richRecents().filter(function (one) { return one !== value; });
    list.unshift(value);
    App.prefs.set('board.textRecents', list.slice(0, 3));
  }

  function richKeep() {
    var sel = window.getSelection();
    richSaved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  }

  function richRestore() {
    if (!richSaved) return false;
    var sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(richSaved);
    return true;
  }

  function richSizeNow() {
    var ctx = richSelection();
    if (!ctx) return '';
    var host = richHost(ctx.range, ctx.box, 'font-size');
    var from = host || (ctx.range.startContainer.nodeType === 3 ? ctx.range.startContainer.parentNode : ctx.range.startContainer);
    return String(Math.round(parseFloat(getComputedStyle(from).fontSize) || fontNow(ctx.item)));
  }

  function richSizeTo(value) {
    var px = parseFloat(String(value === null || value === undefined ? '' : value).replace(/[^0-9.]/g, ''));
    if (!px || !isFinite(px)) return;
    richRestore();
    var ctx = richSelection();
    if (!ctx) return;
    var base = Math.max(6, fontNow(ctx.item));
    var next = Math.max(6, Math.min(160, px));
    pushUndo('format');
    var em = (next / base).toFixed(3) + 'em';
    var host = richHost(ctx.range, ctx.box, 'font-size');
    if (host) {
      host.style.setProperty('font-size', em);
      richSync(ctx);
      return;
    }
    var span = document.createElement('span');
    span.style.setProperty('font-size', em);
    richWrap(ctx.range, span);
    richSync(ctx);
  }

  function richHeadingHost(ctx) {
    var el = ctx.range.commonAncestorContainer;
    if (el && el.nodeType === 3) el = el.parentNode;
    while (el && el !== ctx.box) {
      if (el.nodeType === 1 && /^H[1-6]$/.test(el.tagName)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function richHeading() {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    var host = richHeadingHost(ctx);
    if (host) {
      var parent = host.parentNode;
      var after = host.nextSibling;
      richUnwrap(host);
      if (parent && after && !/^BR$/i.test(after.tagName)) parent.insertBefore(document.createElement('br'), after);
      richSync(ctx);
      return;
    }
    var heading = document.createElement('h4');
    heading.appendChild(ctx.range.extractContents());
    ctx.range.insertNode(heading);
    var sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      var range = document.createRange();
      range.selectNodeContents(heading);
      sel.addRange(range);
    }
    richSync(ctx);
  }

  function richBoxOf(start) {
    var el = start && start.nodeType === 3 ? start.parentNode : start;
    while (el && el !== document) {
      if (el.classList && el.classList.contains('bd-text')) return el;
      el = el.parentNode;
    }
    return null;
  }

function richItemOf(box) {
  var host = box && box.closest ? box.closest('.bd-item') : null;
  if (!host) return box && box.__planItem ? box.__planItem : null;
  if (host.__planView) return host.__planView;
  return findItem(host.getAttribute('data-board-id'));
}

  function richSelection() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var box = richBoxOf(range.commonAncestorContainer);
    if (!box) return null;
    var item = richItemOf(box);
    if (!item || item.kind !== 'note' || lockOf(item)) return null;
    return { sel: sel, range: range, box: box, item: item };
  }

  function richUnwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function richClean(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function (el) {
      if (/^(IMG|BR)$/i.test(el.tagName)) return;
      el.removeAttribute('style');
      if (/^H[1-6]$/.test(el.tagName)) {
        var after = el.nextSibling;
        richUnwrap(el);
        if (after && !/^BR$/i.test(after.tagName)) after.parentNode.insertBefore(document.createElement('br'), after);
        return;
      }
      if (RICH_INLINE.test(el.tagName)) richUnwrap(el);
    });
  }

  // Inline wrappers that ended up holding whole blocks push their style down onto those blocks,
  // so the text keeps one block per line instead of a span around a div.
  function richFlatten(ctx) {
    Array.prototype.slice.call(ctx.box.querySelectorAll('span[style],b[style],i[style],u[style],font[style]')).forEach(function (el) {
      var kids = Array.prototype.slice.call(el.children);
      if (!kids.length) return;
      var wraps = kids.every(function (kid) {
        return /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE)$/.test(kid.tagName);
      });
      if (!wraps) return;
      var decl = el.getAttribute('style') || '';
      kids.forEach(function (kid) {
        var own = kid.getAttribute('style') || '';
        kid.setAttribute('style', own ? own.replace(/;\s*$/, '; ') + decl : decl);
      });
      richUnwrap(el);
    });
  }

  function richSync(ctx) {
    if (!ctx || !ctx.item) return;
    richFlatten(ctx);
    ctx.item.data.text = ctx.box.innerHTML;
    ctx.item.updated_at = util.nowIso();
    queueItemSave(ctx.item);
    richState(ctx);
  }

  function richWrap(range, span) {
    var frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
    var sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    var next = document.createRange();
    next.selectNodeContents(span);
    sel.addRange(next);
  }

  function richHost(range, box, prop) {
    var el = range.commonAncestorContainer;
    if (el && el.nodeType === 3) el = el.parentNode;
    while (el && el !== box) {
      if (el.style && el.style.getPropertyValue(prop) && el.contains(range.startContainer) && el.contains(range.endContainer)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function richToggle(kind) {
    var ctx = richSelection();
    if (!ctx) return;
    var pair = RICH_STYLE[kind];
    pushUndo('format');
    var host = richHost(ctx.range, ctx.box, pair[0]);
    if (host && host.style.getPropertyValue(pair[0]) === pair[1]) {
      host.style.removeProperty(pair[0]);
      if (!host.getAttribute('style')) richUnwrap(host);
      richSync(ctx);
      return;
    }
    var span = document.createElement('span');
    span.style.setProperty(pair[0], pair[1]);
    richWrap(ctx.range, span);
    richSync(ctx);
  }

  function richStep(delta) {
    var ctx = richSelection();
    if (!ctx) return;
    var base = Math.max(6, fontNow(ctx.item));
    var host = richHost(ctx.range, ctx.box, 'font-size');
    var from = host || (ctx.range.startContainer.nodeType === 3 ? ctx.range.startContainer.parentNode : ctx.range.startContainer);
    var now = parseFloat(getComputedStyle(from).fontSize) || base;
    var next = Math.max(8, Math.min(120, now * (delta > 0 ? 1.15 : 1 / 1.15)));
    pushUndo('format');
    var em = (next / base).toFixed(3) + 'em';
    if (host) {
      host.style.setProperty('font-size', em);
      richSync(ctx);
      return;
    }
    var span = document.createElement('span');
    span.style.setProperty('font-size', em);
    richWrap(ctx.range, span);
    richSync(ctx);
  }

  function richColor(value) {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    richRemember(value);
    var host = richHost(ctx.range, ctx.box, 'color');
    if (host) {
      if (value) host.style.setProperty('color', value);
      else host.style.removeProperty('color');
      if (!host.getAttribute('style')) richUnwrap(host);
      richSync(ctx);
      return;
    }
    if (!value) return;
    var span = document.createElement('span');
    span.style.setProperty('color', value);
    richWrap(ctx.range, span);
    richSync(ctx);
  }

  function richBlockOf(ctx, node, offset) {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    if (el === ctx.box) {
      var kids = ctx.box.childNodes;
      var index = Math.min(Math.max((offset || 0) - (offset ? 1 : 0), 0), Math.max(kids.length - 1, 0));
      var kid = kids[index];
      el = (kid && kid.nodeType === 1) ? kid : ctx.box;
    }
    while (el && el !== ctx.box) {
      if (el.nodeType === 1 && /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|UL|OL)$/.test(el.tagName)) return el;
      el = el.parentNode;
    }
    return ctx.box;
  }

  function richSpanBlocks(ctx) {
    var first = richBlockOf(ctx, ctx.range.startContainer, ctx.range.startOffset);
    var last = richBlockOf(ctx, ctx.range.endContainer, ctx.range.endOffset);
    if (!first || !last || first === last) return [first || ctx.box];
    var out = [];
    Array.prototype.forEach.call(ctx.box.querySelectorAll('div,p,li,h1,h2,h3,h4,h5,h6,blockquote,pre'), function (el) {
      try { if (ctx.range.intersectsNode(el)) out.push(el); } catch (e) { }
    });
    return out.length ? out : [first];
  }

  // A line typed straight into an empty box has no element of its own to carry alignment or
  // spacing, so the first command that needs one gives it a block.
  function richBlockTarget(ctx, el) {
    if (el && el !== ctx.box) return el;
    var div = document.createElement('div');
    div.appendChild(ctx.range.extractContents());
    ctx.range.insertNode(div);
    var sel = window.getSelection();
    if (sel) {
      var next = document.createRange();
      next.selectNodeContents(div);
      sel.removeAllRanges();
      sel.addRange(next);
    }
    return div;
  }

  function richTidyBlock(el, box) {
    if (!el || el === box) return;
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  function richSizeHost(ctx) {
    var host = richHost(ctx.range, ctx.box, 'font-size');
    if (host) return host;
    var leaf = ctx.range.startContainer;
    if (leaf === ctx.box) {
      var kids = ctx.box.childNodes;
      var start = ctx.range.startOffset || 0;
      var index = Math.min(Math.max(start - (start ? 1 : 0), 0), Math.max(kids.length - 1, 0));
      leaf = kids[index] || ctx.box;
    }
    var el = leaf && leaf.nodeType === 3 ? leaf.parentNode : leaf;
    while (el && el !== ctx.box) {
      if (el.style && el.style.getPropertyValue('font-size')) return el;
      el = el.parentNode;
    }
    return null;
  }

  function richTypeName() {
    var ctx = richSelection();
    if (!ctx) return 'Normal';
    if (richHeadingHost(ctx)) return 'Heading';
    var host = richSizeHost(ctx);
    if (!host) return 'Normal';
    var base = Math.max(6, fontNow(ctx.item));
    var px = parseFloat(getComputedStyle(host).fontSize) || base;
    var ratio = px / base;
    if (ratio < 0.95) return 'Small';
    if (ratio > 1.45) return 'Huge';
    if (ratio > 1.12) return 'Large';
    return 'Normal';
  }

  function richType(kind) {
    var ctx = richSelection();
    if (!ctx) return;
    if (kind === 'heading') { richHeading(); return; }
    var base = Math.max(6, fontNow(ctx.item));
    if (kind === 'normal') {
      pushUndo('format');
      Array.prototype.slice.call(ctx.box.querySelectorAll('h1,h2,h3,h4,h5,h6,span[style]')).forEach(function (el) {
        var hit = false;
        try { hit = ctx.range.intersectsNode(el); } catch (e) { }
        if (!hit) return;
        if (/^H[1-6]$/.test(el.tagName)) { richUnwrap(el); return; }
        el.style.removeProperty('font-size');
        if (!el.getAttribute('style')) richUnwrap(el);
      });
      Array.prototype.slice.call(ctx.box.querySelectorAll('.bd-tick, .bd-code')).forEach(function (el) {
        var hit = false;
        try { hit = ctx.range.intersectsNode(el); } catch (e) { }
        if (!hit) return;
        el.classList.remove('bd-tick', 'bd-code');
        el.removeAttribute('data-done');
      });
      richSync(ctx);
      return;
    }
    var factor = kind === 'small' ? 0.85 : (kind === 'large' ? 1.25 : 1.6);
    richSizeTo(Math.round(base * factor));
  }

  function richAlign(dir) {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    richSpanBlocks(ctx).forEach(function (el) {
      var block = richBlockTarget(ctx, el);
      if (!block) return;
      if (dir === 'left') block.style.removeProperty('text-align');
      else block.style.setProperty('text-align', dir);
      richTidyBlock(block, ctx.box);
    });
    richSync(ctx);
  }

  function richList(command) {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    var tag = command === 'insertOrderedList' ? 'OL' : 'UL';
    var blocks = richSpanBlocks(ctx).map(function (el) { return richBlockTarget(ctx, el); });
    var lists = [];
    var loose = [];
    blocks.forEach(function (el) {
      if (!el) return;
      var holder = el.tagName === 'UL' || el.tagName === 'OL' ? el : (el.closest ? el.closest('ul,ol') : null);
      if (holder) {
        if (lists.indexOf(holder) < 0) lists.push(holder);
        return;
      }
      loose.push(el);
    });
    if (lists.length) {
      var sameTag = lists.every(function (list) { return list.tagName === tag; });
      lists.forEach(function (list) {
        var host = list.parentNode;
        if (!host) return;
        if (sameTag) {
          while (list.firstChild) {
            var item = list.firstChild;
            if (item.nodeType === 1 && item.tagName === 'LI') {
              var line = document.createElement('div');
              while (item.firstChild) line.appendChild(item.firstChild);
              host.insertBefore(line, list);
              item.remove();
            } else {
              host.insertBefore(item, list);
            }
          }
          list.remove();
          return;
        }
        var swapped = document.createElement(tag.toLowerCase());
        Array.prototype.slice.call(list.attributes).forEach(function (attr) {
          swapped.setAttribute(attr.name, attr.value);
        });
        while (list.firstChild) swapped.appendChild(list.firstChild);
        host.replaceChild(swapped, list);
      });
      if (!loose.length) {
        richSync(ctx);
        return;
      }
    }
    var lead = loose.filter(function (el) { return el && el.parentNode; })[0];
    if (!lead) {
      richSync(ctx);
      return;
    }
    var list = document.createElement(tag.toLowerCase());
    lead.parentNode.insertBefore(list, lead);
    loose.forEach(function (el) {
      if (!el || !el.parentNode) return;
      var item = document.createElement('li');
      if (el.tagName === 'LI' || el.tagName === 'DIV' || el.tagName === 'P') item.innerHTML = el.innerHTML;
      else item.appendChild(el.cloneNode(true));
      list.appendChild(item);
      el.remove();
    });
    var sel = window.getSelection();
    if (sel) {
      var select = document.createRange();
      select.selectNodeContents(list);
      sel.removeAllRanges();
      sel.addRange(select);
    }
    richSync(ctx);
  }

  function richIndent(dir) {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    richSpanBlocks(ctx).forEach(function (el) {
      var block = richBlockTarget(ctx, el);
      if (!block) return;
      var now = parseFloat(block.style.getPropertyValue('margin-left')) || 0;
      var next = dir === 'out' ? Math.max(0, now - 24) : now + 24;
      if (next) block.style.setProperty('margin-left', next + 'px');
      else block.style.removeProperty('margin-left');
      richTidyBlock(block, ctx.box);
    });
    richSync(ctx);
  }

  function richSpacing(value) {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    richSpanBlocks(ctx).forEach(function (el) {
      var block = richBlockTarget(ctx, el);
      if (!block) return;
      if (value) block.style.setProperty('line-height', value);
      else block.style.removeProperty('line-height');
      richTidyBlock(block, ctx.box);
    });
    richSync(ctx);
  }

  // A checklist line keeps its own tick box, so a note can hold small tasks without becoming a to-do.
  function richCheck() {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    var blocks = richSpanBlocks(ctx).map(function (el) { return richBlockTarget(ctx, el); }).filter(Boolean);
    var allOn = blocks.length > 0 && blocks.every(function (el) { return el.classList.contains('bd-tick'); });
    blocks.forEach(function (el) {
      el.classList.toggle('bd-tick', !allOn);
      if (allOn) el.removeAttribute('data-done');
      else el.setAttribute('data-done', el.getAttribute('data-done') === '1' ? '1' : '0');
      richTidyBlock(el, ctx.box);
    });
    richSync(ctx);
  }

  function richCode() {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    var blocks = richSpanBlocks(ctx).map(function (el) { return richBlockTarget(ctx, el); }).filter(Boolean);
    var allOn = blocks.length > 0 && blocks.every(function (el) { return el.classList.contains('bd-code'); });
    blocks.forEach(function (el) {
      el.classList.toggle('bd-code', !allOn);
      richTidyBlock(el, ctx.box);
    });
    richSync(ctx);
  }

  function richCodeInline() {
    var ctx = richSelection();
    if (!ctx) return;
    pushUndo('format');
    var el = ctx.range.commonAncestorContainer;
    if (el && el.nodeType === 3) el = el.parentNode;
    while (el && el !== ctx.box && el.nodeName !== 'CODE') el = el.parentNode;
    if (el && el !== ctx.box) {
      richUnwrap(el);
      richSync(ctx);
      return;
    }
    var code = document.createElement('code');
    richWrap(ctx.range, code);
    richSync(ctx);
  }

  function richMenuClose() {
    if (!richBar) return;
    var menu = richBar.querySelector('.bd-rich__menu');
    if (menu) menu.classList.remove('is-on');
  }

  function richPopClose() {
    if (!richBar) return;
    richBar.classList.remove('is-picking');
  }

  function richMenuOpt(menu, label, on, act) {
    var button = node('button', 'bd-rich__opt' + (on ? ' is-on' : ''), label);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      richMenuClose();
      richRestore();
      act();
    });
    menu.appendChild(button);
    return button;
  }

  function richMenuToggle(kind, trigger) {
    if (!richBar) return;
    var menu = richBar.querySelector('.bd-rich__menu');
    if (!menu) return;
    richKeep();
    richPopClose();
    if (menu.classList.contains('is-on') && menu.getAttribute('data-menu') === kind) { richMenuClose(); return; }
    menu.setAttribute('data-menu', kind);
    menu.textContent = '';
    if (kind === 'type') {
      var now = richTypeName();
      var samples = {
        Normal: ['11.5px', '400'],
        Heading: ['13px', '700'],
        Small: ['10px', '400'],
        Large: ['13.5px', '400'],
        Huge: ['16.5px', '400'],
      };
      ['Normal', 'Heading', 'Small', 'Large', 'Huge'].forEach(function (name) {
        var option = richMenuOpt(menu, name, now === name, function () { richType(name.toLowerCase()); });
        if (!samples[name]) return;
        option.style.fontSize = samples[name][0];
        option.style.fontWeight = samples[name][1];
      });
    } else {
      [['Line spacing 1.0', '1'], ['Line spacing 1.15', '1.15'], ['Line spacing 1.5', '1.5'], ['Line spacing 2.0', '2']].forEach(function (pair) {
        richMenuOpt(menu, pair[0], false, function () { richSpacing(pair[1]); });
      });
    }
    menu.classList.add('is-on');
    menu.style.left = Math.max(0, trigger.offsetLeft) + 'px';
  }
  function richDirty(ctx) {
    var frag = ctx.range.cloneContents();
    var nodes = Array.prototype.slice.call(frag.querySelectorAll('*'));
    if (nodes.some(function (el) {
      return el.getAttribute('style') || /^(B|I|U|S|EM|STRONG|FONT|MARK|H[1-6])$/.test(el.tagName);
    })) return true;
    var el = ctx.range.commonAncestorContainer;
    if (el && el.nodeType === 3) el = el.parentNode;
    while (el && el !== ctx.box) {
      if (el.nodeType === 1 && (el.getAttribute('style') || /^(B|I|U|S|EM|STRONG|FONT|MARK|H[1-6])$/.test(el.tagName))) return true;
      el = el.parentNode;
    }
    return false;
  }

  function richClearSelection(ctx) {
    pushUndo('format');
    var chain = [];
    var node = ctx.range.commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentNode;
    while (node && node !== ctx.box) {
      chain.push(node);
      node = node.parentNode;
    }
    var span = document.createElement('span');
    span.style.setProperty('font-weight', '400');
    span.style.setProperty('font-style', 'normal');
    span.style.setProperty('text-decoration', 'none');
    span.style.setProperty('font-size', '1em');
    span.style.setProperty('color', 'inherit');
    var frag = ctx.range.extractContents();
    richClean(frag);
    span.appendChild(frag);
    ctx.range.insertNode(span);
    chain.forEach(function (el) {
      if (!el.parentNode) return;
      var kids = Array.prototype.filter.call(el.childNodes, function (kid) {
        return kid.nodeType !== 3 || kid.data;
      });
      if (kids.length !== 1 || kids[0] !== span) return;
      el.removeAttribute('style');
      if (RICH_INLINE.test(el.tagName)) richUnwrap(el);
    });
    var host = span.parentNode;
    var styled = false;
    while (host && host !== ctx.box) {
      if (host.nodeType === 1 && host.getAttribute && host.getAttribute('style')) { styled = true; break; }
      host = host.parentNode;
    }
    Array.prototype.slice.call(ctx.box.querySelectorAll('span, b, i, u, em, strong, font, mark, s')).forEach(function (el) {
      if (!el.textContent && !el.querySelector('img')) richUnwrap(el);
    });
    if (!styled) {
      var first = span.firstChild;
      var last = span.lastChild;
      richUnwrap(span);
      var sel = window.getSelection();
      if (sel && first && last) {
        var next = document.createRange();
        next.setStartBefore(first);
        next.setEndAfter(last);
        sel.removeAllRanges();
        sel.addRange(next);
      }
    }
    richSync(ctx);
  }

  function clearFormatting(item) {
    var ctx = richSelection();
    if (ctx && (!item || ctx.item === item)) {
      if (!richDirty(ctx)) {
        util.toast('Nothing to clear here.', 'info');
        return;
      }
      richClearSelection(ctx);
      return;
    }
    if (!item || lockOf(item)) return;
    var box = fontBox(item);
    if (!box) return;
    App.ui.dialog({
      title: 'Clear formatting?',
      icon: 'restore',
      danger: true,
      message: 'Every size, colour, bold, italic and underline inside "' + ((item.data && item.data.title) || 'this note') + '" is removed. The words stay.',
      consequences: [
        'This covers the whole card, because nothing is selected.',
        'Undo brings the formatting back.',
      ],
      confirmLabel: 'Clear formatting',
    }).then(function (ok) {
      if (!ok) return;
      pushUndo('format');
      richClean(box);
      item.data.text = box.innerHTML;
      item.updated_at = util.nowIso();
      saveItem(item);
      util.toast('Formatting cleared.', 'info');
    });
  }

  function richPopToggle() {
    if (!richBar) return;
    richKeep();
    var open = !richBar.classList.contains('is-picking');
    richBar.classList.toggle('is-picking', open);
    if (open) { richMenuClose(); richPopPaint(); }
  }

  function richHex(value) {
    var text = String(value || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      return '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
    }
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    var rgb = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(text);
    if (!rgb) return '';
    return '#' + [rgb[1], rgb[2], rgb[3]].map(function (part) {
      return ('0' + Math.max(0, Math.min(255, parseInt(part, 10))).toString(16)).slice(-2);
    }).join('');
  }

  function richPick() {
    var ctx = richCtx && richCtx.range ? richCtx : richSelection();
    var host = ctx ? richHost(ctx.range, ctx.box, 'color') : null;
    var value = host ? (host.style.getPropertyValue('color') || '') : '';
    return richHex(value) || '#e0555a';
  }

  function richPopSwatch(value, title, removable) {
    var swatch = node('button', 'bd-rich__swatch' + (value ? '' : ' bd-rich__swatch--default'));
    swatch.type = 'button';
    swatch.title = title;
    swatch.setAttribute('aria-label', title);
    if (value) swatch.style.background = value;
    swatch.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); });
    swatch.addEventListener('click', function () {
      richColor(value);
      richPopPaint();
    });
    if (!removable) return swatch;
    var wrap = node('span', 'bd-rich__swatch-wrap');
    var drop = node('button', 'bd-rich__drop', '\u00d7');
    drop.type = 'button';
    drop.title = 'Remove from the collection';
    drop.setAttribute('aria-label', 'Remove from the collection');
    drop.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); });
    drop.addEventListener('click', function () {
      App.prefs.set('board.textColors', richCollection().filter(function (one) { return one !== value; }));
      richPopPaint();
    });
    wrap.appendChild(swatch);
    wrap.appendChild(drop);
    return wrap;
  }

  function richPopRow(label, items, empty) {
    var row = node('div', 'bd-rich__pop-row');
    row.appendChild(node('span', 'bd-rich__pop-label', label));
    if (!items.length && empty) {
      row.appendChild(node('span', 'bd-rich__pop-empty', empty));
      return row;
    }
    items.forEach(function (item) { row.appendChild(item); });
    return row;
  }

  function richPopPaint() {
    if (!richBar) return;
    var pop = richBar.querySelector('.bd-rich__pop');
    if (!pop) return;
    pop.textContent = '';
    var palette = node('div', 'bd-rich__pop-row');
    palette.appendChild(node('span', 'bd-rich__pop-label', 'Colour'));
    RICH_COLORS.forEach(function (pair) {
      var swatch = node('button', 'bd-rich__swatch' + (pair[0] ? '' : ' bd-rich__swatch--default'));
      swatch.type = 'button';
      swatch.title = pair[1];
      swatch.setAttribute('aria-label', pair[1]);
      swatch.setAttribute('data-colour', pair[0]);
      if (pair[0]) swatch.style.background = pair[0] === 'var(--accent)' ? 'var(--accent)' : pair[0];
      swatch.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); });
      swatch.addEventListener('click', function () { richRestore(); richColor(pair[0]); });
      palette.appendChild(swatch);
    });
    pop.appendChild(palette);
    pop.appendChild(richPopRow('Recent', richRecents().map(function (value) {
      return richPopSwatch(value, value);
    }), 'None yet'));
    pop.appendChild(richPopRow('Saved', richCollection().map(function (value) {
      return richPopSwatch(value, value, true);
    }), 'Nothing saved'));
    var make = node('div', 'bd-rich__pop-row');
    make.appendChild(node('span', 'bd-rich__pop-label', 'Custom'));
    var picker = node('input', 'bd-rich__colour');
    picker.type = 'color';
    picker.value = richPick();
    picker.title = 'Pick a colour';
    picker.setAttribute('aria-label', 'Pick a colour');
    picker.addEventListener('pointerdown', function (event) { richKeep(); event.stopPropagation(); });
    picker.addEventListener('focus', function () { richKeep(); });
    picker.addEventListener('input', function () {
      richRestore();
      richColor(picker.value);
    });
    picker.addEventListener('change', function () { richPopPaint(); });
    make.appendChild(picker);
    var save = node('button', 'bd-rich__save', 'Save');
    save.type = 'button';
    save.title = 'Save this colour to the collection';
    save.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); });
    save.addEventListener('click', function () {
      var value = picker.value;
      if (!value) return;
      var list = richCollection().filter(function (one) { return one !== value; });
      list.push(value);
      App.prefs.set('board.textColors', list.slice(-12));
      richRemember(value);
      util.toast('Colour saved.', 'info');
      richPopPaint();
    });
    make.appendChild(save);
    pop.appendChild(make);
  }

  function richButton(cls, label, title) {
    var button = node('button', 'bd-rich__btn' + (cls ? ' ' + cls : ''), label);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); });
    return button;
  }

  // The bar reads as two rows: what a line is on top, where it sits at the bottom. Everything a
  // note can be told about its words lives in one of them, so nothing hides in a second surface.
  function buildRichBar() {
    var bar = node('div', 'bd-rich');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Format the selected text');
    var row = function (name) {
      var strip = node('div', 'bd-rich__row bd-rich__row--' + name);
      bar.appendChild(strip);
      return strip;
    };
    var group = function (parent) {
      var box = node('div', 'bd-rich__group');
      parent.appendChild(box);
      return box;
    };
    var caret = function (button) {
      button.appendChild(node('span', 'bd-rich__caret'));
      return button;
    };

    var head = row('type');
    var typeBtn = richButton('bd-rich__type', '', 'Text style');
    typeBtn.appendChild(node('span', 'bd-rich__label', 'Normal'));
    caret(typeBtn);
    typeBtn.setAttribute('data-type', '1');
    typeBtn.setAttribute('aria-haspopup', 'true');
    typeBtn.addEventListener('click', function (event) { event.stopPropagation(); richMenuToggle('type', typeBtn); });
    group(head).appendChild(typeBtn);

    var metrics = group(head);
    var smaller = richButton(null, 'A-', 'Smaller text');
    smaller.addEventListener('click', function () { richStep(-1); });
    metrics.appendChild(smaller);
    var field = node('input', 'bd-rich__size');
    field.type = 'text';
    field.inputMode = 'numeric';
    field.title = 'Text size in pixels';
    field.setAttribute('aria-label', 'Text size in pixels');
    field.addEventListener('pointerdown', function (event) { richKeep(); event.stopPropagation(); });
    field.addEventListener('focus', function () { richKeep(); });
    field.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); field.blur(); }
      if (event.key === 'Escape') { field.value = richSizeNow(); field.blur(); }
    });
    field.addEventListener('change', function () { richSizeTo(field.value); });
    metrics.appendChild(field);
    var bigger = richButton(null, 'A+', 'Larger text');
    bigger.addEventListener('click', function () { richStep(1); });
    metrics.appendChild(bigger);

    var weight = group(head);
    ['bold', 'italic', 'underline'].forEach(function (kind) {
      var label = kind === 'bold' ? 'B' : (kind === 'italic' ? 'I' : 'U');
      var button = richButton('bd-rich__btn--' + kind, label, kind.charAt(0).toUpperCase() + kind.slice(1));
      button.setAttribute('data-rich', kind);
      button.addEventListener('click', function () { richToggle(kind); });
      weight.appendChild(button);
    });
    var mono = richButton('bd-rich__btn--icon', '', 'Inline code');
    mono.setAttribute('data-code', '1');
    var monoGlyph = App.ui.icon('code', 13);
    if (monoGlyph) mono.appendChild(monoGlyph);
    mono.addEventListener('click', function () { richCodeInline(); });
    weight.appendChild(mono);

    var ink = group(head);
    var colour = richButton('bd-rich__btn--colour', 'A', 'Text colour');
    caret(colour);
    colour.setAttribute('data-ink', '1');
    colour.setAttribute('aria-haspopup', 'true');
    colour.addEventListener('click', function (event) {
      event.stopPropagation();
      richKeep();
      richMenuClose();
      if (!richBar.classList.contains('is-picking')) richPopToggle();
    });
    ink.appendChild(colour);

    var tidy = group(head);
    var clear = richButton('bd-rich__btn--wide', 'Clear', 'Clear the formatting');
    clear.addEventListener('click', function () { clearFormatting(); });
    tidy.appendChild(clear);
    var shut = richButton('bd-rich__btn--shut', '\u00d7', 'Close the bar');
    shut.addEventListener('click', function () { richPopClose(); richHide(); });
    tidy.appendChild(shut);

    var base = row('block');
    var align = group(base);
    [['alignleft', 'left', 'Align left'], ['aligncenter', 'center', 'Align centre'], ['alignright', 'right', 'Align right']].forEach(function (pair) {
      var button = richButton('bd-rich__btn--icon', '', pair[2]);
      button.setAttribute('data-align', pair[1]);
      var glyph = App.ui.icon(pair[0], 13);
      if (glyph) button.appendChild(glyph);
      button.addEventListener('click', function () { richAlign(pair[1]); });
      align.appendChild(button);
    });
    var lists = group(base);
    [['bullets', 'insertUnorderedList', 'Bulleted list'], ['numbers', 'insertOrderedList', 'Numbered list']].forEach(function (pair) {
      var button = richButton('bd-rich__btn--icon', '', pair[2]);
      button.setAttribute('data-list', pair[1]);
      var glyph = App.ui.icon(pair[0], 13);
      if (glyph) button.appendChild(glyph);
      button.addEventListener('click', function () { richList(pair[1]); });
      lists.appendChild(button);
    });
    var shapes = group(base);
    [['check', 'checklist', 'Checklist'], ['code', 'code', 'Code block']].forEach(function (pair) {
      var button = richButton('bd-rich__btn--icon', '', pair[2]);
      button.setAttribute('data-block', pair[0]);
      var glyph = App.ui.icon(pair[1], 13);
      if (glyph) button.appendChild(glyph);
      button.addEventListener('click', function () {
        if (pair[0] === 'check') richCheck();
        else richCode();
      });
      shapes.appendChild(button);
    });
    var nest = group(base);
    [['outdent', 'out', 'Outdent'], ['indent', 'in', 'Indent']].forEach(function (pair) {
      var button = richButton('bd-rich__btn--icon', '', pair[2]);
      var glyph = App.ui.icon(pair[0], 13);
      if (glyph) button.appendChild(glyph);
      button.addEventListener('click', function () { richIndent(pair[1]); });
      nest.appendChild(button);
    });
    var space = group(base);
    var spacing = richButton('bd-rich__type', 'Spacing', 'Line spacing');
    caret(spacing);
    spacing.setAttribute('data-space', '1');
    spacing.setAttribute('aria-haspopup', 'true');
    spacing.addEventListener('click', function (event) { event.stopPropagation(); richMenuToggle('space', spacing); });
    space.appendChild(spacing);

    bar.appendChild(node('div', 'bd-rich__menu'));
    bar.appendChild(node('div', 'bd-rich__pop'));
    document.body.appendChild(bar);
    return bar;
  }

  function richState(ctx) {
    if (!richBar) return;
    Array.prototype.forEach.call(richBar.querySelectorAll('[data-rich]'), function (button) {
      var pair = RICH_STYLE[button.getAttribute('data-rich')];
      button.classList.toggle('is-on', !!(ctx && richHost(ctx.range, ctx.box, pair[0])));
    });
    var line = ctx ? richBlockOf(ctx, ctx.range.startContainer, ctx.range.startOffset) : null;
    var checks = !!(line && line.classList && line.classList.contains('bd-tick'));
    var codes = !!(line && line.classList && line.classList.contains('bd-code'));
    Array.prototype.forEach.call(richBar.querySelectorAll('[data-block]'), function (button) {
      button.classList.toggle('is-on', button.getAttribute('data-block') === 'check' ? checks : codes);
    });
    var inlineCode = false;
    if (ctx) {
      var walk = ctx.range.commonAncestorContainer;
      if (walk && walk.nodeType === 3) walk = walk.parentNode;
      while (walk && walk !== ctx.box) {
        if (walk.nodeName === 'CODE') { inlineCode = true; break; }
        walk = walk.parentNode;
      }
    }
    Array.prototype.forEach.call(richBar.querySelectorAll('[data-code]'), function (button) {
      button.classList.toggle('is-on', inlineCode);
    });
    var label = richBar.querySelector('[data-type] .bd-rich__label');
    if (label) label.textContent = ctx ? richTypeName() : 'Normal';
    Array.prototype.forEach.call(richBar.querySelectorAll('[data-colour]'), function (swatch) {
      var host = ctx ? richHost(ctx.range, ctx.box, 'color') : null;
      var value = host ? (host.style.getPropertyValue('color') || '') : '';
      if (value === 'inherit') value = '';
      swatch.classList.toggle('is-on', !!ctx && swatch.getAttribute('data-colour') === value);
    });
    var ink = richBar.querySelector('[data-ink]');
    if (ink) {
      var inkHost = ctx ? richHost(ctx.range, ctx.box, 'color') : null;
      var tone = inkHost ? (inkHost.style.getPropertyValue('color') || '') : '';
      ink.style.setProperty('--tone', tone || 'transparent');
      ink.classList.toggle('is-on', !!tone);
    }
    var block = ctx ? richBlockOf(ctx, ctx.range.startContainer, ctx.range.startOffset) : null;
    var alignNow = '';
    var probe = block;
    while (probe && probe !== ctx.box && !alignNow) {
      alignNow = (probe.style && probe.style.getPropertyValue('text-align')) || '';
      probe = probe.parentNode;
    }
    if (!alignNow && block && window.getComputedStyle) {
      var seen = window.getComputedStyle(block).textAlign || '';
      alignNow = /center|right|justify/.test(seen) ? seen : '';
    }
    alignNow = alignNow === 'start' ? 'left' : (alignNow === 'end' ? 'right' : (alignNow || 'left'));
    Array.prototype.forEach.call(richBar.querySelectorAll('[data-align]'), function (button) {
      button.classList.toggle('is-on', !!ctx && button.getAttribute('data-align') === alignNow);
    });
    var listNow = '';
    if (ctx) {
      var line = richBlockOf(ctx, ctx.range.startContainer, ctx.range.startOffset);
      var holder = line && line.closest ? line.closest('ul,ol') : null;
      if (holder) listNow = holder.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList';
    }
    Array.prototype.forEach.call(richBar.querySelectorAll('[data-list]'), function (button) {
      button.classList.toggle('is-on', !!ctx && button.getAttribute('data-list') === listNow);
    });
  }

  function richFollow() {
    if (!richBar || !richBar.classList.contains('is-on')) return;
    var range = richCtx ? richCtx.range : null;
    if (!range) return;
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    richPlace(rect);
  }

  function richPlace(rect) {
    richBar.style.visibility = 'hidden';
    richBar.classList.add('is-on');
    var width = richBar.offsetWidth;
    var height = richBar.offsetHeight;
    var left = rect.left + rect.width / 2 - width / 2;
    var top = rect.top - height - 10;
    if (top < 8) top = rect.bottom + 10;
    left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    richBar.style.left = Math.round(left) + 'px';
    richBar.style.top = Math.round(top) + 'px';
    richBar.style.visibility = '';
  }

  function richHide() {
    if (!richBar) return;
    richBar.classList.remove('is-on');
    richBar.classList.remove('is-picking');
    richMenuClose();
    richCtx = null;
  }

  function richRefresh() {
    var ctx = richSelection();
    if (ctx) richCtx = ctx;
    if (richBar && richBar.contains(document.activeElement)) { richState(richCtx); return; }
    if (!ctx) { richHide(); return; }
    if (board.planner && !(ctx.box.closest && ctx.box.closest('.bd-cal__quick'))) { richHide(); return; }
    var rect = ctx.range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { richHide(); return; }
    if (!richBar) richBar = buildRichBar();
    var layer = ctx.box.closest ? (ctx.box.closest('.bd-cal__quick') || ctx.box.closest('dialog[open]')) : null;
    if (layer && richBar.parentNode !== layer) layer.appendChild(richBar);
    else if (!layer && richBar.parentNode !== document.body) document.body.appendChild(richBar);
    richPlace(rect);
    var field = richBar.querySelector('.bd-rich__size');
    if (field && document.activeElement !== field) field.value = richSizeNow();
    richState(ctx);
  }

  function onSelectionChange() {
    if (!board.open) { richHide(); return; }
    richRefresh();
  }

  function clearFormatButton(item) {
    var button = node('button', 'bd-item__clear', '');
    button.type = 'button';
    button.title = 'Clear formatting';
    button.setAttribute('data-font', 'clear');
    button.setAttribute('aria-label', 'Clear formatting');
    var glyph = App.ui.icon('restore', 12);
    if (glyph) button.appendChild(glyph);
    else button.textContent = '\u2715';
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      clearFormatting(item);
    });
    return button;
  }

  function fontButton(item, label, dir) {
    var button = node('button', 'bd-item__font', label);
    button.type = 'button';
    button.setAttribute('aria-label', dir > 0 ? 'Bigger text' : 'Smaller text');
    button.setAttribute('data-font', dir > 0 ? 'up' : 'down');
    button.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    button.addEventListener('click', function (event) { event.stopPropagation(); bumpFont(item, dir); });
    return button;
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
          pushUndo('edit');
          entry.done = box.checked;
          row.classList.toggle('is-done', entry.done);
          queueItemSave(item);
          paintKind(item);
          if (item.node) item.node.classList.toggle('is-done', planDoneOf(item));
        });
        var text = node('input', 'bd-todo__text');
        text.type = 'text';
        text.value = entry.text || '';
        text.setAttribute('placeholder', 'To-do');
        text.addEventListener('focus', function () { pushUndo('edit'); });
        text.addEventListener('input', function () { entry.text = text.value; queueItemSave(item); });
        text.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          pushUndo('edit');
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
          pushUndo('edit');
          item.data.items.splice(index, 1);
          if (!item.data.items.length) item.data.items.push({ text: '', done: false });
          saveItem(item);
          paint();
          paintKind(item);
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
      paintKind(item);
    });
    wrap.appendChild(add);
    return wrap;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function linkUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      if (!/^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(raw) && raw.indexOf('localhost') !== 0) return '';
      raw = 'https://' + raw;
    }
    try {
      var url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (e) { return ''; }
  }

  function absolute(src, base) {
    try { return new URL(src, base).href; } catch (e) { return ''; }
  }

  function metaFromHtml(html, url) {
    var head = String(html || '').slice(0, 300000);
    var metas = {};
    var re = /<meta\s+([^>]+?)\/?>/gi;
    var m;
    while ((m = re.exec(head))) {
      var key = (m[1].match(/(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
      var val = (m[1].match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
      if (key && val && !metas[key.toLowerCase()]) metas[key.toLowerCase()] = val;
    }
    var title = metas['og:title'] || metas['twitter:title'] || ((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    var icon = (head.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i) || [''])[0];
    icon = (icon.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    return {
      title: util.decodeEntities(String(title).trim()),
      description: util.decodeEntities((metas['og:description'] || metas['twitter:description'] || metas['description'] || '').trim()),
      image: absolute(metas['og:image:secure_url'] || metas['og:image'] || metas['twitter:image'] || '', url),
      favicon: absolute(icon, url),
      host: hostOf(url),
    };
  }

  function fetchWithTimeout(url, ms) {
    if (typeof AbortController !== 'function') return fetch(url);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal }).then(function (res) { clearTimeout(timer); return res; }, function (err) { clearTimeout(timer); throw err; });
  }

  function unfurlDirect(url) {
    return fetchWithTimeout(url, 8000).then(function (res) {
      if (!res || !res.ok) throw new Error('bad response');
      return res.text();
    }).then(function (html) {
      var meta = metaFromHtml(html, url);
      if (!meta.title && !meta.image && !meta.description) throw new Error('no metadata');
      return meta;
    });
  }

  function unfurlService(url) {
    var api = 'https://api.microlink.io/?meta=true&url=' + encodeURIComponent(url);
    return fetchWithTimeout(api, 10000).then(function (res) { return res.json(); }).then(function (json) {
      var data = json && json.data;
      if (!data) throw new Error('no data');
      return {
        title: data.title || '',
        description: data.description || '',
        image: data.image && data.image.url ? data.image.url : '',
        favicon: data.logo && data.logo.url ? data.logo.url : '',
        host: hostOf(url),
      };
    });
  }

  function unfurl(url) {
    return unfurlDirect(url).catch(function () { return unfurlService(url); });
  }

  function fitLinkCard(item) {
    if (!item.node || !item.node.isConnected) return;
    var wrap = item.node.querySelector('.bd-linkcard');
    var bar = item.node.querySelector('.bd-item__bar');
    if (!wrap) return;
    if (item.data.fitH && Math.abs(item.h - item.data.fitH) > 4) return;
    var kids = wrap.children;
    var need = 0;
    var shown = 0;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].style.display === 'none') continue;
      need += kids[i].offsetHeight;
      shown++;
    }
    need += 7 * Math.max(0, shown - 1) + (bar ? bar.offsetHeight : 26) + 20 + 2;
    var want = clamp(need, 92, 480);
    item.data.fitH = want;
    if (Math.abs(want - item.h) < 4) return;
    item.h = want;
    placeItem(item);
    saveItem(item);
  }

  function linkExt(url) {
    try { return ((new URL(url)).pathname.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase(); } catch (e) { return ''; }
  }

  function youtubeId(url) {
    var parsed;
    try { parsed = new URL(url); } catch (e) { return ''; }
    var host = parsed.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return (parsed.pathname.match(/^\/([\w-]{6,20})/) || ['', ''])[1];
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return '';
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
    return (parsed.pathname.match(/^\/(?:embed|shorts|v|live)\/([\w-]{6,20})/) || ['', ''])[1];
  }

  function vimeoId(url) {
    var parsed;
    try { parsed = new URL(url); } catch (e) { return ''; }
    if (parsed.hostname.replace(/^www\./, '') !== 'vimeo.com') return '';
    return (parsed.pathname.match(/\/(\d{6,})/) || ['', ''])[1];
  }

  function linkMedia(url) {
    var yt = youtubeId(url);
    if (yt) return { media: 'youtube', embed: 'https://www.youtube.com/embed/' + yt, thumb: 'https://i.ytimg.com/vi/' + yt + '/mqdefault.jpg' };
    var vimeo = vimeoId(url);
    if (vimeo) return { media: 'vimeo', embed: 'https://player.vimeo.com/video/' + vimeo, thumb: '' };
    var ext = linkExt(url);
    if (/^(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(ext)) return { media: 'image', src: url };
    if (/^(mp4|webm|mov|m4v|ogv)$/.test(ext)) return { media: 'video', src: url };
    if (/^(mp3|wav|ogg|oga|m4a|flac)$/.test(ext)) return { media: 'audio', src: url };
    if (ext === 'pdf') return { media: 'pdf', src: url };
    return null;
  }

  function linkLocal(url) {
    var host = hostOf(url);
    return {
      url: url,
      title: '',
      description: '',
      image: '',
      favicon: host ? 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(host) : '',
      host: host,
      media: linkMedia(url),
    };
  }

  function linkShot(item, box, src, cls, fallback) {
    if (!src) return null;
    var shot = node('img', cls);
    shot.src = src;
    shot.alt = '';
    shot.setAttribute('referrerpolicy', 'no-referrer');
    shot.setAttribute('loading', 'lazy');
    shot.addEventListener('error', function () {
      if (fallback && shot.getAttribute('src') !== fallback) { shot.src = fallback; return; }
      if (shot.parentNode) shot.parentNode.removeChild(shot);
      fitLinkCard(item);
    });
    box.appendChild(shot);
    return shot;
  }

  function linkEmbedOk() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function linkFrame(media, data, autoplay) {
    var frame = node('iframe', 'bd-linkcard__frame');
    frame.setAttribute('src', media.embed + (autoplay ? '?autoplay=1&rel=0' : ''));
    frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('title', String(data.title || '').trim() || 'Video');
    return frame;
  }

  function linkVideo(item, data, media) {
    var wrap = node('div', 'bd-linkcard__video');
    var play = node('button', 'bd-linkcard__play');
    play.type = 'button';
    var host = data.host || hostOf(data.url);
    play.setAttribute('aria-label', linkEmbedOk() ? 'Play video' : 'Play on ' + host);
    var start = function () {
      if (!linkEmbedOk()) {
        window.open(data.url, '_blank', 'noopener');
        return;
      }
      wrap.textContent = '';
      wrap.classList.add('is-playing');
      wrap.appendChild(linkFrame(media, data, true));
      fitLinkCard(item);
    };
    play.addEventListener('click', function (event) { event.stopPropagation(); start(); });
    var down = null;
    wrap.addEventListener('pointerdown', function (event) { down = { x: event.clientX, y: event.clientY }; });
    wrap.addEventListener('click', function (event) {
      if (event.target === play || play.contains(event.target)) return;
      if (down && Math.abs(event.clientX - down.x) + Math.abs(event.clientY - down.y) > 4) return;
      start();
    });
    linkShot(item, wrap, data.image || media.thumb, 'bd-linkcard__poster', data.image ? media.thumb : '');
    wrap.appendChild(play);
    return wrap;
  }
  function renderLinkCard(item) {
    if (!item.node) return;
    var box = item.node.querySelector('.bd-linkcard__preview');
    if (!box) return;
    box.textContent = '';
    var url = linkUrl(item.data.url);
    if (!url) { box.style.display = 'none'; fitLinkCard(item); return; }
    box.style.display = '';
    var data = item.data.link && item.data.link.url === url ? item.data.link : null;
    if (!data) {
      box.appendChild(node('span', 'bd-linkcard__status', 'Reading link...'));
      fitLinkCard(item);
      return;
    }
    var media = data.media || linkMedia(url);
    if (media && media.media === 'image') {
      linkShot(item, box, data.image || media.src, 'bd-linkcard__shot', '');
    } else if (media && (media.media === 'video' || media.media === 'audio')) {
      var player = node(media.media === 'audio' ? 'audio' : 'video', 'bd-linkcard__player');
      player.setAttribute('controls', '');
      player.setAttribute('preload', 'metadata');
      player.setAttribute('src', media.src);
      box.appendChild(player);
    } else if (media && media.media === 'pdf') {
      var page = node('iframe', 'bd-linkcard__frame');
      page.setAttribute('src', media.src);
      page.setAttribute('loading', 'lazy');
      page.setAttribute('title', data.host || hostOf(url));
      box.appendChild(page);
    } else if (media && (media.media === 'youtube' || media.media === 'vimeo')) {
      box.appendChild(linkVideo(item, data, media));
    } else if (data.image) {
      linkShot(item, box, data.image, 'bd-linkcard__shot', media && media.thumb ? media.thumb : '');
    }
    var row = node('div', 'bd-linkcard__row');
    var glyph = node('span', 'bd-linkcard__glyph');
    glyph.appendChild(App.ui.icon('link', 13));
    if (data.favicon) {
      var icon = node('img', 'bd-linkcard__icon');
      icon.src = data.favicon;
      icon.alt = '';
      icon.setAttribute('referrerpolicy', 'no-referrer');
      icon.addEventListener('error', function () { if (icon.parentNode) icon.parentNode.replaceChild(glyph, icon); });
      row.appendChild(icon);
    } else {
      row.appendChild(glyph);
    }
    row.appendChild(node('span', 'bd-linkcard__host', data.host || hostOf(url)));
    box.appendChild(row);
    var name = String(data.title || '').trim();
    if (name) box.appendChild(node('span', 'bd-linkcard__name', name));
    else if (!media) {
      // Without a page title the host is already on the row above, so the second line is the path.
      var path = String(url || '').replace(/^[a-z]+:\/\//i, '').replace(/^[^/]+\/?/i, '').replace(/[?#].*$/, '');
      if (path) box.appendChild(node('span', 'bd-linkcard__name', '/' + path));
    }
    if (data.description) box.appendChild(node('p', 'bd-linkcard__desc', data.description));
    if (data.failed) box.appendChild(node('span', 'bd-linkcard__status', 'No preview available for this page'));
    fitLinkCard(item);
  }

  function unfurlLink(item) {
    var url = linkUrl(item.data.url);
    if (!url || !item.node) return;
    var known = item.data.link;
    if (known && known.url === url && !known.failed) { renderLinkCard(item); return; }
    if (item.data.linkBusy === url) return;
    var local = linkLocal(url);
    item.data.link = local;
    saveItem(item);
    renderLinkCard(item);
    if (local.media && local.media.media !== 'youtube' && local.media.media !== 'vimeo') return;
    item.data.linkBusy = url;
    unfurl(url).then(function (meta) {
      if (item.data.linkBusy !== url) return;
      item.data.linkBusy = '';
      var link = item.data.link && item.data.link.url === url ? item.data.link : local;
      link.title = meta.title;
      link.description = meta.description;
      link.image = meta.image;
      link.favicon = meta.favicon || link.favicon;
      link.host = meta.host || link.host;
      link.failed = false;
      saveItem(item);
      renderLinkCard(item);
    }).catch(function () {
      if (item.data.linkBusy !== url) return;
      item.data.linkBusy = '';
      if (!item.data.link || item.data.link.url !== url) return;
      if (!item.data.link.media) item.data.link.failed = true;
      saveItem(item);
      renderLinkCard(item);
    });
  }

  function linkBody(item) {
    var wrap = node('div', 'bd-linkcard');
    wrap.appendChild(field(item, 'url', 'input', 'bd-url', 'Paste a link'));
    wrap.appendChild(node('div', 'bd-linkcard__preview'));
    var open = node('a', 'bd-linkcard__open', 'Open link');
    open.setAttribute('data-board-nodrag', '1');
    open.setAttribute('rel', 'noreferrer noopener');
    open.setAttribute('target', '_blank');
    var queue = util.debounce(function () { unfurlLink(item); }, 700);
    function sync() {
      var url = linkUrl(item.data.url);
      open.setAttribute('href', url || '#');
      open.style.display = url ? '' : 'none';
      renderLinkCard(item);
      if (url && (!item.data.link || item.data.link.url !== url)) queue();
    }
    item.data.syncLink = sync;
    sync();
    wrap.appendChild(open);
    return wrap;
  }

  function fileLoad(data) {
    return function () {
      return Promise.resolve(App.db.getFileBlob(data.fileId)).then(function (res) { return res ? res.blob : null; });
    };
  }

  function filePreviewKind(data) {
    var name = String(data.filename || '');
    var ext = (name.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    var mime = String(data.mime || '').toLowerCase();
    if (mime.indexOf('image/') === 0 || /^(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/.test(ext)) return 'image';
    if (mime.indexOf('video/') === 0 || /^(mp4|webm|mov|m4v|ogv)$/.test(ext)) return 'video';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (mime.indexOf('text/plain') === 0 || /^(txt|md|log)$/.test(ext)) return 'text';
    return '';
  }

  function fileTile(data) {
    var name = String(data.filename || '');
    var ext = (name.match(/\.([a-z0-9]+)$/i) || ['', ''])[1];
    var tile = node('div', 'bd-filetile');
    tile.appendChild(node('span', 'bd-filetile__ext', ext ? ext.toUpperCase().slice(0, 4) : 'FILE'));
    tile.appendChild(node('span', 'bd-filetile__name', name || 'File'));
    return tile;
  }

  function downloadItem(item) {
    var data = item.data || {};
    var name = data.filename || data.title || 'download';
    function save(href, revoke) {
      var link = document.createElement('a');
      link.href = href;
      link.download = name;
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 5000);
      util.toast('Downloading ' + name);
    }
    if (data.src) { save(data.src, false); return; }
    if (!data.fileId) { util.toast('This card holds no file'); return; }
    App.db.getFileBlob(data.fileId).then(function (row) {
      if (!row || !row.blob) { util.toast('Could not read that file'); return; }
      save(URL.createObjectURL(row.blob), true);
    }).catch(function () { util.toast('Could not read that file'); });
  }

  function storeBoardFile(item, file) {
    return App.db.addFile(BOARD_ID, null, file.name || 'file', file.type || 'application/octet-stream', file).then(function (row) {
      item.data.fileId = row.id;
      item.data.filename = row.filename;
      item.data.mime = row.mime_type;
      item.data.size = row.size;
      saveItem(item);
      repaintBody(item);
      paintKind(item);
      if (board.planner) paintPlanner();
      if (filePreviewKind(item.data) === 'image') {
        util.imageThumb(file, 480).then(function (thumb) {
          if (!thumb) return;
          item.data.thumb = thumb;
          saveItem(item);
          repaintBody(item);
          if (board.planner) paintPlanner();
        });
      }
      return item;
    });
  }

  function dropFiles(files, clientX, clientY) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var point = canvasPoint(clientX, clientY);
    list.forEach(function (file, index) {
      var item = addItem('image', {
        at: {
          x: Math.round(point.x - SIZES.image[0] / 2 + index * 24),
          y: Math.round(point.y - SIZES.image[1] / 2 + index * 24),
        },
        data: {
          name: file.name || 'File',
          filename: file.name || 'file',
          mime: file.type || 'application/octet-stream',
          size: file.size || 0,
        },
      });
      storeBoardFile(item, file);
    });
    util.toast(list.length === 1 ? 'Added \u201c' + list[0].name + '\u201d to the board' : 'Added ' + list.length + ' files to the board');
  }

  function thumbPicture(item) {
    var data = item.data || {};
    var img = node('img', 'bd-image__img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = data.name || data.filename || '';
    img.src = data.thumb;
    return img;
  }

  // A card without a thumbnail draws its picture and quietly makes one for the next paint.
  function warmThumb(item) {
    if (item.thumbBusy || item.thumbTried || !item.data) return;
    var data = item.data;
    if (data.thumb) return;
    if (!data.fileId && !data.src) return;
    if (data.fileId && filePreviewKind(data) !== 'image') return;
    item.thumbBusy = true;
    var source = data.fileId
      ? App.db.getFileBlob(data.fileId).then(function (res) { return res && res.blob ? res.blob : null; })
      : Promise.resolve(data.src);
    source.then(function (given) {
      if (!given) return '';
      return util.imageThumb(given, 480);
    }).then(function (thumb) {
      item.thumbBusy = false;
      if (!thumb) { item.thumbTried = true; return; }
      data.thumb = thumb;
      saveItem(item);
      repaintBody(item);
      if (board.planner) paintPlanner();
    }, function () { item.thumbBusy = false; item.thumbTried = true; });
  }

  function imageBody(item) {
    var wrap = node('div', 'bd-image');
    var data = item.data || {};
    if (data.fileId) {
      if (data.thumb && filePreviewKind(data) === 'image') {
        wrap.appendChild(thumbPicture(item));
        return wrap;
      }
      warmThumb(item);
      var shown = filePreviewKind(data);
      if (shown && App.ui.filePreviewContent) {
        var classes = { pdfChrome: false };
        if (shown === 'image') classes.image = 'bd-image__img';
        else if (shown === 'video') classes.video = 'bd-file__video';
        else if (shown === 'pdf') classes.pdf = 'bd-file__pdf';
        else classes.doc = 'bd-file__doc';
        var holder = App.ui.filePreviewContent(filePreview(data), fileLoad(data), classes);
        if (holder) {
          wrap.appendChild(holder);
          return wrap;
        }
      }
      wrap.appendChild(fileTile(data));
      return wrap;
    }
    if (data.src) {
      if (data.thumb) {
        wrap.appendChild(thumbPicture(item));
        return wrap;
      }
      warmThumb(item);
      var img = node('img', 'bd-image__img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = data.src;
      img.alt = data.name || '';
      wrap.appendChild(img);
      return wrap;
    }
    var empty = node('div', 'bd-image__empty');
    empty.appendChild(node('span', 'bd-image__glyph', 'Any file'));
    var pick = node('button', 'btn btn--ghost', 'Choose file');
    pick.type = 'button';
    pick.addEventListener('click', function (event) {
      event.stopPropagation();
      var input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        util.toast('Adding ' + file.name + '\u2026');
        storeBoardFile(item, file).then(function () {
          util.toast(file.name + ' is on the board');
        }, function () { util.toast('Could not add that file'); });
      });
      input.click();
    });
    empty.appendChild(pick);
    wrap.appendChild(empty);
    return wrap;
  }

  var TEXT_EXT = ['.txt', '.md', '.markdown', '.json', '.log', '.yml', '.yaml', '.ini', '.xml', '.html', '.css', '.js', '.ts'];

  function filePreview(data) {
    var name = String(data.filename || data.title || '');
    var mime = String(data.mime || '');
    var ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    return {
      kind: 'file',
      title: name,
      id: data.fileId,
      mime: mime,
      image: /^image\//.test(mime),
      video: /^video\//.test(mime),
      audio: /^audio\//.test(mime),
      pdf: mime === 'application/pdf' || ext === '.pdf',
      docx: ext === '.docx' || mime.indexOf('wordprocessingml') !== -1,
      xlsx: ext === '.xlsx' || mime.indexOf('spreadsheetml') !== -1,
      csv: ext === '.csv' || ext === '.tsv',
      text: /^text\//.test(mime) || TEXT_EXT.indexOf(ext) !== -1,
    };
  }

  function refNote(item) {
    if (item.ref_kind !== 'note' || !item.ref_id) return null;
    var note = null;
    try { note = App.db.getNote(item.ref_id); } catch (e) { note = null; }
    if (!note || typeof note.content !== 'string') return null;
    if (App.crypto && App.crypto.isEnvelope && App.crypto.isEnvelope(note.content)) return null;
    var html = '';
    try { html = util.sanitizeRichHtml(note.content); } catch (e) { html = ''; }
    return { note: note, html: html };
  }

  function refSheet(html) {
    var sheet = node('div', 'bd-ref__note editor__body');
    sheet.setAttribute('contenteditable', 'false');
    sheet.innerHTML = html;
    try {
      util.normalizeCheckboxRows(sheet);
      util.linkifyWikiText(sheet);
    } catch (e) { }
    if (App.ui.hydrateNoteImages) {
      try { App.ui.hydrateNoteImages(sheet); } catch (e) { }
    }
    Array.prototype.forEach.call(sheet.querySelectorAll('input'), function (field) {
      field.disabled = true;
      field.tabIndex = -1;
      field.setAttribute('data-blocked', '1');
    });
    return sheet;
  }

  function refBody(item) {
    var wrap = node('div', 'bd-ref');
    var data = item.data || {};
    var live = refNote(item);
    var glyph = node('span', 'bd-ref__glyph');
    glyph.appendChild(App.ui.icon(item.ref_kind === 'folder' ? 'folder' : item.ref_kind === 'file' ? 'file' : 'note', 16));
    var head = node('div', 'bd-ref__head');
    head.appendChild(glyph);
    head.appendChild(node('span', 'bd-ref__title', (live && live.note.title) || data.title || 'Untitled'));
    wrap.appendChild(head);
    var stage = null;
    if (item.ref_kind === 'file' && data.fileId && App.ui.filePreviewContent) {
      var load = function () {
        return Promise.resolve(App.db.getFileBlob(data.fileId)).then(function (res) { return res ? res.blob : null; });
      };
      var holder = App.ui.filePreviewContent(filePreview(data), load, { pdfChrome: false, pdf: 'bd-file__pdf' });
      if (holder) {
        stage = node('div', 'bd-ref__preview');
        stage.appendChild(holder);
        wrap.appendChild(stage);
      }
    }
    if (!stage) {
      wrap.appendChild(node('span', 'bd-ref__meta', data.meta || ''));
      if (live && live.html) wrap.appendChild(refSheet(live.html));
      else if (data.snippet) wrap.appendChild(node('p', 'bd-ref__snippet', data.snippet));
    }
    wrap.appendChild(node('span', 'bd-ref__badge', 'from ' + (data.workspace || 'notes')));
    return wrap;
  }

  function bodyFor(item) {
    if (item.kind === 'todo') return todoBody(item);
    if (item.kind === 'link') return linkBody(item);
    if (item.kind === 'image') return imageBody(item);
    if (item.kind === 'ref') return refBody(item);
    if (item.kind === 'group') return groupBody(item);
    if (item.kind === 'column') return containerBody(item);
    if (item.kind === 'draw') return drawBody(item);
    if (item.kind === 'table') return tableBody(item);
    if (item.kind === 'comment') return commentBody(item);
    return textArea(item, 'text', 'Start typing...');
  }

  function repaintBody(item) {
    if (!item.node) return;
    var body = item.node.querySelector('.bd-item__body');
    if (!body) return;
    body.textContent = '';
    body.appendChild(bodyFor(item));
    applyReadOnly(item);
    settleChildren();
  }

  function kindLabel(item) {
    if (item.kind === 'ref') return item.ref_kind || 'item';
    if (item.kind === 'column') return 'group';
    if (item.kind === 'draw') return 'draw';
    if (item.kind === 'group') return item.data && item.data.scope === 'workspace' ? 'workspace' : 'folder';
    if (item.kind === 'image') {
      var name = item.data && item.data.filename;
      return name ? (name.match(/\.[a-z0-9]+$/i) || ['file'])[0].slice(1).toLowerCase() : 'file';
    }
    return item.kind;
  }

  function paintKind(item) {
    if (!item.node) return;
    var label = item.node.querySelector('.bd-item__kind');
    if (!label) return;
    var prog = label.querySelector('.bd-item__prog');
    if (prog) label.textContent = '';
    if (label) label.textContent = labelText(item);
    if (prog) {
      prog.textContent = todoProgress(item);
      prog.hidden = !prog.textContent;
      label.appendChild(prog);
    }
  }

  function labelText(item) {
    var title = item.data && item.data.title;
    return title ? title : kindLabel(item);
  }

  function todoProgress(item) {
    if (item.kind !== 'todo' || !item.data) return '';
    var rows = item.data.items || [];
    if (!rows.length) return '';
    var done = 0;
    rows.forEach(function (row) { if (row.done) done++; });
    return done + '/' + rows.length;
  }

  function barLabel(item, kindOnly) {
    var span = node('span', 'bd-item__kind', kindOnly ? kindLabel(item) : labelText(item));
    if (item.kind === 'todo') {
      var prog = node('span', 'bd-item__prog', todoProgress(item));
      if (!prog.textContent) prog.hidden = true;
      span.appendChild(prog);
    }
    if (kindOnly) span.setAttribute('data-kind-only', '1');
    span.title = 'Double-click to rename';
    span.addEventListener('dblclick', function (event) {
      event.preventDefault();
      event.stopPropagation();
      renameCard(item, span);
    });
    return span;
  }

  function renameCard(item, span) {
    if (lockOf(item)) {
      util.toast('Unlock this card to rename it');
      return;
    }
    if (!span && item.node) span = item.node.querySelector('.bd-item__kind');
    if (!span) return;
    if (span.parentNode.querySelector('.bd-item__title')) return;
    if (!item.data) item.data = {};
    var input = node('input', 'bd-item__title');
    input.type = 'text';
    input.value = item.data.title || '';
    input.placeholder = kindLabel(item);
    input.setAttribute('aria-label', 'Rename card');
    var measure = document.createElement('canvas').getContext('2d');
    var grow = function () {
      var style = getComputedStyle(input);
      measure.font = style.fontSize + ' ' + style.fontFamily;
      var gap = parseFloat(style.letterSpacing) || 0;
      var text = (input.value || input.placeholder || '').toUpperCase();
      var wide = measure.measureText(text).width + gap * text.length;
      input.style.width = Math.max(48, Math.ceil(wide) + 18) + 'px';
    };
    input.style.width = Math.max(48, span.offsetWidth + 14) + 'px';
    input.addEventListener('input', grow);
    var closed = false;
    var finish = function (commit) {
      if (closed) return;
      closed = true;
      document.removeEventListener('pointerdown', onClickAway, true);
      var text = input.value.trim();
      if (commit && text !== (item.data.title || '')) {
        pushUndo('rename');
        if (text) item.data.title = text; else delete item.data.title;
        saveItem(item);
      }
      if (input.parentNode) input.parentNode.removeChild(input);
      span.textContent = span.hasAttribute('data-kind-only') ? kindLabel(item) : labelText(item);
      span.style.display = '';
    };
    var onClickAway = function (event) {
      if (!document.contains(input)) {
        finish(false);
        return;
      }
      if (event.target === input || input.contains(event.target)) return;
      finish(true);
    };
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    input.addEventListener('dblclick', function (event) { event.stopPropagation(); });
    input.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', function () { finish(true); });
    span.style.display = 'none';
    span.parentNode.insertBefore(input, span.nextSibling);
    document.addEventListener('pointerdown', onClickAway, true);
  // Pointing anywhere else retires the landing ring at once, so a new block never sits there lit up.
  document.addEventListener('pointerdown', function (event) {
    var fresh = board.planFresh;
    if (!fresh) return;
    var card = event.target && event.target.closest ? event.target.closest('.bd-item') : null;
    if (card && card.getAttribute('data-plan-id') === fresh.id) return;
    board.planFresh = null;
    Array.prototype.forEach.call(document.querySelectorAll('.bd-item.is-fresh'), function (one) {
      one.classList.remove('is-fresh');
    });
  }, true);
    input.focus();
    input.select();
  }

  function paintItem(item) {
    if (item.node && item.node.closest && item.node.closest('.bd-cal')) return;
    var box = node('div', 'bd-item bd-item--' + item.kind);
    if (planDoneOf(item)) box.classList.add('is-done');
    box.setAttribute('data-board-id', item.id);
    var bar = node('div', 'bd-item__bar');
    var planLabel = barLabel(item);
    var planChip = node('span', 'bd-item__plan');
    planChip.hidden = true;
    planLabel.appendChild(planChip);
    bar.appendChild(planLabel);
    var remove = node('button', 'bd-item__x', '\u00d7');
    remove.type = 'button';
    remove.setAttribute('data-board-del', item.id);
    remove.setAttribute('aria-label', 'Remove from board');
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      removeItem(item);
    });
    var tools = node('div', 'bd-item__tools');
    if (item.kind === 'note') {
      var fmt = node('div', 'bd-item__fmt');
      fmt.appendChild(fontButton(item, 'A\u2212', -1));
      fmt.appendChild(fontButton(item, 'A+', 1));
      fmt.appendChild(clearFormatButton(item));
      tools.appendChild(fmt);
      tools.appendChild(node('span', 'bd-item__sep'));
    }
    var planButton = node('button', 'bd-item__plan-btn', '');
    planButton.type = 'button';
    planButton.setAttribute('data-board-plan', item.id);
    planButton.setAttribute('aria-label', 'Add to planner');
    planButton.title = 'Add to planner';
    planButton.appendChild(App.ui.icon('calendar', 14));
    planButton.addEventListener('click', function (event) {
      event.stopPropagation();
      openPlannerAssign(rowsFor(item));
    });
    tools.appendChild(planButton);
    var lock = node('button', 'bd-item__lock', '');
    lock.type = 'button';
    lock.setAttribute('aria-label', 'Lock this card');
    lock.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleLock(item);
    });
    tools.appendChild(lock);
    tools.appendChild(remove);
    bar.appendChild(tools);
    box.appendChild(bar);
    var body = node('div', 'bd-item__body');
    body.appendChild(bodyFor(item));
    box.appendChild(body);
    RESIZE_DIRS.forEach(function (dir) {
      var grip = node('div', 'bd-item__resize bd-item__resize--' + dir);
      grip.setAttribute('data-board-resize', item.id);
      grip.setAttribute('data-dir', dir);
      box.appendChild(grip);
    });
    box.addEventListener('pointerdown', onItemDown);
    item.node = box;
    applyFont(item);
    paintLock(item);
    paintPlan(item);
    placeItem(item);
    board.canvas.appendChild(box);
    if (isChild(item)) attachChild(item);
    if (item.kind === 'link') renderLinkCard(item);
    return box;
  }

  function addItem(kind, payload) {
    if (!(payload && payload.quiet)) pushUndo('add');
    var now = util.nowIso();
    var size = SIZES[kind] || SIZES.note;
    var at = payload && payload.at ? payload.at : centerOfView(board.items.length);
    var data = payload && payload.data ? payload.data : defaultData(kind);
    if (payload && payload.parent) data.parent = payload.parent;
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
      data: data,
      created_at: now,
      updated_at: now,
    };
    board.items.push(item);
    paintItem(item);
    select(item);
    try { App.db.boardAddItem(item); } catch (e) { }
    paintLinks();
    return item;
  }

  function descendantsOf(id) {
    var out = [];
    var queue = [id];
    while (queue.length) {
      childrenOf(queue.shift()).forEach(function (kid) {
        out.push(kid);
        queue.push(kid.id);
      });
    }
    return out;
  }

  var RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var RESIZE_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

  function lockOf(item) {
    return !!(item.data && item.data.locked);
  }

  function paintLock(item) {
    if (!item.node) return;
    var locked = lockOf(item);
    var button = item.node.querySelector('.bd-item__lock');
    var remove = item.node.querySelector('.bd-item__x');
    var grips = item.node.querySelectorAll('.bd-item__resize');
    item.node.classList.toggle('is-locked', locked);
    if (button) {
      button.textContent = '';
      button.appendChild(App.ui.icon(locked ? 'lock' : 'unlock', 12));
      button.setAttribute('aria-label', locked ? 'Unlock this card' : 'Lock this card');
      button.title = locked ? 'Unlock this card' : 'Lock this card';
    }
    if (remove) remove.style.display = locked ? 'none' : '';
    grips.forEach(function (grip) { grip.style.display = locked ? 'none' : ''; });
    applyReadOnly(item);
  }

  function applyReadOnly(item) {
    if (!item.node) return;
    var locked = lockOf(item);
    var body = item.node.querySelector('.bd-item__body');
    if (!body) return;
    body.classList.toggle('is-readonly', locked);
    Array.prototype.forEach.call(body.querySelectorAll('[contenteditable]'), function (el) {
      el.setAttribute('contenteditable', locked ? 'false' : 'true');
    });
    Array.prototype.forEach.call(body.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea'), function (el) {
      if (locked) el.setAttribute('readonly', 'readonly');
      else el.removeAttribute('readonly');
    });
    Array.prototype.forEach.call(body.querySelectorAll('input[type="checkbox"], input[type="radio"], button, select'), function (el) {
      el.disabled = locked || el.getAttribute('data-blocked') === '1';
    });
  }

  function selectedGroup(item) {
    if (board.selectedIds.length > 1 && board.selectedIds.indexOf(item.id) >= 0) {
      return board.selectedIds.map(findItem).filter(Boolean);
    }
    return [item];
  }

  function toggleLock(item) {
    var rows = selectedGroup(item);
    var next = rows.some(function (row) { return !lockOf(row); });
    rows.forEach(function (row) {
      if (!row.data) row.data = {};
      row.data.locked = next;
      saveItem(row);
      paintLock(row);
    });
    if (rows.length > 1) util.toast(rows.length + (next ? ' cards locked' : ' cards unlocked'));
    else util.toast(next ? 'Card locked' : 'Card unlocked');
  }

  function deleteRow(row) {
    containerKids(row.id).forEach(function (kid) { releaseChild(kid, row); });
    if (row.saveTimer) { clearTimeout(row.saveTimer); row.saveTimer = null; }
    if (row.node && row.node.parentNode) row.node.parentNode.removeChild(row.node);
    try { App.db.boardDeleteItem(row.id); } catch (e) { }
  }

  var BIN_MAX = 20;

  function binKey() {
    return 'boardBin.' + BOARD_ID;
  }

  function binSave() {
    var list = board.bin.slice(0, BIN_MAX);
    while (list.length) {
      try { App.prefs.set(binKey(), list); return; } catch (e) { list.pop(); }
    }
    try { App.prefs.set(binKey(), []); } catch (e) { }
  }

  function binLoad() {
    var stored = App.prefs.get(binKey(), []);
    board.bin = Array.isArray(stored)
      ? stored.filter(function (entry) { return entry && Array.isArray(entry.rows); }).slice(0, BIN_MAX)
      : [];
    paintBin();
  }

  function binPush(rows) {
    var keep = rows.filter(Boolean);
    if (!keep.length) return;
    board.bin.unshift({ label: itemLabel(keep[0]) || 'Block', rows: cloneValue(keep) });
    board.bin = board.bin.slice(0, BIN_MAX);
    binSave();
    paintBin();
  }

  function paintBin() {
    if (!board.binButton) return;
    var count = board.binButton.querySelector('.board__bin-count');
    var size = board.bin.length;
    if (count) {
      count.textContent = size > 9 ? '9+' : String(size);
      count.hidden = !size;
    }
    board.binButton.classList.toggle('has-items', !!size);
    board.binButton.title = size ? 'Board trash, ' + size + ' to restore' : 'Board trash is empty';
    board.binButton.setAttribute('aria-label', board.binButton.title);
  }

  function restoreBinEntries(entries) {
    var restore = entries.filter(function (entry) { return entry && board.bin.indexOf(entry) >= 0; });
    if (!restore.length) return;
    pushUndo('restore');
    var blocks = 0;
    restore.forEach(function (entry) {
      entry.rows.forEach(function (row) {
        var copy = cloneValue(row);
        if (findItem(copy.id)) return;
        board.items.push(copy);
        paintItem(copy);
        try { App.db.boardAddItem(copy); } catch (e) { }
      });
      blocks += entry.rows.length;
      var at = board.bin.indexOf(entry);
      if (at >= 0) board.bin.splice(at, 1);
    });
    binSave();
    paintBin();
    paintLinks();
    util.toast(blocks > 1 ? blocks + ' blocks restored' : 'Block restored');
  }

  function binBlocks(entries) {
    var total = 0;
    entries.forEach(function (entry) { total += entry.rows.length; });
    return total;
  }

  function binPurge(entries, done) {
    var keep = entries.filter(function (entry) { return entry && board.bin.indexOf(entry) >= 0; });
    if (!keep.length) return;
    var blocks = binBlocks(keep);
    App.ui.confirm({
      title: blocks > 1 ? 'Delete ' + blocks + ' blocks for good?' : 'Delete this block for good?',
      message: 'Blocks deleted here leave the board trash for good and cannot be restored.',
      confirmLabel: 'Delete permanently',
      cancelLabel: 'Keep',
      danger: true,
    }).then(function (yes) {
      if (!yes) return;
      board.bin = board.bin.filter(function (entry) { return keep.indexOf(entry) < 0; });
      binSave();
      paintBin();
      util.toast(blocks > 1 ? blocks + ' blocks deleted' : 'Block deleted');
      if (done) done();
    });
  }

  function binRow(entry, ctx) {
    var on = ctx.picked.indexOf(entry) >= 0;
    var row = node('div', 'board__bin-row' + (on ? ' is-picked' : ''));
    var check = node('input', 'board__bin-check');
    check.type = 'checkbox';
    check.checked = on;
    check.setAttribute('aria-label', 'Select ' + (entry.label || 'Block'));
    check.addEventListener('click', function (event) { event.stopPropagation(); });
    check.addEventListener('change', function () { ctx.toggle(entry, check.checked); });
    row.appendChild(check);
    var text = node('span', 'board__bin-text');
    text.appendChild(node('span', 'board__bin-name', entry.label || 'Block'));
    text.appendChild(node('span', 'board__bin-meta', entry.rows.length > 1 ? entry.rows.length + ' blocks' : '1 block'));
    row.appendChild(text);
    var back = node('button', 'board__bin-back', 'Restore');
    back.type = 'button';
    back.addEventListener('click', function () {
      restoreBinEntries([entry]);
      ctx.render();
    });
    row.appendChild(back);
    var drop = node('button', 'board__bin-del');
    drop.type = 'button';
    drop.title = 'Delete permanently';
    drop.setAttribute('aria-label', 'Delete ' + (entry.label || 'Block') + ' permanently');
    var glyph = App.ui.icon('trash', 14);
    if (glyph) drop.appendChild(glyph);
    drop.addEventListener('click', function () { binPurge([entry], ctx.render); });
    row.appendChild(drop);
    row.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('button, input')) return;
      ctx.toggle(entry, ctx.picked.indexOf(entry) < 0);
    });
    return row;
  }

  function openBin() {
    var list = node('div', 'board__bin-list');
    var bar = node('div', 'board__bin-bar');
    var allBtn = node('button', 'board__bin-link', 'Select all');
    allBtn.type = 'button';
    var countLabel = node('span', 'board__bin-count-text');
    var restoreBtn = node('button', 'btn btn--sm', 'Restore selected');
    restoreBtn.type = 'button';
    var deleteBtn = node('button', 'btn btn--sm btn--danger', 'Delete permanently\u2026');
    deleteBtn.type = 'button';
    bar.appendChild(allBtn);
    bar.appendChild(countLabel);
    bar.appendChild(restoreBtn);
    bar.appendChild(deleteBtn);

    var ctx = { picked: [] };
    ctx.toggle = function (entry, on) {
      var at = ctx.picked.indexOf(entry);
      if (on && at < 0) ctx.picked.push(entry);
      else if (!on && at >= 0) ctx.picked.splice(at, 1);
      paint();
    };
    ctx.render = function () { paint(); };

    function paint() {
      ctx.picked = ctx.picked.filter(function (entry) { return board.bin.indexOf(entry) >= 0; });
      var empty = !board.bin.length;
      var count = ctx.picked.length;
      list.textContent = '';
      bar.hidden = empty;
      allBtn.hidden = empty;
      restoreBtn.hidden = !count;
      deleteBtn.hidden = !count;
      allBtn.textContent = !empty && count === board.bin.length ? 'Clear selection' : 'Select all';
      countLabel.textContent = count
        ? count + ' of ' + board.bin.length + ' selected'
        : board.bin.length + ' in the trash';
      restoreBtn.textContent = count > 1 ? 'Restore ' + count + ' selected' : 'Restore selected';
      deleteBtn.textContent = count > 1 ? 'Delete ' + count + ' permanently\u2026' : 'Delete permanently\u2026';
      if (empty) {
        list.appendChild(node('p', 'board__bin-empty', 'Nothing in the board trash.'));
        return;
      }
      board.bin.forEach(function (entry) { list.appendChild(binRow(entry, ctx)); });
    }

    allBtn.addEventListener('click', function () {
      ctx.picked = ctx.picked.length === board.bin.length ? [] : board.bin.slice();
      paint();
    });
    restoreBtn.addEventListener('click', function () {
      var chosen = ctx.picked.slice();
      ctx.picked = [];
      restoreBinEntries(chosen);
      paint();
    });
    deleteBtn.addEventListener('click', function () {
      binPurge(ctx.picked.slice(), function () {
        ctx.picked = [];
        paint();
      });
    });

    paint();

    var host = node('div', 'board__bin-wrap');
    host.appendChild(bar);
    host.appendChild(list);

    var full = board.bin.length > 0;
    App.ui.dialog({
      title: 'Board trash',
      icon: 'trash',
      body: host,
      wide: true,
      danger: full,
      confirmLabel: full ? 'Empty trash\u2026' : 'Close',
      cancelLabel: 'Close',
    }).then(function (yes) {
      if (!yes || !board.bin.length) return;
      board.bin = [];
      binSave();
      paintBin();
      util.toast('Board trash emptied');
    });
  }

  function askRemove(rows, run) {
    var count = rows.length;
    rows.forEach(function (row) { count += descendantsOf(row.id).length; });
    App.ui.confirm({
      title: count > 1 ? 'Remove ' + count + ' blocks?' : 'Remove this block?',
      message: count > 1
        ? 'They go to the board trash, so you can put them back.'
        : 'It goes to the board trash, so you can put it back.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      danger: true,
    }).then(function (yes) { if (yes) run(); });
  }

  function removeItem(item, ask) {
    if (lockOf(item)) { util.toast('Unlock this card first'); return; }
    var run = function () {
      pushUndo('remove');
      containerKids(item.id).forEach(function (kid) { releaseChild(kid, item); });
      var doomed = [item].concat(descendantsOf(item.id)).filter(function (row) { return !lockOf(row); });
      binPush(doomed);
      doomed.forEach(deleteRow);
      board.items = board.items.filter(function (other) { return doomed.indexOf(other) < 0; });
      setSelection([], null);
      paintLinks();
    };
    if (ask === false) { run(); return; }
    askRemove([item], run);
  }

  function removeSelected(ask) {
    var rows = board.selectedIds.map(findItem).filter(Boolean);
    if (rows.length < 2) { if (rows.length) removeItem(rows[0], ask); return; }
    var free = [];
    var doomed = [];
    rows.forEach(function (row) {
      if (lockOf(row)) return;
      free.push(row);
      [row].concat(descendantsOf(row.id)).forEach(function (child) {
        if (!lockOf(child) && doomed.indexOf(child) < 0) doomed.push(child);
      });
    });
    if (!free.length) { util.toast(rows.length > 1 ? 'Unlock these cards first' : 'Unlock this card first'); return; }
    var run = function () {
      pushUndo('remove');
      binPush(doomed);
      doomed.forEach(deleteRow);
      board.items = board.items.filter(function (other) { return doomed.indexOf(other) < 0; });
      setSelection([], null);
      paintLinks();
      if (free.length < rows.length) util.toast('Locked cards were kept');
    };
    if (ask === false) { run(); return; }
    askRemove(free, run);
  }

  function binButton() {
    var bin = node('button', 'board__bin');
    bin.type = 'button';
    bin.title = 'Board trash is empty';
    bin.setAttribute('aria-label', bin.title);
    bin.addEventListener('click', openBin);
    var glyph = App.ui.icon('trash', 16);
    if (glyph) bin.appendChild(glyph);
    var count = node('span', 'board__bin-count');
    count.hidden = true;
    bin.appendChild(count);
    return bin;
  }

  function onItemDown(event) {
    if (board.space) return;
    if (event.button !== 0) return;
    var target = event.target;
    if (target.closest && target.closest('input, textarea, [contenteditable="true"], a, button')) return;
    var box = target.closest ? target.closest('.bd-item') : null;
    if (!box) return;
    var item = findItem(box.getAttribute('data-board-id'));
    if (!item) return;
    if (box.classList.contains('bd-item--column') && !(target.closest && (target.closest('.bd-item__bar') || target.closest('.bd-item__resize')))) return;
    var multi = board.selectedIds.length > 1 && board.selectedIds.indexOf(item.id) >= 0;
    if (!multi) select(item);
    if (lockOf(item) && !multi) return;
    event.stopPropagation();
    var grip = target.closest('.bd-item__resize');
    var dir = grip ? (grip.getAttribute('data-dir') || 'se') : '';
    var rows = null;
    if (!grip) {
      rows = (multi ? board.selectedIds.map(findItem) : [item]).filter(function (row) {
        return row && !lockOf(row);
      });
      var held = rows.filter(function (row) { return row.kind === 'column'; }).map(function (row) { return row.id; });
      if (held.length) {
        rows = rows.filter(function (row) {
          return !(row.data && row.data.parent && held.indexOf(row.data.parent) >= 0);
        });
      }
      if (!rows.length) return;
      rows.forEach(function (row) {
        var home = containerOf(row);
        row.home = home && home.grid && row.node ? { left: row.node.offsetLeft, top: row.node.offsetTop } : null;
        row.homeIndex = home && home.grid && row.node ? gridSlots(home).indexOf(row.node) : -1;
        row.homeCell = home && home.grid ? cellOf(home, row) : null;
        if (home && home.grid && row.node) liftChild(row, home, row.homeCell);
      });
      clearDropSlot();
      pushUndo('move');
      rows.forEach(function (row) { detachChild(row, event.clientX, event.clientY); });
      lift.forEach(function (entry) { layoutContainer(entry.container, null); });
    }
    if (grip && isChild(item) && item.node) {
      var boxed = item.node.getBoundingClientRect();
      var unit = board.view.z || 1;
      if (boxed.width) item.w = Math.round(boxed.width / unit);
      if (boxed.height) item.h = Math.round(boxed.height / unit);
    }
    var start = { x: event.clientX, y: event.clientY, w: item.w, h: item.h, ix: item.x, iy: item.y };
    if (grip) pushUndo('resize');
    if (grip) {
      board.resize = { item: item, start: start, dir: dir };
      if (board.stage) board.stage.style.cursor = RESIZE_CURSOR[dir] || 'nwse-resize';
    } else {
      board.drag = {
        item: item,
        start: start,
        rows: rows.map(function (row) { return { item: row, x: row.x, y: row.y, home: row.home || null, homeIndex: row.homeIndex, homeCell: row.homeCell || null, span: row.data && row.data.span ? row.data.span : 1, rows: row.data && row.data.rows ? row.data.rows : 3 }; }),
      };
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
  }

  function onStageDown(event) {
    cancelViewGlide();
    if (event.button !== 0) return;
    commitEdits(event);
    var target = event.target;
    var card = target.closest ? target.closest('.bd-item') : null;
    var handle = target.closest ? target.closest('.bd-item__bar') : null;
    if (target.closest && target.closest('.board__rail, .board__picker, .board__mode')) return;
    if (board.space) {
      startPan(event, true);
      return;
    }
    if (board.moving) {
      var spot = canvasPoint(event.clientX, event.clientY);
      dropMarkMove(spot.x, spot.y);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (board.marking && !(target.closest && target.closest('.bd-mark'))) {
      var at = canvasPoint(event.clientX, event.clientY);
      var placed = addMark(at.x, at.y);
      setMarking(false);
      markEdit(placed);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (card && (!card.classList.contains('bd-item--column') || handle)) return;
    if (board.mode === 'select') {
      startMarquee(event);
      return;
    }
    startPan(event);
  }

  function beginPan(x, y, keepSelection) {
    if (!keepSelection) select(null);
    board.pan = { x: x, y: y, vx: board.view.x, vy: board.view.y };
    board.stage.classList.add('is-panning');
    return board.pan;
  }

  function startPan(event, keepSelection) {
    beginPan(event.clientX, event.clientY, keepSelection);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
  }

  function endMarquee() {
    var done = board.marquee;
    if (!done) return null;
    if (done.node && done.node.parentNode) done.node.parentNode.removeChild(done.node);
    board.marquee = null;
    return done;
  }

  function setSpaceHeld(on) {
    board.space = !!on;
    if (board.stage) board.stage.classList.toggle('is-space', !!on);
  }

  function releasePointer() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    board.pan = null;
    if (board.stage) board.stage.classList.remove('is-panning');
    if (board.marquee) endMarquee();
    if (board.resize) {
      if (board.stage) board.stage.style.cursor = '';
      saveItem(board.resize.item);
      board.resize = null;
    }
    if (board.drag) {
      var rows = board.drag.rows;
      clearSwap();
      clearDropSlot();
      board.drag = null;
      rows.forEach(function (row) { placeItem(row.item); });
      clearLift();
      settleChildren();
      paintLinks();
    }
    setSpaceHeld(false);
  }

  function startMarquee(event) {
    var box = node('div', 'board__marquee');
    var rect = board.stage.getBoundingClientRect();
    box.style.left = (event.clientX - rect.left) + 'px';
    box.style.top = (event.clientY - rect.top) + 'px';
    board.stage.appendChild(box);
    board.marquee = {
      x: event.clientX,
      y: event.clientY,
      base: event.shiftKey || event.metaKey || event.ctrlKey ? board.selectedIds.slice() : [],
      node: box,
      last: null,
    };
    if (!board.marquee.base.length) setSelection([], null);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
  }

  function moveMarquee(event) {
    var m = board.marquee;
    var rect = board.stage.getBoundingClientRect();
    var x1 = Math.min(m.x, event.clientX);
    var y1 = Math.min(m.y, event.clientY);
    var x2 = Math.max(m.x, event.clientX);
    var y2 = Math.max(m.y, event.clientY);
    m.node.style.left = (x1 - rect.left) + 'px';
    m.node.style.top = (y1 - rect.top) + 'px';
    m.node.style.width = (x2 - x1) + 'px';
    m.node.style.height = (y2 - y1) + 'px';
    m.last = { x1: x1, y1: y1, x2: x2, y2: y2 };
    m.pointer = { x: event.clientX, y: event.clientY };
    var ids = m.base.slice();
    board.items.forEach(function (item) {
      var box = itemScreenRect(item);
      var sx = box.x + rect.left;
      var sy = box.y + rect.top;
      if (sx < x2 && sx + box.w > x1 && sy < y2 && sy + box.h > y1 && ids.indexOf(item.id) < 0) ids.push(item.id);
    });
    setSelection(ids, ids[ids.length - 1]);
  }

  function onPointerMove(event) {
    var scale = board.view.z;
    if (board.marquee) { moveMarquee(event); return; }
    if (board.pan) {
      board.view.x = board.pan.vx + (event.clientX - board.pan.x);
      board.view.y = board.pan.vy + (event.clientY - board.pan.y);
      applyView();
      return;
    }
    if (board.drag) {
      var drag = board.drag;
      var dx = (event.clientX - drag.start.x) / scale;
      var dy = (event.clientY - drag.start.y) / scale;
      drag.rows.forEach(function (row) {
        row.item.x = Math.round(row.x + dx);
        row.item.y = Math.round(row.y + dy);
        placeItem(row.item);
      });
      var over = containerUnder(event.clientX, event.clientY, drag.rows);
      var overItem = over ? over.item : null;
      var sib = overItem ? siblingUnder(overItem, event.clientX, event.clientY, drag.rows[0].item) : null;
      if (sib && drag.rows.length === 1 && drag.rows[0].homeCell && sameRowOrCol(drag.rows[0].homeCell, sib.box)) {
        clearDropSlot();
        setSwap(sib.item);
      } else {
        clearSwap();
        if (overItem) showDropSlot(overItem, freeCell(overItem, cellUnder(overItem, event.clientX, event.clientY, drag.rows[0].span, drag.rows[0].rows), drag.rows[0].item));
        else clearDropSlot();
      }
      paintLinks();
      return;
    }
    if (board.resize) {
      var size = board.resize;
      var dir = size.dir || 'se';
      var west = dir.indexOf('w') >= 0;
      var north = dir.indexOf('n') >= 0;
      if (isChild(size.item)) {
        var parent = containerOf(size.item);
        var geom = parent ? containerGeom(parent) : { cols: 1, colW: 200 };
        var stepX = geom.colW + CONTAINER_GAP;
        var stepY = CONTAINER_ROW + CONTAINER_GAP;
        var baseSpan = Math.max(1, Math.min(geom.cols, Math.round((size.start.w + CONTAINER_GAP) / stepX)));
        var baseRows = Math.max(1, Math.round((size.start.h + CONTAINER_GAP) / stepY));
        var dCol = Math.round((event.clientX - size.start.x) / scale / stepX) * (west ? -1 : 1);
        var dRow = Math.round((event.clientY - size.start.y) / scale / stepY) * (north ? -1 : 1);
        var span = Math.max(1, Math.min(geom.cols, baseSpan + dCol));
        var count = Math.max(1, baseRows + dRow);
        size.item.data.span = span;
        size.item.data.rows = count;
        size.item.w = Math.round(span * geom.colW + CONTAINER_GAP * (span - 1));
        size.item.h = Math.round(count * CONTAINER_ROW + CONTAINER_GAP * (count - 1));
        if (parent) layoutContainer(parent, null);
      } else {
        var dx = (event.clientX - size.start.x) / scale;
        var dy = (event.clientY - size.start.y) / scale;
        var growX = dir.indexOf('e') >= 0 ? dx : west ? -dx : 0;
        var growY = dir.indexOf('s') >= 0 ? dy : north ? -dy : 0;
        var w = Math.max(170, Math.round(size.start.w + growX));
        var h = Math.max(110, Math.round(size.start.h + growY));
        size.item.w = w;
        size.item.h = h;
        size.item.x = Math.round(size.start.ix + (west ? size.start.w - w : 0));
        size.item.y = Math.round(size.start.iy + (north ? size.start.h - h : 0));
        placeItem(size.item);
        if (size.item.kind === 'column') layoutContainer(size.item, null);
      }
      paintLinks();
    }
  }

  function onPointerUp(event) {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    board.stage.classList.remove('is-panning');
    if (board.resize) board.stage.style.cursor = '';
    if (board.drag) {
      var dragged = board.drag.rows;
      var over = containerUnder(event.clientX, event.clientY, dragged);
      var overItem = over ? over.item : null;
      var swap = board.swap && dragged.length === 1 ? board.swap.target : null;
      clearSwap();
      clearDropSlot();
      dragged.forEach(function (row) {
        if (swap && row.item !== swap) {
          swapCells(row.item, swap, containerOf(swap));
        } else if (overItem) {
          placeChild(row.item, overItem, event.clientX, event.clientY);
        } else if (isChild(row.item)) {
          releaseChild(row.item, null);
        }
        saveItem(row.item);
      });
      clearLift();
      board.drag = null;
      settleChildren();
      paintLinks();
    }
    if (board.resize) { saveItem(board.resize.item); board.resize = null; }
    if (board.marquee) endMarquee();
    if (board.pan) {
      var travelled = Math.abs(event.clientX - board.pan.x) + Math.abs(event.clientY - board.pan.y);
      if (travelled < 5) richHide();
    }
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
    if (drawPad) return;
    if (!board.open) return;
    var editing = event.target && event.target.closest && event.target.closest('input, textarea, [contenteditable="true"]');
    if (event.key === 'Escape') {
      // A dialog owns Escape while it is up, so it does not also close the board behind it.
      if (document.querySelector('dialog[open]')) return;
      if (board.picker) { closePicker(); return; }
      if (editing) { event.target.blur(); return; }
      if (board.moving) { disarmMarkMove(); return; }
      if (board.marking) { setMarking(false); return; }
      if (board.railMarks) { openMarks(false); return; }
      if (board.selectedIds.length) { event.preventDefault(); setSelection([], null); return; }
      event.preventDefault();
      close();
      return;
    }
    if (event.code === 'Space' && !editing) {
      setSpaceHeld(true);
      var live = endMarquee();
      if (live) {
        var at = live.pointer || { x: live.x, y: live.y };
        beginPan(at.x, at.y, true);
      }
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
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      if (editing) return;
      event.preventDefault();
      undoLast();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y')) {
      if (editing) return;
      event.preventDefault();
      redoLast();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      if (editing) return;
      event.preventDefault();
      redoLast();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'd' || event.key === 'D')) {
      if (editing) return;
      var copy = board.selectedId ? findItem(board.selectedId) : null;
      if (copy) {
        event.preventDefault();
        duplicateItem(copy);
      }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !editing && board.selectedIds.length) {
      event.preventDefault();
      removeSelected();
    }
  }

  function onKeyUp(event) {
    if (event.code !== 'Space') return;
    setSpaceHeld(false);
  }

  var MARK_ICONS = ['pin', 'star', 'flag', 'heart', 'bolt', 'check', 'warning', 'info', 'sun', 'moon', 'cloud', 'shield', 'gear', 'eye', 'search', 'document', 'link', 'folder', 'chart', 'note'];

  function findMark(id) {
    var list = board.marks || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function markData(list) {
    return (list || []).map(function (mark) {
      return { id: mark.id, x: mark.x, y: mark.y, name: mark.name, desc: mark.desc || '', icon: mark.icon || 'pin' };
    });
  }

  function flushBoardState() {
    if (!board.open) return;
    if (board.markTimer) saveMarks(true);
    if (board.viewTimer) {
      clearTimeout(board.viewTimer);
      board.viewTimer = null;
      try { App.db.boardSaveView(BOARD_ID, board.view.x, board.view.y, board.view.z); } catch (e) { }
    }
  }

  function markSaveFailed(err) {
    console.error('landmark save failed', err);
    util.toast('Could not save the landmarks', 'error');
  }

  function saveMarks(now) {
    if (board.markTimer) clearTimeout(board.markTimer);
    var flush = function () {
      board.markTimer = null;
      var rows = JSON.stringify(markData(board.marks));
      var saved = null;
      try { saved = App.db.boardSaveMarks(BOARD_ID, rows); } catch (e) { }
      if (saved && typeof saved.catch === 'function') saved.catch(markSaveFailed);
      else if (!saved) markSaveFailed();
    };
    if (now) { flush(); return; }
    board.markTimer = setTimeout(flush, 260);
  }

  function addMark(x, y, name, icon, desc) {
    if (!board.marks) board.marks = [];
    pushUndo('landmark');
    var mark = {
      id: util.uuid(),
      x: Math.round(x),
      y: Math.round(y),
      name: name || 'Landmark ' + (board.marks.length + 1),
      desc: desc || '',
      icon: icon || 'pin',
    };
    board.marks.push(mark);
    paintMarks();
    saveMarks(true);
    renderMarkList();
    return mark;
  }

  function removeMark(mark) {
    var at = (board.marks || []).indexOf(mark);
    if (at < 0) return;
    pushUndo('landmark');
    board.marks.splice(at, 1);
    paintMarks();
    saveMarks(true);
    renderMarkList();
    util.toast('Landmark removed');
  }

  function scaleMarks() {
    var unit = board.view.z || 1;
    var flat = Math.abs(unit - 1) < 0.001;
    (board.marks || []).forEach(function (mark) {
      if (!mark.node || !mark.node.isConnected) return;
      mark.node.style.transform = flat ? '' : 'scale(' + (1 / unit) + ')';
    });
  }

  function paintMarks() {
    if (!board.canvas) return;
    var live = {};
    board.marks.forEach(function (mark) {
      if (mark.node && mark.node.isConnected) live[mark.id] = true;
    });
    Array.prototype.slice.call(board.canvas.querySelectorAll('.bd-mark')).forEach(function (pin) {
      if (!live[pin.getAttribute('data-mark')]) pin.parentNode.removeChild(pin);
    });
    (board.marks || []).forEach(function (mark) {
      if (!mark.node || !mark.node.isConnected) {
        var pin = node('div', 'bd-mark');
        pin.setAttribute('data-mark', mark.id);
        var head = node('button', 'bd-mark__head');
        head.type = 'button';
        head.setAttribute('aria-label', 'Landmark');
        head.addEventListener('pointerdown', markGrab);
        head.addEventListener('dragstart', stopDrag);
        pin.addEventListener('dragstart', stopDrag);
        head.addEventListener('dblclick', function (event) { event.preventDefault(); markEdit(mark); });
        var text = node('div', 'bd-mark__text');
        var label = node('span', 'bd-mark__name', mark.name);
        label.addEventListener('dblclick', function (event) { event.preventDefault(); event.stopPropagation(); markEdit(mark); });
        text.appendChild(label);
        pin.appendChild(head);
        pin.appendChild(text);
        board.canvas.appendChild(pin);
        mark.node = pin;
        mark.head = head;
        mark.text = text;
        mark.label = label;
      }
      mark.node.setAttribute('data-icon', mark.icon || 'pin');
      mark.node.style.left = mark.x + 'px';
      mark.node.style.top = mark.y + 'px';
      if (mark.head.getAttribute('data-icon') !== (mark.icon || 'pin')) {
        mark.head.textContent = '';
        mark.head.appendChild(App.ui.icon(mark.icon || 'pin', 17));
        mark.head.setAttribute('data-icon', mark.icon || 'pin');
      }
      if (mark.label.textContent !== mark.name) mark.label.textContent = mark.name;
      mark.label.title = mark.name;
    });
    Array.prototype.slice.call(board.canvas.querySelectorAll('.bd-mark')).forEach(function (pin) {
      if (!findMark(pin.getAttribute('data-mark'))) pin.parentNode.removeChild(pin);
    });
    scaleMarks();
    renderMarkList();
  }

  function stopDrag(event) {
    event.preventDefault();
  }

  function markGrab(event) {
    if (event.button !== 0) return;
    var pin = event.currentTarget.parentNode;
    var mark = findMark(pin.getAttribute('data-mark'));
    if (!mark) return;
    event.preventDefault();
    event.stopPropagation();
    var unit = board.view.z || 1;
    var start = { x: event.clientX, y: event.clientY, mx: mark.x, my: mark.y };
    var moved = false;
    var move = function (e) {
      if (!moved && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < 4) return;
      if (!moved) pushUndo('landmark');
      moved = true; disarmMarkMove();
      mark.x = Math.round(start.mx + (e.clientX - start.x) / unit);
      mark.y = Math.round(start.my + (e.clientY - start.y) / unit);
      pin.style.left = mark.x + 'px';
      pin.style.top = mark.y + 'px';
      pin.classList.add('is-dragging');
    };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      pin.classList.remove('is-dragging');
      if (moved) { saveMarks(true); return; }
      armMarkMove(mark);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function markEdit(mark) {
    if (!mark.node || !mark.node.isConnected) return;
    if (mark.node.querySelector('.bd-mark__edit')) return;
    commitEdits(null);
    var input = node('input', 'bd-mark__edit');
    input.type = 'text';
    input.value = mark.name;
    input.setAttribute('aria-label', 'Landmark name');
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    mark.text.style.display = 'none';
    mark.node.appendChild(input);
    input.focus();
    input.select();
    var done = function (keep) {
      if (!input.parentNode) return;
      var value = input.value.trim();
      var changed = !!(keep && value && value !== mark.name);
      if (changed) mark.name = value;
      dropEditor(entry);
      input.parentNode.removeChild(input);
      mark.text.style.display = '';
      paintMarks();
      if (!keep) { renderMarkList(); return; }
      if (board.marks.indexOf(mark) < 0) board.marks.push(mark);
      saveMarks(true);
      renderMarkList();
    };
    var entry = { commit: function () { done(true); }, field: input };
    pushEditor(entry);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); done(true); }
      else if (event.key === 'Escape') { event.preventDefault(); done(false); }
    });
    input.addEventListener('blur', function () { done(true); });
  }

  function moveGhost(event) {
    if (!board.markGhost) return;
    var at = canvasPoint(event.clientX, event.clientY);
    var unit = board.view.z || 1;
    board.markGhost.style.left = at.x + 'px';
    board.markGhost.style.top = at.y + 'px';
    board.markGhost.style.transform = Math.abs(unit - 1) < 0.001 ? '' : 'scale(' + (1 / unit) + ')';
    board.markGhost.style.opacity = '0.6';
  }

  function leaveGhost() {
    if (board.markGhost) board.markGhost.style.opacity = '0';
  }

  function markGhost(show, icon) {
    if (!board.canvas) return;
    if (board.stage) {
      board.stage.removeEventListener('pointermove', moveGhost);
      board.stage.removeEventListener('pointerleave', leaveGhost);
    }
    if (!show) {
      if (board.markGhost && board.markGhost.parentNode) board.markGhost.parentNode.removeChild(board.markGhost);
      board.markGhost = null;
      return;
    }
    if (!board.markGhost) {
      var pin = node('div', 'bd-mark is-ghost');
      var head = node('div', 'bd-mark__head');
      head.appendChild(App.ui.icon(icon || 'pin', 17));
      pin.appendChild(head);
      pin.style.opacity = '0';
      board.canvas.appendChild(pin);
      board.markGhost = pin;
      board.markGhostIcon = icon || 'pin';
    } else if ((icon || 'pin') !== board.markGhostIcon) {
      var liveHead = board.markGhost.firstChild;
      liveHead.textContent = '';
      liveHead.appendChild(App.ui.icon(icon || 'pin', 17));
      board.markGhostIcon = icon || 'pin';
    }
    if (board.stage) {
      board.stage.addEventListener('pointermove', moveGhost);
      board.stage.addEventListener('pointerleave', leaveGhost);
    }
  }

  function pushEditor(entry) {
    if (!board.editors) board.editors = [];
    board.editors.push(entry);
  }

  function dropEditor(entry) {
    if (!board.editors) return;
    var at = board.editors.indexOf(entry);
    if (at >= 0) board.editors.splice(at, 1);
  }

  function commitEdits(event) {
    if (!board.editors || !board.editors.length) return;
    var open = board.editors.slice();
    for (var i = 0; i < open.length; i++) {
      if (event && event.target && open[i].field.contains(event.target)) continue;
      open[i].commit();
    }
  }

  function setMarking(on) {
    board.marking = !!on;
    if (board.marking) disarmMarkMove();
    if (board.stage) board.stage.classList.toggle('is-marking', board.marking);
    if (board.root) board.root.classList.toggle('is-marking', board.marking);
    if (board.marksAdd) board.marksAdd.classList.toggle('is-on', board.marking);
    markGhost(board.marking, 'pin');
    if (board.marking) util.toast('Click the board to drop a landmark. Hold Space to pan');
  }

  function armMarkMove(mark) {
    if (board.moving === mark) { disarmMarkMove(); return; }
    setMarking(false);
    board.moving = mark;
    if (board.stage) board.stage.classList.add('is-moving');
    if (board.root) board.root.classList.add('is-moving');
    if (mark.node && mark.node.isConnected) mark.node.classList.add('is-armed');
    markGhost(true, mark.icon || 'pin');
    util.toast('Click where ' + mark.name + ' should go. Hold Space to pan, Esc to cancel');
  }

  function disarmMarkMove() {
    var mark = board.moving;
    board.moving = null;
    if (mark && mark.node && mark.node.isConnected) mark.node.classList.remove('is-armed');
    if (board.stage) board.stage.classList.remove('is-moving');
    if (board.root) board.root.classList.remove('is-moving');
    if (!board.marking) markGhost(false);
  }

  function dropMarkMove(x, y) {
    var mark = board.moving;
    if (!mark) return;
    pushUndo('landmark');
    mark.x = Math.round(x);
    mark.y = Math.round(y);
    disarmMarkMove();
    paintMarks();
    saveMarks(true);
    util.toast('Landmark moved');
  }

  function openMarks(on) {
    board.railMarks = on !== false;
    if (board.rail) board.rail.classList.toggle('is-marks', board.railMarks);
    if (board.root) board.root.classList.toggle('is-marks', board.railMarks);
    if (!board.railMarks) setMarking(false);
    renderMarkList();
  }

  var PLAN_BOARD = BOARD_ID + ':planner';
  var CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var CAL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CAL_DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  function calPad(value) { return (value < 10 ? '0' : '') + value; }

  function calKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + calPad(d.getMonth() + 1) + '-' + calPad(d.getDate());
  }

  function calMs(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
  }

  function calShort(key) {
    var ms = calMs(key);
    if (ms === null) return '';
    var d = new Date(ms);
    return CAL_MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
  }

  function monthStart(ms) {
    var d = new Date(ms);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function planSpanOf(item, isBoard) {
    var start = planClock(planTimeOf(item, isBoard));
    var end = planClock(planEndOf(item, isBoard));
    if (start === null || end === null || end <= start) return QUICK_HOUR;
    return end - start;
  }

  function planKeysOf(item) {
    if (!item || !item.data) return [];
    var out = [];
    var list = item.data.plans;
    if (Object.prototype.toString.call(list) === '[object Array]') {
      list.forEach(function (key) { if (key && out.indexOf(key) < 0) out.push(key); });
    }
    if (item.data.plan && out.indexOf(item.data.plan) < 0) out.push(item.data.plan);
    if (item.data.planner && out.indexOf(item.data.planner) < 0) out.push(item.data.planner);
    return out;
  }

  function planKeyOf(item) {
    var keys = planKeysOf(item);
    return keys.length ? keys[0] : null;
  }

  var PLAN_REPEAT_UNITS = ['day', 'week', 'month', 'year'];

  function planRepeatOf(item) {
    var rule = item && item.data ? item.data.repeat : null;
    if (!rule || !rule.kind || rule.kind === 'none') return null;
    return rule;
  }

  function planRepeatStart(item) {
    var data = (item && item.data) || {};
    return data.spanFrom || planKeyOf(item) || null;
  }

  // The dialog starts from the stored rule so re-opening a repeated block shows what it will keep doing.
  function planRepeatDraft(item) {
    var saved = planRepeatOf(item);
    if (!saved) return { kind: 'none', every: 1, unit: 'day', days: [], until: '' };
    return { kind: saved.kind, every: saved.every || 1, unit: saved.unit || 'day', days: (saved.days || []).slice(), until: saved.until || '' };
  }

  function planRepeatValue(rule) {
    if (!rule || !rule.kind || rule.kind === 'none') return null;
    if (rule.kind !== 'custom') return { kind: rule.kind, every: 1, until: String(rule.until || '') };
    return {
      kind: 'custom',
      every: Math.max(1, Math.round(Number(rule.every) || 1)),
      unit: PLAN_REPEAT_UNITS.indexOf(rule.unit) >= 0 ? rule.unit : 'day',
      days: (rule.days || []).slice().sort(),
      until: String(rule.until || ''),
    };
  }

  function planWeekdayOf(key) {
    var ms = calMs(key);
    return ms === null ? null : new Date(ms).getDay();
  }

  function planMonthOf(key) {
    var ms = calMs(key);
    return ms === null ? null : new Date(ms).getFullYear() * 12 + new Date(ms).getMonth();
  }

  function planOrdinal(n) {
    return ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] || n + 'th';
  }

  function planLongDay(key) {
    var ms = calMs(key);
    if (ms === null) return '';
    try { return new Date(ms).toLocaleDateString([], { weekday: 'long' }); } catch (e) { return CAL_DAYS[new Date(ms).getDay()]; }
  }

  function planLongMonth(key) {
    var ms = calMs(key);
    if (ms === null) return '';
    try { return new Date(ms).toLocaleDateString([], { month: 'long', day: 'numeric' }); } catch (e) { return calShort(key); }
  }

  // The same sentence names the rule in the menu, on the button and in the block chip, so the three never drift apart.
  function planRepeatText(rule, startKey) {
    var kind = rule && rule.kind ? rule.kind : 'none';
    var every = Math.max(1, Math.round(Number(rule && rule.every) || 1));
    var unit = rule && rule.unit ? rule.unit : 'day';
    var many = function (n, one) { return n > 1 ? 'Every ' + n + ' ' + one + 's' : 'Every ' + one; };
    if (kind === 'none') return 'Does not repeat';
    if (kind === 'daily') return every > 1 ? many(every, 'day') : 'Daily';
    if (kind === 'weekday') return 'Every weekday (Monday to Friday)';
    if (kind === 'weekly') return every > 1 ? many(every, 'week') + ' on ' + planLongDay(startKey) : 'Weekly on ' + planLongDay(startKey);
    if (kind === 'monthly') {
      var ms = calMs(startKey);
      if (ms === null) return 'Monthly';
      return 'Monthly on the ' + planOrdinal(Math.ceil(new Date(ms).getDate() / 7)) + ' ' + planLongDay(startKey);
    }
    if (kind === 'yearly') return 'Annually on ' + planLongMonth(startKey);
    if (unit === 'week') {
      var days = (rule.days || []).length;
      return (every > 1 ? many(every, 'week') : 'Weekly') + ' on ' + (days > 1 ? days + ' days' : planLongDay(startKey));
    }
    if (unit === 'month') return many(every, 'month') + ' on day ' + Number(String(startKey || '').slice(8));
    if (unit === 'year') return many(every, 'year') + ' on ' + planLongMonth(startKey);
    return many(every, 'day');
  }

  function planRepeatHit(item, key) {
    var rule = planRepeatOf(item);
    var start = planRepeatStart(item);
    if (!rule || !start || !key || key === start) return false;
    var a = calMs(start);
    var b = calMs(key);
    if (a === null || b === null || b < a) return false;
    if (rule.until && key > rule.until) return false;
    var every = Math.max(1, Math.round(Number(rule.every) || 1));
    var days = Math.round((b - a) / 86400000);
    var weekday = planWeekdayOf(key);
    var mine = (rule.days && rule.days.length ? rule.days : [planWeekdayOf(start)]);
    var weekBlock = Math.floor(days / 7) % every === 0;
    if (rule.kind === 'daily') return days % every === 0;
    if (rule.kind === 'weekday') return weekday >= 1 && weekday <= 5;
    if (rule.kind === 'weekly') return mine.indexOf(weekday) >= 0 && weekBlock;
    if (rule.kind === 'monthly') {
      var months = planMonthOf(key) - planMonthOf(start);
      return months > 0 && months % every === 0 && weekday === planWeekdayOf(start) && Math.ceil(Number(key.slice(8)) / 7) === Math.ceil(Number(start.slice(8)) / 7);
    }
    if (rule.kind === 'yearly') return key.slice(5) === start.slice(5) && (Number(key.slice(0, 4)) - Number(start.slice(0, 4))) % every === 0;
    var unit = PLAN_REPEAT_UNITS.indexOf(rule.unit) >= 0 ? rule.unit : 'day';
    if (unit === 'day') return days % every === 0;
    if (unit === 'week') return mine.indexOf(weekday) >= 0 && weekBlock;
    if (unit === 'month') {
      var gap = planMonthOf(key) - planMonthOf(start);
      return gap > 0 && gap % every === 0 && Number(key.slice(8)) === Number(start.slice(8));
    }
    return key.slice(5) === start.slice(5) && (Number(key.slice(0, 4)) - Number(start.slice(0, 4))) % every === 0;
  }

  function planTitle(item) {
    if (item.data && item.data.text) return planPlain(item.data.text);
    if (item.data && item.data.planner) return '';
    try { return barLabel(item).textContent; } catch (e) { return item.kind; }
  }

  function planPlain(html) {
    var text = String(html || '');
    if (text.indexOf('<') >= 0) {
      var holder = node('div', '', '');
      holder.innerHTML = text;
      text = holder.textContent || '';
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function planLabelOf(item) {
    var data = item.data || {};
    if (item.kind === 'todo') {
      var first = (data.items || [])[0];
      return String(data.title || '').trim() || String(first && first.text || '').trim() || labelText(item);
    }
    if (item.kind === 'link') return String(data.title || '').trim() || String(data.url || '').trim() || labelText(item);
    if (item.kind === 'image' || item.kind === 'file' || item.kind === 'ref') return String(data.name || '').trim() || labelText(item);
    if (item.kind === 'table') return planPlain(data.text) || labelText(item);
    return planPlain(data.text) || labelText(item);
  }

  function planScope() {
    if (board.planForeign) return board.planForeign;
    var rows = [];
    var boards = [];
    try { boards = App.db.listBoards() || []; } catch (e) { boards = []; }
    boards.forEach(function (boardRow) {
      var id = boardRow && boardRow.id;
      if (!id || id === BOARD_ID || /:planner$/.test(String(id))) return;
      var mine = [];
      try { mine = App.db.boardItems(id) || []; } catch (e) { mine = []; }
      mine.forEach(function (row) {
        if (!row) return;
        row.data = row.data || {};
        rows.push(row);
      });
    });
    board.planForeign = rows;
    return rows;
  }

  function planEntries(key) {
    var out = [];
    board.items.forEach(function (item) {
      if (planKeysOf(item).indexOf(key) >= 0) out.push({ board: true, key: key, item: item, boardId: BOARD_ID, title: planTitle(item) || item.kind });
    });
    planScope().forEach(function (item) {
      if (planKeysOf(item).indexOf(key) >= 0) out.push({ board: true, foreign: true, key: key, item: item, boardId: item.board_id, title: planTitle(item) || item.kind });
    });
    board.plans.forEach(function (item) {
      if (item.data && planKeysOf(item).indexOf(key) >= 0) out.push({ board: false, key: key, item: item, boardId: PLAN_BOARD, title: planLabelOf(item) });
    });
    // A repeated block is stored once and stands in for every day its rule names, so one row keeps all of them up to date.
    var seen = {};
    out.forEach(function (entry) { if (entry.item) seen[entry.item.id] = true; });
    var repeats = [];
    var offer = function (item, isBoard, foreign, boardId) {
      if (!item || seen[item.id] || !planRepeatHit(item, key)) return;
      seen[item.id] = true;
      repeats.push({ board: isBoard, foreign: !!foreign, key: key, item: item, boardId: boardId, repeat: true, title: planTitle(item) || planLabelOf(item) });
    };
    board.items.forEach(function (item) { offer(item, true, false, BOARD_ID); });
    planScope().forEach(function (item) { offer(item, true, true, item.board_id); });
    board.plans.forEach(function (item) { offer(item, false, false, PLAN_BOARD); });
    return out.concat(repeats);
  }

  function kindRank(kind) {
    for (var i = 0; i < BLOCK_KINDS.length; i++) if (BLOCK_KINDS[i].kind === kind) return i;
    return BLOCK_KINDS.length;
  }

  function planSeqOf(item, key) {
    var map = item && item.data ? item.data.planSeq : null;
    return map && typeof map[key] === 'number' ? map[key] : null;
  }

  function planReorder(entries, item, key, index) {
    var from = -1;
    var rest = [];
    entries.forEach(function (entry, i) {
      if (entry.item === item || (entry.item && entry.item.id === item.id)) { from = i; return; }
      rest.push(entry);
    });
    if (from < 0) return false;
    var at = typeof index === 'number' ? index : rest.length;
    if (from < at) at -= 1;
    at = Math.max(0, Math.min(at, rest.length));
    rest.splice(at, 0, entries[from]);
    rest.forEach(function (entry, i) {
      var row = entry.item;
      if (!row.data) return;
      if (!row.data.planSeq) row.data.planSeq = {};
      row.data.planSeq[key] = i;
      row.updated_at = util.nowIso();
      try { App.db.boardAddItem(row); } catch (e) { }
    });
    return true;
  }

  function planSort(entries, date) {
    entries.sort(function (a, b) {
      var as = date ? planSeqOf(a.item, date) : null;
      var bs = date ? planSeqOf(b.item, date) : null;
      if (as !== null || bs !== null) {
        if (as === null) return 1;
        if (bs === null) return -1;
        if (as !== bs) return as - bs;
      }
      var at = planTimeOf(a.item, a.board);
      var bt = planTimeOf(b.item, b.board);
      if (!at !== !bt) return at ? -1 : 1;
      if (at && bt && at !== bt) return at < bt ? -1 : 1;
      var ak = kindRank(a.item.kind);
      var bk = kindRank(b.item.kind);
      if (ak !== bk) return ak - bk;
      return planPlain(a.title).toLowerCase() < planPlain(b.title).toLowerCase() ? -1 : 1;
    });
    return entries;
  }

  function planAllEntries() {
    var out = [];
    var push = function (item, boardId, foreign) {
      planKeysOf(item).forEach(function (key) {
        if (!key) return;
        out.push({ board: true, foreign: !!foreign, key: key, item: item, boardId: boardId, title: planTitle(item) || item.kind });
      });
    };
    board.items.forEach(function (item) { push(item, BOARD_ID, false); });
    planScope().forEach(function (item) { push(item, item.board_id, true); });
    board.plans.forEach(function (item) {
      var key = item.data ? item.data.planner : null;
      if (key) out.push({ board: false, key: key, item: item, boardId: PLAN_BOARD, title: planLabelOf(item) });
    });
    return out;
  }

  function planTypes(plan) {
    if (!plan) return [];
    if (Object.prototype.toString.call(plan.types) !== '[object Array]') plan.types = [];
    return plan.types;
  }

  function planEntryFiltered(entry, query) {
    var plan = board.planner;
    var types = plan && plan.mode === 'browse' ? planTypes(plan) : [];
    if (types.length && types.indexOf(planKindOf(entry.item)) < 0) return false;
    if (!query) return true;
    var hay = kindText(planKindOf(entry.item)).label + ' ' + planPlain(entry.title) + ' ' + (planTimeOf(entry.item, entry.board) || '');
    return hay.toLowerCase().indexOf(query) >= 0;
  }

  function planFiltered(entries) {
    var plan = board.planner;
    var query = plan && plan.query ? String(plan.query).trim().toLowerCase() : '';
    if (!query && !planTypes(plan).length) return entries;
    return entries.filter(function (entry) { return planEntryFiltered(entry, query); });
  }

  function planMatches() {
    var plan = board.planner;
    var query = plan && plan.query ? String(plan.query).trim().toLowerCase() : '';
    var found = planAllEntries().filter(function (entry) { return planEntryFiltered(entry, query); });
    found.sort(function (a, b) {
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      var at = planTimeOf(a.item, a.board);
      var bt = planTimeOf(b.item, b.board);
      if (at !== bt) return at < bt ? -1 : 1;
      return String(a.title).localeCompare(String(b.title));
    });
    return found;
  }

  function goToPlanDate(key) {
    var plan = board.planner;
    if (!plan) return;
    var ms = calMs(key);
    plan.date = key;
    if (ms !== null) plan.month = monthStart(ms);
    plan.query = '';
    paintPlanner();
  }

  // A chip, bar or row carries the block's own words, so typing has to reach it before the next repaint does.
  function planRelabel(item) {
    if (!item || !item.id) return;
    var label = planLabelOf(item);
    if (!label) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-plan-id="' + item.id + '"], [data-ol-id="' + item.id + '"]'), function (el) {
      if (el.__planView) return;
      var slot = el.querySelector('.bd-cal__tdchiptext, .bd-cal__teventtext, .bd-cal__rtitle, .bd-cal__oltitle');
      if (!slot) return;
      if (slot.classList.contains('bd-cal__tdchiptext') || slot.classList.contains('bd-cal__teventtext')) slot.innerHTML = planCellHtml(item, label);
      else slot.textContent = label;
    });
  }

  // A cell shows the block's own words with the colours it was given, at the cell's own size.
  function planCellHtml(item, fallback) {
    var raw = item.data && item.data.text;
    if (!raw || String(raw).indexOf('<') < 0) return util.escapeHtml(String(fallback || ''));
    var holder = node('div', '', '');
    holder.innerHTML = util.sanitizeRichHtml(String(raw));
    Array.prototype.forEach.call(holder.querySelectorAll('[style]'), function (el) {
      ['font-size', 'font-family', 'line-height', 'background', 'background-color', 'display', 'position'].forEach(function (prop) {
        el.style.removeProperty(prop);
      });
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    var html = holder.innerHTML.replace(/<\/?(?:div|p|br|h[1-6]|ul|ol|li|blockquote|pre|section|article)[^>]*>/gi, ' ');
    return planPlain(html) ? html : util.escapeHtml(String(fallback || ''));
  }

  function planResultRow(entry) {
    var text = kindText(planKindOf(entry.item));
    var title = planPlain(entry.title) || text.label;
    var row = node('button', 'bd-cal__row' + (planDoneOf(entry.item) ? ' is-done' : ''));
    row.type = 'button';
    row.setAttribute('data-plan-id', entry.item.id);
    row.setAttribute('data-result-key', entry.key);
    row.title = 'Open ' + entry.key;
    var glyph = node('span', 'bd-cal__ricon');
    var mark = App.ui.icon(text.icon, 13);
    if (mark) glyph.appendChild(mark);
    row.appendChild(glyph);
    row.appendChild(node('span', 'bd-cal__rkind', text.label));
    var label = node('span', 'bd-cal__rtitle', title);
    label.title = title;
    row.appendChild(label);
    var time = planTimeOf(entry.item, entry.board);
    if (time) row.appendChild(node('span', 'bd-cal__rtime', time));
    if (entry.board) row.appendChild(node('span', 'bd-cal__rboard', entry.foreign ? boardName(entry.boardId) : 'board'));
    row.addEventListener('click', function () { goToPlanDate(entry.key); });
    return row;
  }

  function planResults(entries) {
    var wrap = node('div', 'bd-cal__results');
    if (!entries.length) {
      wrap.appendChild(node('div', 'bd-cal__empty', 'No block matches. Try another word, or clear the type filters.'));
      return wrap;
    }
    var at = null;
    var group = null;
    entries.forEach(function (entry) {
      if (entry.key !== at) {
        at = entry.key;
        var ms = calMs(at);
        var when = ms === null ? at : CAL_DAYS[new Date(ms).getDay()] + ', ' + CAL_MONTHS[new Date(ms).getMonth()] + ' ' + new Date(ms).getDate() + ', ' + new Date(ms).getFullYear();
        group = node('div', 'bd-cal__rgroup');
        group.appendChild(node('div', 'bd-cal__rdate', when));
        wrap.appendChild(group);
      }
      group.appendChild(planResultRow(entry));
    });
    return wrap;
  }

  // A block that references another block is shown by the type it points at, the same way the card in the
  // day panel labels it, so a reference to a note counts and filters as a note.
  function planKindOf(item) {
    if (item && item.kind === 'ref' && item.ref_kind) return item.ref_kind;
    return item ? item.kind : '';
  }

  function planTypeBar() {
    var plan = board.planner;
    var on = planTypes(plan);
    var counts = {};
    var extra = [];
    planAllEntries().forEach(function (entry) {
      var kind = planKindOf(entry.item);
      counts[kind] = (counts[kind] || 0) + 1;
      var known = false;
      BLOCK_KINDS.forEach(function (row) { if (row.kind === kind) known = true; });
      if (!known && extra.indexOf(kind) < 0) extra.push(kind);
    });
    var present = [];
    BLOCK_KINDS.forEach(function (entry) { if (counts[entry.kind]) present.push(entry.kind); });
    extra.forEach(function (kind) { if (counts[kind] && present.indexOf(kind) < 0) present.push(kind); });
    if (!present.length) return null;
    var summary = '';
    if (on.length === 1) summary = kindText(on[0]).label;
    else if (on.length === 2) summary = kindText(on[0]).label + ' + ' + kindText(on[1]).label;
    else if (on.length > 2) summary = on.length + ' types';
    var button = node('button', 'bd-cal__type' + (on.length ? ' is-on' : ''));
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-label', 'Filter blocks by type');
    button.title = on.length ? 'Showing ' + summary + '. Click to change.' : 'Showing every type. Click to filter.';
    button.appendChild(node('span', 'bd-cal__typelabel', summary || 'All types'));
    button.appendChild(node('span', 'bd-cal__caret'));
    var total = 0;
    present.forEach(function (kind) { total += counts[kind] || 0; });
    var openTypes = function (quiet) {
      var live = document.querySelector('.bd-cal__type') || button;
      var at = live.getBoundingClientRect();
      var chosen = planTypes(plan);
      var items = [{
        label: 'All types',
        box: true,
        checked: !chosen.length,
        shortcut: String(total),
        onclick: function () {
          planTypes(plan).length = 0;
          paintPlanner();
          openTypes(true);
        },
      }];
      present.forEach(function (kind) {
        var text = kindText(kind);
        items.push({
          label: text.label,
          icon: text.icon,
          box: true,
          shortcut: String(counts[kind] || 0),
          checked: chosen.indexOf(kind) >= 0,
          onclick: function () {
            var list = planTypes(plan);
            var seen = list.indexOf(kind);
            if (seen >= 0) list.splice(seen, 1);
            else list.push(kind);
            paintPlanner();
            openTypes(true);
          },
        });
      });
      App.ui.openMenu({ x: Math.round(at.left), y: Math.round(at.bottom + 6), quiet: !!quiet, items: items });
    };
    button.addEventListener('click', function () { openTypes(false); });
    return button;
  }

  function paintPlan(item) {
    if (!item.node) return;
    if (!item.node) return;
    var keys = planKeysOf(item);
    var label = keys.map(function (key) { return calShort(key); }).join(', ');
    var button = item.node.querySelector('.bd-item__plan-btn');
    if (button) {
      button.classList.toggle('is-on', keys.length > 0);
      button.title = keys.length ? 'Planned for ' + label + '. Click to add another day.' : 'Add to planner';
    }
    var chip = item.node.querySelector('.bd-item__plan');
    if (!chip) return;
    chip.hidden = keys.length === 0;
    if (keys.length) chip.textContent = keys.length > 1 ? calShort(keys[0]) + ' +' + (keys.length - 1) : calShort(keys[0]);
  }

  function rowsFor(item) {
    if (board.selectedIds.length > 1 && board.selectedIds.indexOf(item.id) >= 0) {
      return board.selectedIds.map(findItem).filter(Boolean);
    }
    return [item];
  }

  function planAdd(item, key, quiet) {
    if (!item || !item.data || !key) return false;
    var keys = planKeysOf(item);
    if (keys.indexOf(key) >= 0) {
      if (!quiet) util.toast('Already planned for ' + calShort(key));
      return false;
    }
    keys.push(key);
    keys.sort();
    delete item.data.spanFrom;
    delete item.data.spanTo;
    item.data.plans = keys;
    item.data.plan = keys[0];
    item.updated_at = util.nowIso();
    try { App.db.boardAddItem(item); } catch (e) { }
    paintPlan(item);
    return true;
  }

  function planSync(item, keys) {
    if (keys.length) { item.data.plans = keys; item.data.plan = keys[0]; }
    else { delete item.data.plans; delete item.data.plan; }
    if (item.data.planner) item.data.planner = keys.length ? keys[0] : '';
    item.updated_at = util.nowIso();
    try { App.db.boardAddItem(item); } catch (e) { }
    paintPlan(item);
  }

  function planRemove(item, key) {
    if (!item || !item.data) return;
    planSync(item, planKeysOf(item).filter(function (other) { return other !== key; }));
    var left = planKeysOf(item);
    var dirty = false;
    if (item.data.spanFrom && left.indexOf(item.data.spanFrom) < 0) { delete item.data.spanFrom; dirty = true; }
    if (item.data.spanTo && left.indexOf(item.data.spanTo) < 0) { delete item.data.spanTo; dirty = true; }
    if (dirty) savePlanItem(item);
  }

  function planClear(item) {
    if (!item || !item.data) return;
    delete item.data.spanFrom;
    delete item.data.spanTo;
    planSync(item, []);
  }

  function setPlan(item, key) {
    if (!item || !item.data) return;
    if (!key) return planClear(item);
    planAdd(item, key);
  }

  function planRangeKeys(from, to) {
    var a = calMs(from);
    var b = calMs(to);
    if (a === null || b === null) return null;
    if (b < a) { var swap = a; a = b; b = swap; }
    var first = new Date(a);
    var last = new Date(b);
    var cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    var stop = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    var keys = [];
    while (cursor.getTime() <= stop.getTime() && keys.length < 366) {
      keys.push(calKey(cursor.getTime()));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return keys.length ? keys : null;
  }

  function planSetRange(item, from, to) {
    var keys = planRangeKeys(from, to);
    if (!item || !item.data || !keys) return false;
    planSync(item, keys);
    item.data.spanFrom = keys[0];
    item.data.spanTo = keys[keys.length - 1];
    savePlanItem(item);
    return true;
  }


  function calRangeLabel(from, to) {
    if (!from) return 'Range';
    if (!to || to === from) return calShort(from);
    return calShort(from) + ' - ' + calShort(to);
  }

  function planTimeLabel(value) {
    var parts = String(value || '').split(':');
    if (parts.length < 2) return '';
    var at = new Date();
    at.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    try { return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return value; }
  }

  function planClock(value) {
    var parts = String(value || '').split(':');
    if (parts.length < 2) return null;
    var hour = Number(parts[0]);
    var minute = Number(parts[1]);
    if (isNaN(hour) || isNaN(minute)) return null;
    return Math.max(0, Math.min(1439, hour * 60 + minute));
  }

  function planStamped(minutes) {
    var at = Math.max(0, Math.min(1439, Math.round(minutes)));
    var hour = Math.floor(at / 60);
    var minute = at % 60;
    return (hour < 10 ? '0' : '') + hour + ':' + (minute < 10 ? '0' : '') + minute;
  }

  function planEndOf(item, isBoard) {
    if (!item || !item.data) return '';
    return String((isBoard ? item.data.planEnd : item.data.end) || '');
  }

  function planEventClock(item, isBoard) {
    var start = planClock(planTimeOf(item, isBoard));
    if (start === null) return '';
    var end = planClock(planEndOf(item, isBoard));
    if (end === null || end <= start) return planTimeLabel(planStamped(start));
    return planTimeLabel(planStamped(start)) + ' - ' + planTimeLabel(planStamped(end));
  }

  // A block with a time is drawn on the clock, on every day its range covers; one without a time waits in the all day band.
  function planTimed(entry) {
    var start = planClock(planTimeOf(entry.item, entry.board));
    if (start === null) return null;
    var end = planClock(planEndOf(entry.item, entry.board));
    if (end === null || end <= start) end = Math.min(1440, start + 60);
    return { start: start, end: end, entry: entry };
  }

  // One block is planned for one stretch of time, so its clock and its days are set in one place
  // and the card bar spends a single short chip on them.
  function planWhenLabel(item, isBoard) {
    var from = item.data && item.data.spanFrom ? item.data.spanFrom : '';
    var to = item.data && item.data.spanTo ? item.data.spanTo : '';
    var day = from ? calRangeLabel(from, to) : (planKeyOf(item) ? calShort(planKeyOf(item)) : 'When');
    var time = planEventClock(item, isBoard);
    var line = time ? time + ' \u00b7 ' + day : day;
    return planRepeatOf(item) ? line + ' \u00b7 repeats' : line;
  }

  // A repaint tears down the node the pointer just landed on, so a dialog that closes under a press waits for the gesture to end.
  var planSoon = false;
  var planPressed = false;
  function planLater() {
    if (planSoon) return;
    planSoon = true;
    var fire = function () {
      if (!planSoon) return;
      planSoon = false;
      planPressed = false;
      window.removeEventListener('pointerup', fire, true);
      window.removeEventListener('pointercancel', fire, true);
      paintPlanner();
    };
    window.addEventListener('pointerup', fire, true);
    window.addEventListener('pointercancel', fire, true);
    // A press waits for its own release, because a repaint mid-drag would take the drag highlight with it.
    if (!planPressed) window.setTimeout(fire, 60);
  }

  function planWhenTools(item, isBoard) {
    var wrap = node('div', 'bd-plan__when');
    var from = item.data && item.data.spanFrom ? item.data.spanFrom : '';
    var timed = !!planTimeOf(item, isBoard);
    var button = node('button', 'bd-plan__whenbtn' + (from || timed ? ' is-on' : ''), planWhenLabel(item, isBoard));
    button.type = 'button';
    button.title = 'Set the time, the days and the repeat for this block';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (document.querySelector('.bd-cal__quick')) { planQuickClose(); return; }
      var day = planRepeatStart(item) || planKeyOf(item) || (board.planner && board.planner.date) || calKey(Date.now());
      planQuickAdd(item, day, planQuickAt(event), button, isBoard);
    });
    wrap.appendChild(button);
    return wrap;
  }

  function savePlanItem(item) {
    if (item.__planDraft) return;
    item.updated_at = util.nowIso();
    try { App.db.boardAddItem(item); } catch (e) { }
  }

  function plannerEl() {
    if (board.plannerEl && board.plannerEl.parentNode) return board.plannerEl;
    var el = node('div', 'bd-cal');
    el.hidden = true;
    board.root.appendChild(el);
    board.plannerEl = el;
    return el;
  }

  function calButton(label, action, extra) {
    var button = node('button', 'bd-cal__btn' + (extra ? ' ' + extra : ''), label);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  function openPlanner(mode, rows, date) {
    var ms = date ? calMs(date) : null;
    var saved = 'month';
    try { saved = App.prefs.get('board.planView', 'month') || 'month'; } catch (e) { saved = 'month'; }
    var dayFirst = saved === 'day' && mode !== 'assign';
    board.planner = {
      mode: mode,
      rows: rows || [],
      date: date || calKey(Date.now()),
      month: monthStart(ms === null ? Date.now() : ms),
      dayOpen: dayFirst,
      full: false,
      viewMode: saved,
      sheetZoom: 1,
      tool: board.mode === 'select' ? 'select' : 'grab',
    };
    richHide();
    var el = plannerEl();
    el.hidden = false;
    paintPlanner();
  }

  function openPlannerAssign(rows) {
    var picked = (rows || []).filter(Boolean);
    if (!picked.length) return;
    var keys = picked.map(planKeyOf);
    var shared = keys.length && keys.every(function (key) { return key && key === keys[0]; }) ? keys[0] : null;
    openPlanner('assign', picked, shared);
  }

  function closePlanner() {
    planQuickClose();
    if (board.plannerEl) board.plannerEl.hidden = true;
    // The fullscreen minimap hangs off the body, so closing the planner has to take it down too.
    var map = board.planner && board.planner.map;
    if (map && map.el) {
      map.el.remove();
      map.el = null;
      map.canvas = null;
      map.ctx = null;
    }
    board.planner = null;
    board.planForeign = null;
  }

  function consumeReveal() {
    var id = null;
    try { id = App.prefs.get('board.reveal', null); } catch (e) { id = null; }
    if (!id) return;
    try { App.prefs.set('board.reveal', null); } catch (e) { }
    var item = findItem(id);
    if (!item) return;
    if (item.node) revealOnBoard(item);
    else setTimeout(function () { if (item.node) revealOnBoard(item); }, 700);
  }

  function revealOnBoard(entry) {
    var item = entry && entry.item ? entry.item : entry;
    if (!item) return;
    var target = (entry && entry.boardId) || BOARD_ID;
    if (target !== BOARD_ID) {
      try { App.prefs.set('board.id', target); } catch (e) { }
      try { App.prefs.set('board.reveal', item.id); } catch (e) { }
      closePlanner();
      util.toast('Opening ' + boardName(target) + '\u2026');
      location.reload();
      return;
    }
    closePlanner();
    var view = board.view;
    var rect = board.stage.getBoundingClientRect();
    if (view.z < 0.8) {
      view.z = 1;
      applyView(true);
    }
    var topBar = document.querySelector('.board__top');
    var gap = (topBar ? topBar.getBoundingClientRect().bottom - rect.top : 48) + 24;
    glideViewTo(
      Math.round(rect.width / 2 - (item.x + item.w / 2) * view.z),
      Math.round(gap - item.y * view.z),
      320
    );
    select(item);
    window.setTimeout(function () {
      if (!item.node) return;
      paintSelection();
      item.node.classList.add('is-pinged');
      window.setTimeout(function () {
        if (item.node) item.node.classList.remove('is-pinged');
      }, 1200);
    }, 400);
  }

  function planIcon(kind) {
    var map = { note: 'note', todo: 'check', link: 'external', comment: 'info', table: 'grid', image: 'upload', file: 'file', ref: 'file', column: 'panel', group: 'folder', draw: 'pencil' };
    return map[kind] || 'note';
  }

  function planTimeOf(item, isBoard) {
    if (!item.data) return '';
    return String((isBoard ? item.data.planTime : item.data.time) || '');
  }

  function setPlanTime(item, isBoard, value) {
    if (!item.data) item.data = {};
    if (isBoard) item.data.planTime = value;
    else item.data.time = value;
    savePlanItem(item);
    paintPlanner();
  }

  function planDoneOf(item) {
    if (!item.data) return false;
    if (item.kind === 'todo') {
      var rows = item.data.items || [];
      var done = 0;
      rows.forEach(function (row) { if (row.done) done++; });
      return rows.length > 0 && done === rows.length;
    }
    return !!item.data.done;
  }

  function planSetDone(item, done) {
    if (!item.data) item.data = {};
    if (item.kind === 'todo') (item.data.items || []).forEach(function (row) { row.done = done; });
    else item.data.done = done;
    savePlanItem(item);
    if (item.node) item.node.classList.toggle('is-done', done);
  }

  function queuePlanSave(item) {
    if (item.saveTimer) clearTimeout(item.saveTimer);
    item.saveTimer = setTimeout(function () { item.saveTimer = null; savePlanItem(item); }, 400);
  }

  // A draft stays in memory only, so nothing is stored until the dialog that opened it is confirmed.
  function planDraftItem(kind, key, time, end) {
    var now = util.nowIso();
    var size = { note: [268, 176], todo: [256, 196], link: [268, 96], image: [288, 216], comment: [268, 132], table: [320, 208], file: [300, 236] }[kind] || [260, 160];
    var data = defaultData(kind);
    data.planner = key;
    if (time) data.time = time;
    if (end) data.end = end;
    return {
      id: util.uuid(),
      board_id: PLAN_BOARD,
      kind: kind,
      ref_kind: null,
      ref_id: null,
      x: 0,
      y: 0,
      w: size[0],
      h: size[1],
      z: 0,
      data: data,
      created_at: now,
      updated_at: now,
    };
  }

  function addPlannerItem(kind, key, time, end, draft) {
    if (kind === 'draw' && !board.planDrawAdd) {
      board.planPadDate = key;
      openDrawPad(null);
      return null;
    }
    var item = planDraftItem(kind, key, time, end);
    board.planFresh = { id: item.id, key: key, until: Date.now() + 4000 };
    if (draft) item.__planDraft = true;
    board.plans.push(item);
    if (!draft) savePlanItem(item);
    paintPlanner();
    return item;
  }

  var QUICK_HOUR = 60;

  // Putting the dialog away has to take the block it was holding with it, or a press somewhere
  // else leaves a block behind that was never confirmed.
  function planQuickClose() {
    var dropped = false;
    Array.prototype.forEach.call(document.querySelectorAll('.bd-cal__quick'), function (el) {
      var draft = el.__planDraftItem;
      if (draft && draft.__planDraft) {
        delete draft.__planDraft;
        var at = board.plans.indexOf(draft);
        if (at >= 0) { board.plans.splice(at, 1); dropped = true; }
      }
      if (typeof el.__planOff === 'function') el.__planOff();
      el.remove();
    });
    if (dropped && !document.querySelector('.bd-cal__quick')) paintPlanner();
  }

  // A press outside the dialog puts it away, and that press never also starts a second block.
  function planQuickBusy() {
    if (!document.querySelector('.bd-cal__quick')) return false;
    planQuickClose();
    return true;
  }

  function planQuickName(item, wording) {
    if (!item.data) item.data = {};
    var text = String(wording == null ? '' : wording);
    var plain = planPlain(text) || text;
    item.data.text = text;
    item.data.title = plain;
    var bar = plannerEl().querySelector('.bd-cal__tevent[data-plan-id="' + item.id + '"] .bd-cal__teventtext');
    if (bar) bar.innerHTML = planCellHtml(item, plain) || util.escapeHtml(plain);
    if (!item.__planDraft) savePlanItem(item);
  }

  function planQuickNode(item) {
    return function () {
      return plannerEl().querySelector('.bd-cal__tevent[data-plan-id="' + item.id + '"], .bd-cal__tdchip[data-plan-id="' + item.id + '"]');
    };
  }

  // The popover is fixed to the viewport, so the box a block can scroll out of is whatever scrolls it.
  function planQuickFrame(node) {
    var row = node.parentNode;
    while (row && row.nodeType === 1 && row !== document.body) {
      if (row.clientHeight > 0 && row.scrollHeight > row.clientHeight + 4 && /auto|scroll|overlay/.test(window.getComputedStyle(row).overflowY || '')) {
        return row.getBoundingClientRect();
      }
      row = row.parentNode;
    }
    return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  }

  // The popover is fixed to the viewport, so a scroll would leave it behind the block it belongs to.
  function planQuickPlace(box, at, anchor) {
    var spot = at || null;
    var target = anchor ? (typeof anchor === 'function' ? anchor() : anchor) : null;
    var away = false;
    if (target && target.isConnected) {
      var frame = planQuickFrame(target);
      var rect = target.getBoundingClientRect();
      away = rect.bottom < frame.top + 4 || rect.top > frame.bottom - 4 || rect.right < frame.left || rect.left > frame.right;
      if (!away) {
        // A block can be as wide as its lane, so where the pointer was is the offset to keep, not the block edge.
        if (at && !box.__planGap) box.__planGap = { dx: at.left - rect.left, dy: at.top - rect.top };
        if (box.__planGap) spot = { left: rect.left + box.__planGap.dx, top: rect.top + box.__planGap.dy };
        else if (!spot) spot = { left: rect.right + 12, top: rect.top - 22 };
      }
    }
    box.style.display = away && !at ? 'none' : '';
    if (away && !at) return;
    var base = spot || { left: 40, top: 120 };
    var width = box.offsetWidth || 336;
    var height = box.offsetHeight || 250;
    box.style.left = Math.max(8, Math.min(Math.round(base.left), Math.round(window.innerWidth - width - 8))) + 'px';
    box.style.top = Math.max(8, Math.min(Math.round(base.top), Math.round(window.innerHeight - height - 8))) + 'px';
  }

  // A click carries where the pointer was, so the dialog opens there instead of hanging off the right edge.
  function planQuickAt(event) {
    if (!event || (!event.clientX && !event.clientY)) return null;
    return { left: event.clientX + 12, top: event.clientY - 26 };
  }

  // A block asks for its title and its time right where it sits, whether it is new or already there.
  function planQuickAdd(item, key, at, anchor, isBoard, opts) {
    planQuickClose();
    var fresh = !!(opts && opts.isNew);
    var box = node('div', 'bd-cal__quick');
    if (fresh) box.__planDraftItem = item;
    box.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    var title = node('input', 'bd-cal__quicktitle');
    title.type = 'text';
    title.value = planTitle(item) || '';
    title.placeholder = 'Add title';
    title.setAttribute('aria-label', 'Block title');
    // A note is written, not titled, so the dialog gives it the same field and the same bar as its card.
    var body = item.kind === 'note' ? node('div', 'bd-cal__quicktext bd-text') : null;
    if (body) {
      var stored = item.data && item.data.text ? item.data.text : '';
      body.setAttribute('contenteditable', 'true');
      body.setAttribute('data-placeholder', 'Add a note');
      body.setAttribute('aria-label', 'Note text');
      body.__planItem = item;
      body.innerHTML = stored ? (util.isRichHtml(stored) ? util.sanitizeRichHtml(stored) : util.escapeHtml(stored)) : '';
      body.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
      title.hidden = true;
    }
    var when = planTimeOf(item, !!isBoard);
    var kind = kindText(planKindOf(item));
    var head = node('div', 'bd-cal__quickhead');
    var badge = node('span', 'bd-cal__quickkind');
    var kindGlyph = App.ui.icon(kind.icon, 13);
    if (kindGlyph) badge.appendChild(kindGlyph);
    badge.appendChild(node('span', '', kind.label));
    head.appendChild(badge);
    // A block can be finished from the card, so the editor for it can finish it too.
    var doneNow = planDoneOf(item);
    var doneDraft = doneNow;
    var mark = node('button', 'bd-cal__quickdone' + (doneNow ? ' is-on' : ''));
    mark.type = 'button';
    mark.title = doneNow ? 'Mark as not done' : 'Mark as done';
    mark.setAttribute('aria-label', mark.title);
    mark.setAttribute('aria-pressed', doneNow ? 'true' : 'false');
    var markIcon = App.ui.icon('check', 13);
    if (markIcon) mark.appendChild(markIcon);
    mark.addEventListener('click', function (event) {
      event.stopPropagation();
      doneDraft = !doneDraft;
      var finished = doneDraft;
      mark.classList.toggle('is-on', finished);
      mark.title = finished ? 'Mark as not done' : 'Mark as done';
      mark.setAttribute('aria-label', mark.title);
      mark.setAttribute('aria-pressed', finished ? 'true' : 'false');
      subtitle.classList.toggle('is-done', finished);
    });
    head.appendChild(mark);
    var group = node('div', 'bd-cal__quickwhen');
    var groupHead = node('div', 'bd-cal__quickwhenhead');
    groupHead.appendChild(node('span', 'bd-cal__quicklabel', 'When'));
    var allRow = node('label', 'bd-cal__quickall');
    var all = node('input', '');
    all.type = 'checkbox';
    all.checked = !when;
    allRow.appendChild(all);
    allRow.appendChild(node('span', '', 'All day'));
    groupHead.appendChild(allRow);
    var glyph = node('span', 'bd-cal__quickicon');
    var glyphIcon = App.ui.icon('calendar', 13);
    if (glyphIcon) glyph.appendChild(glyphIcon);
    var dayRow = node('div', 'bd-cal__quickday');
    dayRow.appendChild(glyph);
    var day = node('input', 'bd-plan__rangedate');
    day.type = 'date';
    day.value = key;
    day.title = 'Day';
    day.setAttribute('aria-label', 'Day');
    var from = node('input', 'bd-plan__time');
    from.type = 'time';
    from.value = when;
    from.title = 'Start time';
    from.setAttribute('aria-label', 'Start time');
    var dash = node('span', 'bd-plan__rangedash', '-');
    var to = node('input', 'bd-plan__time');
    to.type = 'time';
    to.value = planEndOf(item, !!isBoard);
    to.title = 'End time';
    to.setAttribute('aria-label', 'End time');
    var row = node('div', 'bd-cal__quickrow');
    row.appendChild(from);
    row.appendChild(dash);
    row.appendChild(to);
    dayRow.appendChild(node('span', 'bd-cal__quicktag', 'From'));
    dayRow.appendChild(day);
    var lastRow = node('div', 'bd-cal__quickday');
    lastRow.appendChild(node('span', 'bd-cal__quicktag', 'To'));
    var last = node('input', 'bd-plan__rangedate');
    last.type = 'date';
    last.title = 'Last day';
    last.setAttribute('aria-label', 'Last day');
    lastRow.appendChild(last);
    var keepLast = item.data && item.data.spanTo && item.data.spanTo !== day.value ? item.data.spanTo : '';
    last.value = keepLast;
    group.appendChild(groupHead);
    group.appendChild(dayRow);
    group.appendChild(row);
    group.appendChild(lastRow);
    var subtitle = node('div', 'bd-cal__quicksub');
    subtitle.classList.toggle('is-done', doneNow);
    var sum = function () {
      subtitle.textContent = planQuickLine(day.value || key, all.checked, from.value, to.value);
    };
    sum();
    var rule = planRepeatDraft(item);
    var repeat = node('div', 'bd-cal__repeat');
    var repeatHead = node('div', 'bd-cal__repeathead');
    repeatHead.appendChild(node('span', 'bd-cal__quicklabel', 'Repeat'));
    var repeatBtn = node('button', 'bd-cal__repeatbtn');
    repeatBtn.type = 'button';
    repeatBtn.setAttribute('aria-haspopup', 'true');
    var menu = node('div', 'bd-cal__repmenu');
    menu.hidden = true;
    var custom = node('div', 'bd-cal__repcustom');
    custom.hidden = true;
    var startKey = function () { return day.value || key; };
    var everyIn = node('input', 'bd-cal__repnum');
    everyIn.type = 'number';
    everyIn.min = '1';
    everyIn.max = '99';
    everyIn.title = 'How often';
    everyIn.setAttribute('aria-label', 'How often');
    var unitSel = node('select', 'bd-cal__repunit');
    unitSel.title = 'Repeat unit';
    unitSel.setAttribute('aria-label', 'Repeat unit');
    [['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']].forEach(function (pair) {
      var opt = node('option', '', pair[1]);
      opt.value = pair[0];
      unitSel.appendChild(opt);
    });
    var unitRow = node('div', 'bd-cal__reprow');
    unitRow.appendChild(node('span', 'bd-cal__quicktag', 'Every'));
    unitRow.appendChild(everyIn);
    unitRow.appendChild(unitSel);
    var chips = CAL_DAYS.map(function (name, index) {
      var chip = node('button', 'bd-cal__repday', name.slice(0, 2));
      chip.type = 'button';
      chip.title = name;
      chip.setAttribute('aria-label', name);
      chip.addEventListener('click', function (event) {
        event.stopPropagation();
        var at = rule.days.indexOf(index);
        if (at >= 0) rule.days.splice(at, 1);
        else rule.days.push(index);
        paint();
      });
      return chip;
    });
    var chipRow = node('div', 'bd-cal__repdays');
    chips.forEach(function (chip) { chipRow.appendChild(chip); });
    var untilIn = node('input', 'bd-cal__repuntil');
    untilIn.type = 'date';
    untilIn.title = 'Last day of the repeat';
    untilIn.setAttribute('aria-label', 'This repeats until');
    var untilRow = node('div', 'bd-cal__reprow');
    untilRow.appendChild(node('span', 'bd-cal__quicktag', 'Until'));
    untilRow.appendChild(untilIn);
    var chipHint = node('span', 'bd-cal__rephint', 'On these days');
    custom.appendChild(unitRow);
    custom.appendChild(chipHint);
    custom.appendChild(chipRow);
    custom.appendChild(untilRow);
    var paint = function () {
      repeatBtn.textContent = planRepeatText(rule, startKey());
      repeatBtn.appendChild(node('span', 'bd-cal__repcaret', ''));
      custom.hidden = rule.kind !== 'custom';
      everyIn.value = String(rule.every || 1);
      unitSel.value = rule.unit || 'day';
      untilIn.value = rule.until || '';
      chips.forEach(function (chip, index) { chip.classList.toggle('is-on', rule.days.indexOf(index) >= 0); });
      chipHint.textContent = rule.unit === 'week' ? 'On these days' : 'Repeat unit';
      chipRow.hidden = rule.unit !== 'week';
    };
    var fillMenu = function () {
      menu.innerHTML = '';
      [{ kind: 'none' }, { kind: 'daily' }, { kind: 'weekly' }, { kind: 'monthly' }, { kind: 'yearly' }, { kind: 'weekday' }, { kind: 'custom', text: 'Custom...' }].forEach(function (opt) {
        var pick = node('button', 'bd-cal__repopt' + (rule.kind === opt.kind ? ' is-on' : ''), opt.text || planRepeatText({ kind: opt.kind, every: 1, days: [] }, startKey()));
        pick.type = 'button';
        pick.addEventListener('click', function (event) {
          event.stopPropagation();
          rule.kind = opt.kind;
          if (opt.kind !== 'custom') { rule.every = 1; rule.until = ''; }
          if (opt.kind === 'weekly' && !rule.days.length) rule.days = [];
          menu.hidden = true;
          paint();
        });
        menu.appendChild(pick);
      });
    };
    repeatBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menu.hidden) fillMenu();
      menu.hidden = !menu.hidden;
    });
    everyIn.addEventListener('input', function () {
      rule.every = Math.max(1, Math.round(Number(everyIn.value) || 1));
      paint();
    });
    unitSel.addEventListener('change', function () {
      rule.unit = unitSel.value;
      paint();
    });
    untilIn.addEventListener('change', function () {
      rule.until = untilIn.value || '';
      paint();
    });
    repeat.appendChild(repeatHead);
    repeat.appendChild(repeatBtn);
    repeat.appendChild(menu);
    repeat.appendChild(custom);
    paint();
    var acts = node('div', 'bd-cal__quickacts');
    // Nothing reaches the block until Save, so Cancel can put the dialog away without leaving half an edit behind.
    var write = function () {
      delete item.__planDraft;
      if (!item.data) item.data = {};
      var first = day.value || key;
      var stop = last.value && calMs(last.value) !== null && calMs(last.value) > calMs(first) ? last.value : first;
      planSetRange(item, first, stop);
      planQuickName(item, body ? util.sanitizeRichHtml(body.innerHTML) : title.value);
      var timed = !all.checked && !!from.value;
      if (isBoard) {
        item.data.planTime = timed ? from.value : '';
        item.data.planEnd = timed ? (to.value || '') : '';
      } else {
        item.data.time = timed ? from.value : '';
        item.data.end = timed ? (to.value || '') : '';
      }
      var saved = planRepeatValue(rule);
      if (saved) item.data.repeat = saved;
      else delete item.data.repeat;
      if (doneDraft !== planDoneOf(item)) planSetDone(item, doneDraft);
      savePlanItem(item);
    };
    var shut = function () {
      planQuickClose();
      planLater();
    };
    if (!fresh) {
      var kill = calButton('Delete', function () {
        planQuickClose();
        removePlannerItem(item);
      }, 'is-quiet bd-cal__quickdel');
      var killIcon = App.ui.icon('trash', 13);
      if (killIcon) kill.insertBefore(killIcon, kill.firstChild);
      acts.appendChild(kill);
    }
    var bail = calButton('Cancel', function () {
      planQuickClose();
      if (fresh) removePlannerItem(item, true);
      else planLater();
    }, 'is-quiet');
    var keep = calButton(fresh ? 'Create' : 'Save', function () {
      write();
      shut();
    }, 'is-primary');
    acts.appendChild(bail);
    acts.appendChild(keep);
    box.appendChild(head);
    box.appendChild(subtitle);
    box.appendChild(body || title);
    box.appendChild(group);
    box.appendChild(repeat);
    box.appendChild(acts);
    document.body.appendChild(box);
    var stamp = function () {
      if (all.checked) return;
      if (from.value && !to.value) to.value = planStamped(Math.min(1439, planClock(from.value) + QUICK_HOUR));
      if (to.value && !from.value) from.value = planStamped(Math.max(0, planClock(to.value) - QUICK_HOUR));
    };
    // A typed time means a timed block, so the all day box clears itself instead of swallowing the clock.
    var wake = function () {
      if (all.checked) all.checked = false;
    };
    title.addEventListener('input', sum);
    from.addEventListener('change', function () { wake(); stamp(); sum(); });
    to.addEventListener('change', function () { wake(); stamp(); sum(); });
    from.addEventListener('input', sum);
    to.addEventListener('input', sum);
    // All day means no clock, so the two time fields go quiet rather than sitting there inviting a time.
    var wireAllDay = function () {
      var off = all.checked;
      from.disabled = off;
      to.disabled = off;
      row.classList.toggle('is-off', off);
    };
    all.addEventListener('change', function () {
      if (!all.checked && !from.value) from.value = '09:00';
      if (!all.checked && !to.value) to.value = planStamped(Math.min(1439, planClock(from.value) + QUICK_HOUR));
      stamp();
      sum();
      wireAllDay();
    });
    wireAllDay();
    var syncRange = function () {
      if (last.value && calMs(last.value) !== null && calMs(last.value) <= calMs(day.value || key)) last.value = '';
      sum();
      paint();
    };
    day.addEventListener('change', syncRange);
    day.addEventListener('input', syncRange);
    last.addEventListener('change', sum);
    last.addEventListener('input', sum);
    var outside = function (event) {
      if (box.contains(event.target)) return;
      planPressed = true;
      // Clicking away from a draft that was never confirmed drops it, together with anything typed into it.
      if (fresh) bail.click();
      else keep.click();
    };
    // Enter belongs to the note: a note is lines, so it only ever starts a new one, and the
    // block is confirmed by pressing Create rather than by a keystroke.
    var keys = function (event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      bail.click();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keys, true);
    var follow = function () { planQuickPlace(box, at, anchor); };
    box.__planOff = function () {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
    planQuickPlace(box, at, anchor);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    (body || title).focus();
    if (!body) { try { title.setSelectionRange(title.value.length, title.value.length); } catch (e) { } }
    return item;
  }

  function planLengthText(minutes) {
    if (!(minutes > 0)) return '';
    return minutes >= 60 ? Math.floor(minutes / 60) + 'h' + (minutes % 60 ? ' ' + minutes % 60 + 'm' : '') : minutes + 'm';
  }

  function planQuickLine(key, allDay, from, to) {
    var ms = calMs(key);
    var day = ms === null ? '' : CAL_DAYS[new Date(ms).getDay()] + ', ' + calShort(key);
    var begin = allDay ? null : planClock(from);
    if (begin === null) return day ? day + ' - all day' : 'All day';
    var end = planClock(to);
    var clock = planTimeLabel(planStamped(begin)) + (end !== null && end > begin ? ' - ' + planTimeLabel(planStamped(end)) : '');
    var len = planLengthText(end !== null ? end - begin : 0);
    return (day ? day + ' - ' : '') + clock + (len ? ' (' + len + ')' : '');
  }

  function removePlannerItem(item, later) {
    board.plans = board.plans.filter(function (row) { return row.id !== item.id; });
    try { App.db.boardDeleteItem(item.id); } catch (e) { }
    if (later) planLater();
    else paintPlanner();
  }

  // A planner drag names its blocks by id, and a planned block can belong to any board, so the id
  // resolves against the board you are on and then against every other board in the planner.
  function planRow(id) {
    var hit = findItem(id);
    if (hit) return hit;
    var rows = planScope();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i].id) === String(id)) return rows[i];
    }
    return null;
  }

  // A block dragged inside the planner lives in its own store, which planRow does not hold, so both
  // places are asked before a drag gives up on the block it is carrying.
  function planRowAny(id) {
    var own = board.plans.filter(function (row) { return row.id === id; })[0];
    return own || planRow(id);
  }

  function dropPlanOn(key, index) {
    var drag = board.planDrag;
    var sources = board.planDragSources;
    board.planDrag = null;
    board.planDragSources = null;
    if (!drag) return;
    if (!sources || !sources.length) sources = [{ id: drag.id, board: drag.board, from: drag.from }];
    if (sources.length > 1) index = undefined;
    var added = false;
    var moved = false;
    var count = 0;
    var last = null;
    var repeats = 0;
    sources.forEach(function (source) {
      var item = source.board ? planRow(source.id) : board.plans.filter(function (row) { return row.id === source.id; })[0];
      if (!item) return;
      last = item;
      var keys = planKeysOf(item);
      if (source.from && keys.indexOf(source.from) < 0 && planRepeatOf(item)) { repeats++; return; }
      if (source.board) {
        // A block dragged inside the planner keeps its other dates, but the day it came from is
        // replaced, because a drop on another day reads as a move and not as a second date.
        if (source.from && source.from !== key && keys.indexOf(source.from) >= 0) {
          planSync(item, keys.filter(function (other) { return other !== source.from; }).concat([key]).sort());
          added = true;
          moved = true;
          count++;
        } else if (keys.indexOf(key) < 0) {
          planAdd(item, key, true);
          added = true;
          count++;
        }
      } else if (item.data.planner !== key) {
        item.data.planner = key;
        savePlanItem(item);
        added = true;
        moved = true;
        count++;
      }
    });
    if (typeof index === 'number' && last) planReorder(planSort(planEntries(key), key), last, key, index);
    if (added) util.toast(count > 1 ? 'Moved ' + count + ' blocks to ' + calShort(key) : (moved ? 'Moved to ' : (drag.board ? 'Planned for ' : 'Moved to ')) + calShort(key));
    if (!added && repeats) util.toast('That day comes from a repeat. Move the block\'s own day to shift the whole series.');
    if (board.planner) board.planner.date = key;
    paintPlanner();
  }

  function focusBoardItem(item) {
    closePlanner();
    select(item);
    var rect = board.stage.getBoundingClientRect();
    board.view.x = Math.round(rect.width / 2 - (item.x + item.w / 2) * board.view.z);
    board.view.y = Math.round(rect.height / 2 - (item.y + item.h / 2) * board.view.z);
    applyView();
  }

  function planDragHas(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    var list = Array.prototype.slice.call(types);
    return list.indexOf('Files') >= 0 || list.indexOf('text/plain') >= 0 || list.indexOf('text/uri-list') >= 0;
  }

  function planDropFiles(files, key) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    list.forEach(function (file) {
      var item = addPlannerItem('image', key, '');
      item.data.name = file.name || 'File';
      item.data.filename = file.name || 'file';
      item.data.mime = file.type || 'application/octet-stream';
      item.data.size = file.size || 0;
      savePlanItem(item);
      try { storeBoardFile(item, file); } catch (e) { }
    });
    paintPlanner();
    util.toast(list.length === 1 ? 'Added “' + (list[0].name || 'file') + '” to the planner' : 'Added ' + list.length + ' files to the planner');
  }

  function planAddText(text, key) {
    var body = String(text || '');
    if (!body.trim()) return null;
    var item = addPlannerItem('note', key, '');
    item.data.text = util.escapeHtml(body).replace(/\n/g, '<br>');
    savePlanItem(item);
    paintPlanner();
    return item;
  }

  function planAddPastedFile(file, key) {
    var reader = new FileReader();
    reader.onload = function () {
      var item = addPlannerItem('image', key, '');
      item.data.name = file.name || 'Pasted image';
      item.data.src = String(reader.result || '');
      savePlanItem(item);
      paintPlanner();
    };
    reader.readAsDataURL(file);
  }

  function planDropText(text, key) {
    var value = String(text || '').trim();
    if (!value) return;
    if (/^(https?:\/\/|www\.)\S+$/i.test(value)) {
      var link = addPlannerItem('link', key, '');
      link.data.url = value.replace(/^www\./i, 'https://www.');
      var host = '';
      try { host = new URL(link.data.url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
      link.data.title = host || 'Link';
      savePlanItem(link);
    } else {
      planAddText(value, key);
    }
    paintPlanner();
    util.toast(/^(https?:\/\/|www\.)\S+$/i.test(value) ? 'Added a link' : 'Added a note');
  }

  function adoptDragText(text, key) {
    var id = String(text || '').trim();
    if (!id || id.length > 64 || /^https?:\/\//i.test(id)) return false;
    var item = findItem(id);
    if (item) {
      planAdd(item, key);
      if (board.planner) board.planner.date = key;
      paintPlanner();
      return true;
    }
    var row = board.plans.filter(function (other) { return other.id === id; })[0];
    if (!row) return false;
    row.data.planner = key;
    savePlanItem(row);
    if (board.planner) board.planner.date = key;
    paintPlanner();
    util.toast('Moved to ' + calShort(key));
    return true;
  }

  function planDropEvent(event, key) {
    if (!planDragHas(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    var dt = event.dataTransfer;
    if (dt.files && dt.files.length) { planDropFiles(dt.files, key); return true; }
    var text = '';
    try { text = dt.getData('text/uri-list') || dt.getData('text/plain') || ''; } catch (e) { text = ''; }
    text = String(text).trim();
    if (!text) return false;
    if (adoptDragText(text, key)) return true;
    planDropText(text, key);
    return true;
  }

  function planClone(item) {
    var view = {};
    for (var key in item) { if (Object.prototype.hasOwnProperty.call(item, key)) view[key] = item[key]; }
    if (!view.data) { view.data = {}; item.data = view.data; }
    return view;
  }

  function planDragPill(label, src) {
    var style = src ? getComputedStyle(src) : null;
    var fill = style ? style.backgroundColor : '';
    if (!fill || /^rgba\(.*,\s*0(\.\d+)?\)$/.test(fill) || fill === 'transparent') fill = '#1b1e26';
    var line = (style && style.borderTopColor) || '#3a4050';
    var ink = (style && style.color) || '#e8eaf0';
    var name = String(label || 'Block').replace(/\s+/g, ' ').trim();
    if (name.length > 24) name = name.slice(0, 23) + '\u2026';
    var c = document.createElement('canvas');
    c.width = 168;
    c.height = 32;
    c.setAttribute('aria-hidden', 'true');
    var g = c.getContext('2d');
    g.fillStyle = fill;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = line;
    g.lineWidth = 2;
    g.strokeRect(1, 1, c.width - 2, c.height - 2);
    g.fillStyle = ink;
    g.font = '12px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(name, 12, 17);
    return c;
  }

  function planCard(entry) {
    var item = entry.item;
    var isBoard = !!entry.board;
    var view = planClone(item);
    var box = node('div', 'bd-item bd-item--' + item.kind + ' bd-item--in-plan');
    box.setAttribute('data-plan-id', item.id);
    if (isBoard) box.classList.add('is-linked');
    if (planDoneOf(item)) box.classList.add('is-done');
    view.node = box;
    box.__planView = view;
    var bar = node('div', 'bd-item__bar');
    bar.setAttribute('draggable', 'true');
    bar.title = 'Drag to reorder, or onto another day';
    bar.addEventListener('dragstart', function (event) {
      board.planDrag = { id: item.id, board: isBoard, from: entry.key };
      board.planDragSources = null;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain', item.id); } catch (e) { }
        var pill = planDragPill(planLabelOf(item), bar);
        pill.className = 'bd-plan__pill';
        pill.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;';
        Array.prototype.forEach.call(document.querySelectorAll('.bd-plan__pill'), function (n) { n.remove(); });
        document.body.appendChild(pill);
        event.dataTransfer.setDragImage(pill, 14, 16);
      }
    });
    bar.addEventListener('dragend', planDragStop);
    var label = barLabel(view, true);
    if (isBoard) {
      var jump = node('button', 'bd-item__plan is-jump', 'board');
      jump.type = 'button';
      jump.setAttribute('data-plan-jump', item.id);
      jump.setAttribute('data-plan-board', entry.boardId || BOARD_ID);
      jump.title = entry.foreign ? 'Show this block on ' + boardName(entry.boardId) : 'Show this block on the board';
      jump.setAttribute('aria-label', jump.title);
      jump.appendChild(App.ui.icon('external', 11));
      jump.addEventListener('click', function (event) {
        event.stopPropagation();
        revealOnBoard(entry);
      });
      label.appendChild(jump);
    }
    bar.appendChild(label);
    var tools = node('div', 'bd-item__tools');
    tools.appendChild(planWhenTools(item, isBoard));
    var done = planDoneOf(item);
    box.classList.toggle('is-done', done);
    var mark = node('button', 'bd-item__lock' + (done ? ' is-on' : ''), '');
    mark.type = 'button';
    mark.title = done ? 'Mark as not done' : 'Mark as done';
    mark.setAttribute('aria-label', mark.title);
    mark.appendChild(App.ui.icon('check', 12));
    mark.addEventListener('click', function (event) {
      event.stopPropagation();
      planSetDone(item, !planDoneOf(item));
      paintPlanner();
    });
    tools.appendChild(mark);
    var kill = node('button', 'bd-item__x', '×');
    kill.type = 'button';
    kill.setAttribute('aria-label', isBoard ? 'Remove from planner' : 'Delete this block');
    kill.title = isBoard ? 'Remove from planner' : 'Delete this block';
    kill.addEventListener('click', function (event) {
      event.stopPropagation();
      if (isBoard) { planRemove(item, entry.key || plan.date); paintPlanner(); }
      else removePlannerItem(item);
    });
    tools.appendChild(kill);
    bar.appendChild(tools);
    box.appendChild(bar);
    var body = node('div', 'bd-item__body');
    if (isBoard && !(board.planner && board.planner.full) && PLAN_ADD_KINDS.indexOf(item.kind) < 0) {
      box.classList.add('is-plain');
      body.classList.add('bd-cal__plain');
      body.appendChild(node('span', 'bd-cal__plainkind', kindText(item.kind).label));
      var open = node('button', 'bd-cal__plainopen', 'Show on the board');
      open.type = 'button';
      open.addEventListener('click', function (event) { event.stopPropagation(); revealOnBoard(entry); });
      body.appendChild(open);
    } else {
      body.appendChild(bodyFor(view));
      if (isBoard && board.planner && board.planner.full && item.kind === 'column') planGroupInside(body, item);
    }
    box.appendChild(body);
    if (item.kind === 'link') { try { renderLinkCard(view); } catch (e) { } }
    try { applyFont(view); } catch (e) { }
    try { applyReadOnly(view); } catch (e) { }
    return box;
  }

  var PLAN_ORIGIN = { x: 3000, y: 2400 };
  var PLAN_PAD = { w: 6000, h: 4800 };
  var planCanvasZ = 1;

  function planGroupInside(body, item) {
    var grid = body.querySelector('.bd-container__grid');
    if (!grid) return;
    var scale = (board.view && board.view.z) || 1;
    var outer = item.node ? item.node.getBoundingClientRect() : null;
    var inner = item.grid ? item.grid.getBoundingClientRect() : null;
    var offX = outer && inner ? (inner.left - outer.left) / scale : 0;
    var offY = outer && inner ? (inner.top - outer.top) / scale : 0;
    var bottom = 0;
    childEntries(item).forEach(function (entry) {
      var kid = entry.item;
      if (!kid) return;
      var kidBox = node('div', 'bd-item bd-item--' + kid.kind + ' bd-item--in-group');
      var left = Math.round(kid.x - item.x - offX);
      var top = Math.round(kid.y - item.y - offY);
      kidBox.style.left = left + 'px';
      kidBox.style.top = top + 'px';
      kidBox.style.width = Math.round(kid.w) + 'px';
      kidBox.style.height = Math.round(kid.h) + 'px';

      var kidBody = node('div', 'bd-item__body');
      kidBody.appendChild(bodyFor(kid));
      kidBox.appendChild(kidBody);
      grid.appendChild(kidBox);
      bottom = Math.max(bottom, top + kid.h);
    });
    if (bottom) grid.style.height = Math.max(60, Math.round(bottom)) + 'px';
  }

  // A new block takes the next place that is actually free, so moving blocks around never leaves a fresh one on top of another.
  function planCanvasFree(taken, w, h, index) {
    var gap = 24;
    var colStep = 330;
    var rowStep = 310;
    var clash = function (x, y) {
      return taken.some(function (box) {
        return x < box.x + box.w + gap && x + w + gap > box.x && y < box.y + box.h + gap && y + h + gap > box.y;
      });
    };
    var first = { x: 30 + (index % 3) * colStep, y: 30 + Math.floor(index / 3) * rowStep };
    if (!clash(first.x, first.y)) return first;
    for (var row = 0; row < 14; row++) {
      for (var col = 0; col < 12; col++) {
        var x = 30 + col * colStep;
        var y = 30 + row * rowStep;
        if (!clash(x, y)) return { x: x, y: y };
      }
    }
    var low = 30;
    taken.forEach(function (box) { low = Math.max(low, box.y + box.h + 30); });
    return { x: 30, y: low };
  }

  function planCanvasBox(item, key, index, taken) {
    var saved = item.data && item.data.planCanvas ? item.data.planCanvas[key] : null;
    if (saved && typeof saved.x === 'number') return { x: saved.x, y: saved.y, w: saved.w, h: saved.h };
    var w = Math.max(230, Math.round(item.w || 268));
    var h = Math.max(150, Math.round(item.h || 176));
    var spot = planCanvasFree(taken || [], w, h, index);
    return { x: spot.x, y: spot.y, w: w, h: h };
  }

  function planCanvasApply(card, box) {
    var view = planView(board.planner);
    card.style.left = '0px';
    card.style.top = '0px';
    card.style.width = Math.round(box.w) + 'px';
    card.style.height = Math.round(box.h) + 'px';
    card.style.transformOrigin = '0 0';
    card.style.transform = 'translate(' + Math.round(view.x + box.x * view.z) + 'px, ' + Math.round(view.y + box.y * view.z) + 'px) scale(' + view.z + ')';
    card.__planCanvas = box;
    var ink = card.querySelector('.bd-draw__canvas');
    if (ink && ink.inkPaint) requestAnimationFrame(function () { ink.inkPaint(); });
  }

  function planCanvasKeep(item, key, box) {
    if (!item.data) item.data = {};
    if (!item.data.planCanvas) item.data.planCanvas = {};
    item.data.planCanvas[key] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
    saveItem(item);
  }

  // The canvas moves a card with the pointer instead of the list's drag and drop, so the block keeps a
  // place of its own on the day and the day can be laid out like a board.
  function planCanvasPull(event, entry, key, dir) {
    if (event.button !== 0) return;
    var card = event.currentTarget && event.currentTarget.closest ? event.currentTarget.closest('.bd-item') : null;
    if (!card) return;
    // A drag moves the blocks you picked, and picking one block lets go of the block you added last.
    if (!dir && planSel().indexOf(card.getAttribute('data-plan-id')) < 0) planSelectPaint(card.parentNode, [card]);
    card.style.zIndex = ++planCanvasZ;
    var box = card.__planCanvas || planCanvasBox(entry.item, key, 0);
    card.__planCanvas = box;
    var zoom = planView(board.planner).z;
    var start = { x: event.clientX, y: event.clientY, box: { x: box.x, y: box.y, w: box.w, h: box.h } };
    var move = function (event) {
      var dx = (event.clientX - start.x) / zoom;
      var dy = (event.clientY - start.y) / zoom;
      if (dir) {
        var growX = dir.indexOf('e') >= 0 ? dx : dir.indexOf('w') >= 0 ? -dx : 0;
        var growY = dir.indexOf('s') >= 0 ? dy : dir.indexOf('n') >= 0 ? -dy : 0;
        var w = Math.max(230, Math.round(start.box.w + growX));
        var h = Math.max(150, Math.round(start.box.h + growY));
        box.w = w;
        box.h = h;
        box.x = Math.round(start.box.x + (dir.indexOf('w') >= 0 ? start.box.w - w : 0));
        box.y = Math.round(start.box.y + (dir.indexOf('n') >= 0 ? start.box.h - h : 0));
      } else {
        box.x = Math.round(start.box.x + dx);
        box.y = Math.round(start.box.y + dy);
      }
      if (!dir) {
        mateStart.forEach(function (row) {
          if (!row.card) return;
          row.card.__planCanvas.x = Math.round(row.x + dx);
          row.card.__planCanvas.y = Math.round(row.y + dy);
          planCanvasApply(row.card, row.card.__planCanvas);
        });
      }
      planCanvasApply(card, box);
      if (dir) {
        card.classList.add('is-resizing');
        card.style.cursor = RESIZE_CURSOR[dir] || 'nwse-resize';
      }
    };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      card.classList.remove('is-moving');
      card.classList.remove('is-resizing');
      card.style.cursor = '';
      planCanvasKeep(entry.item, key, box);
      mateStart.forEach(function (row) {
        if (row.item && row.card) planCanvasKeep(row.item, row.key, row.card.__planCanvas);
      });
    };
    var mateStart = planSel().map(function (id) {
      return card.parentNode ? card.parentNode.querySelector('[data-plan-id="' + id + '"]') : null;
    }).filter(function (other) {
      return other && other !== card && other.__planCanvas;
    }).map(function (other) {
      return { card: other, item: other.__planItem, key: other.__planKey, x: other.__planCanvas.x, y: other.__planCanvas.y };
    });
    card.classList.add('is-moving');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
    event.stopPropagation();
  }

  // Reordering the day slides blocks up and down the list, so a block takes its place on the canvas
  // once and keeps it, because the canvas is laid out by hand and the list is laid out by order.
  function planCanvasCard(card, entry, key, index, entries) {
    var taken = [];
    (entries || []).forEach(function (other) {
      if (!other || other === entry || !other.item || !other.item.data || !other.item.data.planCanvas) return;
      var row = other.item.data.planCanvas[key];
      if (row && typeof row.x === 'number') taken.push(row);
    });
    var box = planCanvasBox(entry.item, key, index, taken);
    var stored = entry.item.data && entry.item.data.planCanvas ? entry.item.data.planCanvas[key] : null;
    if (!stored) planCanvasKeep(entry.item, key, box);
    card.__planCanvas = box;
    card.setAttribute('data-plan-canvas', '1');
    card.__planItem = entry.item;
  card.__planKey = key;
  card.addEventListener('pointerdown', function (event) {
    if (event.target.closest && (event.target.closest('.bd-item__bar') || event.target.closest('.bd-item__resize') || event.target.closest('.bd-draw'))) return;
    planSelectPaint(card.parentNode, [card]);
  });
    var bar = card.querySelector('.bd-item__bar');
    if (bar) {
      var ordinal = node('span', 'bd-cal__ordinal', String(index + 1));
      ordinal.title = 'Number ' + (index + 1) + ' of the day';
      bar.insertBefore(ordinal, bar.firstChild);
      bar.setAttribute('draggable', 'false');
      bar.title = 'Drag to move the block, or drag its corner to resize';
      bar.addEventListener('pointerdown', function (event) { planCanvasPull(event, entry, key, false); });
    }
    RESIZE_DIRS.forEach(function (dir) {
      var grip = node('div', 'bd-item__resize bd-item__resize--' + dir);
      grip.setAttribute('data-dir', dir);
      grip.setAttribute('aria-hidden', 'true');
      grip.addEventListener('pointerdown', function (event) { planCanvasPull(event, entry, key, dir); });
      card.appendChild(grip);
    });
    planCanvasApply(card, box);
  }

  function planToolPaint(button, plan) {
    var on = plan.tool === 'select';
    button.textContent = '';
    var glyph = App.ui.icon(on ? 'marquee' : 'hand', 16);
    if (glyph) button.appendChild(glyph);
    button.classList.toggle('is-select', on);
    button.title = on ? 'Drag to select blocks, hold Space to pan' : 'Drag to pan the canvas';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    var day = button.closest('.bd-cal__day');
    var list = day ? day.querySelector('.bd-cal__list') : null;
    if (list) list.classList.toggle('is-select-mode', on);
  }

  function planToolButton(plan) {
    var button = calButton('', function () {
      plan.tool = plan.tool === 'select' ? 'grab' : 'select';
      planToolPaint(button, plan);
      if (plan.tool !== 'select') {
        var day = button.closest('.bd-cal__day');
        var list = day ? day.querySelector('.bd-cal__list') : null;
        if (list) planSelectPaint(list, []);
      }
      util.toast(plan.tool === 'select' ? 'Drag to select blocks' : 'Drag to pan the canvas');
    }, 'is-icon is-quiet');
    button.setAttribute('data-plan-tool', '1');
    planToolPaint(button, plan);
    return button;
  }

  function planCanvasGrab(event) {
    var plan = board.planner;
    if (!plan || !plan.full || event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('.bd-item')) return;
    if (board.space || plan.tool !== 'select') planCanvasPan(event, event.currentTarget);
    else planMarqueeStart(event, event.currentTarget);
  }

  function planCanvasPan(event, list) {
    var plan = board.planner;
    var view = planView(plan);
    var start = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    var move = function (event) {
      view.x = start.vx + (event.clientX - start.x);
      view.y = start.vy + (event.clientY - start.y);
      planPaintView(plan);
    };
    var up = function () {
      list.classList.remove('is-grabbing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    list.classList.add('is-grabbing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    event.preventDefault();
  }
  function planDayNav(plan) {
    var nav = node('div', 'bd-cal__daynav');
    var stepDay = function (delta) {
      var ms = calMs(plan.date);
      if (ms === null) return;
      plan.date = calKey(ms + delta * 86400000);
      plan.month = monthStart(calMs(plan.date));
      plan.calMonth = plan.month;
      paintPlanner();
    };
    var back = calButton('\u2039', function () { stepDay(-1); }, 'is-icon');
    back.title = 'Previous day';
    back.setAttribute('aria-label', 'Previous day');
    var next = calButton('\u203a', function () { stepDay(1); }, 'is-icon');
    next.title = 'Next day';
    next.setAttribute('aria-label', 'Next day');
    nav.appendChild(back);
    nav.appendChild(next);
    return nav;
  }

  // Today sits beside the stepper for the same reason it does in the planner header: it moves the
  // date, so it belongs with the arrows instead of inside them.
  function planOnToday(plan) {
    if (!plan) return true;
    var now = Date.now();
    var mode = planViewMode(plan);
    if (mode === 'month') return plan.month === monthStart(now);
    if (mode === 'year') return new Date(plan.month).getFullYear() === new Date(now).getFullYear();
    return plan.date === calKey(now);
  }

  function planTodayButton(todayKey) {
    var button = calButton('Today', function () {
      var plan = board.planner;
      if (!plan) return;
      plan.date = todayKey;
      plan.month = monthStart(calMs(todayKey));
      plan.calMonth = plan.month;
      paintPlanner();
    }, 'is-quiet bd-cal__today');
    button.title = 'Go to today';
    if (!planOnToday(board.planner)) button.classList.add('is-off');
    return button;
  }

  // A block that is focused stays in view through the repaint its own focus causes, so the wish to
  // reveal it rides along with the paint instead of racing it.
  function planReveal(id) {
    if (!id) return;
    board.planRevealId = id;
    board.planRevealUntil = Date.now() + 900;
    planScrollTo(id);
  }

  // Picking a block brings its bar into view on the clock, the way clicking an event in a calendar does.
  function planScrollTo(id) {
    if (!id) return;
    var el = plannerEl();
    var body = el.querySelector('.bd-cal__tbody');
    var bar = el.querySelector('.bd-cal__tevent[data-plan-id="' + id + '"]');
    if (!body || !bar) return;
    var view = body.getBoundingClientRect();
    var spot = bar.getBoundingClientRect();
    var room = 30;
    if (spot.top >= view.top + room && spot.bottom <= view.bottom - room) return false;
    var shift = spot.top < view.top + room ? spot.top - (view.top + room) : spot.bottom - (view.bottom - room);
    body.scrollTop = Math.max(0, Math.round(body.scrollTop + shift));
    return true;
  }

  // The month grid scrolls on its own, so the cell a block landed in is brought up the same way a bar is.
  function planCellIntoView(scroller, cell) {
    var view = scroller.getBoundingClientRect();
    var spot = cell.getBoundingClientRect();
    var room = 6;
    if (spot.top >= view.top + room && spot.bottom <= view.bottom - room) return false;
    var shift = spot.top < view.top + room ? spot.top - (view.top + room) : spot.bottom - (view.bottom - room);
    scroller.scrollTop = Math.max(0, Math.round(scroller.scrollTop + shift));
    return true;
  }

  // Bringing a fresh block's card up keeps it clear of the panel edge, the way the clock reveal keeps its bar clear.
  function planCardIntoView(list, card) {
    var view = list.getBoundingClientRect();
    var spot = card.getBoundingClientRect();
    var room = 14;
    var shift = spot.bottom > view.bottom - room ? spot.bottom - (view.bottom - room) : 0;
    if (spot.top - shift < view.top + room) shift = spot.top - (view.top + room);
    if (!shift) return false;
    list.scrollTop = Math.max(0, Math.round(list.scrollTop + shift));
    return true;
  }

  function planRevealFresh(plan) {
    var fresh = board.planFresh;
    if (!fresh || Date.now() > fresh.until) return;
    board.planFresh = null;
    // The paint returns before the new rows have the height they end up with, and opening the panel
    // sizes the grid again, so the reveal is repeated over the next few frames until it stops moving.
    var tries = 0;
    var step = function () {
      if (!board.planner) return;
      var moved = planShowFresh(board.planner, fresh);
      tries++;
      if (moved && tries < 5) setTimeout(step, tries < 3 ? 60 : 140);
    };
    requestAnimationFrame(function () { requestAnimationFrame(step); });
  }

  function planShowFresh(plan, fresh) {
    var moved = false;
    var grid = plannerEl().querySelector('.bd-cal__grid');
    if (fresh.key && grid && grid.clientHeight) {
      var cell = grid.querySelector('.bd-cal__cell[data-key="' + fresh.key + '"]');
      if (cell) moved = planCellIntoView(grid, cell) || moved;
    }
    var list = plannerEl().querySelector('.bd-cal__list');
    var card = list ? list.querySelector('[data-plan-id="' + fresh.id + '"]') : null;
    if (!list || !card) return moved;
    if (plan.full && card.__planCanvas) {
      var box = card.__planCanvas;
      var view = planView(plan);
      view.x = Math.round(list.clientWidth / 2 - (box.x + box.w / 2) * view.z);
      view.y = Math.round(list.clientHeight / 2 - (box.y + box.h / 2) * view.z);
      planPaintView(plan);
    } else {
      moved = planCardIntoView(list, card) || moved;
    }
    if (!plan.full) moved = planRectIntoView(plan, fresh.id) || moved;
    // The block is shown, not edited: taking the caret would pull the next keystroke into a field nobody asked for.
    card.classList.remove('is-selected');
    if (!board.planFreshFade) {
      board.planFreshFade = setTimeout(function () {
        board.planFreshFade = null;
        Array.prototype.forEach.call(plannerEl().querySelectorAll('.bd-item.is-fresh'), function (node) { node.classList.remove('is-fresh'); });
      }, 1400);
    }
    return moved;
  }

  function planRectIntoView(plan, id) {
    if (!id) return false;
    var body = plannerEl().querySelector('.bd-cal__tbody');
    if (!body) return false;
    var before = body.scrollTop;
    planReveal(id);
    return body.scrollTop !== before;
  }

  // The day canvas doubles as the drawing surface: in fullscreen a draw block is sketched anywhere on
  // the infinite board and lands where it was drawn, which is closer to the board than a dialog is.
  function planInkPlace(item, key, local, base, box) {
    if (!item.data) item.data = {};
    item.data.strokes = local;
    item.data.ox = base.x;
    item.data.oy = base.y;
    item.data.ink = 1;
    item.data.w = Math.max(16, box.w);
    item.data.h = Math.max(16, box.h);
    item.w = Math.max(230, Math.round(box.w) + INK_PAD * 2);
    item.h = Math.max(150, Math.round(box.h) + INK_PAD * 2 + INK_BAR);
    if (board.planner && board.planner.full) {
      if (!item.data.planCanvas) item.data.planCanvas = {};
      item.data.planCanvas[key] = { x: Math.round(box.x - INK_PAD), y: Math.round(box.y - INK_PAD), w: item.w, h: item.h };
    }
    savePlanItem(item);
    board.planFresh = { id: item.id, key: key, until: Date.now() + 4000 };
  }

  function planSel() {
    if (!board.planSel) board.planSel = [];
    return board.planSel;
  }

  function planSelectPaint(list, cards) {
    if (!list) return;
    var sel = planSel();
    var canvas = list.classList.contains('is-canvas');
    sel.length = 0;
    Array.prototype.forEach.call(list.querySelectorAll('.bd-item'), function (card) { card.classList.remove('is-selected'); });
    if (board.planFresh && !Array.prototype.some.call(cards, function (card) { return card.getAttribute('data-plan-id') === board.planFresh.id; })) board.planFresh = null;
    cards.forEach(function (card) {
      if (canvas && !card.__planCanvas) return;
      sel.push(card.getAttribute('data-plan-id'));
      card.classList.add('is-selected');
    });
    if (!canvas && cards.length) planReveal(cards[0].getAttribute('data-plan-id'));
  }

  function planMarqueeStart(event, list) {
    var plan = board.planner;
    if (!plan || !list) return;
    var view = planView(plan);
    var rect = list.getBoundingClientRect();
    var toCanvas = function (event) {
      return { x: (event.clientX - rect.left - view.x) / view.z, y: (event.clientY - rect.top - view.y) / view.z };
    };
    var start = toCanvas(event);
    var box = node('div', 'bd-cal__marbox');
    var moved = false;
    var paint = function (event) {
      var p = toCanvas(event);
      var x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      var w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      if (w > 4 || h > 4) moved = true;
      box.style.cssText = 'left:' + (x * view.z + view.x) + 'px;top:' + (y * view.z + view.y) + 'px;width:' + (w * view.z) + 'px;height:' + (h * view.z) + 'px;';
      var hits = [];
      Array.prototype.forEach.call(list.querySelectorAll('.bd-item'), function (card) {
        var row = card && card.__planCanvas;
        if (!row) return;
        if (row.x < x + w && row.x + row.w > x && row.y < y + h && row.y + row.h > y) hits.push(card);
      });
      planSelectPaint(list, hits);
    };
    var move = function (event) { paint(event); };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) planSelectPaint(list, []);
      if (box.parentNode) box.parentNode.removeChild(box);
    };
    if (!event.shiftKey) planSelectPaint(list, []);
    list.appendChild(box);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    paint(event);
    event.preventDefault();
  }
  function planView(plan) {
    if (!plan) return { x: 48, y: 28, z: 1 };
    if (!plan.view) plan.view = { x: 48, y: 28, z: 1 };
    return plan.view;
  }

  var PLAN_MAP = { w: 200, h: 132 };

  function planMapState() {
    var plan = board.planner;
    if (!plan) return null;
    if (!plan.map) plan.map = { el: null, canvas: null, ctx: null, frame: null, hover: null, hidden: false, fit: null, toggle: null };
    return plan.map;
  }

  function planMapHide(plan, on) {
    var map = planMapState();
    if (!map) return;
    map.hidden = !!on;
    try { App.prefs.set('planner.mapHidden', map.hidden); } catch (e) { }
    if (map.el) map.el.classList.toggle('is-maphidden', map.hidden);
    var button = map.toggle;
    if (button) {
      var text = map.hidden ? 'Show the minimap' : 'Hide the minimap';
      button.title = text;
      button.setAttribute('aria-label', text);
      button.setAttribute('aria-pressed', map.hidden ? 'true' : 'false');
      button.textContent = '';
      var mark = App.ui.icon(map.hidden ? 'eye' : 'eyeOff', 14);
      if (mark) button.appendChild(mark);
    }
    planMapDraw(plan);
  }

  function planMapCards(plan) {
    var list = plannerEl().querySelector('.bd-cal__list');
    if (!list) return [];
    return Array.prototype.filter.call(list.querySelectorAll('.bd-item[data-plan-canvas]'), function (card) { return !!card.__planCanvas; });
  }

  function planMapFit(plan) {
    var list = plannerEl().querySelector('.bd-cal__list');
    var view = planView(plan);
    var rect = list ? list.getBoundingClientRect() : { width: 900, height: 600 };
    var box = { x: -view.x / view.z, y: -view.y / view.z, w: Math.max(rect.width / view.z, 1), h: Math.max(rect.height / view.z, 1) };
    var grow = function (x, y, w, h) {
      var x2 = Math.max(box.x + box.w, x + w);
      var y2 = Math.max(box.y + box.h, y + h);
      box.x = Math.min(box.x, x);
      box.y = Math.min(box.y, y);
      box.w = x2 - box.x;
      box.h = y2 - box.y;
    };
    planMapCards(plan).forEach(function (card) {
      grow(card.__planCanvas.x, card.__planCanvas.y, Math.max(card.__planCanvas.w, 1), Math.max(card.__planCanvas.h, 1));
    });
    var pad = Math.max(box.w, box.h) * 0.08 + 24;
    box.x -= pad;
    box.y -= pad;
    box.w += pad * 2;
    box.h += pad * 2;
    var k = Math.min(PLAN_MAP.w / box.w, PLAN_MAP.h / box.h);
    return { x: box.x, y: box.y, w: box.w, h: box.h, k: k, ox: (PLAN_MAP.w - box.w * k) / 2 - box.x * k, oy: (PLAN_MAP.h - box.h * k) / 2 - box.y * k };
  }

  function planMapPaint(plan) {
    var map = planMapState();
    if (!map || !map.ctx || !map.canvas) return;
    var fit = planMapFit(plan);
    map.fit = fit;
    var canvas = map.canvas;
    var ctx = map.ctx;
    var dpr = window.devicePixelRatio || 1;
    var wide = Math.round(PLAN_MAP.w * dpr);
    var tall = Math.round(PLAN_MAP.h * dpr);
    if (canvas.width !== wide || canvas.height !== tall) {
      canvas.width = wide;
      canvas.height = tall;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PLAN_MAP.w, PLAN_MAP.h);
    var mx = function (x) { return fit.ox + x * fit.k; };
    var my = function (y) { return fit.oy + y * fit.k; };
    planMapCards(plan).forEach(function (card) {
      var box = card.__planCanvas;
      ctx.fillStyle = card.__planItem && planKindOf(card.__planItem) === 'draw' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(125, 141, 255, 0.32)';
      ctx.fillRect(mx(box.x), my(box.y), Math.max(box.w * fit.k, 2), Math.max(box.h * fit.k, 2));
    });
    var view = planView(plan);
    var list = plannerEl().querySelector('.bd-cal__list');
    var rect = list ? list.getBoundingClientRect() : { width: 900, height: 600 };
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(-view.x / view.z), my(-view.y / view.z), Math.max((rect.width / view.z) * fit.k, 3), Math.max((rect.height / view.z) * fit.k, 3));
    if (map.hover) {
      var hx = map.hover.x;
      var hy = map.hover.y;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx + 0.5, 0);
      ctx.lineTo(hx + 0.5, PLAN_MAP.h);
      ctx.moveTo(0, hy + 0.5);
      ctx.lineTo(PLAN_MAP.w, hy + 0.5);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function planMapDraw(plan) {
    var map = planMapState();
    if (!map || !map.ctx || map.hidden || !plan || !plan.full) return;
    if (map.frame) return;
    map.frame = window.requestAnimationFrame(function () {
      map.frame = null;
      planMapPaint(plan);
    });
  }

  function planMapToCanvas(plan, event) {
    var map = planMapState();
    if (!map || !map.canvas) return { x: 0, y: 0 };
    var fit = map.fit || planMapFit(plan);
    var rect = map.canvas.getBoundingClientRect();
    var scale = PLAN_MAP.w / Math.max(rect.width, 1);
    return {
      x: (event.clientX - rect.left) * scale / fit.k + (0 - fit.ox) / fit.k,
      y: (event.clientY - rect.top) * scale / fit.k + (0 - fit.oy) / fit.k,
    };
  }

  function planMapHover(plan, event) {
    var map = planMapState();
    if (!map || !map.canvas) return;
    var rect = map.canvas.getBoundingClientRect();
    map.hover = {
      x: (event.clientX - rect.left) * (PLAN_MAP.w / Math.max(rect.width, 1)),
      y: (event.clientY - rect.top) * (PLAN_MAP.h / Math.max(rect.height, 1)),
    };
    planMapDraw(plan);
  }

  function planMapCenter(plan, event) {
    var at = planMapToCanvas(plan, event);
    var list = plannerEl().querySelector('.bd-cal__list');
    if (!list) return;
    var view = planView(plan);
    var rect = list.getBoundingClientRect();
    view.x = Math.round(rect.width / 2 - at.x * view.z);
    view.y = Math.round(rect.height / 2 - at.y * view.z);
    planPaintView(plan);
  }

  function planMapBuild(plan, host) {
    var map = planMapState();
    if (!map || !host) return;
    try { map.hidden = !!App.prefs.get('planner.mapHidden', false); } catch (e) { map.hidden = false; }
    var wrap = node('div', 'bd-cal__map');
    var box = node('div', 'board__map');
    var canvas = node('canvas', 'board__map-canvas');
    canvas.title = 'Click or drag to move the view';
    canvas.setAttribute('aria-label', 'Day minimap, click or drag to move the view');
    var bar = node('div', 'board__map-bar');
    var zoom = node('div', 'board__zoom');
    var out = node('button', 'board__zoom-btn', '\u2212');
    out.type = 'button';
    out.title = 'Zoom out';
    out.addEventListener('click', function () { planZoomBy(plan, 1 / STEP); });
    var label = node('button', 'board__zoom-btn board__zoom-label', Math.round(planView(plan).z * 100) + '%');
    label.type = 'button';
    label.title = 'Reset zoom';
    label.addEventListener('click', function () { planZoomBy(plan, 1 / (planView(plan).z || 1)); });
    var inside = node('button', 'board__zoom-btn', '+');
    inside.type = 'button';
    inside.title = 'Zoom in';
    inside.addEventListener('click', function () { planZoomBy(plan, STEP); });
    zoom.appendChild(out);
    zoom.appendChild(label);
    zoom.appendChild(inside);
    var toggle = node('button', 'board__map-toggle');
    toggle.type = 'button';
    toggle.addEventListener('click', function () { planMapHide(plan, !map.hidden); });
    bar.appendChild(zoom);
    bar.appendChild(toggle);
    box.appendChild(canvas);
    box.appendChild(bar);
    wrap.appendChild(box);
    box.addEventListener('wheel', function (event) { event.stopPropagation(); }, { passive: true });
    canvas.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try { canvas.setPointerCapture(event.pointerId); } catch (e) { }
      planMapHover(plan, event);
      planMapCenter(plan, event);
    });
    canvas.addEventListener('pointermove', function (event) {
      planMapHover(plan, event);
      try { if (!canvas.hasPointerCapture(event.pointerId)) return; } catch (e) { return; }
      planMapCenter(plan, event);
    });
    canvas.addEventListener('pointerleave', function () {
      map.hover = null;
      planMapDraw(plan);
    });
    var release = function (event) {
      try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch (e) { }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    var old = map.el;
    map.el = wrap;
    map.canvas = canvas;
    map.ctx = canvas.getContext('2d');
    map.toggle = toggle;
    map.fit = null;
    host.appendChild(wrap);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    planMapHide(plan, map.hidden);
  }

  function planMapSync(plan) {
    var map = planMapState();
    if (!map) return;
    if (!plan.full) {
      if (map.el) map.el.hidden = true;
      return;
    }
    if (!map.el || map.el.parentNode !== document.body) planMapBuild(plan, document.body);
    if (map.el) map.el.hidden = false;
    planMapDraw(plan);
  }

  function planPaintView(plan) {
    if (!plan) return;
    var list = plannerEl().querySelector('.bd-cal__list');
    if (!list) return;
    var view = planView(plan);
    var dot = Math.max(8, 24 * view.z);
    list.style.backgroundSize = dot + 'px ' + dot + 'px';
    list.style.backgroundPosition = (((view.x % dot) + dot) % dot) + 'px ' + (((view.y % dot) + dot) % dot) + 'px';
    Array.prototype.forEach.call(list.querySelectorAll('.bd-item'), function (card) {
      if (card && card.__planCanvas) planCanvasApply(card, card.__planCanvas);
    });
    var label = plannerEl().querySelector('.bd-cal__zoomlabel');
    if (label) label.textContent = Math.round(view.z * 100) + '%';
    planMapDraw(plan);
  }

  function planPaintInk() {
    Array.prototype.forEach.call(document.querySelectorAll('.bd-cal__list .bd-draw__canvas'), function (ink) {
      ink.inkScale = 0;
      if (ink.inkPaint) ink.inkPaint();
    });
  }

  function planViewMode(plan) {
    if (plan && plan.full) return 'day';
    return (plan && plan.viewMode) || 'month';
  }

  function planSetView(plan, mode) {
    if (!plan || !mode) return;
    if (mode === 'day') {
      plan.dayOpen = true;
      plan.full = false;
      plan.viewMode = 'day';
      plan.calMonth = null;
    } else {
      plan.full = false;
      plan.dayOpen = mode === 'month';
      plan.viewMode = mode;
      if (mode === 'month') plan.calMonth = null;
    }
    board.plannerView = mode;
    try { App.prefs.set('board.planView', mode); } catch (e) { }
    paintPlanner();
  }

  function planViewSwitch(plan) {
    var wrap = node('div', 'bd-cal__views');
    var mode = planViewMode(plan);
    [['day', 'Day', 'Day view (D)'], ['week', 'Week', 'Week view (W)'], ['month', 'Month', 'Month view (M)'], ['year', 'Year', 'Year view (Y)']].forEach(function (def) {
      var button = calButton(def[1], function () { planSetView(plan, def[0]); }, 'is-quiet' + (def[0] === mode ? ' is-on' : ''));
      button.title = def[2];
      button.setAttribute('aria-pressed', def[0] === mode ? 'true' : 'false');
      wrap.appendChild(button);
    });
    return wrap;
  }

  function planNavLabel(plan) {
    var mode = planViewMode(plan);
    var ms = calMs(plan.date);
    var day = new Date(ms === null ? Date.now() : ms);
    if (mode === 'day') return CAL_MONTHS[day.getMonth()] + ' ' + day.getDate() + ', ' + day.getFullYear();
    if (mode === 'year') return String(new Date(plan.month).getFullYear());
    if (mode === 'week') {
      var start = new Date(day.getTime());
      start.setDate(start.getDate() - start.getDay());
      var end = new Date(start.getTime());
      end.setDate(start.getDate() + 6);
      var left = CAL_MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate();
      var right = (start.getMonth() === end.getMonth() ? '' : CAL_MONTHS[end.getMonth()].slice(0, 3) + ' ') + end.getDate();
      return left + ' - ' + right + ', ' + end.getFullYear();
    }
    return CAL_MONTHS[new Date(plan.month).getMonth()] + ' ' + new Date(plan.month).getFullYear();
  }

  function planShift(plan, dir) {
    if (!plan) return;
    var mode = planViewMode(plan);
    var ms = calMs(plan.date);
    if (mode === 'week') {
      plan.date = calKey((ms === null ? Date.now() : ms) + dir * 7 * 86400000);
      plan.month = monthStart(calMs(plan.date));
      plan.calMonth = plan.month;
    } else if (mode === 'year') {
      plan.month = calShift(plan.month, dir * 12);
      plan.calMonth = plan.month;
      plan.date = calKey(plan.month);
    } else if (mode === 'day') {
      plan.date = calKey((ms === null ? Date.now() : ms) + dir * 86400000);
      plan.month = monthStart(calMs(plan.date));
      plan.calMonth = plan.month;
    } else {
      shiftMonth(plan, dir);
      return;
    }
    paintPlanner();
  }

  function planZoomLabel(plan) {
    var z = plan && plan.full ? planView(plan).z : ((plan && plan.sheetZoom) || 1);
    return Math.round(z * 100) + '%';
  }

  function planSheetZoomPaint(plan) {
    var el = plannerEl();
    // The fullscreen day zooms by moving its cards and dots, so a CSS zoom here would scale it twice.
    el.style.setProperty('--cal-zoom', String(plan && plan.full ? 1 : ((plan && plan.sheetZoom) || 1)));
    var label = el.querySelector('.bd-cal__zoomlabel');
    if (label) label.textContent = planZoomLabel(plan);
  }

  function planSheetZoom(plan, factor) {
    if (!plan) return;
    var now = plan.sheetZoom || 1;
    var next = Math.min(1.6, Math.max(0.6, now * factor));
    if (Math.abs(next - now) < 0.001) return;
    plan.sheetZoom = next;
    planSheetZoomPaint(plan);
  }

  function planZoomStep(plan, factor) {
    var open = board.planner || plan;
    if (!open) return;
    if (open.full) planZoomBy(open, factor);
    else planSheetZoom(open, factor);
  }

  function planZoomReset(plan) {
    var open = board.planner || plan;
    if (!open) return;
    if (open.full) {
      planZoomBy(open, 1 / (planView(open).z || 1));
    } else {
      open.sheetZoom = 1;
    }
    planSheetZoomPaint(open);
  }

  function planCountIndex(plan) {
    var query = plan && plan.query ? String(plan.query).trim().toLowerCase() : '';
    var typed = planTypes(plan).length > 0;
    var map = {};
    planAllEntries().forEach(function (entry) {
      if ((query || typed) && !planEntryFiltered(entry, query)) return;
      map[entry.key] = (map[entry.key] || 0) + 1;
    });
    return map;
  }

  function planSumLabel(plan, mode, monthTotal, monthLate) {
    var plural = function (count) { return count + (count === 1 ? ' block' : ' blocks'); };
    if (mode === 'day') {
      var onDay = planFiltered(planEntries(plan.date)).length;
      return onDay ? plural(onDay) : '';
    }
    if (mode !== 'week' && mode !== 'year') {
      return monthTotal ? plural(monthTotal) + (monthLate ? ' \u00b7 ' + monthLate + ' late' : '') : '';
    }
    var counts = planCountIndex(plan);
    var ms = calMs(plan.date);
    var day = new Date(ms === null ? Date.now() : ms);
    if (mode === 'week') {
      var start = new Date(day.getTime());
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      var total = 0;
      for (var i = 0; i < 7; i++) total += counts[calKey(start.getTime() + i * 86400000)] || 0;
      return total ? plural(total) : '';
    }
    var year = String(day.getFullYear());
    var all = 0;
    Object.keys(counts).forEach(function (key) { if (key.slice(0, 4) === year) all += counts[key]; });
    return all ? plural(all) : '';
  }

  var PLAN_HOUR = 46;

  function planHourLabel(hour) {
    var shown = hour % 12;
    if (!shown) shown = 12;
    return shown + ' ' + (hour < 12 ? 'AM' : 'PM');
  }

  function planZoneLabel() {
    var offset = -new Date().getTimezoneOffset();
    var abs = Math.abs(offset);
    return 'GMT' + (offset < 0 ? '-' : '+') + (abs / 60 < 10 ? '0' : '') + Math.floor(abs / 60) + (abs % 60 ? ':' + (abs % 60 < 10 ? '0' : '') + (abs % 60) : '');
  }

  function planMinutesAt(column, clientY) {
    var box = column.getBoundingClientRect();
    if (!box.height) return 0;
    return (clientY - box.top) / box.height * 1440;
  }

  // The grip travels with the drag, because a repaint between the drag and the drop rebuilds everything
  // that could remember it.
  function planGrabY() {
    var drag = board.planDrag;
    var grabbed = drag ? drag.grab : null;
    return typeof grabbed === 'number' && grabbed > 0 ? grabbed : 0;
  }

  // A dragged block marks the slot it takes with a copy of itself, so the drag shows the block and its
  // range rather than the day it happens to be over.
  function planDropBand(col, event) {
    var drag = board.planDrag;
    if (!drag) return false;
    var item = planRowAny(drag.id);
    if (!item) return false;
    var isBoard = !!drag.board;
    var start = planClock(planTimeOf(item, isBoard));
    var band = col.querySelector('.bd-cal__dropband');
    Array.prototype.forEach.call(document.querySelectorAll('.bd-cal__dropband'), function (other) { if (other !== band) other.remove(); });
    if (!band) {
      band = node('div', 'bd-cal__dropband');
      band.setAttribute('aria-hidden', 'true');
      col.appendChild(band);
    }
    if (start === null) {
      // The block has no time of its own, so it takes the whole day and the whole day is what is marked.
      col.classList.add('is-over');
      band.className = 'bd-cal__tevent bd-cal__dropband is-ghost is-short';
      band.style.top = '2px';
      band.style.height = '22px';
      planBandFill(band, item, planLabelOf(item), '');
      return true;
    }
    col.classList.remove('is-over');
    var at = planSnapped(planMinutesAt(col, event.clientY - planGrabY()));
    var span = planSpanOf(item, isBoard);
    var length = span / 60 * PLAN_HOUR;
    var height = Math.max(16, length);
    var top = Math.min(at / 60 * PLAN_HOUR, 24 * PLAN_HOUR - height);
    band.className = 'bd-cal__tevent bd-cal__dropband is-ghost'
      + (length < 34 ? ' is-short' : '')
      + (length < 24 ? ' is-tiny' : '');
    band.style.top = Math.round(top) + 'px';
    band.style.height = Math.round(height) + 'px';
    planBandFill(band, item, planLabelOf(item), planTimeLabel(planStamped(at)) + ' - ' + planTimeLabel(planStamped(at + span)));
    return true;
  }

  function planBandFill(band, item, label, clock) {
    band.textContent = '';
    if (clock) band.appendChild(node('span', 'bd-cal__teventtime', clock));
    var line = node('span', 'bd-cal__teventname');
    line.appendChild(App.ui.icon(kindText(planKindOf(item)).icon, 11));
    var words = node('span', 'bd-cal__teventtext', '');
    words.innerHTML = planCellHtml(item, label);
    line.appendChild(words);
    band.appendChild(line);
  }

  function planDropBandClear() {
    Array.prototype.forEach.call(document.querySelectorAll('.bd-cal__dropband'), function (band) { band.remove(); });
  }

  // A drag can end anywhere, and a cancelled one ends where the pointer last was rather than over a
  // target, so the marks it made are taken away here instead of waiting for the next paint.
  function planDragStop() {
    board.planDrag = null;
    board.planDragSources = null;
    board.planDropIndex = null;
    planDropBandClear();
    Array.prototype.forEach.call(document.querySelectorAll('.bd-cal__tcol.is-over, .bd-cal__tallcol.is-over, .bd-cal__cell.is-over, .bd-cal__list.is-over'), function (over) { over.classList.remove('is-over'); });
    Array.prototype.forEach.call(document.querySelectorAll('.bd-cal__dropmark'), function (mark) { mark.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll('.bd-item.is-dragging'), function (card) { card.classList.remove('is-dragging'); });
    Array.prototype.forEach.call(document.querySelectorAll('.bd-plan__pill'), function (n) { n.remove(); });
  }

  // A drag that ends outside the planner still ends, and the planner hears about it here rather than
  // leaving the marks of a drag that is no longer happening on the screen.
  window.addEventListener('dragend', function () { if (board.planner) planDragStop(); });
  window.addEventListener('drop', function () { if (board.planner) planDragStop(); });

  function planSnapped(minutes) {
    return Math.max(0, Math.min(1425, Math.round(minutes / 15) * 15));
  }

  function planGridName(entry) {
    return planTitle(entry.item) || kindText(planKindOf(entry.item)).label;
  }

  function planGridPick(plan, key, id) {
    plan.date = key;
    planReveal(id);
    plan.month = monthStart(calMs(key));
    plan.dayOpen = true;
    board.planFresh = { id: id, key: key, board: !!board.planFresh && board.planFresh.board };
    paintPlanner();
  }

  // Press and drag down a lane to book a range. A press that does not travel books the hour it landed on.
  function planTimeDrag(col, key) {
    col.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || board.planDrag) return;
      if (event.target !== col) return;
      if (planQuickBusy()) return;
      event.preventDefault();
      var plan = board.planner;
      if (!plan || plan.tool === 'select' && plan.full) return;
      var anchor = planSnapped(planMinutesAt(col, event.clientY));
      var ghost = node('div', 'bd-cal__tdrag');
      var stamp = node('span', 'bd-cal__tdragtext');
      ghost.appendChild(stamp);
      col.appendChild(ghost);
      var scroller = col.closest ? col.closest('.bd-cal__tbody') : null;
      var from = anchor;
      var to = Math.min(1440, anchor + QUICK_HOUR);
      var moved = false;
      var paint = function (clientY) {
        var at = planSnapped(planMinutesAt(col, clientY));
        if (Math.abs(at - anchor) >= 15) moved = true;
        if (moved) {
          from = Math.min(anchor, at);
          to = Math.max(anchor, at);
          if (to - from < 15) to = from + 15;
        }
        ghost.style.top = (from / 60 * PLAN_HOUR) + 'px';
        ghost.style.height = Math.max(14, (to - from) / 60 * PLAN_HOUR) + 'px';
        stamp.textContent = planTimeLabel(planStamped(from)) + ' - ' + planTimeLabel(planStamped(to));
      };
      paint(event.clientY);
      // Holding the pointer past an edge walks the grid, so a range can run from any hour to any other.
      var holding = true;
      var frame = 0;
      var pointerY = event.clientY;
      var edge = function () {
        if (!holding) return;
        var step = 0;
        if (scroller) {
          var box = scroller.getBoundingClientRect();
          if (pointerY < box.top + 46) step = -Math.min(26, (box.top + 46 - pointerY) / 1.4);
          else if (pointerY > box.bottom - 46) step = Math.min(26, (pointerY - (box.bottom - 46)) / 1.4);
        }
        if (step) {
          var before = scroller.scrollTop;
          scroller.scrollTop = before + step;
          if (scroller.scrollTop !== before) paint(pointerY);
        }
        frame = window.requestAnimationFrame(edge);
      };
      frame = window.requestAnimationFrame(edge);
      var stop = function (event, cancelled) {
        holding = false;
        if (frame) window.cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', gone);
        if (ghost.parentNode) ghost.remove();
        if (cancelled) return;
        planAddKind(plan, key, planStamped(from), planStamped(to));
      };
      var move = function (event) { pointerY = event.clientY; paint(event.clientY); };
      var up = function (event) { stop(event, false); };
      var gone = function (event) { stop(event, true); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', gone);
    });
  }

  // Day and week share one clock: an hour gutter, a lane per day and every timed block drawn where it belongs.
  function planTimeGrid(plan, keys, todayKey, week) {
    var wrap = node('div', 'bd-cal__tgrid');
    var head = node('div', 'bd-cal__thead');
    head.appendChild(node('div', 'bd-cal__tcorner'));
    keys.forEach(function (key) {
      var day = new Date(calMs(key));
      var cell = node('button', 'bd-cal__tday' + (key === todayKey ? ' is-today' : '') + (key === plan.date ? ' is-sel' : ''));
      cell.type = 'button';
      cell.title = CAL_DAYS[day.getDay()] + ', ' + CAL_MONTHS[day.getMonth()] + ' ' + day.getDate();
      cell.appendChild(node('span', 'bd-cal__tdow', week ? CAL_DOW[day.getDay()] : CAL_DAYS[day.getDay()]));
      cell.appendChild(node('span', 'bd-cal__tdnum', String(day.getDate())));
      cell.addEventListener('click', (function (useKey) {
        return function () { planGridPick(plan, useKey, null); };
      })(key));
      head.appendChild(cell);
    });
    wrap.appendChild(head);
    var band = node('div', 'bd-cal__tall');
    band.appendChild(node('div', 'bd-cal__tallab', 'All day'));
    var lanes = node('div', 'bd-cal__tallcols');
    keys.forEach(function (key) {
      var lane = node('div', 'bd-cal__tallcol');
      lane.setAttribute('data-key', key);
      // A blank all day lane is a thin strip with nothing to aim at, so every lane ends with a quiet
      // line that books a block on the day it sits over.
      var add = node('button', 'bd-cal__tadd');
      add.type = 'button';
      add.title = 'Add a block on ' + CAL_MONTHS[new Date(calMs(key)).getMonth()] + ' ' + new Date(calMs(key)).getDate();
      add.setAttribute('aria-label', add.title);
      var addMark = App.ui.icon('plus', 10);
      if (addMark) add.appendChild(addMark);
      add.appendChild(node('span', 'bd-cal__taddtext', 'Add block'));
      add.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
      add.addEventListener('click', function (event) {
        event.stopPropagation();
        if (event.target !== add && event.target.parentNode !== add) return;
        if (planQuickBusy()) return;
        planAddKind(plan, key);
      });
      lane.addEventListener('pointerdown', (function (useKey) {
        return function (event) {
          if (event.button !== 0 || event.target !== lane) return;
          if (board.planDrag || board.planDragSources) return;
          if (planQuickBusy()) return;
          event.preventDefault();
          planAddKind(plan, useKey);
        };
      })(key));
      planSort(planFiltered(planEntries(key)), key).forEach(function (entry) {
        if (planTimed(entry)) return;
        var chip = node('button', 'bd-cal__tdchip' + (planDoneOf(entry.item) ? ' is-done' : ''));
        chip.type = 'button';
        chip.title = planGridName(entry, key);
        chip.appendChild(App.ui.icon(kindText(planKindOf(entry.item)).icon, 11));
        var chipText = node('span', 'bd-cal__tdchiptext', '');
        chipText.innerHTML = planCellHtml(entry.item, planGridName(entry, key));
        chip.appendChild(chipText);
        if (planDoneOf(entry.item)) chip.classList.add('is-done');
        chip.setAttribute('data-plan-id', entry.item.id);
        chip.addEventListener('click', function (event) {
          planGridPick(plan, key, entry.item.id);
          planQuickAdd(entry.item, key, planQuickAt(event), planQuickNode(entry.item), entry.board);
        });
        chip.setAttribute('draggable', 'true');
        chip.addEventListener('dragstart', function (event) {
          board.planDragSources = [{ id: entry.item.id, board: !!entry.board, from: key }];
          board.planDrag = board.planDragSources[0];
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', planDragStop);
        lane.appendChild(chip);
      });
      lane.addEventListener('dragover', function (event) {
        if (!board.planDrag && !planDragHas(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        lane.classList.add('is-over');
      });
      lane.addEventListener('dragleave', function () { lane.classList.remove('is-over'); });
      lane.addEventListener('drop', (function (useKey, useLane) {
        return function (event) {
          useLane.classList.remove('is-over');
          if (!board.planDrag) { planDropEvent(event, useKey); return; }
          event.preventDefault();
          var dropping = planRowAny(board.planDrag.id);
          // The band holds the blocks that own the whole day, so a drop here takes the clock away.
          if (dropping) {
            if (!dropping.data) dropping.data = {};
            if (board.planDrag.board) { dropping.data.planTime = ''; dropping.data.planEnd = ''; }
            else { dropping.data.time = ''; dropping.data.end = ''; }
            savePlanItem(dropping);
          }
          dropPlanOn(useKey);
        };
      })(key, lane));
      lane.appendChild(add);
      lanes.appendChild(lane);
    });
    band.appendChild(lanes);
    Array.prototype.forEach.call(lanes.children, function (lane) {
      if (!lane.querySelector('.bd-cal__tdchip')) lane.classList.add('is-empty');
    });
    wrap.appendChild(band);
    var body = node('div', 'bd-cal__tbody');
    var gutter = node('div', 'bd-cal__tgutter');
    gutter.appendChild(node('div', 'bd-cal__tz', planZoneLabel()));
    for (var hour = 0; hour < 24; hour++) gutter.appendChild(node('div', 'bd-cal__thour', planHourLabel(hour)));
    body.appendChild(gutter);
    var cols = node('div', 'bd-cal__tcols');
    var now = new Date();
    var nowMinutes = now.getHours() * 60 + now.getMinutes();
    keys.forEach(function (key) {
      var col = node('div', 'bd-cal__tcol' + (key === todayKey ? ' is-today' : ''));
      col.setAttribute('data-key', key);
      col.style.height = (24 * PLAN_HOUR) + 'px';
      planSort(planFiltered(planEntries(key)), key).forEach(function (entry) {
        var span = planTimed(entry);
        if (!span) return;
        var bar = node('button', 'bd-cal__tevent' + (planDoneOf(entry.item) ? ' is-done' : ''));
        bar.type = 'button';
        bar.setAttribute('data-plan-id', entry.item.id);
        var length = (span.end - span.start) / 60 * PLAN_HOUR;
        bar.style.top = (span.start / 60 * PLAN_HOUR) + 'px';
        bar.style.height = Math.max(16, length) + 'px';
        if (length < 34) bar.classList.add('is-short');
        if (length < 24) bar.classList.add('is-tiny');
        bar.title = planEventClock(entry.item, entry.board) + ' \u00b7 ' + planGridName(entry, key);
        bar.appendChild(node('span', 'bd-cal__teventtime', planEventClock(entry.item, entry.board)));
        var line = node('span', 'bd-cal__teventname');
        line.appendChild(App.ui.icon(kindText(planKindOf(entry.item)).icon, 11));
        var lineText = node('span', 'bd-cal__teventtext', '');
        lineText.innerHTML = planCellHtml(entry.item, planGridName(entry, key));
        line.appendChild(lineText);
        bar.appendChild(line);
        bar.setAttribute('draggable', 'true');
        bar.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
        bar.addEventListener('dragstart', (function (useEntry, useKey) {
          return function (event) {
            board.planDragSources = [{ id: useEntry.item.id, board: !!useEntry.board, from: useKey, grab: Math.max(0, Math.round(event.clientY - bar.getBoundingClientRect().top)) }];
            board.planDrag = board.planDragSources[0];
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          };
        })(entry, key));
        bar.addEventListener('dragend', planDragStop);
        bar.addEventListener('click', (function (useEntry, useKey) {
          return function (event) {
            event.stopPropagation();
            planGridPick(plan, useKey, useEntry.item.id);
            planQuickAdd(useEntry.item, useKey, planQuickAt(event), planQuickNode(useEntry.item), useEntry.board);
          };
        })(entry, key));
        col.appendChild(bar);
      });
      if (key === todayKey) {
        var mark = node('div', 'bd-cal__nowline');
        mark.style.top = (nowMinutes / 60 * PLAN_HOUR) + 'px';
        mark.title = 'Now';
        col.appendChild(mark);
      }
      planTimeDrag(col, key);
      col.addEventListener('dragover', function (event) {
        if (!board.planDrag && !planDragHas(event)) return;
        event.preventDefault();
        // A block that carries a time range only marks the range it will take, never the whole day.
        if (board.planDrag && planDropBand(col, event)) return;
        col.classList.add('is-over');
      });
      col.addEventListener('dragleave', function () { col.classList.remove('is-over'); });
      col.addEventListener('drop', (function (useKey, useCol) {
        return function (event) {
          col.classList.remove('is-over');
          planDropBandClear();
          if (board.planDrag) {
            event.preventDefault();
            var at = planStamped(planSnapped(planMinutesAt(useCol, event.clientY - planGrabY())));
            var isBoardDrag = !!board.planDrag.board;
            var moved = planRowAny(board.planDrag.id);
            // A block with no time of its own belongs to the whole day, so the clock it was dropped on
            // is not a time to give it.
            if (moved && planClock(planTimeOf(moved, isBoardDrag)) !== null) {
              if (!moved.data) moved.data = {};
              // The drop says where the block starts and nothing else, so the length it had travels with it.
              var stop = planStamped(Math.min(1440, planClock(at) + planSpanOf(moved, isBoardDrag)));
              if (isBoardDrag) { moved.data.planTime = at; moved.data.planEnd = stop; }
              else { moved.data.time = at; moved.data.end = stop; }
              savePlanItem(moved);
            }
            dropPlanOn(useKey);
            return;
          }
          if (planDropEvent(event, useKey)) event.preventDefault();
        };
      })(key, col));
      cols.appendChild(col);
    });
    body.appendChild(cols);
    wrap.appendChild(body);
    var spot = (week ? 'week ' : 'day ') + plan.date;
    var keep = board.plannerHourScroll && board.plannerHourScroll.key === spot ? board.plannerHourScroll.top : 7 * PLAN_HOUR - 14;
    requestAnimationFrame(function () { body.scrollTop = Math.max(0, keep); });
    body.addEventListener('scroll', function () { board.plannerHourScroll = { key: spot, top: body.scrollTop }; });
    return wrap;
  }

  function planWeekView(plan, todayKey) {
    var ms = calMs(plan.date);
    var start = new Date(ms === null ? Date.now() : ms);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    var keys = [];
    for (var i = 0; i < 7; i++) keys.push(calKey(start.getTime() + i * 86400000));
    return planTimeGrid(plan, keys, todayKey, true);
  }

  function planDayView(plan, todayKey) {
    return planTimeGrid(plan, [plan.date], todayKey, false);
  }
  function planYearView(plan, todayKey) {
    var counts = planCountIndex(plan);
    var ms = calMs(plan.date);
    var base = new Date(ms === null ? Date.now() : ms);
    var year = base.getFullYear();
    var picked = monthStart(ms === null ? Date.now() : ms);
    var wrap = node('div', 'bd-cal__yearview');
    for (var m = 0; m < 12; m++) {
      var first = new Date(year, m, 1);
      var stamp = year + '-' + String(m + 1).padStart(2, '0');
      var booked = Object.keys(counts).reduce(function (total, one) {
        return one.slice(0, 7) === stamp ? total + counts[one] : total;
      }, 0);
      var card = node('div', 'bd-cal__ymonth'
        + (first.getTime() === picked ? ' is-sel' : '')
        + (booked ? '' : ' is-empty'));
      var title = node('button', 'bd-cal__ytitle');
      title.type = 'button';
      title.title = 'Open ' + CAL_MONTHS[m] + ' ' + year;
      title.setAttribute('aria-label', CAL_MONTHS[m] + ' ' + year
        + (booked ? ', ' + booked + (booked === 1 ? ' block' : ' blocks') : ', no blocks'));
      title.appendChild(node('span', 'bd-cal__ymonthname', CAL_MONTHS[m]));
      if (booked) title.appendChild(node('span', 'bd-cal__ycount', String(booked)));
      title.addEventListener('click', (function (useMonth) {
        return function () {
          plan.month = new Date(year, useMonth, 1).getTime();
          plan.date = calKey(plan.month);
          planSetView(plan, 'month');
        };
      })(m));
      card.appendChild(title);
      var grid = node('div', 'bd-cal__ygrid');
      CAL_DOW.forEach(function (text) { grid.appendChild(node('span', 'bd-cal__ydow', text)); });
      var cursor = new Date(year, m, 1 - first.getDay());
      for (var i = 0; i < 42; i++) {
        var day = new Date(cursor.getTime());
        day.setDate(cursor.getDate() + i);
        var key = calKey(day.getTime());
        var count = counts[key] || 0;
        var cell = node('button', 'bd-cal__yday'
          + (day.getMonth() === m ? '' : ' is-out')
          + (key === todayKey ? ' is-today' : '')
          + (key === plan.date ? ' is-sel' : '')
          + (count ? ' has-plan' : ''));
        cell.type = 'button';
        cell.title = CAL_DAYS[day.getDay()] + ', ' + CAL_MONTHS[day.getMonth()] + ' ' + day.getDate() + (count ? ', ' + count + (count === 1 ? ' block' : ' blocks') : '');
        cell.appendChild(node('span', null, String(day.getDate())));
        if (count) cell.appendChild(node('span', 'bd-cal__ydot'));
        cell.setAttribute('data-year-key', key);
        cell.addEventListener('click', function () {
          var use = this.getAttribute('data-year-key');
          plan.date = use;
          plan.month = monthStart(calMs(use));
          plan.calMonth = plan.month;
          plan.dayOpen = true;
          paintPlanner();
        });
        grid.appendChild(cell);
      }
      card.appendChild(grid);
      wrap.appendChild(card);
    }
    return wrap;
  }
  function planZoomBy(plan, factor, px, py) {
    var view = planView(plan);
    var next = Math.min(2.5, Math.max(0.15, view.z * factor));
    if (Math.abs(next - view.z) < 0.001) return;
    var list = plannerEl().querySelector('.bd-cal__list');
    var rect = list ? list.getBoundingClientRect() : null;
    var cx = typeof px === 'number' ? px : (rect ? rect.width / 2 : 0);
    var cy = typeof py === 'number' ? py : (rect ? rect.height / 2 : 0);
    view.x = cx - (cx - view.x) * (next / view.z);
    view.y = cy - (cy - view.y) * (next / view.z);
    view.z = next;
    planPaintView(plan);
    planPaintInk();
    var zoomLabel = plannerEl().querySelector('.bd-cal__zoomlabel');
    if (zoomLabel) zoomLabel.textContent = planZoomLabel(plan);
  }

  function planFitView(plan) {
    var list = plannerEl().querySelector('.bd-cal__list');
    if (!list || !plan) return false;
    var cards = Array.prototype.slice.call(list.querySelectorAll('.bd-item[data-plan-id]'));
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    cards.forEach(function (card) {
      var box = card.__planCanvas;
      if (!box) return;
      left = Math.min(left, box.x);
      top = Math.min(top, box.y);
      right = Math.max(right, box.x + box.w);
      bottom = Math.max(bottom, box.y + box.h);
    });
    if (left === Infinity) return false;
    var view = planView(plan);
    var pad = 56;
    var wide = Math.max(120, list.clientWidth - pad * 2);
    var room = Math.max(120, list.clientHeight - pad * 2);
    var z = Math.min(1, Math.max(0.15, Math.min(wide / Math.max(1, right - left), room / Math.max(1, bottom - top))));
    view.z = z;
    view.x = Math.round((list.clientWidth - (right - left) * z) / 2 - left * z);
    view.y = Math.round((list.clientHeight - (bottom - top) * z) / 2 - top * z);
    planPaintView(plan);
    planPaintInk();
    planSheetZoomPaint(plan);
    return true;
  }

  function planCenterOn(plan, id) {
    var list = plannerEl().querySelector('.bd-cal__list');
    var card = list ? list.querySelector('[data-plan-id="' + id + '"]') : null;
    if (!list || !card || !card.__planCanvas) return;
    var box = card.__planCanvas;
    var view = planView(plan);
    view.x = Math.round(list.clientWidth / 2 - (box.x + box.w / 2) * view.z);
    view.y = Math.round(list.clientHeight / 2 - (box.y + box.h / 2) * view.z);
    planPaintView(plan);
    card.classList.add('is-fresh');
    window.setTimeout(function () { card.classList.remove('is-fresh'); }, 1200);
  }

  function planRailOutline(plan) {
    var wrap = node('div', 'bd-cal__outline');
    var entries = planSort(planFiltered(planEntries(plan.date)), plan.date);
    var head = node('div', 'bd-cal__railtitle', 'On this day');
    if (entries.length) head.appendChild(node('span', 'bd-cal__railcount', String(entries.length)));
    wrap.appendChild(head);
    if (!entries.length) {
      wrap.appendChild(node('div', 'bd-cal__railnote', 'Nothing planned yet.'));
      var railAdd = calButton('+ Add a block', function () { planAddKind(plan); }, 'is-quiet bd-cal__railadd');
      railAdd.title = 'Choose what to add to this day';
      wrap.appendChild(railAdd);
      return wrap;
    }
    entries.forEach(function (entry) {
      var row = node('button', 'bd-cal__olrow' + (planDoneOf(entry.item) ? ' is-done' : ''));
      row.type = 'button';
      row.title = 'Show this block on the canvas';
      row.setAttribute('data-ol-id', entry.item.id);
      var kindRow = BLOCK_KINDS.filter(function (kindDef) { return kindDef.kind === entry.item.kind; })[0];
      var glyph = node('span', 'bd-cal__olglyph');
      var glyphIcon = App.ui.icon((kindText(entry.item.kind) || {}).icon || 'note', 12);
      if (glyphIcon) glyph.appendChild(glyphIcon);
      row.appendChild(glyph);
      row.appendChild(node('span', 'bd-cal__oltitle', planTitle(entry.item) || entry.item.kind));
      row.appendChild(node('span', 'bd-cal__olkind', (kindRow || {}).label || entry.item.kind));
      row.addEventListener('click', function () { planCenterOn(plan, this.getAttribute('data-ol-id')); });
      wrap.appendChild(row);
    });
    return wrap;
  }

  // The clock scrolls, so its scrollbar eats into the row of columns while the day headers and the all day
  // lanes above it keep the full width. Handing that width back keeps the week one set of columns.
  function planWeekSync(el) {
    var grid = (el || plannerEl()).querySelector('.bd-cal__tgrid');
    if (!grid) return;
    var body = grid.querySelector('.bd-cal__tbody');
    var head = grid.querySelector('.bd-cal__thead');
    var all = grid.querySelector('.bd-cal__tall');
    if (!body || !head || !all) return;
    var gap = Math.round(body.offsetWidth - body.clientWidth);
    if (!(gap > 0)) gap = 0;
    var value = gap + 'px';
    if (head.style.paddingRight !== value) head.style.paddingRight = value;
    if (all.style.paddingRight !== value) all.style.paddingRight = value;
  }

  function planChrome(plan) {
    if (!plan) return;
    var el = plannerEl();
    planWeekSync(el);
    var day = el.querySelector('.bd-cal__day');
    if (!el.__planWheel) {
      el.__planWheel = true;
      el.addEventListener('wheel', function (event) {
        var open = board.planner;
        if (!open) return;
        var canvas = event.target && event.target.closest ? event.target.closest('.bd-cal__list.is-canvas') : null;
        if (!event.ctrlKey && !event.metaKey) {
          if (!canvas || !open.full) return;
          event.preventDefault();
          var view = planView(open);
          view.x -= event.deltaX;
          view.y -= event.deltaY;
          planPaintView(open);
          return;
        }
        event.preventDefault();
        if (open.full && canvas) {
          var rect = canvas.getBoundingClientRect();
          planZoomBy(open, Math.pow(1.0018, -event.deltaY), event.clientX - rect.left, event.clientY - rect.top);
          return;
        }
        planSheetZoom(open, Math.pow(1.0009, -event.deltaY));
      }, { passive: false });
    }
    if (!window.__planKeys) {
      window.__planKeys = true;
      window.addEventListener('keydown', function (event) {
        var open = board.planner;
        if (!open || event.ctrlKey || event.metaKey || event.altKey) return;
        var target = event.target;
        if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (String(event.key || '').toLowerCase() === 'f') {
          event.preventDefault();
          planFitView(open);
          return;
        }
        var want = { d: 'day', w: 'week', m: 'month', y: 'year' }[String(event.key || '').toLowerCase()];
        if (!want) return;
        event.preventDefault();
        planSetView(open, want);
      });
    }
    if (plan.__fitPending) {
      plan.__fitPending = false;
      planFitView(plan);
    }
    if (el.querySelector('.bd-cal__zoom')) return;
    var zoom = node('div', 'bd-cal__zoom');
    var minus = node('button', 'bd-cal__zoom-btn', '\u2212');
    minus.type = 'button';
    minus.title = 'Zoom out';
    minus.setAttribute('aria-label', 'Zoom out');
    minus.addEventListener('click', function () { planZoomStep(plan, 1 / 1.15); });
    var label = node('div', 'bd-cal__zoomlabel', planZoomLabel(plan));
    label.title = 'Reset the zoom';
    label.addEventListener('click', function () { planZoomReset(plan); });
    var plus = node('button', 'bd-cal__zoom-btn', '+');
    plus.type = 'button';
    plus.title = 'Zoom in';
    plus.setAttribute('aria-label', 'Zoom in');
    plus.addEventListener('click', function () { planZoomStep(plan, 1.15); });
    zoom.appendChild(minus);
    zoom.appendChild(label);
    zoom.appendChild(plus);
    var slot = el.querySelector('.bd-cal__zoomslot');
    (slot || day || el).appendChild(zoom);
  }
  function planInkZoom(wrap) {
    var plan = board.planner;
    if (!plan || !plan.full || !plan.view || plan.view.z === 1) return 1;
    return wrap && wrap.closest && wrap.closest('.bd-cal') ? plan.view.z : 1;
  }

  function calShift(ts, months) {
    var d = new Date(ts);
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    return monthStart(d.getTime());
  }

  // The month arrows alone make a far date a chore, so the month title opens one dialog that walks a
  // year, then a month, then a day, instead of pushing an inline picker into the middle of the grid.
  function planMiniGrid(plan, first, todayKey) {
    var grid = node('div', 'bd-cal__minigrid');
    var start = new Date(first.getTime());
    start.setDate(1 - first.getDay());
    for (var i = 0; i < 42; i++) {
      var day = new Date(start.getTime());
      day.setDate(start.getDate() + i);
      var key = calKey(day.getTime());
      var count = planFiltered(planEntries(key)).length;
      var cell = node('button', 'bd-cal__mday'
        + (day.getMonth() === first.getMonth() ? '' : ' is-out')
        + (key === todayKey ? ' is-today' : '')
        + (key === plan.date ? ' is-sel' : '')
        + (count ? ' has-plan' : ''));
      cell.type = 'button';
      cell.title = CAL_DAYS[day.getDay()] + ', ' + CAL_MONTHS[day.getMonth()] + ' ' + day.getDate()
        + (count ? ', ' + count + (count === 1 ? ' block' : ' blocks') : '');
      cell.appendChild(node('span', '', String(day.getDate())));
      if (count) cell.appendChild(node('span', 'bd-cal__mdot'));
      cell.setAttribute('data-mini-key', key);
      cell.addEventListener('click', function () {
        var use = this.getAttribute('data-mini-key');
        plan.date = use;
        plan.month = monthStart(calMs(use));
        plan.calMonth = plan.month;
        paintPlanner();
      });
      grid.appendChild(cell);
    }
    return grid;
  }

  function planQuickNav(plan) {
    var counts = planCountIndex(plan);
    var busy = {};
    Object.keys(counts).forEach(function (key) { busy[Number(key.slice(0, 4))] = true; });
    var todayKey = calKey(Date.now());
    var state = monthStart(plan.calMonth || plan.month || Date.now());
    var sel = plan.date || todayKey;
    var body = node('div', 'bd-qnav');
    var close = null;
    var wantFocus = false;
    var shown = function () { return new Date(state); };
    var pick = function (key) {
      if (!key) return;
      plan.date = key;
      plan.month = monthStart(calMs(key));
      plan.calMonth = plan.month;
      plan.dayOpen = true;
      if (close) close(null);
      paintPlanner();
    };
    var countIn = function (year, month) {
      var stamp = year + '-' + String(month + 1).padStart(2, '0');
      return Object.keys(counts).reduce(function (total, one) {
        return one.slice(0, 7) === stamp ? total + counts[one] : total;
      }, 0);
    };
    var reseat = function () {
      var view = shown();
      var was = new Date(calMs(sel));
      var last = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      sel = calKey(new Date(view.getFullYear(), view.getMonth(), Math.min(was.getDate(), last)).getTime());
    };
    var gotoMonth = function (ms) {
      state = monthStart(ms);
      reseat();
      wantFocus = true;
      draw();
    };
    var moveDays = function (days) {
      var next = new Date(calMs(sel));
      next.setDate(next.getDate() + days);
      sel = calKey(next.getTime());
      state = monthStart(next.getTime());
      wantFocus = true;
      draw();
    };
    var jump = node('div', 'bd-qnav__jump');
    var jumpIcon = node('span', 'bd-qnav__jumpicon');
    var searchMark = App.ui.icon('search', 13);
    if (searchMark) jumpIcon.appendChild(searchMark);
    var field = node('input', 'bd-qnav__input');
    field.type = 'text';
    field.spellcheck = false;
    field.setAttribute('aria-label', 'Jump to a date, a month or a year');
    field.placeholder = 'Jump to 2032-08-09, aug 2032, or 2032';
    field.title = 'Type a date, a month and year, or a year. Today, tomorrow and yesterday also work.';
    field.addEventListener('input', function () { jump.classList.remove('is-bad'); });
    field.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    jump.appendChild(jumpIcon);
    jump.appendChild(field);
    var months = node('div', 'bd-qnav__months');
    var cal = node('div', 'bd-qnav__cal');
    var head = node('div', 'bd-qnav__head');
    var dow = node('div', 'bd-qnav__dow');
    CAL_DOW.forEach(function (label) { dow.appendChild(node('span', null, label.slice(0, 2))); });
    var grid = node('div', 'bd-qnav__grid');
    cal.appendChild(head);
    cal.appendChild(dow);
    cal.appendChild(grid);
    var rail = node('div', 'bd-qnav__years');
    var total = node('span', 'bd-qnav__total', '');
    var foot = node('div', 'bd-qnav__foot');
    foot.appendChild(calButton('Today', function () { pick(todayKey); }, 'is-quiet bd-qnav__today'));
    foot.appendChild(total);
    var left = node('div', 'bd-qnav__left');
    left.appendChild(node('div', 'bd-qnav__sect', 'Month'));
    left.appendChild(months);
    left.appendChild(cal);
    var railWrap = node('div', 'bd-qnav__railwrap');
    railWrap.appendChild(rail);
    var right = node('div', 'bd-qnav__right');
    right.appendChild(node('div', 'bd-qnav__sect', 'Year'));
    right.appendChild(railWrap);
    var wrap = node('div', 'bd-qnav__body');
    wrap.appendChild(left);
    wrap.appendChild(right);
    body.appendChild(jump);
    body.appendChild(wrap);
    body.appendChild(foot);
    var railFrom = 0;
    var railTo = 0;
    var paintRail = function () {
      var year = shown().getFullYear();
      var from = Math.min(1960, year - 40);
      var to = Math.max(2060, year + 40);
      if (from !== railFrom || to !== railTo) {
        railFrom = from;
        railTo = to;
        rail.textContent = '';
        for (var value = from; value <= to; value++) {
          var row = node('button', 'bd-qnav__year');
          row.type = 'button';
          row.setAttribute('data-qnav-year', String(value));
          row.appendChild(node('span', null, String(value)));
          if (busy[value]) row.appendChild(node('span', 'bd-qnav__ydot'));
          row.addEventListener('click', (function (picked) {
            return function () { gotoMonth(new Date(picked, shown().getMonth(), 1).getTime()); };
          })(value));
          rail.appendChild(row);
        }
      }
      var on = null;
      Array.prototype.forEach.call(rail.children, function (row) {
        var match = row.getAttribute('data-qnav-year') === String(year);
        row.classList.toggle('is-sel', match);
        row.setAttribute('aria-pressed', match ? 'true' : 'false');
        if (match) on = row;
      });
      if (on && rail.getAttribute('data-qnav-at') !== String(year) && rail.clientHeight) {
        rail.setAttribute('data-qnav-at', String(year));
        rail.scrollTop = on.offsetTop - (rail.clientHeight - on.offsetHeight) / 2;
      }
    };
    var stepButton = function (glyph, tip, run) {
      var button = node('button', 'bd-qnav__step', glyph);
      button.type = 'button';
      button.title = tip;
      button.setAttribute('aria-label', tip);
      button.addEventListener('click', run);
      return button;
    };
    var draw = function () {
      var view = shown();
      var year = view.getFullYear();
      var month = view.getMonth();
      months.textContent = '';
      for (var index = 0; index < 12; index++) {
        var booked = countIn(year, index);
        var chip = node('button', 'bd-qnav__month'
          + (index === month ? ' is-sel' : '')
          + (booked ? ' has-plan' : ''));
        chip.type = 'button';
        chip.title = CAL_MONTHS[index] + ' ' + year
          + (booked ? ', ' + booked + (booked === 1 ? ' block' : ' blocks') : ', no blocks');
        chip.setAttribute('aria-label', chip.title);
        chip.setAttribute('aria-pressed', index === month ? 'true' : 'false');
        chip.appendChild(node('span', null, CAL_MONTHS[index].slice(0, 3)));
        if (booked) chip.appendChild(node('span', 'bd-qnav__mdot'));
        chip.addEventListener('click', (function (picked) {
          return function () { gotoMonth(new Date(year, picked, 1).getTime()); };
        })(index));
        months.appendChild(chip);
      }
      head.textContent = '';
      head.appendChild(stepButton('\u2039', 'Previous month', function () { gotoMonth(calShift(state, -1)); }));
      var label = node('div', 'bd-qnav__label');
      label.setAttribute('aria-label', CAL_MONTHS[month] + ' ' + year);
      label.appendChild(node('span', null, CAL_MONTHS[month]));
      label.appendChild(node('span', 'bd-qnav__yearname', String(year)));
      head.appendChild(label);
      head.appendChild(stepButton('\u203a', 'Next month', function () { gotoMonth(calShift(state, 1)); }));
      grid.textContent = '';
      var cell = new Date(view.getFullYear(), month, 1 - view.getDay());
      for (var i = 0; i < 42; i++) {
        var day = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate() + i);
        var key = calKey(day.getTime());
        var count = counts[key] || 0;
        var button = node('button', 'bd-qnav__day'
          + (day.getMonth() === month ? '' : ' is-out')
          + (key === todayKey ? ' is-today' : '')
          + (key === sel ? ' is-sel' : '')
          + (count ? ' has-plan' : ''));
        button.type = 'button';
        button.setAttribute('data-qnav-key', key);
        button.title = CAL_DAYS[day.getDay()] + ', ' + CAL_MONTHS[day.getMonth()] + ' ' + day.getDate() + ', ' + day.getFullYear()
          + (count ? ', ' + count + (count === 1 ? ' block' : ' blocks') : '');
        button.appendChild(node('span', null, String(day.getDate())));
        if (count) button.appendChild(node('span', 'bd-qnav__dot'));
        button.addEventListener('click', function () { pick(this.getAttribute('data-qnav-key')); });
        grid.appendChild(button);
      }
      var when = new Date(calMs(sel));
      total.textContent = CAL_DAYS[when.getDay()] + ', ' + CAL_MONTHS[when.getMonth()] + ' '
        + when.getDate() + ', ' + when.getFullYear();
      paintRail();
      if (wantFocus) {
        wantFocus = false;
        var cursor = grid.querySelector('.bd-qnav__day.is-sel');
        if (cursor) cursor.focus();
      }
    };
    var monthFromWord = function (word) {
      var head3 = String(word).slice(0, 3).toLowerCase();
      for (var index = 0; index < 12; index++) {
        if (CAL_MONTHS[index].slice(0, 3).toLowerCase() === head3) return index;
      }
      return -1;
    };
    var dayHit = function (year, month, day) {
      if (!(year >= 1000 && year <= 9999) || month < 0 || month > 11 || day < 1) return null;
      var probe = new Date(year, month, day);
      if (probe.getFullYear() !== year || probe.getMonth() !== month || probe.getDate() !== day) return null;
      return { key: calKey(probe.getTime()) };
    };
    var monthHit = function (year, month) {
      if (!(year >= 1000 && year <= 9999) || month < 0 || month > 11) return null;
      return { monthMs: new Date(year, month, 1).getTime() };
    };
    var read = function (raw) {
      var text = String(raw || '').trim().toLowerCase().replace(/[,\s]+/g, ' ');
      if (!text) return null;
      var now = new Date();
      if (text === 'today' || text === 'now') return { key: todayKey };
      if (text === 'tomorrow') { now.setDate(now.getDate() + 1); return { key: calKey(now.getTime()) }; }
      if (text === 'yesterday') { now.setDate(now.getDate() - 1); return { key: calKey(now.getTime()) }; }
      var hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
      if (hit) return dayHit(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3]));
      hit = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
      if (hit) {
        var wide = Number(hit[3]);
        return dayHit(wide < 100 ? 2000 + wide : wide, Number(hit[1]) - 1, Number(hit[2]));
      }
      hit = /^(\d{4})[-/.](\d{1,2})$/.exec(text);
      if (hit) return monthHit(Number(hit[1]), Number(hit[2]) - 1);
      hit = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
      if (hit) return monthHit(Number(hit[2]), Number(hit[1]) - 1);
      hit = /^(\d{4})$/.exec(text);
      if (hit) return monthHit(Number(hit[1]), shown().getMonth());
      var parts = text.split(' ');
      var month = -1;
      var day = 0;
      var year = 0;
      for (var n = 0; n < parts.length; n++) {
        var one = parts[n];
        var word = monthFromWord(one);
        if (word >= 0 && month < 0 && !/^\d+$/.test(one)) { month = word; continue; }
        if (/^\d{4}$/.test(one)) { year = Number(one); continue; }
        if (/^\d{1,2}(st|nd|rd|th)?$/.test(one)) { day = parseInt(one, 10); continue; }
        return null;
      }
      if (month < 0) return null;
      var use = year || shown().getFullYear();
      if (day) return dayHit(use, month, day) || monthHit(use, month);
      return monthHit(use, month);
    };
    var submit = function () {
      var hit = read(field.value);
      if (!hit) {
        jump.classList.add('is-bad');
        field.focus();
        return;
      }
      jump.classList.remove('is-bad');
      if (hit.key) { pick(hit.key); return; }
      if (hit.monthMs) { gotoMonth(hit.monthMs); return; }
    };
    var onKey = function (event) {
      if (event.target === field) return;
      var delta = 0;
      if (event.key === 'ArrowLeft') delta = -1;
      else if (event.key === 'ArrowRight') delta = 1;
      else if (event.key === 'ArrowUp') delta = -7;
      else if (event.key === 'ArrowDown') delta = 7;
      else if (event.key === 'PageUp') { event.preventDefault(); gotoMonth(calShift(state, event.shiftKey ? -12 : -1)); return; }
      else if (event.key === 'PageDown') { event.preventDefault(); gotoMonth(calShift(state, event.shiftKey ? 12 : 1)); return; }
      else if (event.key === 'Enter') { event.preventDefault(); pick(sel); return; }
      else return;
      event.preventDefault();
      moveDays(delta);
    };
    draw();
    App.ui.dialog({
      title: 'Go to a date',
      icon: 'calendar',
      body: body,
      hideFooter: true,
      focus: '.bd-qnav__day.is-sel',
      onOpen: function (api) {
        close = api.close;
        api.root.addEventListener('keydown', onKey);
        paintRail();
      },
    });
  }

  function planMiniCal(plan, todayKey) {
    var wrap = node('div', 'bd-cal__mini');
    var head = node('div', 'bd-cal__minihead');
    var shift = function (months) {
      plan.calMonth = calShift(plan.calMonth || plan.month, months);
      paintPlanner();
    };
    var step = function (label, tip, months) {
      var button = calButton(label, function () { shift(months); }, 'is-icon');
      button.title = tip;
      button.setAttribute('aria-label', tip);
      head.appendChild(button);
    };
    var shown = new Date(plan.calMonth || plan.month);
    var first = new Date(shown.getTime());
    first.setDate(1);
    step('\u00ab', 'Previous year', -12);
    step('\u2039', 'Previous month', -1);
    var miniTitle = calButton(CAL_MONTHS[first.getMonth()] + ' ' + first.getFullYear(), function () {
      planQuickNav(plan);
    }, 'is-quiet bd-cal__minititle');
    miniTitle.title = 'Go to a date';
    miniTitle.setAttribute('aria-haspopup', 'dialog');
    head.appendChild(miniTitle);
    step('\u203a', 'Next month', 1);
    step('\u00bb', 'Next year', 12);
    wrap.appendChild(head);
    var dow = node('div', 'bd-cal__minidow');
    CAL_DOW.forEach(function (text) { dow.appendChild(node('span', '', text)); });
    wrap.appendChild(dow);
    var grid = node('div', 'bd-cal__minigrid');
    var start = new Date(first.getTime());
    start.setDate(1 - first.getDay());
    for (var i = 0; i < 42; i++) {
      var day = new Date(start.getTime());
      day.setDate(start.getDate() + i);
      var key = calKey(day.getTime());
      var count = planFiltered(planEntries(key)).length;
      var cell = node('button', 'bd-cal__mday'
        + (day.getMonth() === first.getMonth() ? '' : ' is-out')
        + (key === todayKey ? ' is-today' : '')
        + (key === plan.date ? ' is-sel' : '')
        + (count ? ' has-plan' : ''));
      cell.type = 'button';
      cell.title = CAL_DAYS[day.getDay()] + ', ' + CAL_MONTHS[day.getMonth()] + ' ' + day.getDate() + (count ? ', ' + count + (count === 1 ? ' block' : ' blocks') : '');
      cell.appendChild(node('span', '', String(day.getDate())));
      if (count) cell.appendChild(node('span', 'bd-cal__mdot'));
      cell.setAttribute('data-mini-key', key);
      cell.addEventListener('click', function () {
        var use = this.getAttribute('data-mini-key');
        plan.date = use;
        plan.month = monthStart(calMs(use));
        plan.calMonth = plan.month;
        paintPlanner();
      });
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function paintPlanner() {
    planQuickClose();
    var shell = plannerEl();
    if (!shell.__planReveal) {
      shell.__planReveal = 1;
      var fromCard = function (event) {
        var card = event.target && event.target.closest ? event.target.closest('.bd-item') : null;
        if (card) planReveal(card.getAttribute('data-plan-id'));
      };
      // Capture, because picking a card repaints the column and takes the focus event down with it.
      shell.addEventListener('pointerdown', fromCard, true);
      shell.addEventListener('focusin', fromCard, true);
    }
    var plan = board.planner;
    if (!plan || !board.root) return;
    var el = plannerEl();
    var keepScroll = 0;
    var before = el.querySelector('.bd-cal__list');
    if (before) keepScroll = before.scrollTop;
    var gridBefore = el.querySelector('.bd-cal__grid');
    var keepGrid = gridBefore ? gridBefore.scrollTop : 0;
    var clockBefore = el.querySelector('.bd-cal__tbody');
    var keepClock = clockBefore ? clockBefore.scrollTop : 0;
    var active = document.activeElement;
    // Every keystroke rebuilds this view, so the search box has to be handed back its caret by hand.
    var caret = active && active.classList && active.classList.contains('bd-cal__filter')
      ? [active.selectionStart, active.selectionEnd]
      : null;
    el.textContent = '';
    el.classList.toggle('is-day-open', !!plan.dayOpen);
    var main = node('div', 'bd-cal__main');
    var top = node('div', 'bd-cal__top');
    top.classList.toggle('is-assign', plan.mode !== 'browse');
    var titles = {
      browse: 'Planner',
      assign: 'Choose a date for ' + plan.rows.length + (plan.rows.length === 1 ? ' block' : ' blocks'),
    };
    var lead = node('div', 'bd-cal__lead');
    lead.appendChild(node('span', 'bd-cal__label', titles[plan.mode] || 'Planner'));
    var nav = node('div', 'bd-cal__nav');
    var stepped = planViewMode(plan) || 'month';
    var previous = calButton('\u2039', function () { planShift(plan, -1); }, 'is-icon');
    previous.title = 'Previous ' + stepped;
    previous.setAttribute('aria-label', previous.title);
    nav.appendChild(previous);
    var monthTitle = calButton(planNavLabel(plan), function () {
      planQuickNav(plan);
    }, 'is-quiet bd-cal__mtitle bd-cal__mtjump');
    monthTitle.title = 'Go to a date';
    monthTitle.setAttribute('aria-haspopup', 'dialog');
    monthTitle.appendChild(node('span', 'bd-cal__mtcaret', '\u25be'));
    nav.appendChild(monthTitle);
    var following = calButton('\u203a', function () { planShift(plan, 1); }, 'is-icon');
    following.title = 'Next ' + stepped;
    following.setAttribute('aria-label', following.title);
    nav.appendChild(following);
    var toToday = calButton('Today', function () {
      plan.date = calKey(Date.now());
      plan.month = monthStart(Date.now());
      plan.calMonth = monthStart(Date.now());
      paintPlanner();
    }, 'is-quiet bd-cal__today');
    toToday.title = 'Go to today';
    if (!planOnToday(plan)) toToday.classList.add('is-off');
    nav.appendChild(toToday);
    lead.appendChild(nav);
    top.appendChild(lead);
    top.appendChild(node('div', 'bd-cal__spacer'));
    var trail = node('div', 'bd-cal__trail');
    trail.appendChild(planViewSwitch(plan));
    var sum = node('span', 'bd-cal__msum', '');
    var search = node('div', 'bd-cal__search');
    var glyph = App.ui.icon('search', 14);
    if (glyph) search.appendChild(glyph);
    var filter = node('input', 'bd-cal__filter');
    filter.type = 'search';
    filter.placeholder = 'Search blocks';
    filter.value = plan.query || '';
    filter.setAttribute('aria-label', 'Search planned blocks in every month');
    filter.addEventListener('input', function () {
      plan.query = filter.value;
      board.plannerFilter = true;
      paintPlanner();
    });
    filter.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !filter.value) return;
      event.stopPropagation();
      filter.value = '';
      plan.query = '';
      paintPlanner();
    });
    search.appendChild(filter);
    if (plan.query) {
      var clearSearch = node('button', 'bd-cal__searchx');
      clearSearch.type = 'button';
      clearSearch.title = 'Clear the search';
      clearSearch.setAttribute('aria-label', 'Clear the search');
      var cross = App.ui.icon('close', 12);
      if (cross) clearSearch.appendChild(cross);
      clearSearch.addEventListener('click', function () {
        plan.query = '';
        board.plannerFilter = true;
        paintPlanner();
      });
      search.appendChild(clearSearch);
    }
    if (board.plannerFilter) {
      filter.focus();
      try { filter.setSelectionRange(filter.value.length, filter.value.length); } catch (e) { }
      board.plannerFilter = false;
    }
    if (plan.mode === 'assign') {
      trail.appendChild(calButton('Remove from planner', function () {
        plan.rows.forEach(function (item) { setPlan(item, null); });
        closePlanner();
        util.toast('Removed from the planner');
      }, 'is-quiet'));
    }
    var dayToggle = node('button', 'bd-cal__btn is-quiet is-icon bd-cal__sheetbtn');
    dayToggle.type = 'button';
    dayToggle.title = plan.dayOpen ? 'Hide the day panel' : 'Show the day panel';
    dayToggle.setAttribute('aria-label', dayToggle.title);
    dayToggle.setAttribute('aria-pressed', plan.dayOpen ? 'true' : 'false');
    var dayGlyph = App.ui.icon('panel', 15);
    if (dayGlyph) dayToggle.appendChild(dayGlyph);
    dayToggle.addEventListener('click', function () {
      plan.dayOpen = !plan.dayOpen;
      if (!plan.dayOpen) plan.full = false;
      paintPlanner();
    });
    trail.appendChild(dayToggle);
    var shut = node('button', 'bd-cal__btn is-quiet is-icon bd-cal__close');
    shut.type = 'button';
    shut.title = 'Close the planner';
    shut.setAttribute('aria-label', 'Close the planner');
    var shutmark = App.ui.icon('close', 15);
    if (shutmark) shut.appendChild(shutmark);
    shut.addEventListener('click', function () { closePlanner(); });
    trail.appendChild(shut);
    top.appendChild(trail);
    main.appendChild(top);
    var rail = node('div', 'bd-cal__find');
    var group = node('div', 'bd-cal__grp');
    group.appendChild(search);
    if (plan.mode === 'browse') {
      var types = planTypeBar();
      if (types) group.appendChild(types);
    }
    rail.appendChild(group);
    rail.appendChild(sum);
    main.appendChild(rail);
    var viewMode = planViewMode(plan);
    var sheetDay = viewMode === 'day' && !plan.full;
    main.classList.toggle('is-dayview', sheetDay);
    main.classList.toggle('is-weekview', viewMode === 'week');
    main.classList.toggle('is-yearview', viewMode === 'year');
    if (viewMode === 'week') main.appendChild(planWeekView(plan, calKey(Date.now())));
    if (viewMode === 'year') main.appendChild(planYearView(plan, calKey(Date.now())));
    if (sheetDay) main.appendChild(planDayView(plan, calKey(Date.now())));
    var dow = node('div', 'bd-cal__dow');
    CAL_DOW.forEach(function (day) { dow.appendChild(node('span', '', day)); });
    main.appendChild(dow);
    var grid = node('div', 'bd-cal__grid');
    var monthTotal = 0;
    var monthLate = 0;
    var first = new Date(plan.month);
    var start = new Date(plan.month);
    start.setDate(1 - first.getDay());
    var todayKey = calKey(Date.now());
    for (var i = 0; i < 42; i++) {
      var day = new Date(start.getTime());
      day.setDate(start.getDate() + i);
      var key = calKey(day.getTime());
      var cell = node('button', 'bd-cal__cell');
      cell.type = 'button';
      cell.setAttribute('data-key', key);
      if (day.getMonth() !== first.getMonth()) cell.classList.add('is-out');
      if (key === todayKey) cell.classList.add('is-today');
      if (key === plan.date) cell.classList.add('is-sel');
      var entries = planFiltered(planEntries(key));
      monthTotal += entries.length;
      var num = node('span', 'bd-cal__n');
      num.appendChild(node('span', key === todayKey ? 'bd-cal__num is-today' : 'bd-cal__num', String(day.getDate())));
      if (key < todayKey) {
        var late = 0;
        entries.forEach(function (entry) { if (!planDoneOf(entry.item)) late++; });
        if (late) num.appendChild(node('span', 'bd-cal__nlate', late + ' late'));
        monthLate += late;
      }
      cell.appendChild(num);
      var groups = [];
      entries.forEach(function (entry) {
        var found = null;
        var entryKind = planKindOf(entry.item);
        groups.forEach(function (group) { if (group.kind === entryKind) found = group; });
        if (!found) {
          var text = kindText(entryKind);
          found = { kind: entryKind, label: text.label, icon: text.icon, n: 0, board: false, entries: [] };
          groups.push(found);
        }
        found.n++;
        found.entries.push(entry);
        if (entry.board) found.board = true;
        if (entry.item && entry.item.data) {
          if (entry.item.data.spanFrom === key) found.spanStart = true;
          if (entry.item.data.spanTo === key) found.spanEnd = true;
          if (entry.item.data.spanFrom && entry.item.data.spanTo && entry.item.data.spanFrom < key && key < entry.item.data.spanTo) found.spanMid = true;
        }
      });
      groups.slice(0, 3).forEach(function (group) {
        // A tag that stands for several blocks counts what is left of them, so finishing one takes it
        // off the count and only the last one strikes the whole line through.
        var left = group.entries.reduce(function (total, entry) {
          return planDoneOf(entry.item) ? total : total + 1;
        }, 0);
        var tag = node('span', 'bd-cal__t' + (left ? '' : ' is-done') + (group.board ? ' is-board' : '')
          + (group.spanStart ? ' is-span-start' : '')
          + (group.spanEnd ? ' is-span-end' : '')
          + (!group.spanStart && !group.spanEnd && group.spanMid ? ' is-span-mid' : ''));
        tag.appendChild(App.ui.icon(group.icon, 11));
        tag.appendChild(node('span', 'bd-cal__tlabel', group.n > 1 && left > 0 ? group.label + ' \u00d7' + left : group.label));
        tag.setAttribute('draggable', 'true');
        tag.addEventListener('dragstart', (function (useKey) {
          return function (event) {
            board.planDragSources = group.entries.map(function (entry) { return { id: entry.item.id, board: !!entry.board, from: useKey }; });
            board.planDrag = board.planDragSources[0];
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          };
        })(key));
        tag.addEventListener('dragend', planDragStop);
        cell.appendChild(tag);
      });
      if (groups.length > 3) cell.appendChild(node('span', 'bd-cal__t', '+' + (groups.length - 3) + ' more'));
      cell.addEventListener('click', (function (useKey) {
        return function () { onCell(useKey); };
      })(key));
      // The press picks a day, it does not ask to be shown the button it landed on, so the grid must not
      // scroll the cell into view. A press on a chip keeps its default, or dragging between days breaks.
      cell.addEventListener('mousedown', function (event) {
        var chip = event.target && event.target.closest ? event.target.closest('[draggable="true"]') : null;
        if (!chip) event.preventDefault();
      });
      cell.addEventListener('dragover', function (event) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        if (!board.planDrag && !planDragHas(event)) return;
        event.preventDefault();
        event.currentTarget.classList.add('is-over');
      });
      cell.addEventListener('dragleave', function (event) { event.currentTarget.classList.remove('is-over'); });
      cell.addEventListener('drop', function (event) {
        var dropKey = event.currentTarget.getAttribute('data-key');
        if (board.planDrag) {
          event.stopPropagation();
          event.preventDefault();
          event.currentTarget.classList.remove('is-over');
          dropPlanOn(dropKey);
          return;
        }
        if (!planDropEvent(event, dropKey)) return;
        event.currentTarget.classList.remove('is-over');
      });
      grid.appendChild(cell);
    }
    main.appendChild(grid);
    sum.textContent = planSumLabel(plan, viewMode, monthTotal, monthLate);
    if (plan.mode === 'browse' && plan.query && String(plan.query).trim()) {
      // A query looks through every month, so the calendar gives way to what it found.
      var matches = planMatches();
      if (dow.parentNode) main.removeChild(dow);
      if (grid.parentNode) main.removeChild(grid);
      main.appendChild(planResults(matches));
      sum.textContent = matches.length
        ? matches.length + (matches.length === 1 ? ' block' : ' blocks') + ' found in every month'
        : 'No block matches';
    }
    el.appendChild(main);
    var column = node('div', 'bd-cal__day');
    var ms = calMs(plan.date);
    var picked = new Date(ms === null ? Date.now() : ms);
    var dayTop = node('div', 'bd-cal__daytop');
    var dayInfo = node('div', 'bd-cal__dayinfo');
    dayInfo.appendChild(node('div', 'bd-cal__dayhead', CAL_DAYS[picked.getDay()] + ', ' + CAL_MONTHS[picked.getMonth()] + ' ' + picked.getDate()));
    var dayCountNode = node('div', 'bd-cal__daycount', '');
    dayInfo.appendChild(dayCountNode);
    dayTop.appendChild(dayInfo);
    var dayActs = node('div', 'bd-cal__dayacts');
    var blockLabel = 'Choose what to add to this day';
    var blockButton = calButton('+ Block', function () {
      planAddKind(plan);
    }, 'is-quiet bd-cal__addblock');
    blockButton.title = blockLabel;
    blockButton.setAttribute('aria-label', blockLabel);
    dayActs.appendChild(blockButton);
    var drawButton = calButton('', function () { addPlannerItem('draw', plan.date, ''); }, 'is-icon is-quiet');
    drawButton.title = 'Draw on this day';
    drawButton.setAttribute('aria-label', 'Draw on this day');
    drawButton.appendChild(App.ui.icon('pencil', 15));
    dayActs.appendChild(drawButton);
    if (plan.full) {
      dayActs.appendChild(node('span', 'bd-cal__sep'));
      dayActs.appendChild(planToolButton(plan));
    }
    dayActs.appendChild(node('div', 'bd-cal__zoomslot'));
    var dayClose = node('button', 'bd-cal__dayclose');
    dayClose.type = 'button';
    dayClose.title = 'Hide the day panel';
    dayClose.setAttribute('aria-label', 'Hide the day panel');
    var dayCross = App.ui.icon('close', 14);
    if (dayCross) dayClose.appendChild(dayCross);
    dayClose.addEventListener('click', function () {
      plan.dayOpen = false;
      paintPlanner();
    });
    if (plan.full) {
      var fitButton = calButton('Fit', function () { planFitView(plan); }, 'is-quiet');
      fitButton.title = 'Frame every block on this day (F)';
      fitButton.setAttribute('aria-label', 'Frame every block on this day');
      dayActs.appendChild(fitButton);
    }
    dayActs.appendChild(node('span', 'bd-cal__sep'));
    dayActs.appendChild(calButton(plan.full ? 'Exit fullscreen' : 'Fullscreen', function () {
      plan.full = !plan.full;
      plan.calMonth = null;
      plan.view = null;
      board.plannerView = plan.full ? 'day' : planViewMode(plan);
      try { App.prefs.set('board.planView', board.plannerView); } catch (e) { }
      paintPlanner();
    }, 'is-quiet'));
    dayActs.appendChild(dayClose);
    dayTop.appendChild(dayActs);
    if (plan.full) {
      dayTop.insertBefore(planDayNav(plan), dayActs);
      dayTop.insertBefore(planTodayButton(todayKey), dayActs);
    }
    column.appendChild(dayTop);
    var railPanel = null;
    if (plan.full) {
      railPanel = node('div', 'bd-cal__railpanel');
      column.appendChild(railPanel);
      railPanel.appendChild(planMiniCal(plan, todayKey));
    }
    var week = node('div', 'bd-cal__week');
    var weekStart = new Date(ms === null ? Date.now() : ms);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    for (var w = 0; w < 7; w++) {
      var stripDay = new Date(weekStart.getTime());
      stripDay.setDate(weekStart.getDate() + w);
      var stripKey = calKey(stripDay.getTime());
      var chip = node('button', 'bd-cal__wday' + (stripKey === todayKey ? ' is-today' : '') + (stripKey === plan.date ? ' is-sel' : ''));
      chip.type = 'button';
      chip.title = CAL_DAYS[stripDay.getDay()] + ', ' + CAL_MONTHS[stripDay.getMonth()] + ' ' + stripDay.getDate();
      chip.setAttribute('data-week-key', stripKey);
      chip.appendChild(node('span', '', CAL_DOW[stripDay.getDay()]));
      chip.appendChild(node('span', 'bd-cal__wn', String(stripDay.getDate())));
      var count = planFiltered(planEntries(stripKey)).length;
      chip.appendChild(node('span', 'bd-cal__wc', count ? String(count) : '\u00b7'));
      chip.addEventListener('click', function () {
        var useKey = this.getAttribute('data-week-key');
        plan.date = useKey;
        plan.month = monthStart(calMs(useKey));
        paintPlanner();
      });
      week.appendChild(chip);
    }
    if (railPanel) {
      // The week strip is the rail's own calendar, so it sits between the month and the day list.
      week.classList.add('is-rail');
      railPanel.appendChild(node('div', 'bd-cal__railtitle', 'This week'));
      railPanel.appendChild(week);
      railPanel.appendChild(planRailOutline(plan));
    } else {
      column.appendChild(week);
    }
    var list = node('div', 'bd-cal__list');
    var dayEntries = planSort(planFiltered(planEntries(plan.date)), plan.date);
    var dayDone = 0;
    dayEntries.forEach(function (entry) { if (planDoneOf(entry.item)) dayDone++; });
    dayCountNode.textContent = dayEntries.length
      ? dayEntries.length + (dayEntries.length === 1 ? ' block' : ' blocks') + (dayDone ? ' \u00b7 ' + dayDone + ' done' : '')
      : 'Nothing planned';
    if (!dayEntries.length) {
      if (plan.full) {
        var filtered = !!(plan.query || planTypes(plan).length);
        var blank = node('div', 'bd-cal__empty is-center');
        blank.appendChild(node('div', 'bd-cal__emptytitle', filtered ? 'Nothing matches the filter' : 'Nothing planned on this day'));
        blank.appendChild(node('div', 'bd-cal__emptyhint', filtered
          ? 'Clear the search or the type filter to see the whole day.'
          : 'Schedule one from the board, or add it right here.'));
        if (!filtered) blank.appendChild(calButton('+ Add a block', function () { planAddKind(plan); }, 'is-quiet bd-cal__emptyadd'));
        blank.appendChild(node('div', 'bd-cal__emptygestures', 'Drag to pan \u00b7 Ctrl + wheel to zoom \u00b7 F to frame'));
        list.appendChild(blank);
      } else {
        list.appendChild(node('div', 'bd-cal__empty', plan.query || planTypes(plan).length
          ? 'Nothing here matches the filter.'
          : (plan.mode === 'assign' ? 'Nothing on this day yet' : 'Nothing planned. Add a block, or schedule one from the board.')));
      }
    }
    list.addEventListener('dragover', function (event) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (!board.planDrag && !planDragHas(event)) return;
      event.preventDefault();
      list.classList.add('is-over');
      var frame = list.getBoundingClientRect();
      var y = event.clientY - frame.top + list.scrollTop;
      var cards = Array.prototype.slice.call(list.querySelectorAll('.bd-item[data-plan-id]'));
      var spans = cards.map(function (card) {
        var box = card.getBoundingClientRect();
        return { top: box.top - frame.top + list.scrollTop, bottom: box.bottom - frame.top + list.scrollTop };
      });
      var index = 0;
      spans.forEach(function (span) { if (y > (span.top + span.bottom) / 2) index++; });
      board.planDropIndex = index;
      var mark = list.querySelector('.bd-cal__dropmark');
      if (!mark) {
        mark = node('div', 'bd-cal__dropmark');
        mark.setAttribute('aria-hidden', 'true');
        list.appendChild(mark);
      }
      var gap = 5;
      var edge = !spans.length ? gap
        : index <= 0 ? spans[0].top - gap
        : index >= spans.length ? spans[spans.length - 1].bottom + gap
        : (spans[index - 1].bottom + spans[index].top) / 2;
      mark.style.top = Math.max(0, Math.round(edge) - 1) + 'px';
      var held = list.querySelector('.bd-item.is-dragging');
      if (!held && board.planDrag) {
        held = list.querySelector('.bd-item[data-plan-id="' + board.planDrag.id + '"]');
        if (held) held.classList.add('is-dragging');
      }
    });
    var clearDropHint = function () {
      list.classList.remove('is-over');
      var mark = list.querySelector('.bd-cal__dropmark');
      if (mark) mark.remove();
      Array.prototype.forEach.call(list.querySelectorAll('.bd-item.is-dragging'), function (card) {
        card.classList.remove('is-dragging');
      });
    };
    list.addEventListener('dragleave', function (event) {
      if (event.relatedTarget && list.contains(event.relatedTarget)) return;
      clearDropHint();
    });
    list.addEventListener('drop', function (event) {
      event.stopPropagation();
      var index = board.planDropIndex;
      board.planDropIndex = null;
      clearDropHint();
      if (board.planDrag) {
        dropPlanOn(plan.date, typeof index === 'number' ? index : undefined);
        return;
      }
      planDropEvent(event, plan.date);
    });
    if (plan.full && !plan.view) plan.__fitPending = true;
    dayEntries.forEach(function (entry, index) {
      var card = planCard(entry);
      if (plan.full) planCanvasCard(card, entry, plan.date, index, dayEntries);
      if (board.planFresh && board.planFresh.id === entry.item.id) card.classList.add('is-fresh');
      list.appendChild(card);
      var ink = card.querySelector('.bd-draw__canvas');
      if (ink && ink.inkPaint) requestAnimationFrame(function () { ink.inkPaint(); });
    });
column.addEventListener('dragover', function (event) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (!board.planDrag && !planDragHas(event)) return;
      event.preventDefault();
      column.classList.add('is-over');
    });
    column.addEventListener('dragleave', function (event) {
      if (event.relatedTarget && column.contains(event.relatedTarget)) return;
      column.classList.remove('is-over');
    });
    column.addEventListener('drop', function (event) {
      event.preventDefault();
      column.classList.remove('is-over');
      if (board.planDrag) { dropPlanOn(plan.date); return; }
      planDropEvent(event, plan.date);
    });
    if (plan.full) {
      column.classList.add('is-full');
      list.classList.add('is-canvas');
      if (board.planner && board.planner.tool === 'select') list.classList.add('is-select-mode');
      list.appendChild(node('div', 'bd-cal__canvas'));
      list.addEventListener('pointerdown', planCanvasGrab);
      if (!board.planFresh) requestAnimationFrame(function () {
        list.scrollLeft = PLAN_ORIGIN.x - 24;
        list.scrollTop = PLAN_ORIGIN.y - 24;
      });
    }
    column.appendChild(list);
    el.appendChild(column);
    planChrome(plan);
    planSheetZoomPaint(plan);
    if (plan.full) planPaintView(plan);
    planMapSync(plan);
    if (keepScroll) {
      var after = el.querySelector('.bd-cal__list');
      if (after) after.scrollTop = keepScroll;
    }
    var clock = el.querySelector('.bd-cal__tbody');
    if (clock && keepClock) clock.scrollTop = keepClock;
    var gridAfter = el.querySelector('.bd-cal__grid');
    if (gridAfter && keepGrid) gridAfter.scrollTop = keepGrid;
    planRevealFresh(plan);
    if (board.planRevealId && board.planRevealUntil > Date.now()) planScrollTo(board.planRevealId);
    if (caret) {
      filter.focus();
      try { filter.setSelectionRange(caret[0], caret[1]); } catch (e) { }
    }
  }
  function shiftMonth(plan, delta) {
    var d = new Date(plan.month);
    d.setMonth(d.getMonth() + delta);
    plan.month = monthStart(d.getTime());
    paintPlanner();
  }

  function onCell(key) {
    var plan = board.planner;
    if (!plan) return;
    if (plan.mode === 'assign') {
      plan.rows.forEach(function (item) { setPlan(item, key); });
      closePlanner();
      util.toast('Planned for ' + calShort(key));
      return;
    }
    // A month grid shows the days either side of its own month, and a press on one of them picks that
    // day. It is not a request to move the grid to their month, which would slide the days away.
    plan.date = key;
    plan.dayOpen = true;
    paintPlanner();
  }

  window.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !board.planner) return;
    if (document.querySelector('dialog[open]')) return;
    if (board.planner.full) {
      board.planner.full = false;
      board.planner.view = null;
      board.plannerView = planViewMode(board.planner);
      try { App.prefs.set('board.planView', board.plannerView); } catch (e) { }
      paintPlanner();
      return;
    }
    closePlanner();
  });

  function goToMark(mark) {
    var rect = board.stage.getBoundingClientRect();
    var x = rect.width / 2 - mark.x * board.view.z;
    var y = rect.height / 2 - mark.y * board.view.z;
    glideViewTo(x, y, clamp(Math.hypot(x - board.view.x, y - board.view.y) / 0.85, 320, 1150));
    if (mark.node && mark.node.isConnected) {
      mark.node.classList.add('is-hot');
      setTimeout(function () { if (mark.node) mark.node.classList.remove('is-hot'); }, 900);
    }
  }

  function editRow(row, mark) {
    commitEdits(null);
    var fresh = board.marksList ? board.marksList.querySelector('[data-mark="' + mark.id + '"]') : null;
    if (fresh) row = fresh;
    if (row.querySelector('.board__mark-editor')) return;
    var name = row.querySelector('.board__mark-name');
    var box = node('div', 'board__mark-editor');
    var nameInput = node('input', 'board__mark-edit');
    nameInput.type = 'text';
    nameInput.value = mark.name;
    nameInput.placeholder = 'Name';
    nameInput.setAttribute('aria-label', 'Landmark name');
    var descInput = node('input', 'board__mark-desc-edit');
    descInput.type = 'text';
    descInput.value = mark.desc || '';
    descInput.placeholder = 'Add a description (optional)';
    descInput.setAttribute('aria-label', 'Landmark description');
    box.appendChild(nameInput);
    box.appendChild(descInput);
    name.style.display = 'none';
    row.appendChild(box);
    nameInput.focus();
    nameInput.select();
    var done = function (keep) {
      if (!box.parentNode) return;
      var nextName = nameInput.value.trim();
      var nextDesc = descInput.value.trim();
      if (keep) {
        if (nextName) mark.name = nextName;
        mark.desc = nextDesc;
      }
      dropEditor(entry);
      box.parentNode.removeChild(box);
      name.style.display = '';
      paintMarks();
      if (keep) saveMarks(true);
      renderMarkList();
    };
    var entry = { commit: function () { done(true); }, field: box };
    pushEditor(entry);
    box.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); done(true); }
      else if (event.key === 'Escape') { event.preventDefault(); done(false); }
    });
    box.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!box.contains(document.activeElement)) done(true);
      }, 0);
    });
  }

  function markIcons(row, mark) {
    var open = row.querySelector('.board__mark-icons');
    if (open) { row.removeChild(open); return; }
    var grid = node('div', 'board__mark-icons');
    MARK_ICONS.forEach(function (name) {
      var pick = node('button', 'board__mark-pick');
      pick.type = 'button';
      pick.setAttribute('data-pick', name);
      pick.title = name;
      pick.setAttribute('aria-label', name);
      if ((mark.icon || 'pin') === name) pick.classList.add('is-on');
      pick.appendChild(App.ui.icon(name, 14));
      pick.addEventListener('click', function (event) {
        event.stopPropagation();
        mark.icon = name;
        saveMarks(true);
        paintMarks();
        renderMarkList();
      });
      grid.appendChild(pick);
    });
    row.appendChild(grid);
  }

  function renderMarkList() {
    mapDraw();
    var list = board.marksList;
    if (!list) return;
    list.textContent = '';
    var marks = board.marks || [];
    if (!marks.length) {
      list.appendChild(node('p', 'board__marks-empty', 'No landmarks yet.'));
      return;
    }
    marks.forEach(function (mark) {
      var row = node('div', 'board__mark-row');
      row.setAttribute('data-mark', mark.id);
      var pick = node('button', 'board__mark-icon');
      pick.type = 'button';
      pick.title = 'Change icon';
      pick.setAttribute('aria-label', 'Change icon');
      pick.appendChild(App.ui.icon(mark.icon || 'pin', 15));
      pick.addEventListener('click', function (event) { event.stopPropagation(); markIcons(row, mark); });
      var name = node('button', 'board__mark-name', mark.name);
      name.type = 'button';
      name.title = 'Go to ' + mark.name;
      name.addEventListener('click', function () { goToMark(mark); });
      name.addEventListener('dblclick', function (event) { event.preventDefault(); editRow(row, mark); });
      var tools = node('div', 'board__mark-tools');
      var edit = node('button', 'board__mark-act');
      edit.type = 'button';
      edit.title = 'Rename';
      edit.setAttribute('aria-label', 'Rename');
      edit.appendChild(App.ui.icon('pencil', 14));
      edit.addEventListener('click', function (event) { event.stopPropagation(); editRow(row, mark); });
      var place = node('button', 'board__mark-act');
      place.type = 'button';
      place.title = 'Move this landmark';
      place.setAttribute('aria-label', 'Move this landmark');
      place.appendChild(App.ui.icon('move', 14));
      place.addEventListener('click', function (event) { event.stopPropagation(); armMarkMove(mark); });
      var drop = node('button', 'board__mark-act');
      drop.type = 'button';
      drop.title = 'Remove';
      drop.setAttribute('aria-label', 'Remove');
      drop.appendChild(App.ui.icon('trash', 14));
      drop.addEventListener('click', function (event) { event.stopPropagation(); removeMark(mark); });
      tools.appendChild(edit);
      tools.appendChild(place);
      tools.appendChild(drop);
      row.appendChild(pick);
      row.appendChild(name);
      row.appendChild(tools);
      if (mark.desc) {
        var line = node('div', 'board__mark-desc', mark.desc);
        line.title = mark.desc;
        row.appendChild(line);
      }
      list.appendChild(row);
    });
  }

  function buildMarks() {
    var panel = node('div', 'board__marks');
    var head = node('div', 'board__marks-head');
    var back = node('button', 'board__marks-back');
    back.type = 'button';
    back.title = 'Back to tools';
    back.setAttribute('aria-label', 'Back to tools');
    back.appendChild(App.ui.icon('arrowLeft', 15));
    back.appendChild(node('span', null, 'Back'));
    back.addEventListener('click', function () { openMarks(false); });
    var add = node('button', 'board__marks-add');
    add.type = 'button';
    add.appendChild(App.ui.icon('pin', 14));
    add.appendChild(node('span', null, 'Add landmark'));
    add.addEventListener('click', function () { setMarking(!board.marking); });
    head.appendChild(back);
    head.appendChild(add);
    panel.appendChild(head);
    panel.appendChild(node('p', 'board__marks-hint', 'Drop a pin on the board, then name it. Click a pin, then click again to move it, or drag it. Hold Space to pan while placing. Use the pencil to rename a pin or add a description.'));
    var list = node('div', 'board__marks-list');
    panel.appendChild(list);
    panel.addEventListener('wheel', function (event) {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
      event.stopPropagation();
    }, { passive: false });
    board.marksPanel = panel;
    board.marksList = list;
    board.marksAdd = add;
    return panel;
  }

  function railButton(icon, label, action) {
    var button = node('button', 'board__tool');
    button.type = 'button';
    button.title = label;
    button.appendChild(App.ui.icon(icon, 17));
    button.appendChild(node('span', 'board__tool-label', label));
    button.addEventListener('click', action);
    return button;
  }

  var PLAN_ADD_KINDS = ['note', 'todo', 'link', 'image'];

  // The planner keeps a block of any kind, but only these four carry their own surface, so only they can
  // be started here. Anything else is a link to a block that already lives on a board.
  function planAddable(entry) { return PLAN_ADD_KINDS.indexOf(entry.kind) >= 0; }

  var BLOCK_KINDS = [
    { kind: 'note', label: 'Note', icon: 'note' },
    { kind: 'todo', label: 'To-do', icon: 'check' },
    { kind: 'link', label: 'Link', icon: 'external' },
    { kind: 'image', label: 'File', icon: 'file' },
    { kind: 'comment', label: 'Comment', icon: 'info' },
    { kind: 'column', label: 'Group', icon: 'panel' },
    { kind: 'table', label: 'Table', icon: 'grid' },
    { kind: 'draw', label: 'Draw', icon: 'pencil' },
  ];

  var PLAN_KIND_HINTS = {
    note: 'A page to write in',
    todo: 'A checklist of tasks',
    comment: 'A remark on the day',
    link: 'A URL to open',
    image: 'A picture or a file',
    table: 'Rows and columns',
    column: 'Holds other blocks',
    draw: 'Sketch by hand',
  };


  // Which kind it is matters, so a new block is picked rather than assumed to be a note.
  function planAddKind(plan, key, from, to) {
    var dayKey = key || plan.date;
    var grid = node('div', 'bd-cal__kinds');
    var tiles = [];
    var close = null;
    PLAN_ADD_KINDS.forEach(function (kind) {
      var text = kindText(kind);
      var tile = node('button', 'bd-cal__kindtile');
      tile.type = 'button';
      tile.setAttribute('data-kind', kind);
      var glyph = node('span', 'bd-cal__kindicon');
      var picture = App.ui.icon(text.icon, 15);
      if (picture) glyph.appendChild(picture);
      var words = node('span', 'bd-cal__kindtext');
      words.appendChild(node('span', 'bd-cal__kindlabel', text.label));
      words.appendChild(node('span', 'bd-cal__kindhint', PLAN_KIND_HINTS[kind] || ''));
      tile.appendChild(glyph);
      tile.appendChild(words);
      tile.addEventListener('click', function () { if (close) close(kind); });
      grid.appendChild(tile);
      tiles.push(tile);
    });
    grid.addEventListener('keydown', function (event) {
      var moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
      var move = moves[event.key];
      var at = tiles.indexOf(document.activeElement);
      if (move === undefined || at < 0) return;
      var next = tiles[Math.max(0, Math.min(tiles.length - 1, at + move))];
      if (!next) return;
      event.preventDefault();
      next.focus();
    });
    var ms = calMs(dayKey);
    var when = new Date(ms === null ? Date.now() : ms);
    App.ui.dialog({
      title: 'Add a block to ' + CAL_DAYS[when.getDay()] + ', ' + CAL_MONTHS[when.getMonth()] + ' ' + when.getDate(),
      icon: 'plus',
      body: grid,
      wide: true,
      hideFooter: true,
      focus: '.bd-cal__kindtile',
      onOpen: function (api) { close = api.close; },
    }).then(function (kind) { if (kind) planCompose(String(kind), dayKey, from, to); });
  }

  // Picking a type opens that block's own editor, so it is set up before it lands on the day.
  function planCompose(kind, key, from, to) {
    var item = planDraftItem(kind, key, from || '', to || '');
    item.__planDraft = true;
    var view = planClone(item);
    var card = node('div', 'bd-item bd-item--' + kind + ' bd-item--in-plan');
    var body = node('div', 'bd-item__body');
    card.appendChild(body);
    view.node = card;
    card.__planView = view;
    body.appendChild(bodyFor(view));
    if (kind === 'link') { try { renderLinkCard(view); } catch (e) { } }
    // A link card sizes itself to its own preview on the board; in the dialog it fills the form.
    card.style.width = '100%';
    card.style.height = 'auto';
    var wrap = node('div', 'bd-plan__compose');
    wrap.appendChild(card);
    // A link is one line of text, so the dialog says what the one line is for instead of leaving a hole.
    if (kind === 'link') {
      wrap.classList.add('is-link');
      wrap.appendChild(node('p', 'bd-plan__hint', 'Paste an address and the card fills in by itself.'));
    }
    // The box is bigger than one line, so a click on its empty grey has to mean "type here".
    wrap.addEventListener('pointerdown', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('.bd-text, .bd-title, input, textarea, button, a, [contenteditable="true"]')) return;
      var editor = wrap.querySelector('.bd-text, .bd-title, textarea');
      if (!editor) return;
      event.preventDefault();
      editor.focus();
      if (!editor.isContentEditable) return;
      var caret = document.createRange();
      caret.selectNodeContents(editor);
      caret.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(caret);
    });
    var ms = calMs(key);
    var when = new Date(ms === null ? Date.now() : ms);
    App.ui.dialog({
      title: 'New ' + kindText(kind).label + ' for ' + CAL_DAYS[when.getDay()] + ', ' + CAL_MONTHS[when.getMonth()] + ' ' + when.getDate()
        + (from && to ? ', ' + planTimeLabel(from) + ' - ' + planTimeLabel(to) : ''),
      icon: kindText(kind).icon,
      body: wrap,
      wide: true,
      cancelLabel: 'Cancel',
      confirmLabel: 'Create',
      focus: '.bd-plan__compose .bd-text, .bd-plan__compose textarea, .bd-plan__compose input',
    }).then(function (ok) {
      if (!ok || !board.planner) return;
      var made = item;
      delete made.__planDraft;
      made.updated_at = util.nowIso();
      board.plans.push(made);
      savePlanItem(made);
      board.planFresh = { id: made.id, key: key, until: Date.now() + 4000 };
      planGridPick(board.planner, key, made.id);
    });
  }

  function kindText(kind) {
    var found = null;
    BLOCK_KINDS.forEach(function (entry) { if (entry.kind === kind) found = entry; });
    return found || { kind: kind, label: String(kind || 'Block'), icon: 'note' };
  }

  function buildRail() {
    var rail = node('div', 'board__rail');
    board.rail = rail;
    var boards = node('div', 'board__rail-group');
    var boardsButton = railButton('layers', 'Boards', function () { showBoardsMenuFrom(boardsButton); });
    boardsButton.title = 'Board: ' + boardName(BOARD_ID);
    boardsButton.setAttribute('aria-label', boardsButton.title);
    boards.appendChild(boardsButton);
    board.boardButton = boardsButton;
    rail.appendChild(boards);
    var top = node('div', 'board__rail-group');
    top.appendChild(railButton('pin', 'Landmarks', function () { openMarks(!board.railMarks); }));
    rail.appendChild(top);
    var group = node('div', 'board__rail-group');
    BLOCK_KINDS.forEach(function (entry) {
      if (entry.kind === 'draw') {
        group.appendChild(railButton(entry.icon, entry.label, function () { setInkMode(!inkState.on); }));
        board.inkButton = group.lastElementChild;
        return;
      }
      group.appendChild(railButton(entry.icon, entry.label, function () { addItem(entry.kind); }));
    });
    rail.appendChild(group);
    var source = node('div', 'board__rail-group');
    source.appendChild(railButton('layers', 'From notes', openPicker));
    source.appendChild(railButton('restore', 'Fit', fitView));
    rail.appendChild(source);
    var foot = node('div', 'board__rail-group board__rail--foot');
    foot.appendChild(railButton('arrowLeft', 'Back', close));
    rail.appendChild(foot);
    return rail;
  }

  function isChild(item) {
    return !!(item.data && item.data.parent);
  }

  function containerOf(item) {
    return isChild(item) ? findItem(item.data.parent) : null;
  }

  function containerKids(id) {
    return board.items.filter(function (other) { return other.data && other.data.parent && String(other.data.parent) === String(id); });
  }

  function insideParent(item, ancestor) {
    var node = item;
    var guard = 0;
    while (node && node.data && node.data.parent && guard++ < 40) {
      if (String(node.data.parent) === String(ancestor.id)) return true;
      node = findItem(node.data.parent);
    }
    return false;
  }

  var CONTAINER_GAP = 12;
  var CONTAINER_ROW = 60;
  var CONTAINER_MIN_COL = 150;

  function gridSlots(container, skip) {
    var grid = container && container.grid;
    if (!grid) return [];
    return Array.prototype.filter.call(grid.children, function (child) {
      return child.classList && child.classList.contains('bd-item') && child !== (skip && skip.node);
    });
  }

  function containerGeom(container) {
    var width = container.grid.clientWidth;
    var cols = Math.max(1, Math.min(4, Math.floor((width + CONTAINER_GAP) / (CONTAINER_MIN_COL + CONTAINER_GAP))));
    return { cols: cols, colW: Math.max(80, (width - CONTAINER_GAP * (cols - 1)) / cols) };
  }

  function packBoxes(entries, geom) {
    var taken = [];
    var pitchY = CONTAINER_ROW + CONTAINER_GAP;
    var busy = function (r, c) { return !!(taken[r] && taken[r][c]); };
    var fits = function (r0, c0, span, rows) {
      if (c0 < 0 || c0 + span > geom.cols || r0 < 0) return false;
      for (var r = r0; r < r0 + rows; r++) {
        for (var c = c0; c < c0 + span; c++) if (busy(r, c)) return false;
      }
      return true;
    };
    var fill = function (r0, c0, span, rows) {
      for (var r = r0; r < r0 + rows; r++) {
        if (!taken[r]) taken[r] = [];
        for (var c = c0; c < c0 + span; c++) taken[r][c] = true;
      }
    };
    var depth = function () {
      var max = 0;
      for (var r = 0; r < taken.length; r++) if (taken[r]) max = r + 1;
      return max;
    };
    var firstFit = function (span, rows) {
      for (var r = 0; r < 400; r++) {
        for (var c = 0; c + span <= geom.cols; c++) if (fits(r, c, span, rows)) return { c: c, r: r };
      }
      return { c: 0, r: 0 };
    };
    var nearestFit = function (col, row, span, rows) {
      var limit = depth() + rows + 2;
      var best = null;
      var bestD = Infinity;
      for (var r = 0; r <= limit; r++) {
        for (var c = 0; c + span <= geom.cols; c++) {
          if (!fits(r, c, span, rows)) continue;
          var d = Math.abs(c - col) + Math.abs(r - row);
          if (d < bestD) { bestD = d; best = { c: c, r: r }; }
        }
      }
      return best || firstFit(span, rows);
    };
    return entries.map(function (entry) {
      var span = Math.max(1, Math.min(geom.cols, entry.span || 1));
      var rows = Math.max(1, Math.round(entry.rows || 1));
      var col = typeof entry.col === 'number' ? Math.max(0, Math.min(Math.max(0, geom.cols - span), entry.col)) : null;
      var row = typeof entry.row === 'number' ? Math.max(0, entry.row) : null;
      var at = null;
      if (col !== null && row !== null) at = fits(row, col, span, rows) ? { c: col, r: row } : nearestFit(col, row, span, rows);
      if (!at) at = firstFit(span, rows);
      fill(at.r, at.c, span, rows);
      return {
        left: Math.round(at.c * (geom.colW + CONTAINER_GAP)),
        top: Math.round(at.r * pitchY),
        width: Math.round(span * geom.colW + CONTAINER_GAP * (span - 1)),
        height: Math.round(rows * CONTAINER_ROW + CONTAINER_GAP * (rows - 1)),
        span: span,
        rows: rows,
        col: at.c,
        row: at.r,
      };
    });
  }

  function childEntries(container) {
    return gridSlots(container).map(function (child) {
      var held = child.classList.contains('bd-ghost');
      var item = held ? null : findItem(child.getAttribute('data-board-id'));
      var data = item && item.data ? item.data : null;
      var col = held ? Number(child.getAttribute('data-col')) : (data && typeof data.col === 'number' ? data.col : NaN);
      var row = held ? Number(child.getAttribute('data-row')) : (data && typeof data.row === 'number' ? data.row : NaN);
      return {
        node: child,
        item: item,
        ghost: held,
        col: isNaN(col) ? undefined : col,
        row: isNaN(row) ? undefined : row,
        span: held ? Number(child.getAttribute('data-span')) || 1 : (data && data.span ? data.span : 1),
        rows: held ? Number(child.getAttribute('data-rows')) || 3 : (data && data.rows ? data.rows : 3),
      };
    });
  }

  function cellOf(container, item) {
    if (!container || !container.grid || !item || !item.node) return null;
    var geom = containerGeom(container);
    var pitchX = geom.colW + CONTAINER_GAP;
    var pitchY = CONTAINER_ROW + CONTAINER_GAP;
    if (item.data && typeof item.data.col === 'number' && typeof item.data.row === 'number') {
      return { col: item.data.col, row: item.data.row };
    }
    return {
      col: Math.round(item.node.offsetLeft / pitchX),
      row: Math.round(item.node.offsetTop / pitchY),
    };
  }

  function cellUnder(container, clientX, clientY, span, rows) {
    if (!container || !container.grid) return null;
    var rect = container.grid.getBoundingClientRect();
    var scale = board.view.z || 1;
    var geom = containerGeom(container);
    var pitchX = geom.colW + CONTAINER_GAP;
    var pitchY = CONTAINER_ROW + CONTAINER_GAP;
    var wide = Math.max(1, Math.min(geom.cols, span || 1));
    var tall = Math.max(1, Math.round(rows || 1));
    var col = Math.floor((clientX - rect.left) / scale / pitchX);
    var row = Math.floor((clientY - rect.top) / scale / pitchY);
    return {
      col: Math.max(0, Math.min(Math.max(0, geom.cols - wide), col)),
      row: Math.max(0, row),
      span: wide,
      rows: tall,
    };
  }

  function freeCell(container, cell, skip) {
    if (!container || !container.grid || !cell) return null;
    var geom = containerGeom(container);
    var entries = childEntries(container).filter(function (entry) {
      return !entry.ghost && (!skip || entry.item !== skip);
    });
    var boxes = packBoxes(entries, geom);
    var taken = function (probe) {
      return boxes.some(function (box) {
        return box.col < probe.col + probe.span && box.col + box.span > probe.col &&
          box.row < probe.row + probe.rows && box.row + box.rows > probe.row;
      });
    };
    if (!taken(cell)) return cell;
    var limit = 0;
    boxes.forEach(function (box) { limit = Math.max(limit, box.row + box.rows); });
    limit += cell.rows + 2;
    var best = null;
    var bestD = Infinity;
    for (var r = 0; r <= limit; r++) {
      for (var c = 0; c + cell.span <= geom.cols; c++) {
        var probe = { col: c, row: r, span: cell.span, rows: cell.rows };
        if (taken(probe)) continue;
        var d = Math.abs(c - cell.col) + Math.abs(r - cell.row);
        if (d < bestD) { bestD = d; best = probe; }
      }
    }
    return best || cell;
  }

  function placeChild(item, container, clientX, clientY) {
    if (!container || !container.grid || !item.node) return false;
    var span = item.data && item.data.span ? item.data.span : 1;
    var rows = item.data && item.data.rows ? item.data.rows : 3;
    var cell = freeCell(container, cellUnder(container, clientX, clientY, span, rows), item);
    item.data.parent = container.id;
    item.data.col = cell.col;
    item.data.row = cell.row;
    return attachChild(item);
  }

  function containerSlot(container) {
    var slot = container.grid.querySelector('.bd-slot');
    if (!slot) {
      slot = node('div', 'bd-slot');
      container.grid.appendChild(slot);
    }
    return slot;
  }

  function layoutContainer(container, drop) {
    var grid = container && container.grid;
    if (!grid) return;
    var geom = containerGeom(container);
    var entries = childEntries(container);
    if (drop) entries = entries.filter(function (entry) { return !entry.ghost; });
    var blank = drop ? { slot: true, col: drop.col, row: drop.row, span: drop.span || 1, rows: drop.rows || 3 } : null;
    var list = entries.slice();
    if (blank) list.push(blank);
    var slot = containerSlot(container);
    var boxes = packBoxes(list, geom);
    var offsetX = 0;
    var offsetY = 0;
    if (container.node) {
      var scale = board.view.z || 1;
      var outer = container.node.getBoundingClientRect();
      var inner = grid.getBoundingClientRect();
      offsetX = (inner.left - outer.left) / scale;
      offsetY = (inner.top - outer.top) / scale;
    }
    var bottom = 0;
    boxes.forEach(function (box, i) {
      var entry = list[i];
      var target = entry.slot ? slot : entry.node;
      if (!target) return;
      target.style.display = '';
      target.style.left = box.left + 'px';
      target.style.top = box.top + 'px';
      target.style.width = box.width + 'px';
      target.style.height = box.height + 'px';
      if (entry.item) {
        entry.item.w = box.width;
        entry.item.h = box.height;
        entry.item.data.span = box.span;
        if (typeof entry.item.data.col !== 'number') entry.item.data.col = box.col;
        if (typeof entry.item.data.row !== 'number') entry.item.data.row = box.row;
        entry.item.x = Math.round(container.x + offsetX + box.left);
        entry.item.y = Math.round(container.y + offsetY + box.top);
      }
      bottom = Math.max(bottom, box.top + box.height);
    });
    if (!drop) slot.style.display = 'none';
    grid.style.height = Math.max(60, Math.round(bottom)) + 'px';
  }

  function showDropSlot(container, cell) {
    if (!container.grid || !cell) return;
    board.drop = { container: container, col: cell.col, row: cell.row, span: cell.span || 1, rows: cell.rows || 3 };
    layoutContainer(container, board.drop);
    paintDrop();
  }

  function clearDropSlot() {
    if (!board.drop) return;
    var container = board.drop.container;
    board.drop = null;
    if (container) layoutContainer(container, null);
    paintDrop();
  }

  function paintDrop() {
    board.items.forEach(function (item) {
      if (item.node && item.kind === 'column') item.node.classList.toggle('is-drop', !!(board.drop && board.drop.container === item));
    });
  }

  var swapTarget = null;

  function setSwap(target) {
    if (swapTarget === target) { board.swap = { target: target }; return; }
    clearSwap();
    swapTarget = target;
    if (target.node) target.node.classList.add('is-swap');
    board.swap = { target: target };
  }

  function clearSwap() {
    if (swapTarget && swapTarget.node) swapTarget.node.classList.remove('is-swap');
    swapTarget = null;
    board.swap = null;
  }

  function siblingUnder(container, clientX, clientY, skip) {
    if (!container || !container.grid) return null;
    var rect = container.grid.getBoundingClientRect();
    var scale = board.view.z || 1;
    var x = (clientX - rect.left) / scale;
    var y = (clientY - rect.top) / scale;
    var entries = childEntries(container);
    var boxes = packBoxes(entries, containerGeom(container));
    var found = null;
    boxes.forEach(function (box, i) {
      if (found) return;
      var entry = entries[i];
      if (!entry || !entry.item || entry.item === skip) return;
      if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) found = { item: entry.item, box: box };
    });
    return found;
  }

  function sameRowOrCol(home, box) {
    if (!home || !box) return false;
    return home.col === box.col || home.row === box.row;
  }

  function swapCells(a, b, container) {
    if (!container || !container.grid) return false;
    var ca = cellOf(container, a);
    var cb = cellOf(container, b);
    if (!ca || !cb) return false;
    a.data.col = cb.col;
    a.data.row = cb.row;
    b.data.col = ca.col;
    b.data.row = ca.row;
    [a, b].forEach(function (item) {
      if (isChild(item)) return;
      item.data.parent = container.id;
      attachChild(item);
    });
    layoutContainer(container, null);
    return true;
  }

  function attachChild(item) {
    var parent = containerOf(item);
    if (!parent || !parent.grid || !item.node) return false;
    item.node.classList.add('is-child');
    item.node.style.left = '';
    item.node.style.top = '';
    item.node.style.width = '';
    item.node.style.height = '';
    item.node.style.zIndex = '';
    if (item.node.parentNode !== parent.grid) parent.grid.appendChild(item.node);
    if (!item.h) item.h = 120;
    layoutContainer(parent, null);
    return true;
  }

  function settleChildren() {
    board.items.forEach(function (item) {
      if (!isChild(item) || !item.node) return;
      if (!attachChild(item)) {
        item.data.parent = null;
        item.node.classList.remove('is-child');
        board.canvas.appendChild(item.node);
        placeItem(item);
      }
    });
    board.items.forEach(function (item) {
      if (item.kind === 'column' && item.grid) layoutContainer(item, null);
    });
    paintDrop();
  }

  var lift = [];

  function liftChild(item, container, cell) {
    if (!container || !container.grid || !item.node) return;
    var ghost = node('div', 'bd-item bd-ghost');
    ghost.setAttribute('data-span', String(item.data && item.data.span ? item.data.span : 1));
    ghost.setAttribute('data-rows', String(item.data && item.data.rows ? item.data.rows : 3));
    if (cell) {
      ghost.setAttribute('data-col', String(cell.col));
      ghost.setAttribute('data-row', String(cell.row));
    }
    if (item.node.parentNode === container.grid) container.grid.insertBefore(ghost, item.node);
    else container.grid.appendChild(ghost);
    lift.push({ ghost: ghost, container: container });
  }

  function clearLift() {
    var held = lift;
    lift = [];
    held.forEach(function (entry) {
      if (entry.ghost && entry.ghost.parentNode) entry.ghost.parentNode.removeChild(entry.ghost);
    });
    held.forEach(function (entry) { layoutContainer(entry.container, null); });
  }

  function detachChild(item, clientX, clientY) {
    if (!isChild(item) || !item.node) return;
    var parent = containerOf(item);
    var rect = item.node.getBoundingClientRect();
    var scale = board.view.z || 1;
    var point = canvasPoint(clientX, clientY);
    if (rect.width) item.w = Math.round(rect.width / scale);
    if (rect.height) item.h = Math.round(rect.height / scale);
    item.data.parent = null;
    item.x = Math.round(point.x - (clientX - rect.left) / scale);
    item.y = Math.round(point.y - (clientY - rect.top) / scale);
    item.node.classList.remove('is-child');
    item.node.style.left = '';
    item.node.style.top = '';
    item.node.style.width = '';
    item.node.style.height = '';
    board.canvas.appendChild(item.node);
    placeItem(item);
    if (parent) layoutContainer(parent, null);
  }

  function releaseChild(item, parent) {
    if (!item.node) { item.data.parent = null; return; }
    var holder = containerOf(item);
    var rect = item.node.getBoundingClientRect();
    var scale = board.view.z || 1;
    if (rect.width) item.w = Math.round(rect.width / scale);
    if (rect.height) item.h = Math.round(rect.height / scale);
    item.data.parent = null;
    if (parent) {
      item.x = Math.round(parent.x + 20);
      item.y = Math.round(parent.y + parent.h + 20);
    }
    item.node.classList.remove('is-child');
    item.node.style.left = '';
    item.node.style.top = '';
    item.node.style.width = '';
    item.node.style.height = '';
    board.canvas.appendChild(item.node);
    placeItem(item);
    if (holder) layoutContainer(holder, null);
    saveItem(item);
  }

  function containerUnder(clientX, clientY, rows) {
    var point = canvasPoint(clientX, clientY);
    var best = null;
    board.items.forEach(function (item) {
      if (item.kind !== 'column' || !item.grid) return;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].item === item) return;
        if (insideParent(item, rows[i].item)) return;
      }
      if (point.x < item.x || point.x > item.x + item.w) return;
      if (point.y < item.y || point.y > item.y + item.h) return;
      if (!best || (item.z || 0) > (best.z || 0)) best = item;
    });
    return best ? { item: best } : null;
  }

  function openAddMenu(item, button) {
    var rect = button.getBoundingClientRect();
    var add = function (kind) {
return function () {
        var key = button.closest && button.closest('.bd-cal') && board.planner ? board.planner.date : null;
        if (key && item.data && item.data.planner) {
          board.planDrawAdd = true;
          var made = addPlannerItem(kind, key, '');
          board.planDrawAdd = false;
          if (made) {
            made.data.parent = item.id;
            savePlanItem(made);
            paintPlanner();
          }
          return;
        }
        addItem(kind, { parent: item.id });
        if (key) {
          var child = board.items[board.items.length - 1];
          if (child) planAdd(child, key, true);
          paintPlanner();
        }
      };
    };
    App.ui.openMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
      items: [
        { label: 'Note', icon: 'note', onclick: add('note') },
        { label: 'To-do', icon: 'check', onclick: add('todo') },
        { label: 'Link', icon: 'external', onclick: add('link') },
        { label: 'Comment', icon: 'info', onclick: add('comment') },
        { label: 'Table', icon: 'grid', onclick: add('table') },
        { label: 'Image or File', icon: 'upload', onclick: add('image') },
      ],
    });
  }

  function containerBody(item) {
    var wrap = node('div', 'bd-container');
    var grid = node('div', 'bd-container__grid');
    grid.setAttribute('data-board-grid', item.id);
    wrap.appendChild(grid);
    item.grid = grid;
    var add = node('button', 'bd-container__add');
    add.type = 'button';
    add.setAttribute('aria-label', 'Add a block inside this group');
    var badge = node('span', 'bd-container__add-badge');
    badge.appendChild(App.ui.icon('plus', 12));
    add.appendChild(badge);
    add.appendChild(node('span', 'bd-container__add-label', 'Add block'));
    add.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    add.addEventListener('click', function (event) {
      event.stopPropagation();
      if (lockOf(item)) return;
      openAddMenu(item, add);
    });
    wrap.appendChild(add);
    return wrap;
  }
  var TABLE_ROW = 30;
  var TABLE_MIN_H = 140;

  function tableShape(item, rows, cols, drop) {
    var cells = item.data.cells;
    if (!cells || !cells.length) return;
    var oldRows = cells.length;
    var oldCols = cells[0].length;
    var at = item.tableAt;
    var skipRow = drop === 'r' && at && typeof at.r === 'number' ? Math.min(at.r, oldRows - 1) : -1;
    var skipCol = drop === 'c' && at && typeof at.c === 'number' ? Math.min(at.c, oldCols - 1) : -1;
    var wantRows = Math.max(1, Math.min(40, rows));
    var wantCols = Math.max(1, Math.min(40, cols));
    if (skipRow < 0 && skipCol < 0 && wantRows === oldRows && wantCols === oldCols) return;
    if (lockOf(item)) return;
    pushUndo('edit');
    var source = [];
    for (var r = 0; r < oldRows; r++) {
      if (r === skipRow) continue;
      var row = [];
      for (var col = 0; col < oldCols; col++) {
        if (col === skipCol) continue;
        row.push(cells[r][col] || '');
      }
      source.push(row);
    }
    var next = [];
    for (var i = 0; i < wantRows; i++) {
      var line = source[i] ? source[i].slice(0, wantCols) : [];
      while (line.length < wantCols) line.push('');
      next.push(line);
    }
    item.data.cells = next;
    item.tableAt = null;
    item.h = Math.max(TABLE_MIN_H, Math.min(1600, item.h + (wantRows - oldRows) * TABLE_ROW));
    saveItem(item);
    placeItem(item);
    repaintBody(item);
  }

  function tableChange(item, rows, cols) {
    var cells = item.data.cells;
    if (!cells || !cells.length) return;
    tableShape(item, cells.length + rows, cells[0].length + cols, rows === -1 ? 'r' : (cols === -1 ? 'c' : null));
  }

  function tableTyped(item, axis, raw) {
    var cells = item.data.cells;
    if (!cells || !cells.length) return;
    var want = parseInt(raw, 10);
    if (isNaN(want)) return;
    if (axis === 'r') tableShape(item, want, cells[0].length, null);
    else tableShape(item, cells.length, want, null);
  }
  function tableNum(item, axis, value) {
    var input = node('input', 'bd-table__num');
    input.type = 'number';
    input.min = '1';
    input.max = '40';
    input.value = String(value);
    input.setAttribute('aria-label', axis === 'r' ? 'Rows' : 'Columns');
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    input.addEventListener('change', function () { tableTyped(item, axis, input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); tableTyped(item, axis, input.value); }
    });
    return input;
  }
  function tableStep(item, label, disabled, run) {
    var button = node('button', 'bd-table__btn', label);
    button.type = 'button';
    button.disabled = !!disabled;
    button.setAttribute('data-blocked', disabled ? '1' : '0');
    button.setAttribute('aria-label', label === '+' ? 'Add' : 'Remove');
    button.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    button.addEventListener('click', function (event) { event.stopPropagation(); run(); });
    return button;
  }
  function tableBody(item) {
    var cells = item.data && item.data.cells;
    if (!cells || !cells.length) {
      cells = [['', '', ''], ['', '', ''], ['', '', '']];
      item.data.cells = cells;
    }
    var wrap = node('div', 'bd-table');
    cells.forEach(function (row, r) {
      var line = node('div', 'bd-table__row');
      row.forEach(function (value, c) {
        var cell = node('div', 'bd-table__cell');
        cell.contentEditable = 'true';
        cell.spellcheck = false;
        cell.innerHTML = util.isRichHtml(value) ? util.sanitizeRichHtml(value) : util.escapeHtml(value || '');
        cell.addEventListener('input', function () {
          cells[r][c] = cell.innerHTML;
          item.updated_at = util.nowIso();
          queueItemSave(item);
        });
        cell.addEventListener('pointerdown', function () { item.tableAt = { r: r, c: c }; });
        cell.addEventListener('focus', function () { item.tableAt = { r: r, c: c }; });
        cell.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); cell.blur(); }
        });
        line.appendChild(cell);
      });
      wrap.appendChild(line);
    });
    var bar = node('div', 'bd-table__bar');
    bar.appendChild(node('span', 'bd-table__lbl', 'Rows'));
    bar.appendChild(tableNum(item, 'r', cells.length));
    bar.appendChild(tableStep(item, '\u2212', cells.length <= 1, function () { tableChange(item, -1, 0); }));
    bar.appendChild(tableStep(item, '+', false, function () { tableChange(item, 1, 0); }));
    bar.appendChild(node('span', 'bd-table__lbl', 'Cols'));
    bar.appendChild(tableNum(item, 'c', cells[0].length));
    bar.appendChild(tableStep(item, '\u2212', cells[0].length <= 1, function () { tableChange(item, 0, -1); }));
    bar.appendChild(tableStep(item, '+', false, function () { tableChange(item, 0, 1); }));
    wrap.appendChild(bar);
    return wrap;
  }

  function canvasPoint(clientX, clientY) {
    var rect = board.stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - board.view.x) / board.view.z,
      y: (clientY - rect.top - board.view.y) / board.view.z,
    };
  }

  function applyBgFromDb() {
    var row = null;
    try { row = App.db.boardGet(BOARD_ID); } catch (e) { row = null; }
    board.bg = (row && row.bg) || 'dots';
    if (board.root) board.root.setAttribute('data-bg', board.bg);
  }

  function setBg(name, quiet) {
    board.bg = name || 'dots';
    if (board.root) board.root.setAttribute('data-bg', board.bg);
    try { App.db.boardSaveBg(BOARD_ID, board.bg); } catch (e) { }
    if (!quiet) util.toast('Board background: ' + board.bg);
  }

  var CLONE_SKIP = { node: true, saveTimer: true, src: true };

  // A hand written copy instead of a JSON round trip: the board snapshots itself on
  // every edit, so this runs over every card and the string it used to build was pure
  // garbage the moment it was parsed.
  function cloneValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      var list = new Array(value.length);
      for (var i = 0; i < value.length; i++) list[i] = cloneValue(value[i]);
      return list;
    }
    var copy = {};
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (CLONE_SKIP[key]) continue;
      copy[key] = cloneValue(value[key]);
    }
    return copy;
  }

  function snapshotBoard() {
    var items = new Array(board.items.length);
    for (var i = 0; i < board.items.length; i++) items[i] = cloneValue(board.items[i]);
    return {
      items: items,
      view: { x: board.view.x, y: board.view.y, z: board.view.z },
      bg: board.bg,
      marks: markData(board.marks),
    };
  }

  var HISTORY_ROWS = 40000;

  function trimHistory(list) {
    var rows = board.items.length || 1;
    var keep = Math.floor(HISTORY_ROWS / rows);
    if (keep > 30) keep = 30;
    if (keep < 4) keep = 4;
    while (list.length > keep) list.shift();
  }

  function pushUndo(label) {
    if (!board.open || board.batch) return;
    board.undo.push({ label: label, snap: snapshotBoard() });
    trimHistory(board.undo);
    board.redo.length = 0;
  }

  function repaintAll() {
    if (!board.canvas) return;
    clearCanvas();
    board.cullForce = true;
    cullPass();
    settleChildren();
    paintLinks();
    paintSelection();
    paintMarks();
    mapDraw();
  }

  function rowChanged(item, row) {
    if (item.x !== row.x || item.y !== row.y || item.w !== row.w || item.h !== row.h) return true;
    if ((item.z || 0) !== (row.z || 0) || item.kind !== row.kind) return true;
    if ((item.ref_kind || null) !== (row.ref_kind || null)) return true;
    if ((item.ref_id || null) !== (row.ref_id || null)) return true;
    return JSON.stringify(item.data || {}) !== JSON.stringify(row.data || {});
  }

  function applySnap(snap) {
    var keep = {};
    snap.items.forEach(function (row) { keep[row.id] = true; });
    var live = {};
    board.items.forEach(function (item) {
      live[item.id] = item;
      if (keep[item.id]) return;
      if (item.saveTimer) { clearTimeout(item.saveTimer); item.saveTimer = null; }
      if (item.node && item.node.parentNode) item.node.parentNode.removeChild(item.node);
      try { App.db.boardDeleteItem(item.id); } catch (e) { }
    });
    clearCanvas();
    // An undo used to rewrite every row of the board. Only the cards this step actually
    // changed are written back, which is what keeps an undo on a large board quick.
    board.items = snap.items.map(function (row) {
      var copy = cloneValue(row);
      var before = live[row.id];
      if (!before || rowChanged(before, copy)) {
        try { App.db.boardAddItem(copy); } catch (e) { }
      }
      return copy;
    });
    setSelection([], null);
    if (snap.bg && snap.bg !== board.bg) setBg(snap.bg, true);
    board.marks = markData(snap.marks);
    saveMarks(true);
    board.view.x = snap.view.x;
    board.view.y = snap.view.y;
    board.view.z = snap.view.z;
    applyView();
    repaintAll();
    queueViewSave();
  }

  function undoLast() {
    var entry = board.undo.pop();
    if (!entry) {
      util.toast('Nothing to undo');
      return;
    }
    board.redo.push({ label: entry.label, snap: snapshotBoard() });
    trimHistory(board.redo);
    applySnap(entry.snap);
  }

  function redoLast() {
    var entry = board.redo.pop();
    if (!entry) {
      util.toast('Nothing to redo');
      return;
    }
    board.undo.push({ label: entry.label, snap: snapshotBoard() });
    if (board.undo.length > 30) board.undo.shift();
    applySnap(entry.snap);
  }

  function duplicateItem(item) {
    pushUndo('duplicate');
    var copy = cloneValue(item);
    copy.id = util.uuid();
    copy.x = item.x + 28;
    copy.y = item.y + 28;
    copy.z = nextZ();
    copy.created_at = util.nowIso();
    copy.updated_at = copy.created_at;
    board.items.push(copy);
    paintItem(copy);
    select(copy);
    try { App.db.boardAddItem(copy); } catch (e) { }
    return copy;
  }

  function reorder(item, front) {
    pushUndo(front ? 'front' : 'back');
    var zs = board.items.map(function (other) { return other.z; });
    item.z = front ? Math.max.apply(null, zs) + 1 : Math.min.apply(null, zs) - 1;
    placeItem(item);
    saveItem(item);
  }

  function itemLabel(item) {
    if (item.data && item.data.title) return item.data.title;
    if (item.kind === 'ref') return (item.data && item.data.title) || 'Reference';
    if (item.kind === 'image') return (item.data && item.data.name) || 'Image';
    if (item.kind === 'link') return (item.data && (item.data.title || item.data.url)) || 'Link';
    if (item.kind === 'todo') return (item.data && item.data.title) || 'To-do';
    var text = util.htmlToText((item.data && item.data.text) || '').slice(0, 44);
    if (text) return text;
    var kind = kindLabel(item);
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  function pasteFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      util.toast('Press Ctrl+V to paste');
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      if (!text) {
        util.toast('Clipboard is empty');
        return;
      }
      pasteText(text);
    }).catch(function () {
      util.toast('Press Ctrl+V to paste');
    });
  }

  // A tick box is drawn by its line, so pressing it ticks the line instead of dropping the caret.
  function onCheckDown(event) {
    var target = event.target;
    var line = target && target.closest ? target.closest('.bd-tick') : null;
    if (!line) return;
    var box = line.closest('.bd-text');
    if (!box || box.getAttribute('contenteditable') !== 'true') return;
    if (event.clientX - line.getBoundingClientRect().left > 26) return;
    event.preventDefault();
    pushUndo('check');
    line.setAttribute('data-done', line.getAttribute('data-done') === '1' ? '0' : '1');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onPaste(event) {
    if (!board.open || board.picker) return;
    var target = event.target;
    var inBoard = !!(target && board.root && board.root.contains(target));

    // Every editable takes the paste itself, wherever it lives; only a table cell wants the raw rows.
    if (target && target.closest) {
      var editable = target.closest('input, textarea, [contenteditable="true"]');
      if (editable && !editable.closest('.bd-table__cell')) return;
    }
    if (target && target.closest && target.closest('.bd-cal') && board.planner) {
      var planData = event.clipboardData;
      if (!planData) return;
      var planFiles = planData.files && planData.files.length ? planData.files : null;
      if (planFiles) {
        event.preventDefault();
        planAddPastedFile(planFiles[0], board.planner.date);
        return;
      }
      var planText = planData.getData('text/plain');
      if (!planText) return;
      event.preventDefault();
      planAddText(planText, board.planner.date);
      return;
    }
    var data = event.clipboardData;
    if (!data) return;
    var at = board.menuAt || centerOfView(board.items.length);
    var files = data.files && data.files.length ? data.files : null;
    if (files) {
      var file = files[0];
      event.preventDefault();
      var reader = new FileReader();
      reader.onload = function () {
        pushUndo('paste');
        addItem('image', { at: at, data: { name: file.name || 'Pasted image', src: String(reader.result || '') } });
      };
      reader.readAsDataURL(file);
      return;
    }
    var text = data.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    pasteText(text);
  }

  // A pasted address is a link card, a pasted list is a card a line, and a paragraph stays one note.
  var PASTE_MOST = 40;
  var PASTE_URL = /^(?:https?:\/\/|www\.)\S+$/i;
  var PASTE_BULLET = /^(?:[-*\u2022\u00b7]|\d{1,2}[.)])\s+/;

  function pasteLines(text) {
    var raw = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!raw.length) return null;
    var lines = raw.map(function (line) { return line.replace(PASTE_BULLET, '').trim(); }).filter(Boolean);
    if (!lines.length) return null;
    if (lines.length === 1) return lines;
    // A paragraph wraps into lines of its own, so a list has to be short lines that do not read as prose.
    var short = lines.every(function (line) { return line.length <= 72; });
    var bulleted = raw.some(function (line) { return PASTE_BULLET.test(line); });
    var endsSentence = /[.,;:!?]$/.test(lines[lines.length - 1]);
    if (!short || (endsSentence && !bulleted)) return null;
    return lines;
  }

  function pasteText(text) {
    var at = board.menuAt || centerOfView(board.items.length);
    var lines = pasteLines(text);
    if (!lines) {
      addItem('note', { at: at, data: { text: util.escapeHtml(String(text || '')).replace(/\n/g, '<br>') } });
      return;
    }
    var shown = lines.slice(0, PASTE_MOST);
    pushUndo('paste');
    var stepX = SIZES.note[0] + 20;
    var stepY = SIZES.note[1] + 20;
    shown.forEach(function (line, index) {
      var kind = PASTE_URL.test(line) ? 'link' : 'note';
      addItem(kind, {
        at: { x: at.x + (index % 4) * stepX, y: at.y + Math.floor(index / 4) * stepY },
        data: kind === 'link' ? { title: '', url: line } : { text: util.escapeHtml(line) },
        quiet: true,
      });
    });
    if (lines.length > shown.length) util.toast('Pasted the first ' + PASTE_MOST + ' lines.', 'info');
  }

  function activeBoardId() {
    try { return App.prefs.get('board.id', DEFAULT_BOARD_ID) || DEFAULT_BOARD_ID; } catch (e) { return DEFAULT_BOARD_ID; }
  }

  function boardName(id) {
    try {
      var row = App.db.boardGet(id);
      if (row && row.name) return row.name;
    } catch (e) {  }
    return id === DEFAULT_BOARD_ID ? 'Xave' : id;
  }

  function boardList() {
    try {
      var rows = App.db.listBoards() || [];
      if (rows.length) return rows;
    } catch (e) {  }
    return [{ id: BOARD_ID, name: boardName(BOARD_ID) }];
  }

  function switchBoard(id) {
    if (!id || id === BOARD_ID) return;
    try { App.db.boardSaveView(BOARD_ID, board.view.x, board.view.y, board.view.z); } catch (e) {  }
    try { App.prefs.set('board.id', id); } catch (e) {  }
    util.toast('Opening ' + boardName(id) + '\u2026');
    location.reload();
  }

  function newBoard() {
    App.ui.prompt({
      title: 'New board',
      label: 'Board name',
      value: '',
      placeholder: 'Work',
      confirmLabel: 'Create board',
    }).then(function (name) {
      if (name === null) return;
      var id = 'board-' + util.uuid();
      App.db.boardEnsure(id, name || 'Untitled board').then(function () {
        switchBoard(id);
      }).catch(function (err) {
        util.toast('Could not create the board: ' + err.message, 'error');
      });
    });
  }

  function renameThisBoard() {
    App.ui.prompt({
      title: 'Rename board',
      label: 'Board name',
      value: boardName(BOARD_ID),
      placeholder: 'Untitled board',
      confirmLabel: 'Rename',
    }).then(function (name) {
      if (name === null) return;
      App.db.boardRename(BOARD_ID, name || 'Untitled board').then(function () {
        util.toast('Board renamed.', 'success');
      }).catch(function (err) {
        util.toast('Rename failed: ' + err.message, 'error');
      });
    });
  }

  function deleteThisBoard() {
    var boards = boardList();
    if (boards.length < 2) {
      util.toast('This is the only board.', 'info');
      return;
    }
    var count = 0;
    try { count = App.db.boardItemCount(BOARD_ID); } catch (e) { count = 0; }
    App.ui.dialog({
      title: 'Delete this board?',
      icon: 'warning',
      danger: true,
      message: '"' + boardName(BOARD_ID) + '" and its ' + count + ' card' + (count === 1 ? '' : 's') + ' are removed for good.',
      consequences: [
        'Notes and files on it stay in your library.',
        'Export a bundle from Settings first if any of it matters.',
      ],
      confirmLabel: 'Delete board',
    }).then(function (ok) {
      if (!ok) return;
      var next = boards.filter(function (row) { return row.id !== BOARD_ID; })[0];
      App.db.boardDelete(BOARD_ID).then(function () {
        switchBoard(next ? next.id : DEFAULT_BOARD_ID);
      }).catch(function (err) {
        util.toast('Delete failed: ' + err.message, 'error');
      });
    });
  }

  function syncBoardButton() {
    if (!board.boardButton) return;
    board.boardButton.title = 'Board: ' + boardName(BOARD_ID);
    board.boardButton.setAttribute('aria-label', board.boardButton.title);
  }

  function showBoardsMenuFrom(button) {
    var rect = button.getBoundingClientRect();
    showBoardsMenu({ x: Math.round(rect.right + 6), y: Math.round(rect.top) }, false);
  }

  function showBoardsMenu(at, fromBoard) {
    var items = [];
    if (fromBoard) {
      items.push({ label: 'Back', icon: 'arrowLeft', onclick: function () { showBoardMenu(at); } });
      items.push({ sep: true });
    }
    boardList().forEach(function (row) {
      items.push({
        label: row.name,
        checked: row.id === BOARD_ID,
        onclick: function () { switchBoard(row.id); },
      });
    });
    items.push({ sep: true });
    items.push({ label: 'New board\u2026', icon: 'plus', onclick: newBoard });
    items.push({ label: 'Rename this board\u2026', icon: 'pencil', onclick: renameThisBoard });
    items.push({ label: 'Delete this board\u2026', icon: 'trash', onclick: deleteThisBoard });
    App.ui.openMenu({ x: at.x, y: at.y, items: items });
  }

  function showBoardMenu(at) {
    var newItem = function (kind) { return function () { addItem(kind, { at: board.menuAt }); }; };
    App.ui.openMenu({
      x: at.x,
      y: at.y,
      items: [
        { label: 'Paste', shortcut: 'Ctrl+V', icon: 'copy', onclick: pasteFromClipboard },
        { label: 'Undo', shortcut: 'Ctrl+Z', icon: 'restore', disabled: !board.undo.length, onclick: undoLast },
        { sep: true },
        { label: 'New Note', icon: 'note', onclick: newItem('note') },
        { label: 'New Link', icon: 'external', onclick: newItem('link') },
        { label: 'New To-do', icon: 'check', onclick: newItem('todo') },
        { label: 'New Comment', icon: 'info', onclick: newItem('comment') },
        { label: 'New Group', icon: 'panel', onclick: newItem('column') },
        { label: 'New drawing', icon: 'pencil', onclick: function () { startInk(null); } },
        { label: 'New Table', icon: 'grid', onclick: newItem('table') },
        { label: 'New Image or File', icon: 'upload', onclick: newItem('image') },
        { label: 'Add from your notes', icon: 'layers', onclick: openPicker },
        { sep: true },
        { label: 'Change Board Background', icon: 'eye', onclick: function () { showBackgroundMenu(at); } },
        { label: 'Boards\u2026', icon: 'layers', onclick: function () { showBoardsMenu(at, true); } },
        { sep: true },
        { label: 'Fit to view', shortcut: 'Ctrl+0', icon: 'restore', onclick: fitView },
      ],
    });
  }

  function showBackgroundMenu(at) {
    var items = [
      { label: 'Back', icon: 'arrowLeft', onclick: function () { showBoardMenu(at); } },
      { sep: true },
    ];
    [['dots', 'Dots'], ['grid', 'Grid'], ['plain', 'Plain'], ['warm', 'Warm'], ['cool', 'Cool']].forEach(function (pair) {
      items.push({
        label: pair[1],
        checked: board.bg === pair[0],
        onclick: function () {
          pushUndo('background');
          setBg(pair[0]);
        },
      });
    });
    App.ui.openMenu({ x: at.x, y: at.y, items: items });
  }

  function startInk(host) {
    if (host && lockOf(host)) return;
    setInkMode(true);
    inkState.host = host || null;
    if (host && host.data && host.data.ink) {
      var ox = host.data.ox || 0;
      var oy = host.data.oy || 0;
      inkState.strokes = (host.data.strokes || []).map(function (stroke) { return inkShift(stroke, ox, oy); });
      inkState.redo = [];
      inkRepaint();
    }
  }

  function showGroupMenu(rows, at) {
    var free = rows.filter(function (row) { return !lockOf(row); });
    var all = !free.length;
    var count = rows.length;
    App.ui.openMenu({
      x: at.x,
      y: at.y,
      title: count + ' cards',
      items: [
        { label: all ? 'Unlock ' + count + ' cards' : 'Lock ' + count + ' cards', icon: all ? 'unlock' : 'lock', onclick: function () { toggleLock(rows[0]); } },
        {
          label: all ? 'Remove cards' : 'Remove ' + free.length + (free.length === 1 ? ' card' : ' cards'),
          shortcut: 'Delete',
          icon: 'trash',
          danger: true,
          disabled: all,
          onclick: removeSelected,
        },
        { label: 'Add ' + count + ' cards to planner', icon: 'calendar', onclick: function () { openPlannerAssign(rows); } },
        { sep: true },
        { label: 'Deselect', icon: 'close', onclick: function () { setSelection([], null); } },
      ],
    });
  }

  function showItemMenu(item, at) {
    if (board.selectedIds.length > 1 && board.selectedIds.indexOf(item.id) >= 0) {
      showGroupMenu(board.selectedIds.map(findItem).filter(Boolean), at);
      return;
    }
    var items = [];
    var data = item.data || {};
    items.push({ label: data.title ? 'Rename' : 'Name this card', icon: 'type', onclick: function () { renameCard(item); } });
    var planKey = planKeyOf(item);
    items.push({ label: planKey ? 'Planner: ' + calShort(planKey) : 'Add to planner', icon: 'calendar', onclick: function () { openPlannerAssign([item]); } });
    items.push({ sep: true });
    var fileCard = item.kind === 'image' || (item.kind === 'ref' && item.ref_kind === 'file');
    if (fileCard && (data.fileId || data.src)) {
      items.push({ label: 'Download', icon: 'download', onclick: function () { downloadItem(item); } });
      items.push({ sep: true });
    }
    var cells = (item.data && item.data.cells) || [];
    if (item.kind === 'table' && cells.length) {
      items.push({ label: 'Add row', icon: 'grid', onclick: function () { tableChange(item, 1, 0); } });
      items.push({ label: 'Add column', icon: 'grid', onclick: function () { tableChange(item, 0, 1); } });
      items.push({ label: 'Remove row', icon: 'trash', disabled: cells.length <= 1, onclick: function () { tableChange(item, -1, 0); } });
      items.push({ label: 'Remove column', icon: 'trash', disabled: !cells[0] || cells[0].length <= 1, onclick: function () { tableChange(item, 0, -1); } });
      items.push({ sep: true });
    }
    if (item.kind === 'draw') {
      items.push({ label: 'Edit drawing', icon: 'pencil', onclick: function () { startInk(item); } });
      items.push({ sep: true });
    }
    items.push({ label: 'Duplicate', shortcut: 'Ctrl+D', icon: 'copy', onclick: function () { duplicateItem(item); } });
    items.push({ label: lockOf(item) ? 'Unlock' : 'Lock', icon: lockOf(item) ? 'unlock' : 'lock', onclick: function () { toggleLock(item); } });
    items.push({ label: 'Remove', shortcut: 'Delete', icon: 'trash', danger: true, onclick: function () { removeItem(item); } });
    items.push({ sep: true });
    items.push({ label: 'Bring to front', icon: 'layers', onclick: function () { reorder(item, true); } });
    items.push({ label: 'Send to back', icon: 'layers', onclick: function () { reorder(item, false); } });
    App.ui.openMenu({ x: at.x, y: at.y, title: itemLabel(item), items: items });
  }

  function onBoardContext(event) {
    if (!board.open) return;
    var target = event.target;
    if (target && target.closest && target.closest('.board__picker')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]') && !target.closest('.bd-table__cell')) return;
    if (target && target.closest && target.closest('.bd-cal')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    board.menuAt = canvasPoint(event.clientX, event.clientY);
    var at = { x: event.clientX, y: event.clientY };
    var box = event.target.closest ? event.target.closest('.bd-item') : null;
    var item = box ? findItem(box.getAttribute('data-board-id')) : null;
    if (item) showItemMenu(item, at);
    else showBoardMenu(at);
  }
  function clearCanvas() {
    board.items.forEach(function (item) {
      if (item.node && item.node.parentNode) item.node.parentNode.removeChild(item.node);
      delete item.node;
    });
  }

  function linesOn(item) {
    return !(item.data && item.data.lines === false);
  }

  function childrenOf(id) {
    return board.items.filter(function (other) { return other.data && other.data.group === id; });
  }

  function edgePoint(item, towardX, towardY) {
    var cx = item.x + item.w / 2;
    var cy = item.y + item.h / 2;
    var dx = towardX - cx;
    var dy = towardY - cy;
    if (Math.abs(dx) * item.h > Math.abs(dy) * item.w) {
      return { x: dx >= 0 ? item.x + item.w : item.x, y: cy };
    }
    return { x: cx, y: dy >= 0 ? item.y + item.h : item.y };
  }

  function linkPath(anchor, kid) {
    var acx = anchor.x + anchor.w / 2;
    var acy = anchor.y + anchor.h / 2;
    var kcx = kid.x + kid.w / 2;
    var kcy = kid.y + kid.h / 2;
    var a = edgePoint(anchor, kcx, kcy);
    var z = edgePoint(kid, acx, acy);
    var mid = (a.x + z.x) / 2;
    return 'M' + a.x + ' ' + a.y + 'C' + mid + ' ' + a.y + ' ' + mid + ' ' + z.y + ' ' + z.x + ' ' + z.y;
  }

  function paintLinks() {
    if (!board.links) return;
    board.links.textContent = '';
    board.items.forEach(function (anchor) {
      if (anchor.kind !== 'group' || !linesOn(anchor)) return;
      childrenOf(anchor.id).forEach(function (kid) {
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'bd-link');
        path.setAttribute('d', linkPath(anchor, kid));
        board.links.appendChild(path);
      });
    });
  }

  function groupBody(item) {
    var wrap = node('div', 'bd-group');
    var glyph = node('span', 'bd-group__glyph');
    glyph.appendChild(App.ui.icon(item.data && item.data.scope === 'workspace' ? 'layers' : 'folder', 16));
    wrap.appendChild(glyph);
    wrap.appendChild(node('span', 'bd-group__title', (item.data && item.data.title) || 'Folder'));
    var on = linesOn(item);
    var toggle = node('button', 'bd-group__link' + (on ? ' is-on' : ''));
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.setAttribute('aria-label', on ? 'Hide the connection lines' : 'Show the connection lines');
    toggle.title = on ? 'Hide the connection lines' : 'Show the connection lines';
    toggle.appendChild(App.ui.icon('link', 15));
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleLines(item);
    });
    wrap.appendChild(toggle);
    return wrap;
  }

  function toggleLines(item) {
    pushUndo('lines');
    item.data.lines = !linesOn(item);
    item.updated_at = util.nowIso();
    saveItem(item);
    repaintBody(item);
    paintLinks();
  }
  var drawPad = null;
  var DRAW_COLORS = ['#111827', '#e5484d', '#f5a524', '#30a46c', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#0ea5e9', '#a16207'];
  var DRAW_MUTED = ['#cbd5e1', '#94a3b8', '#64748b', '#e2e8f0', '#f1f5f9', '#7c3aed'];
  var DRAW_WIDTHS = [2, 4, 8, 14];

  function paintStroke(ctx, stroke) {
    var points = stroke.p;
    if (!points || !points.length) return;
    ctx.strokeStyle = stroke.c;
    ctx.fillStyle = stroke.c;
    ctx.lineWidth = stroke.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var erase = !!stroke.e || (typeof stroke.e === 'undefined' && String(stroke.c).toLowerCase() === '#ffffff');
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0][0], points[0][1], Math.max(0.5, stroke.w / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  var SHAPES = {
    rect: { label: 'Rectangle', icon: 'rect', def: [240, 160], points: function (w, h) { return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]; } },
    ellipse: { label: 'Ellipse', icon: 'ellipse', def: [240, 170], points: shapeEllipse },
    triangle: { label: 'Triangle', icon: 'triangle', def: [210, 170], points: function (w, h) { return [[w / 2, 0], [w, h], [0, h], [w / 2, 0]]; } },
    diamond: { label: 'Diamond', icon: 'diamond', def: [180, 180], points: function (w, h) { return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2], [w / 2, 0]]; } },
    pentagon: { label: 'Pentagon', icon: 'pentagon', def: [200, 180], points: shapeRing(5) },
    hexagon: { label: 'Hexagon', icon: 'hexagon', def: [220, 150], points: function (w, h) { return [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2], [w * 0.25, 0]]; } },
    octagon: { label: 'Octagon', icon: 'octagon', def: [180, 180], points: shapeRing(8) },
    trapezoid: { label: 'Trapezoid', icon: 'trapezoid', def: [220, 150], points: function (w, h) { return [[w * 0.22, 0], [w * 0.78, 0], [w, h], [0, h], [w * 0.22, 0]]; } },
    parallelogram: { label: 'Parallelogram', icon: 'parallelogram', def: [230, 150], points: function (w, h) { return [[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h], [w * 0.25, 0]]; } },
    star: { label: 'Star', icon: 'star', def: [180, 180], points: shapeStar },
    check: { label: 'Check', icon: 'check', def: [170, 130], points: function (w, h) { return [[w * 0.06, h * 0.55], [w * 0.34, h * 0.88], [w * 0.94, h * 0.1]]; } },
    close: { label: 'Close', icon: 'close', def: [160, 160], points: shapeClose },
    sparkle: { label: 'Sparkle', icon: 'sparkle', def: [170, 170], points: shapeSparkle },
    cross: { label: 'Cross', icon: 'cross', def: [170, 170], points: shapeCross },
    bolt: { label: 'Bolt', icon: 'bolt', def: [140, 200], points: function (w, h) { return [[w * 0.6, 0], [w * 0.15, h * 0.6], [w * 0.45, h * 0.6], [w * 0.3, h], [w * 0.85, h * 0.4], [w * 0.55, h * 0.4], [w * 0.72, 0], [w * 0.6, 0]]; } },
    heart: { label: 'Heart', icon: 'heart', def: [180, 160], points: shapeHeart },
    moon: { label: 'Moon', icon: 'moon', def: [160, 180], points: shapeMoon },
    pin: { label: 'Pin', icon: 'pin', def: [140, 190], points: shapePin },
    cloud: { label: 'Cloud', icon: 'cloud', def: [250, 160], points: shapeCloud },
    shield: { label: 'Shield', icon: 'shield', def: [180, 200], points: shapeShield },
    flag: { label: 'Flag', icon: 'flag', def: [200, 140], points: function (w, h) { return [[0, 0], [w, 0], [w * 0.76, h / 2], [w, h], [0, h], [0, 0]]; } },
    gear: { label: 'Gear', icon: 'gear', def: [180, 180], points: shapeGear },
    wave: { label: 'Wave', icon: 'wave', def: [240, 120], points: shapeWave },
    document: { label: 'Document', icon: 'document', def: [190, 220], points: shapeDocument },
    note: { label: 'Note', icon: 'note', def: [200, 180], points: shapeNote },
    cone: { label: 'Cone', icon: 'cone', def: [170, 200], points: shapeCone },
    cube: { label: 'Cube', icon: 'cube', def: [200, 200], points: shapeCube },
    semicircle: { label: 'Semicircle', icon: 'semicircle', def: [220, 130], points: shapeSemicircle },
    quarter: { label: 'Quarter', icon: 'quarter', def: [170, 170], points: shapeQuarter },
    chevron: { label: 'Chevron', icon: 'chevron', def: [200, 140], points: function (w, h) { return [[0, 0], [w * 0.45, 0], [w, h / 2], [w * 0.45, h], [0, h], [w * 0.55, h / 2], [0, 0]]; } },
    elbow: { label: 'Elbow arrow', icon: 'elbow', def: [230, 170], points: shapeElbow },
    cycle: { label: 'Cycle', icon: 'cycle', def: [180, 180], points: shapeCycle },
    callout: { label: 'Callout', icon: 'callout', def: [240, 160], points: shapeCallout },
    cylinder: { label: 'Cylinder', icon: 'cylinder', def: [200, 170], points: shapeCylinder },
    line: { label: 'Line', icon: 'line', free: true, def: [240, 0], points: function (dx, dy) { return [[0, 0], [dx, dy]]; } },
    arrow: { label: 'Arrow', icon: 'arrow', free: true, def: [240, 0], points: shapeArrow },
  };
  var SHAPE_ORDER = ['rect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'trapezoid', 'parallelogram', 'star', 'sparkle', 'cross', 'check', 'close', 'bolt', 'heart', 'moon', 'cloud', 'pin', 'shield', 'flag', 'gear', 'wave', 'document', 'note', 'cone', 'cube', 'semicircle', 'quarter', 'chevron', 'elbow', 'cycle', 'callout', 'cylinder', 'line', 'arrow'];

  function shapeEllipse(w, h) {
    var out = [];
    for (var i = 0; i <= 48; i++) {
      var a = (i / 48) * Math.PI * 2;
      out.push([(w / 2) * (1 + Math.cos(a)), (h / 2) * (1 + Math.sin(a))]);
    }
    return out;
  }

  function shapeRing(sides) {
    return function (w, h) {
      var out = [];
      for (var i = 0; i <= sides; i++) {
        var a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
        out.push([(w / 2) * (1 + Math.cos(a)), (h / 2) * (1 + Math.sin(a))]);
      }
      return out;
    };
  }

  function shapeSparkle(w, h) {
    var out = [];
    for (var i = 0; i <= 8; i++) {
      var a = -Math.PI / 2 + (i * Math.PI) / 4;
      var r = i % 2 ? 0.34 : 1;
      out.push([(w / 2) * (1 + r * Math.cos(a)), (h / 2) * (1 + r * Math.sin(a))]);
    }
    return out;
  }

  function shapeMoon(w, h) {
    var out = [];
    var i;
    for (i = 0; i <= 24; i++) {
      var a = -Math.PI / 2 + (i / 24) * Math.PI;
      out.push([(w / 2) * (1 + Math.cos(a)), (h / 2) * (1 + Math.sin(a))]);
    }
    for (i = 20; i >= 0; i--) {
      var t = i / 20;
      out.push([w * 0.5 + w * 0.24 * Math.sin(Math.PI * t), h * t]);
    }
    return out;
  }

  function shapeCloud(w, h) {
    var lobes = [[0.22, 0.74, 0.22], [0.44, 0.52, 0.3], [0.7, 0.58, 0.24], [0.88, 0.76, 0.15]];
    var base = h * 0.88;
    var left = lobes[0][0] * w - lobes[0][2] * Math.min(w, h);
    var right = lobes[3][0] * w + lobes[3][2] * Math.min(w, h);
    var out = [[left, base]];
    for (var i = 0; i <= 60; i++) {
      var x = left + ((right - left) * i) / 60;
      var y = base;
      for (var n = 0; n < lobes.length; n++) {
        var cx = lobes[n][0] * w;
        var cy = lobes[n][1] * h;
        var r = lobes[n][2] * Math.min(w, h);
        var dx = x - cx;
        if (Math.abs(dx) < r) y = Math.min(y, cy - Math.sqrt(r * r - dx * dx));
      }
      out.push([x, y]);
    }
    out.push([right, base]);
    return out;
  }

  function shapeShield(w, h) {
    var out = [[w / 2, 0], [w, h * 0.14]];
    var i;
    for (i = 0; i <= 8; i++) {
      var a = (i / 8) * (Math.PI / 2);
      out.push([w / 2 + (w / 2) * Math.cos(a), h * 0.5 + (h / 2) * Math.sin(a)]);
    }
    for (i = 0; i <= 8; i++) {
      var b = Math.PI / 2 + (i / 8) * (Math.PI / 2);
      out.push([w / 2 + (w / 2) * Math.cos(b), h * 0.5 + (h / 2) * Math.sin(b)]);
    }
    out.push([0, h * 0.14], [w / 2, 0]);
    return out;
  }

  function shapeGear(w, h) {
    var teeth = 8;
    var out = [];
    var step = (Math.PI * 2) / teeth;
    var put = function (a, r) { out.push([(w / 2) * (1 + r * Math.cos(a)), (h / 2) * (1 + r * Math.sin(a))]); };
    for (var i = 0; i < teeth; i++) {
      var a0 = (i / teeth) * Math.PI * 2;
      put(a0, 1);
      put(a0 + step * 0.42, 1);
      put(a0 + step * 0.5, 0.68);
      put(a0 + step * 0.92, 0.68);
    }
    out.push(out[0]);
    return out;
  }

  function shapeWave(w, h) {
    var out = [];
    for (var i = 0; i <= 40; i++) {
      var t = i / 40;
      out.push([w * t, h / 2 + (h / 2) * 0.8 * Math.sin(t * Math.PI * 4)]);
    }
    return out;
  }

  function shapeClose(w, h) {
    var out = [];
    var cross = shapeCross(w, h);
    var step = Math.PI / 4;
    for (var i = 0; i < cross.length; i++) {
      var dx = cross[i][0] - w / 2;
      var dy = cross[i][1] - h / 2;
      out.push([
        w / 2 + (dx * Math.cos(step) - dy * Math.sin(step)) * 0.72,
        h / 2 + (dx * Math.sin(step) + dy * Math.cos(step)) * 0.72,
      ]);
    }
    return out;
  }

  function shapePin(w, h) {
    var r = Math.min(w * 0.46, h * 0.42);
    var cy = r;
    var out = [];
    var i;
    for (i = 0; i <= 28; i++) {
      var a = Math.PI * 0.62 + (i / 28) * Math.PI * 1.76;
      out.push([w / 2 + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    out.push([w / 2, h]);
    out.push([w / 2 + r * Math.cos(Math.PI * 0.62), cy + r * Math.sin(Math.PI * 0.62)]);
    return out;
  }

  function shapeDocument(w, h) {
    var out = [[0, 0], [w, 0], [w, h]];
    for (var i = 0; i <= 24; i++) {
      var t = i / 24;
      out.push([w * (1 - t), h * (0.86 + 0.14 * Math.cos(Math.PI * 2 * t))]);
    }
    out.push([0, 0]);
    return out;
  }

  function shapeNote(w, h) {
    return [[0, 0], [w * 0.78, 0], [w * 0.78, h * 0.22], [w, h * 0.22], [w, h], [0, h], [0, 0]];
  }

  function shapeCone(w, h) {
    var ry = h * 0.11;
    var out = [[w / 2, 0], [0, h - ry]];
    for (var i = 0; i <= 24; i++) {
      var a = Math.PI - (i / 24) * Math.PI;
      out.push([w / 2 + (w / 2) * Math.cos(a), h - ry + ry * Math.sin(a)]);
    }
    out.push([w / 2, 0]);
    return out;
  }

  function shapeCube(w, h) {
    var d = Math.min(w, h) * 0.26;
    return [
      [0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h], [0, d],
      [w - d, d], [w, 0], [w - d, d], [w - d, h],
    ];
  }

  function shapeSemicircle(w, h) {
    var out = [[0, h], [w, h]];
    for (var i = 0; i <= 24; i++) {
      var a = (i / 24) * Math.PI;
      out.push([w / 2 + (w / 2) * Math.cos(a), h - h * Math.sin(a)]);
    }
    return out;
  }

  function shapeQuarter(w, h) {
    var out = [[0, 0]];
    for (var i = 0; i <= 24; i++) {
      var a = (i / 24) * (Math.PI / 2);
      out.push([w * Math.sin(a), h - h * Math.cos(a)]);
    }
    out.push([0, h], [0, 0]);
    return out;
  }

  function shapeElbow(w, h) {
    var row = h * 0.8;
    var head = Math.min(w, h) * 0.34;
    return [[0, 0], [0, row], [w, row], [w - head, row - head * 0.6], [w, row], [w - head, row + head * 0.6]];
  }

  function shapeCycle(w, h) {
    var out = [];
    var i;
    for (i = 0; i <= 36; i++) {
      var a = -Math.PI / 2 + (i / 36) * Math.PI * (5 / 3);
      out.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
    }
    var head = Math.min(w, h) * 0.24;
    var tip = out[out.length - 1];
    var prev = out[out.length - 2];
    var ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    out.push([tip[0] + head * Math.cos(ang + Math.PI * 0.72), tip[1] + head * Math.sin(ang + Math.PI * 0.72)]);
    out.push(tip);
    out.push([tip[0] + head * Math.cos(ang - Math.PI * 0.72), tip[1] + head * Math.sin(ang - Math.PI * 0.72)]);
    return out;
  }

  function shapeCross(w, h) {
    var t = Math.min(w, h) / 3;
    var a = (w - t) / 2;
    var b = (h - t) / 2;
    return [
      [a, 0], [w - a, 0], [w - a, b], [w, b], [w, h - b], [w - a, h - b],
      [w - a, h], [a, h], [a, h - b], [0, h - b], [0, b], [a, b], [a, 0],
    ];
  }

  function shapeHeart(w, h) {
    var out = [];
    for (var i = 0; i <= 48; i++) {
      var t = -Math.PI + (i / 48) * Math.PI * 2;
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push([((x + 16) / 32) * w, ((13 - y) / 30) * h]);
    }
    return out;
  }

  function shapeCallout(w, h) {
    var r = Math.min(w, h) * 0.14;
    var bh = h * 0.76;
    var out = [];
    var corner = function (cx, cy, from, to) {
      for (var i = 0; i <= 5; i++) {
        var a = from + ((to - from) * i) / 5;
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(r, r, Math.PI, Math.PI * 1.5);
    out.push([w - r, 0]);
    corner(w - r, r, -Math.PI / 2, 0);
    out.push([w, bh - r]);
    corner(w - r, bh - r, 0, Math.PI / 2);
    out.push([w * 0.36, bh], [w * 0.2, h], [w * 0.14, bh]);
    out.push([r, bh]);
    corner(r, bh - r, Math.PI / 2, Math.PI);
    out.push([0, r]);
    return out;
  }

  function shapeCylinder(w, h) {
    var ry = Math.min(h * 0.18, w * 0.5);
    var out = [];
    var i;
    for (i = 0; i <= 40; i++) {
      var a = Math.PI + (i / 40) * Math.PI * 2;
      out.push([w / 2 + (w / 2) * Math.cos(a), ry + ry * Math.sin(a)]);
    }
    out.push([0, h - ry]);
    for (i = 0; i <= 20; i++) {
      var t = Math.PI * (i / 20);
      out.push([w / 2 - (w / 2) * Math.cos(t), h - ry + ry * Math.sin(t)]);
    }
    out.push([w, ry]);
    return out;
  }

  function shapeStar(w, h) {
    var out = [];
    for (var i = 0; i <= 10; i++) {
      var a = -Math.PI / 2 + (i * Math.PI) / 5;
      var r = i % 2 ? 0.42 : 1;
      out.push([(w / 2) * (1 + r * Math.cos(a)), (h / 2) * (1 + r * Math.sin(a))]);
    }
    return out;
  }

  function shapeArrow(dx, dy) {
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var head = Math.min(Math.max(12, len * 0.3), 40);
    var a = Math.atan2(dy, dx);
    var back = a + Math.PI * 0.82;
    var side = a - Math.PI * 0.82;
    return [[0, 0], [dx, dy], [dx + Math.cos(back) * head, dy + Math.sin(back) * head], [dx, dy], [dx + Math.cos(side) * head, dy + Math.sin(side) * head]];
  }

  function inkShapeStroke(key, x0, y0, x1, y1) {
    var spec = SHAPES[key] || SHAPES.rect;
    var points;
    var ox = x0;
    var oy = y0;
    if (spec.free) {
      points = spec.points(x1 - x0, y1 - y0);
      if (Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3) points = spec.points(spec.def[0], spec.def[1]);
    } else {
      var w = Math.abs(x1 - x0);
      var h = Math.abs(y1 - y0);
      if (w < 5 && h < 5) {
        w = spec.def[0];
        h = spec.def[1];
        ox = x0 - w / 2;
        oy = y0 - h / 2;
      } else {
        ox = Math.min(x0, x1);
        oy = Math.min(y0, y1);
      }
      points = spec.points(w, h);
    }
    return {
      c: inkState.color,
      e: 0,
      w: inkState.width,
      p: points.map(function (point) { return [point[0] + ox, point[1] + oy]; }),
    };
  }

  function inkPlaced(stroke) {
    var angle = stroke.a || 0;
    if (!angle) return stroke.p;
    var box = strokeBox([stroke]);
    return inkRotate(stroke.p, box.x + box.w / 2, box.y + box.h / 2, angle);
  }

  function inkScreenStroke(stroke) {
    var view = board.view;
    return {
      c: stroke.c,
      e: stroke.e,
      w: stroke.w * view.z,
      p: inkPlaced(stroke).map(function (point) { return [point[0] * view.z + view.x, point[1] * view.z + view.y]; }),
    };
  }

  function strokeBox(strokes) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    strokes.forEach(function (stroke) {
      var half = stroke.w / 2 + 1;
      stroke.p.forEach(function (point) {
        minX = Math.min(minX, point[0] - half);
        minY = Math.min(minY, point[1] - half);
        maxX = Math.max(maxX, point[0] + half);
        maxY = Math.max(maxY, point[1] + half);
      });
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  var INK_GRIP = 26;
  var INK_NEAR = 18;
  var inkChromeColor = null;

  function inkChrome() {
    if (inkChromeColor) return inkChromeColor;
    var names = ['--text-muted', '--text-faint', '--text'];
    var style = getComputedStyle(document.body);
    for (var i = 0; i < names.length; i++) {
      var value = (style.getPropertyValue(names[i]) || '').trim();
      if (value) { inkChromeColor = value; return value; }
    }
    inkChromeColor = '#8a8f98';
    return inkChromeColor;
  }

  function inkScreenPoint(point) {
    var view = board.view;
    return [point[0] * view.z + view.x, point[1] * view.z + view.y];
  }

  function inkSelection() {
    var at = inkState.sel;
    if (at == null || at < 0 || at >= inkState.strokes.length) return -1;
    return at;
  }

  function inkSelBox() {
    var at = inkSelection();
    if (at < 0) return null;
    return strokeBox([inkState.strokes[at]]);
  }

  function inkRotate(points, cx, cy, angle) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    return points.map(function (point) {
      var dx = point[0] - cx;
      var dy = point[1] - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    });
  }

  function inkFrameBox() {
    var at = inkSelection();
    if (at < 0) return null;
    var stroke = inkState.strokes[at];
    var box = strokeBox([stroke]);
    var angle = stroke.a || 0;
    var pad = 4 / (board.view.z || 1);
    var left = box.x - pad;
    var top = box.y - pad;
    var right = box.x + box.w + pad;
    var bottom = box.y + box.h + pad;
    var cx = (left + right) / 2;
    var cy = (top + bottom) / 2;
    var place = function (point) { return inkScreenPoint(inkRotate([point], cx, cy, angle)[0]); };
    return {
      corners: [place([left, top]), place([right, top]), place([right, bottom]), place([left, bottom])],
      top: place([cx, top]),
      bottom: place([cx, bottom]),
      grip: (function () {
        var head = place([cx, top]);
        return [head[0] + Math.sin(angle) * INK_GRIP, head[1] - Math.cos(angle) * INK_GRIP];
      })(),
      clear: (function () {
        var foot = place([cx, bottom]);
        return [foot[0] - Math.sin(angle) * INK_GRIP, foot[1] + Math.cos(angle) * INK_GRIP];
      })(),
      color: inkChrome(),
    };
  }

  function inkGrip() {
    var frame = inkFrameBox();
    return frame ? frame.grip : null;
  }

  function inkHandle(point) {
    var frame = inkFrameBox();
    if (!frame) return null;
    var near = function (spot) {
      var dx = point[0] - spot[0];
      var dy = point[1] - spot[1];
      return Math.sqrt(dx * dx + dy * dy) <= 15;
    };
    if (near(frame.clear)) return 'close';
    return near(frame.grip) ? 'rotate' : null;
  }

  function inkNear(point, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var span = dx * dx + dy * dy;
    if (!span) return Math.sqrt((point[0] - a[0]) * (point[0] - a[0]) + (point[1] - a[1]) * (point[1] - a[1]));
    var t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / span;
    t = Math.max(0, Math.min(1, t));
    var px = a[0] + t * dx - point[0];
    var py = a[1] + t * dy - point[1];
    return Math.sqrt(px * px + py * py);
  }

  function inkInside(point, points) {
    var inside = false;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
      var a = points[i];
      var b = points[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function inkBoxNear(box, point) {
    var dx = Math.max(box.x - point[0], 0, point[0] - (box.x + box.w));
    var dy = Math.max(box.y - point[1], 0, point[1] - (box.y + box.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function inkBoxAt(point) {
    var best = -1;
    var bestPair = null;
    for (var i = 0; i < inkState.strokes.length; i++) {
      var box = strokeBox([inkScreenStroke(inkState.strokes[i])]);
      var away = inkBoxNear(box, point);
      if (away > INK_NEAR) continue;
      var pair = [away, box.w * box.h];
      if (!bestPair || pair[0] < bestPair[0] || (pair[0] === bestPair[0] && pair[1] <= bestPair[1])) {
        best = i;
        bestPair = pair;
      }
    }
    return best;
  }

  function inkStrokeAt(point) {
    for (var i = inkState.strokes.length - 1; i >= 0; i--) {
      var stroke = inkScreenStroke(inkState.strokes[i]);
      var reach = stroke.w / 2 + 7;
      if (stroke.p.length === 1 && inkNear(point, stroke.p[0], stroke.p[0]) <= reach) return i;
      var edge = false;
      for (var n = 1; n < stroke.p.length && !edge; n++) {
        if (inkNear(point, stroke.p[n - 1], stroke.p[n]) <= reach) edge = true;
      }
      if (edge) return i;
      var first = stroke.p[0];
      var last = stroke.p[stroke.p.length - 1];
      var shut = stroke.p.length > 3 && Math.abs(first[0] - last[0]) <= 2 && Math.abs(first[1] - last[1]) <= 2;
      if (shut && inkInside(point, stroke.p)) return i;
    }
    return -1;
  }

  function inkDanger() {
    var value = getComputedStyle(document.documentElement).getPropertyValue('--danger');
    return String(value || '').trim() || '#bf2a3d';
  }

  function inkFrame(ctx) {
    var frame = inkFrameBox();
    if (!frame) return;
    var color = frame.color;
    var danger = inkDanger();
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    frame.corners.forEach(function (point, n) {
      if (n) ctx.lineTo(point[0], point[1]);
      else ctx.moveTo(point[0], point[1]);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(frame.top[0], frame.top[1]);
    ctx.lineTo(frame.grip[0], frame.grip[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(frame.grip[0], frame.grip[1], 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(frame.grip[0], frame.grip[1], 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = danger;
    ctx.beginPath();
    ctx.moveTo(frame.bottom[0], frame.bottom[1]);
    ctx.lineTo(frame.clear[0], frame.clear[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(frame.clear[0], frame.clear[1], 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(frame.clear[0] - 3, frame.clear[1] - 3);
    ctx.lineTo(frame.clear[0] + 3, frame.clear[1] + 3);
    ctx.moveTo(frame.clear[0] + 3, frame.clear[1] - 3);
    ctx.lineTo(frame.clear[0] - 3, frame.clear[1] + 3);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.restore();
  }

  function inkGrab(point) {
    var box = inkSelBox();
    var at = inkSelection();
    if (!box || at < 0) return null;
    var spot = inkWorld(point);
    var cx = box.x + box.w / 2;
    var cy = box.y + box.h / 2;
    var drag = { i: at, cx: cx, cy: cy, angle: inkState.strokes[at].a || 0, points: inkState.strokes[at].p.map(function (p) { return [p[0], p[1]]; }) };
    if (inkHandle(point) === 'rotate') {
      drag.mode = 'rotate';
      drag.from = Math.atan2(spot[1] - cy, spot[0] - cx);
      return drag;
    }
    drag.mode = 'move';
    drag.from = spot;
    return drag;
  }

  var inkState = { on: false, tool: 'pen', color: DRAW_COLORS[0], picked: false, width: DRAW_WIDTHS[0], host: null, strokes: [], redo: [], cur: null, last: null, shape: 'rect', draw: null, sel: null, drag: null };

  function inkDefaultColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? '#ffffff' : DRAW_COLORS[0];
  }

  var INK_PAD = 18;
  var INK_BAR = 30;
  var DRAW_PIX = 6000000;

  function inkPoint(event) {
    var rect = board.stage.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function inkWorld(point) {
    var view = board.view;
    return [(point[0] - view.x) / view.z, (point[1] - view.y) / view.z];
  }

  function inkFit() {
    var canvas = board.inkCanvas;
    if (!canvas || !board.inkCtx) return;
    var rect = board.stage.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    board.inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function inkRepaint() {
    var ctx = board.inkCtx;
    if (!ctx || !board.inkCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, board.inkCanvas.width, board.inkCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    inkState.strokes.forEach(function (stroke) { paintStroke(ctx, inkScreenStroke(stroke)); });
    if (inkState.draw) {
      var pending = inkState.draw;
      paintStroke(ctx, inkScreenStroke(inkShapeStroke(pending.key, pending.x0, pending.y0, pending.x1, pending.y1)));
    }
    inkFrame(ctx);
  }

  function inkResize() {
    inkFit();
    inkRepaint();
  }

  function inkDot(hex) {
    var dot = node('button', 'drawpad__dot');
    dot.type = 'button';
    dot.style.background = hex;
    dot.setAttribute('data-ink-color', hex);
    dot.addEventListener('click', function () { inkColor(hex); });
    return dot;
  }

  function inkColor(hex) {
    inkState.color = hex;
    inkState.picked = true;
    inkState.tool = 'pen';
    if (board.inkPop) board.inkPop.classList.add('is-hidden');
    inkBar();
  }

  function inkBar() {
    var bar = board.inkBar;
    if (!bar) return;
    if (board.inkSwatch) board.inkSwatch.style.background = inkState.color;
    if (board.inkWidthBar) board.inkWidthBar.style.height = Math.max(2, inkState.width) + 'px';
    Array.prototype.forEach.call(bar.querySelectorAll('[data-ink-color]'), function (dot) {
      dot.classList.toggle('is-active', dot.getAttribute('data-ink-color') === inkState.color);
    });
    if (board.inkTools) {
      board.inkTools.pen.classList.toggle('is-active', inkState.tool === 'pen');
      board.inkTools.eraser.classList.toggle('is-active', inkState.tool === 'eraser');
    board.inkTools.shape.classList.toggle('is-active', inkState.tool === 'shape');
    if (board.inkTools.move) board.inkTools.move.classList.toggle('is-active', inkState.tool === 'move');
    if (board.inkCanvas) board.inkCanvas.classList.toggle('is-move', inkState.tool === 'move');
    Array.prototype.forEach.call(bar.querySelectorAll('[data-ink-shape]'), function (pick) {
      pick.classList.toggle('is-active', pick.getAttribute('data-ink-shape') === inkState.shape);
    });
    if (board.inkShapeButton && board.inkShapeShown !== inkState.shape) {
      board.inkShapeShown = inkState.shape;
      board.inkShapeButton.textContent = '';
      board.inkShapeButton.appendChild(App.ui.icon((SHAPES[inkState.shape] || SHAPES.rect).icon, 16));
    }
      board.inkTools.undo.disabled = !inkState.strokes.length;
      board.inkTools.redo.disabled = !inkState.redo.length;
    }
  }

  function buildInkBar() {
    var bar = node('div', 'board__inkbar');
    var tools = node('div', 'board__inktools');
    var pen = node('button', 'drawpad__tool is-active');
    pen.type = 'button';
    pen.setAttribute('aria-label', 'Pen');
    pen.appendChild(App.ui.icon('pencil', 16));
    pen.addEventListener('click', function () { inkState.tool = 'pen'; inkBar(); });
    tools.appendChild(pen);
    var eraser = node('button', 'drawpad__tool');
    eraser.type = 'button';
    eraser.setAttribute('aria-label', 'Eraser');
    eraser.appendChild(App.ui.icon('eraser', 16));
    eraser.addEventListener('click', function () { inkState.tool = 'eraser'; inkBar(); });
    tools.appendChild(eraser);
    var move = node('button', 'drawpad__tool board__inkmove-btn');
    move.type = 'button';
    move.setAttribute('aria-label', 'Move');
    move.title = 'Move or rotate';
    move.appendChild(App.ui.icon('move', 16));
    move.addEventListener('click', function () { inkState.tool = 'move'; inkBar(); });
    tools.appendChild(move);
    var shapes = node('button', 'drawpad__tool board__inkshape-btn');
    shapes.type = 'button';
    shapes.title = 'Shapes';
    shapes.setAttribute('aria-label', 'Shapes');
    shapes.addEventListener('click', function () {
      shapePop.classList.toggle('is-hidden');
      if (pop) pop.classList.add('is-hidden');
    });
    tools.appendChild(shapes);
    var swatch = node('button', 'drawpad__swatch');
    swatch.type = 'button';
    swatch.setAttribute('aria-label', 'Colour');
    tools.appendChild(swatch);
    var widthButton = node('button', 'drawpad__width');
    widthButton.type = 'button';
    widthButton.setAttribute('aria-label', 'Stroke thickness');
    var widthBar = node('span', '');
    widthButton.appendChild(widthBar);
    widthButton.addEventListener('click', function () {
      var at = DRAW_WIDTHS.indexOf(inkState.width);
      inkState.width = DRAW_WIDTHS[(at + 1) % DRAW_WIDTHS.length];
      inkBar();
    });
    tools.appendChild(widthButton);
    tools.appendChild(node('span', 'drawpad__sep'));
    var undo = node('button', 'drawpad__tool');
    undo.type = 'button';
    undo.setAttribute('aria-label', 'Undo');
    undo.appendChild(App.ui.icon('undo', 16));
    undo.addEventListener('click', inkUndo);
    tools.appendChild(undo);
    var redo = node('button', 'drawpad__tool');
    redo.type = 'button';
    redo.setAttribute('aria-label', 'Redo');
    redo.appendChild(App.ui.icon('redo', 16));
    redo.addEventListener('click', inkRedo);
    tools.appendChild(redo);
    tools.appendChild(node('span', 'drawpad__sep'));
    var discard = node('button', 'drawpad__btn', 'Discard');
    discard.type = 'button';
    discard.addEventListener('click', function () { setInkMode(false); });
    tools.appendChild(discard);
    var save = node('button', 'drawpad__btn drawpad__btn--go', 'Save');
    save.type = 'button';
    save.addEventListener('click', inkSave);
    tools.appendChild(save);
    bar.appendChild(tools);
    var pop = node('div', 'drawpad__pop board__inkpop is-hidden');
    DRAW_COLORS.forEach(function (hex) { pop.appendChild(inkDot(hex)); });
    pop.appendChild(node('div', 'drawpad__rule'));
    DRAW_MUTED.forEach(function (hex) { pop.appendChild(inkDot(hex)); });
    var custom = node('button', 'drawpad__custom');
    custom.type = 'button';
    custom.appendChild(App.ui.icon('sun', 13));
    custom.appendChild(node('span', '', 'Custom colour'));
    var picker = node('input', 'drawpad__picker');
    picker.type = 'color';
    picker.value = inkState.color;
    picker.addEventListener('input', function () { inkColor(picker.value); });
    custom.appendChild(picker);
    custom.addEventListener('click', function () { picker.click(); });
    pop.appendChild(custom);
    bar.appendChild(pop);
    swatch.addEventListener('click', function () {
      pop.classList.toggle('is-hidden');
      if (shapePop) shapePop.classList.add('is-hidden');
    });
    var shapePop = node('div', 'drawpad__pop board__inkpop board__inkshapes is-hidden');
    SHAPE_ORDER.forEach(function (key) {
      var spec = SHAPES[key];
      var pick = node('button', 'drawpad__tool');
      pick.type = 'button';
      pick.title = spec.label;
      pick.setAttribute('aria-label', spec.label);
      pick.setAttribute('data-ink-shape', key);
      pick.appendChild(App.ui.icon(spec.icon, 16));
      pick.addEventListener('click', function () {
        inkState.tool = 'shape';
        inkState.shape = key;
        shapePop.classList.add('is-hidden');
        inkBar();
      });
      shapePop.appendChild(pick);
    });
    bar.appendChild(shapePop);
    board.inkShapes = shapePop;
    board.inkShapeButton = shapes;
    board.inkBar = bar;
    board.inkPop = pop;
    board.inkSwatch = swatch;
    board.inkWidthBar = widthBar;
    board.inkTools = { pen: pen, move: move, eraser: eraser, shape: shapes, undo: undo, redo: redo };
    inkBar();
    return bar;
  }

  function setInkMode(on) {
    var next = !!on;
    if (next === inkState.on) return;
    inkState.on = next;
    inkState.cur = null;
    inkState.draw = null;
    inkState.sel = null;
    inkState.drag = null;
    inkState.strokes = [];
    inkState.redo = [];
    if (board.stage) board.stage.classList.toggle('is-inking', next);
    if (board.inkButton) board.inkButton.classList.toggle('is-active', next);
    if (next) {
      if (!inkState.picked) inkState.color = inkDefaultColor();
      inkFit();
      inkRepaint();
      inkBar();
      window.addEventListener('keydown', onInkKey, true);
      window.addEventListener('resize', inkResize);
      document.addEventListener('pointerdown', onInkOutside, true);
      if (board.stage) board.stage.addEventListener('wheel', inkRepaint);
    } else {
      inkState.host = null;
      window.removeEventListener('keydown', onInkKey, true);
      window.removeEventListener('resize', inkResize);
      document.removeEventListener('pointerdown', onInkOutside, true);
      if (board.stage) board.stage.removeEventListener('wheel', inkRepaint);
      if (board.inkPop) board.inkPop.classList.add('is-hidden');
      if (board.inkCanvas && board.inkCtx) {
        board.inkCtx.setTransform(1, 0, 0, 1, 0, 0);
        board.inkCtx.clearRect(0, 0, board.inkCanvas.width, board.inkCanvas.height);
      }
      inkBar();
    }
  }

  function onInkKey(event) {
    var key = event.key;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) inkRedo(); else inkUndo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'y' || key === 'Y')) {
      event.preventDefault();
      event.stopPropagation();
      inkRedo();
      return;
    }
    if ((key === 'Delete' || key === 'Backspace') && inkSelection() >= 0) {
      event.preventDefault();
      event.stopPropagation();
      inkRemoveSel();
      return;
    }
    if (key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setInkMode(false);
  }

  function onInkOutside(event) {
    if (!board.inkPop || board.inkPop.classList.contains('is-hidden')) return;
    if (board.inkPop.contains(event.target)) return;
    if (event.target.closest && event.target.closest('.drawpad__swatch')) return;
    board.inkPop.classList.add('is-hidden');
  }

  function inkUndo() {
    if (!inkState.strokes.length) return;
    inkState.redo.push(inkState.strokes.pop());
    inkRepaint();
    inkBar();
  }

  function inkRedo() {
    if (!inkState.redo.length) return;
    inkState.strokes.push(inkState.redo.pop());
    inkRepaint();
    inkBar();
  }

  function inkRemoveSel() {
    var at = inkSelection();
    if (at < 0) return;
    inkState.strokes.splice(at, 1);
    inkState.sel = null;
    inkRepaint();
    inkBar();
  }

  function onInkDown(event) {
    if (!inkState.on || event.button !== 0) return;
    if (board.inkPop) board.inkPop.classList.add('is-hidden');
    if (board.inkShapes) board.inkShapes.classList.add('is-hidden');
    event.preventDefault();
    event.stopPropagation();
    var point = inkPoint(event);
    window.addEventListener('pointermove', onInkMove);
    window.addEventListener('pointerup', onInkUp);
    if (inkState.tool !== 'eraser' && inkHandle(point) === 'close') {
      inkRemoveSel();
      return;
    }
    if (inkState.tool !== 'eraser' && inkHandle(point) === 'rotate') {
      inkState.drag = inkGrab(point);
      inkRepaint();
      return;
    }
    if (inkState.tool === 'move') {
      var at = inkStrokeAt(point);
      if (at < 0) at = inkBoxAt(point);
      inkState.sel = at >= 0 ? at : null;
      inkState.drag = at >= 0 ? inkGrab(point) : null;
      inkRepaint();
      inkBar();
      return;
    }
    if (inkState.tool === 'shape') {
      var start = inkWorld(point);
      inkState.sel = null;
      inkState.draw = { key: inkState.shape, x0: start[0], y0: start[1], x1: start[0], y1: start[1] };
      inkState.cur = null;
      inkRepaint();
      return;
    }
    inkState.sel = null;
    var erase = inkState.tool === 'eraser';
    var stroke = {
      c: erase ? '#ffffff' : inkState.color,
      e: erase ? 1 : 0,
      w: erase ? inkState.width * 2.5 : inkState.width,
      p: [inkWorld(point)],
    };
    inkState.strokes.push(stroke);
    inkState.redo.length = 0;
    inkState.cur = stroke;
    inkState.last = point;
    inkRepaint();
    inkBar();
  }

  function onInkMove(event) {
    if (inkState.drag) {
      var drag = inkState.drag;
      var target = inkState.strokes[drag.i];
      if (!target) { inkState.drag = null; return; }
      var spot = inkWorld(inkPoint(event));
      if (drag.mode === 'move') {
        var dx = spot[0] - drag.from[0];
        var dy = spot[1] - drag.from[1];
        target.p = drag.points.map(function (p) { return [p[0] + dx, p[1] + dy]; });
      } else {
        var turn = Math.atan2(spot[1] - drag.cy, spot[0] - drag.cx) - drag.from;
        target.a = drag.angle + turn;
      }
      inkRepaint();
      return;
    }
    if (inkState.draw) {
      var spot = inkWorld(inkPoint(event));
      inkState.draw.x1 = spot[0];
      inkState.draw.y1 = spot[1];
      inkRepaint();
      return;
    }
    if (!inkState.cur) return;
    var point = inkPoint(event);
    inkState.cur.p.push(inkWorld(point));
    inkState.last = point;
    inkRepaint();
  }

  function onInkUp() {
    window.removeEventListener('pointermove', onInkMove);
    window.removeEventListener('pointerup', onInkUp);
    if (inkState.drag) {
      inkState.drag = null;
      inkRepaint();
      inkBar();
      return;
    }
    if (inkState.draw) {
      var pending = inkState.draw;
      inkState.draw = null;
      inkState.strokes.push(inkShapeStroke(pending.key, pending.x0, pending.y0, pending.x1, pending.y1));
      inkState.redo.length = 0;
      inkState.sel = inkState.strokes.length - 1;
    }
    inkState.cur = null;
    inkRepaint();
    inkBar();
  }

  function inkLocal(stroke, origin) {
    return {
      c: stroke.c,
      e: stroke.e,
      w: stroke.w,
      p: inkPlaced(stroke).map(function (point) { return [point[0] - origin.x, point[1] - origin.y]; }),
    };
  }

  function inkShift(stroke, dx, dy) {
    return {
      c: stroke.c,
      e: stroke.e,
      w: stroke.w,
      p: stroke.p.map(function (point) { return [point[0] + dx, point[1] + dy]; }),
    };
  }

  function inkPlace(item, box) {
    item.data.w = Math.max(16, box.w);
    item.data.h = Math.max(16, box.h);
    item.x = item.data.ox - INK_PAD;
    item.y = item.data.oy - INK_PAD - INK_BAR;
    item.w = Math.max(96, box.w + INK_PAD * 2);
    item.h = Math.max(96, box.h + INK_PAD * 2 + INK_BAR);
    if (item.node) {
      item.node.style.left = item.x + 'px';
      item.node.style.top = item.y + 'px';
      item.node.style.width = item.w + 'px';
      item.node.style.height = item.h + 'px';
    }
  }

  function inkSave() {
    var strokes = inkState.strokes.slice();
    if (!strokes.length) { setInkMode(false); return; }
    var host = inkState.host;
    if (host && host.node && host.data && host.data.ink) {
      var origin = { x: host.data.ox, y: host.data.oy };
      var drawn = strokes.map(function (stroke) { return inkLocal(stroke, origin); });
      var all = strokeBox(drawn);
      host.data.ox = origin.x + all.x;
      host.data.oy = origin.y + all.y;
      host.data.strokes = drawn.map(function (stroke) { return inkShift(stroke, -all.x, -all.y); });
      inkPlace(host, all);
      saveItem(host);
      repaintBody(host);
      setInkMode(false);
      return;
    }
    var box = strokeBox(strokes.map(function (stroke) { return { c: stroke.c, e: stroke.e, w: stroke.w, p: inkPlaced(stroke) }; }));
    var base = { x: box.x, y: box.y };
    var local = strokes.map(function (stroke) { return inkLocal(stroke, base); });
    addItem('draw', {
      data: { strokes: local, ink: 1, ox: base.x, oy: base.y, w: Math.max(16, box.w), h: Math.max(16, box.h) },
      at: { x: base.x - INK_PAD, y: base.y - INK_PAD - INK_BAR },
      w: Math.max(96, box.w + INK_PAD * 2),
      h: Math.max(96, box.h + INK_PAD * 2 + INK_BAR),
    });
    setInkMode(false);
  }

  function closeDrawPad() {
    if (!drawPad) return;
    window.removeEventListener('keydown', onPadKey);
    if (drawPad.pad.parentNode) drawPad.pad.parentNode.removeChild(drawPad.pad);
    drawPad = null;
  }

  function onPadKey(event) {
    if (!drawPad) return;
    var key = event.key;
    if (key === 'Escape') { event.preventDefault(); closeDrawPad(); return; }
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) padRedo(); else padUndo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'y' || key === 'Y')) { event.preventDefault(); padRedo(); }
  }

  function padRedraw() {
    var pad = drawPad;
    if (!pad) return;
    var rect = pad.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var ctx = pad.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    pad.state.strokes.forEach(function (stroke) { paintStroke(ctx, stroke); });
    if (pad.state.drawing) paintStroke(ctx, pad.state.drawing);
  }

  function padUndo() {
    if (!drawPad || !drawPad.state.strokes.length) return;
    drawPad.state.redo.push(drawPad.state.strokes.pop());
    padTools();
    padRedraw();
  }

  function padRedo() {
    if (!drawPad || !drawPad.state.redo.length) return;
    drawPad.state.strokes.push(drawPad.state.redo.pop());
    padTools();
    padRedraw();
  }

  function padTools() {
    var pad = drawPad;
    if (!pad) return;
    pad.undo.disabled = !pad.state.strokes.length;
    pad.redo.disabled = !pad.state.redo.length;
    pad.widthBar.style.height = Math.max(2, Math.min(14, pad.state.width)) + 'px';
    pad.swatch.style.background = pad.state.color;
    pad.tools.forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-draw-tool') === pad.state.tool);
    });
    Array.prototype.forEach.call(pad.pop.querySelectorAll('.drawpad__dot'), function (dot) {
      dot.classList.toggle('is-active', dot.getAttribute('data-color') === pad.state.color);
    });
  }

  function padColor(hex) {
    if (!drawPad) return;
    drawPad.state.color = hex;
    drawPad.state.tool = drawPad.state.tool === 'eraser' ? 'pen' : drawPad.state.tool;
    drawPad.pop.classList.add('is-hidden');
    padTools();
  }

  function padDot(hex) {
    var dot = node('button', 'drawpad__dot');
    dot.type = 'button';
    dot.setAttribute('data-color', hex);
    dot.style.background = hex;
    dot.setAttribute('aria-label', 'Colour ' + hex);
    dot.addEventListener('click', function () { padColor(hex); });
    return dot;
  }

  function padSave() {
    var pad = drawPad;
    if (!pad) return;
    if (!pad.state.strokes.length) { closeDrawPad(); return; }
    var box = strokeBox(pad.state.strokes);
    var strokes = pad.state.strokes.map(function (stroke) {
      return {
        c: stroke.c,
        w: stroke.w,
        p: stroke.p.map(function (point) {
          return [Math.round((point[0] - box.x) * 10) / 10, Math.round((point[1] - box.y) * 10) / 10];
        }),
      };
    });
    var data = { strokes: strokes, w: Math.max(24, Math.round(box.w)), h: Math.max(24, Math.round(box.h)) };
    var target = pad.state.item;
    var planKey = board.planPadDate;
    board.planPadDate = null;
    closeDrawPad();
    if (planKey && !target) {
      var planned = null;
      board.planDrawAdd = true;
      planned = addPlannerItem('draw', planKey, '');
      board.planDrawAdd = false;
      if (planned) planInkPlace(planned, planKey, data.strokes, { x: 0, y: 0 }, { x: 0, y: 0, w: data.w, h: data.h });
      paintPlanner();
      return;
    }
    if (target) {
      pushUndo('edit');
      target.data.strokes = data.strokes;
      target.data.w = data.w;
      target.data.h = data.h;
      saveItem(target);
      repaintBody(target);
      return;
    }
    addItem('draw', { data: data });
  }

  function inkScale(w, h) {
    var z = (board.view && board.view.z) || 1;
    var k = (window.devicePixelRatio || 1) * z;
    var cap = Math.sqrt(DRAW_PIX / Math.max(1, w * h));
    return Math.max(1, Math.min(k, cap));
  }

  function inkRepaintCards() {
    if (!board.items) return;
    board.items.forEach(function (item) {
      if (item.kind !== 'draw' || !item.node) return;
      var canvas = item.node.querySelector('.bd-draw__canvas');
      if (canvas && canvas.inkPaint) canvas.inkPaint();
    });
  }

  function drawBody(item) {
    var wrap = node('div', 'bd-draw');
    var canvas = node('canvas', 'bd-draw__canvas');
    wrap.appendChild(canvas);
    var strokes = (item.data && item.data.strokes) || [];
    var paint = function () {
      var w = wrap.offsetWidth;
      var h = wrap.offsetHeight;
      if (w < 2 || h < 2) return;
      var k = inkScale(w, h) * planInkZoom(wrap);
      if (canvas.inkScale && canvas.inkW === w && canvas.inkH === h && Math.abs(k - canvas.inkScale) / canvas.inkScale < 0.2) return;
      canvas.inkScale = k;
      canvas.inkW = w;
      canvas.inkH = h;
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      var ctx = canvas.getContext('2d');
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // On the board the ink sits at the offset it was drawn at. A planned card is a different size, so it
      // fits the block's body into the card at one scale, which keeps the drawing whole and in the same place.
      if (item.data && typeof item.data.ox === 'number' && !(wrap.closest && wrap.closest('.bd-cal'))) {
        ctx.setTransform(k, 0, 0, k, k * (item.data.ox - item.x - 1), k * (item.data.oy - item.y - 1 - INK_BAR));
      } else if (item.data && typeof item.data.ox === 'number') {
        // Stored strokes are local to the ink's own box, so a planned card fits that box, not the block. Fitting the block put the
        // ink outside the card, because the block keeps its board coordinates and the strokes do not.
        var inkBox = strokeBox(strokes);
        var fit = Math.min(w / Math.max(1, inkBox.w), h / Math.max(1, inkBox.h));
        var s = k * fit;
        ctx.setTransform(s, 0, 0, s, k * ((w - inkBox.w * fit) / 2) - s * inkBox.x, k * ((h - inkBox.h * fit) / 2) - s * inkBox.y);
      } else {
        var box = strokeBox(strokes);
        ctx.setTransform(k, 0, 0, k, k * ((w - box.w) / 2 - box.x), k * ((h - box.h) / 2 - box.y));
      }
      strokes.forEach(function (stroke) { paintStroke(ctx, stroke); });
    };
    canvas.inkPaint = paint;
    wrap.addEventListener('dblclick', function (event) {
      event.stopPropagation();
if (wrap.closest && wrap.closest('.bd-cal')) openDrawPad(item);
      else startInk(item);
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(paint).observe(wrap);
    requestAnimationFrame(paint);
    return wrap;
  }

  function openDrawPad(item) {
    if (drawPad) return;
    var pad = node('div', 'drawpad');
    pad.setAttribute('role', 'dialog');
    pad.setAttribute('aria-label', 'Drawing board');
    var canvas = node('canvas', 'drawpad__canvas');
    pad.appendChild(canvas);
    var state = {
      tool: 'pen',
      color: '#111827',
      width: DRAW_WIDTHS[1],
      strokes: item && item.data && item.data.strokes ? JSON.parse(JSON.stringify(item.data.strokes)) : [],
      redo: [],
      drawing: null,
      item: item || null,
    };
    var tools = node('div', 'drawpad__tools');
    var toolButtons = [];
    var addTool = function (name, icon, label) {
      var button = node('button', 'drawpad__tool');
      button.type = 'button';
      button.setAttribute('data-draw-tool', name);
      button.setAttribute('aria-label', label);
      button.title = label;
      button.appendChild(App.ui.icon(icon, 16));
      button.addEventListener('click', function () {
        state.tool = name;
        state.width = name === 'eraser' ? DRAW_WIDTHS[3] : state.width;
        padTools();
      });
      toolButtons.push(button);
      tools.appendChild(button);
      return button;
    };
    addTool('pen', 'pencil', 'Pen');
    addTool('line', 'slash', 'Line');
    addTool('eraser', 'eraser', 'Eraser');
    var swatch = node('button', 'drawpad__swatch');
    swatch.type = 'button';
    swatch.setAttribute('aria-label', 'Colour');
    swatch.addEventListener('click', function () { drawPad.pop.classList.toggle('is-hidden'); });
    tools.appendChild(swatch);
    var widthButton = node('button', 'drawpad__width');
    widthButton.type = 'button';
    widthButton.setAttribute('aria-label', 'Stroke thickness');
    var widthBar = node('span', '');
    widthButton.appendChild(widthBar);
    widthButton.addEventListener('click', function () {
      var at = DRAW_WIDTHS.indexOf(state.width);
      state.width = DRAW_WIDTHS[(at + 1) % DRAW_WIDTHS.length];
      padTools();
    });
    tools.appendChild(widthButton);
    tools.appendChild(node('span', 'drawpad__sep'));
    var undoButton = node('button', 'drawpad__tool');
    undoButton.type = 'button';
    undoButton.setAttribute('aria-label', 'Undo');
    undoButton.appendChild(App.ui.icon('undo', 16));
    undoButton.addEventListener('click', padUndo);
    tools.appendChild(undoButton);
    var redoButton = node('button', 'drawpad__tool');
    redoButton.type = 'button';
    redoButton.setAttribute('aria-label', 'Redo');
    redoButton.appendChild(App.ui.icon('redo', 16));
    redoButton.addEventListener('click', padRedo);
    tools.appendChild(redoButton);
    tools.appendChild(node('span', 'drawpad__sep'));
    var cancel = node('button', 'drawpad__btn', 'Discard');
    cancel.type = 'button';
    cancel.addEventListener('click', closeDrawPad);
    tools.appendChild(cancel);
    var save = node('button', 'drawpad__btn drawpad__btn--go', 'Save');
    save.type = 'button';
    save.addEventListener('click', padSave);
    tools.appendChild(save);
    pad.appendChild(tools);
    var pop = node('div', 'drawpad__pop is-hidden');
    DRAW_COLORS.forEach(function (hex) { pop.appendChild(padDot(hex)); });
    pop.appendChild(node('div', 'drawpad__rule'));
    DRAW_MUTED.forEach(function (hex) { pop.appendChild(padDot(hex)); });
    var custom = node('button', 'drawpad__custom');
    custom.type = 'button';
    custom.appendChild(App.ui.icon('sun', 13));
    custom.appendChild(node('span', '', 'Custom colour'));
    var picker = node('input', 'drawpad__picker');
    picker.type = 'color';
    picker.value = state.color;
    picker.addEventListener('input', function () { padColor(picker.value); });
    custom.appendChild(picker);
    custom.addEventListener('click', function () { picker.click(); });
    pop.appendChild(custom);
    pad.appendChild(pop);
    document.body.appendChild(pad);
    drawPad = {
      pad: pad,
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      state: state,
      pop: pop,
      swatch: swatch,
      widthBar: widthBar,
      tools: toolButtons,
      undo: undoButton,
      redo: redoButton,
    };
    var fit = function () {
      var rect = canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      padRedraw();
    };
    var padPoint = function (event) {
      var rect = canvas.getBoundingClientRect();
      return [Math.round((event.clientX - rect.left) * 10) / 10, Math.round((event.clientY - rect.top) * 10) / 10];
    };
    var onMove = function (event) {
      if (!state.drawing) return;
      var point = padPoint(event);
      if (state.tool === 'line') state.drawing.p = [state.drawing.p[0], point];
      else state.drawing.p.push(point);
      padRedraw();
    };
    var onUp = function () {
      if (!state.drawing) return;
      state.drawing = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      padTools();
      padRedraw();
    };
    canvas.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      var erase = state.tool === 'eraser';
      state.drawing = { c: erase ? '#ffffff' : state.color, e: erase ? 1 : 0, w: erase ? state.width * 2.5 : state.width, p: [padPoint(event)] };
      state.strokes.push(state.drawing);
      state.redo.length = 0;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      padTools();
      padRedraw();
      event.preventDefault();
    });
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onPadKey);
    pad.addEventListener('contextmenu', function (event) { event.preventDefault(); event.stopPropagation(); });
    fit();
    padTools();
  }
  function buildRoot() {
    var root = node('div', 'board');
    root.setAttribute('data-board', 'root');
    root.appendChild(buildRail());
    var stage = node('div', 'board__stage');
    var grid = node('div', 'board__grid');
    var canvas = node('div', 'board__canvas');
    var links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    links.setAttribute('class', 'board__links');
    canvas.appendChild(links);
    board.links = links;
    stage.appendChild(grid);
    stage.appendChild(canvas);
    var inkCanvas = node('canvas', 'board__ink');
    board.inkCanvas = inkCanvas;
    board.inkCtx = inkCanvas.getContext('2d');
    inkCanvas.addEventListener('pointerdown', onInkDown);
    stage.appendChild(inkCanvas);
    stage.appendChild(buildInkBar());
    stage.addEventListener('pointerdown', onStageDown);
    stage.addEventListener('wheel', onWheel, { passive: false });
    root.appendChild(stage);
    root.appendChild(buildMarks());
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
    var map = node('div', 'board__map');
    var mapCanvas = node('canvas', 'board__map-canvas');
    var mapBar = node('div', 'board__map-bar');
    var mapToggle = node('button', 'board__map-toggle');
    mapToggle.type = 'button';
    mapToggle.addEventListener('click', function () { setMapHidden(!board.mapHidden); });
    board.mapToggle = mapToggle;
    mapBar.appendChild(zoom);
    mapBar.appendChild(mapToggle);
    mapCanvas.setAttribute('aria-label', 'Board minimap, click or drag to move the view');
    mapCanvas.title = 'Click or drag to move the view';
    map.addEventListener('wheel', function (event) {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
      event.stopPropagation();
    }, { passive: false });
    mapCanvas.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      try { mapCanvas.setPointerCapture(event.pointerId); } catch (e) { }
      mapHover(event);
      mapDrag(event);
    });
    var mapHover = function (event) {
      var rect = mapCanvas.getBoundingClientRect();
      board.mapHover = {
        x: (event.clientX - rect.left) * (MAP_W / Math.max(rect.width, 1)),
        y: (event.clientY - rect.top) * (MAP_H / Math.max(rect.height, 1)),
      };
      mapDraw();
    };
    mapCanvas.addEventListener('pointermove', function (event) {
      mapHover(event);
      try {
        if (!mapCanvas.hasPointerCapture(event.pointerId)) return;
      } catch (e) {
        return;
      }
      mapDrag(event);
    });
    mapCanvas.addEventListener('pointerleave', function () {
      board.mapHover = null;
      mapDraw();
    });
    var mapRelease = function (event) {
      try {
        if (mapCanvas.hasPointerCapture(event.pointerId)) mapCanvas.releasePointerCapture(event.pointerId);
      } catch (e) { }
    };
    mapCanvas.addEventListener('pointerup', mapRelease);
    mapCanvas.addEventListener('pointercancel', mapRelease);
    map.appendChild(mapCanvas);
    map.appendChild(mapBar);
    root.appendChild(map);
    board.map = map;
    board.mapCanvas = mapCanvas;
    board.mapCtx = mapCanvas.getContext('2d');
    setMapHidden(App.prefs.get('board.mapHidden', false));
    root.appendChild(top);
    var planToggle = node('button', 'board__plan');
    planToggle.type = 'button';
    planToggle.title = 'Planner';
    planToggle.setAttribute('aria-label', 'Planner');
    planToggle.appendChild(App.ui.icon('calendar', 15));
    planToggle.appendChild(node('span', '', 'Planner'));
    planToggle.addEventListener('click', function () { openPlanner('browse', [], null); });
    board.planButton = planToggle;
    top.appendChild(planToggle);
    board.root = root;
    board.stage = stage;
    board.canvas = canvas;
    board.grid = grid;
    board.zoomLabel = label;
    var mode = node('button', 'board__mode');
    mode.type = 'button';
    mode.addEventListener('click', function () {
      setMode(board.mode === 'select' ? 'grab' : 'select');
    });
    board.modeButton = mode;
    root.appendChild(mode);
    board.binButton = binButton();
    root.appendChild(board.binButton);
    paintBin();
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
    var kin = subtreeNodes(spec.node || { key: spec.key, kind: spec.kind, id: spec.id, ws: spec.ws, kids: [] });
    if (kin.length > 1) {
      var total = 0;
      var on = 0;
      kin.forEach(function (entry) {
        if (entry.key === spec.key) return;
        total++;
        if (board.pickChecked[entry.key]) on++;
      });
      if (on && (!box.checked || on < total)) box.indeterminate = true;
    }
    box.addEventListener('change', function () {
      kin.forEach(function (entry) {
        if (box.checked) board.pickChecked[entry.key] = entry.kind === 'workspace' || !entry.kind ? { kind: null, id: null, ws: entry.ws } : { kind: entry.kind, id: entry.id, ws: entry.ws };
        else delete board.pickChecked[entry.key];
      });
      paintPicker();
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

  function noteModel(space, note) {
    return {
      key: 'note:' + note.id,
      kind: 'note',
      id: note.id,
      ws: space.id,
      name: note.title && note.title.trim() ? note.title : 'Untitled note',
      meta: util.formatWhen(note.updated_at),
      kids: [],
    };
  }

  function fileModel(space, file) {
    return {
      key: 'file:' + file.id,
      kind: 'file',
      id: file.id,
      ws: space.id,
      name: file.filename || 'file',
      meta: util.formatBytes(file.size),
      kids: [],
    };
  }

  function renderPickNode(model) {
    var kids = model.kids || [];
    return pickNode({
      key: model.key,
      kind: model.kind === 'workspace' ? null : model.kind,
      id: model.kind === 'workspace' ? null : model.id,
      ws: model.ws,
      name: model.name,
      meta: model.meta || '',
      node: model,
      kids: kids.length ? function () {
        var host = node('div', 'pk-kids');
        kids.forEach(function (kid) { host.appendChild(renderPickNode(kid)); });
        return host;
      } : null,
      open: model.kind === 'workspace' ? board.pickExpanded[model.key] !== false : !!board.pickExpanded[model.key],
    });
  }

  function buildPickModel(space) {
    var folders = safeList(function () { return App.db.listFolders(space.id); });
    var notes = safeList(function () { return App.db.listAllNotes(space.id); });
    var rootFiles = safeList(function () { return App.db.listFilesIn(space.id, null); });
    var filesByFolder = {};
    var nestedFiles = 0;
    folders.forEach(function (folder) {
      var list = safeList(function () { return App.db.listFilesIn(space.id, folder.id); });
      filesByFolder[folder.id] = list;
      nestedFiles += list.length;
    });
    var folderModel = function (folder) {
      var kids = [];
      folders.forEach(function (row) {
        if (String(row.parent_folder_id) === String(folder.id)) kids.push(folderModel(row));
      });
      notes.forEach(function (row) {
        if (String(row.folder_id) === String(folder.id)) kids.push(noteModel(space, row));
      });
      (filesByFolder[folder.id] || []).forEach(function (file) { kids.push(fileModel(space, file)); });
      return {
        key: 'folder:' + folder.id,
        kind: 'folder',
        id: folder.id,
        ws: space.id,
        name: folder.name || 'Untitled folder',
        meta: kids.length ? String(kids.length) : '',
        kids: kids,
      };
    };
    var kids = [];
    folders.forEach(function (row) { if (!row.parent_folder_id) kids.push(folderModel(row)); });
    notes.forEach(function (row) { if (!row.folder_id) kids.push(noteModel(space, row)); });
    rootFiles.forEach(function (file) { kids.push(fileModel(space, file)); });
    return {
      key: 'ws:' + space.id,
      kind: 'workspace',
      id: space.id,
      ws: space.id,
      name: space.name || 'Workspace',
      meta: folders.length + notes.length + rootFiles.length + nestedFiles + 1 + ' items',
      kids: kids,
    };
  }

  function paintPicker() {
    var panel = board.picker;
    if (!panel) return;
    var body = panel.querySelector('.board__picker-body');
    var scroll = body.scrollTop;
    body.textContent = '';
    var spaces = safeList(function () { return App.db.listWorkspaces(); });
    if (!spaces.length) body.appendChild(node('p', 'board__picker-empty', 'No workspaces yet.'));
    var model = [];
    spaces.forEach(function (space) {
      var spaceModel = buildPickModel(space);
      model.push(spaceModel);
      var group = node('div', 'pk-group');
      group.appendChild(renderPickNode(spaceModel));
      body.appendChild(group);
    });
    board.pickModel = model;
    body.scrollTop = scroll;
    updatePickCount();
  }
  function safeList(fn) {
    try { return fn() || []; } catch (e) { return []; }
  }

  function subtreeNodes(model) {
    var out = [];
    (function walk(entry) {
      out.push(entry);
      (entry.kids || []).forEach(walk);
    })(model);
    return out;
  }

  function pickChildren(list) {
    var out = [];
    (list || []).forEach(function (model) {
      var on = !!board.pickChecked[model.key];
      if (model.kind === 'note' || model.kind === 'file') {
        if (on) out.push({ type: 'leaf', kind: model.kind, id: model.id, ws: model.ws, children: [] });
        return;
      }
      if (on) {
        out.push({ type: 'anchor', kind: model.kind, id: model.id, ws: model.ws, name: model.name, children: pickChildren(model.kids) });
        return;
      }
      pickChildren(model.kids).forEach(function (entry) { out.push(entry); });
    });
    return out;
  }

  function pickTree() {
    return pickChildren(board.pickModel);
  }
  function countPicks(list) {
    var total = 0;
    list.forEach(function (entry) { total += 1 + countPicks(entry.children || []); });
    return total;
  }

  function subtreeHeight(entry) {
    var own = entry.type === 'anchor' ? 66 : entry.kind === 'file' ? 250 : 190;
    var kids = entry.children || [];
    if (!kids.length) return own;
    var total = 0;
    kids.forEach(function (kid) { total += subtreeHeight(kid); });
    return Math.max(own, total);
  }

  function updatePickCount() {
    if (!board.pickerCount) return;
    var total = countPicks(pickTree());
    board.pickerCount.textContent = total ? total + ' selected' : 'Nothing selected';
  }
  function commitPicker(panel) {
    var roots = pickTree();
    closePicker();
    if (!roots.length) return;
    var plan = planPicks(roots);
    var size = planSize(plan);
    var spot = findSpot(size.w, size.h);
    var made = [];
    board.batch = true;
    pushUndo('picker');
    plan.forEach(function (row) {
      var entry = row.entry;
      var at = { x: spot.x + row.x, y: spot.y + row.y };
      var item;
      if (entry.type === 'anchor') {
        item = addItem('group', {
          at: at,
          w: SIZES.group[0],
          h: SIZES.group[1],
          data: {
            title: entry.name,
            lines: true,
            scope: entry.kind,
            refId: entry.id,
            wsId: entry.ws,
          },
        });
      } else {
        var snapshot = snapshotFor(entry.kind, entry.id, entry.ws);
        var isFile = entry.kind === 'file';
        item = addItem('ref', {
          ref_kind: entry.kind,
          ref_id: entry.id,
          data: snapshot,
          at: at,
          w: isFile ? SIZES.file[0] : SIZES.ref[0],
          h: isFile ? SIZES.file[1] : SIZES.ref[1],
        });
        snapshot.__itemId = item.id;
      }
      if (row.parent !== null && made[row.parent]) {
        item.data.group = made[row.parent].id;
        saveItem(item);
      }
      made.push(item);
    });
    board.batch = false;
    paintLinks();
    showSpot(spot, size);
    util.toast(made.length === 1 ? '1 item added to the board' : made.length + ' items added to the board');
  }

  function closePicker() {
    if (!board.picker) return;
    if (board.picker.parentNode) board.picker.parentNode.removeChild(board.picker);
    board.picker = null;
    board.pickerCount = null;
    board.pickChecked = {};
    board.pickExpanded = {};
    board.pickModel = [];
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
    data.fileId = id;
    data.filename = file ? file.filename : '';
    data.mime = file ? file.mime_type || '' : '';
    return data;
  }

  function planPicks(roots) {
    var plan = [];
    var walk = function (entry, x, y, parent) {
      var index = plan.length;
      var isFile = entry.kind === 'file';
      plan.push({
        entry: entry,
        x: x,
        y: y,
        parent: parent,
        w: entry.type === 'anchor' ? SIZES.group[0] : isFile ? SIZES.file[0] : SIZES.ref[0],
        h: entry.type === 'anchor' ? SIZES.group[1] : isFile ? SIZES.file[1] : SIZES.ref[1],
      });
      var cursor = y;
      (entry.children || []).forEach(function (kid) {
        walk(kid, x + 300, cursor, index);
        cursor += subtreeHeight(kid);
      });
      return index;
    };
    var cursor = 0;
    roots.forEach(function (entry) {
      walk(entry, 0, cursor, null);
      cursor += subtreeHeight(entry) + 40;
    });
    return plan;
  }

  function planSize(plan) {
    var w = 0;
    var h = 0;
    plan.forEach(function (row) {
      w = Math.max(w, row.x + row.w);
      h = Math.max(h, row.y + row.h);
    });
    return { w: w, h: h };
  }

  function blocked(x, y, w, h, margin) {
    return board.items.some(function (other) {
      return x < other.x + other.w + margin && x + w + margin > other.x
        && y < other.y + other.h + margin && y + h + margin > other.y;
    });
  }

  function findSpot(w, h) {
    var base = centerOfView(0);
    var margin = 28;
    var step = 80;
    var span = 24;
    var rect = board.stage.getBoundingClientRect();
    var z = board.view.z || 1;
    var rx = Math.floor(Math.max(0, rect.width / 2 / z - w / 2 - 20) / step);
    var ry = Math.floor(Math.max(0, rect.height / 2 / z - h / 2 - 20) / step);
    var cells = [];
    for (var gx = -span; gx <= span; gx++) {
      for (var gy = -span; gy <= span; gy++) {
        cells.push({ gx: gx, gy: gy, vis: Math.abs(gx) <= rx && Math.abs(gy) <= ry ? 0 : 1, d: Math.max(Math.abs(gx), Math.abs(gy)) });
      }
    }
    cells.sort(function (a, c) { return a.vis - c.vis || a.d - c.d; });
    for (var i = 0; i < cells.length; i++) {
      var x = Math.round(base.x - w / 2 + cells[i].gx * step);
      var y = Math.round(base.y - h / 2 + cells[i].gy * step);
      if (!blocked(x, y, w, h, margin)) return { x: x, y: y, visible: cells[i].vis === 0 };
    }
    var right = 0;
    board.items.forEach(function (other) { right = Math.max(right, other.x + other.w); });
    return { x: right + 80, y: Math.round(base.y - h / 2), visible: false };
  }

  function showSpot(spot, size) {
    if (spot.visible) return;
    var rect = board.stage.getBoundingClientRect();
    board.view.x = Math.round(rect.width / 2 - (spot.x + size.w / 2) * board.view.z);
    board.view.y = Math.round(rect.height / 2 - (spot.y + size.h / 2) * board.view.z);
    applyView();
  }  function load() {
    clearCanvas();
    board.cullAt = null;
    board.cullForce = true;
    board.items = [];
    board.plans = [];
    try {
      (App.db.boardItems(PLAN_BOARD) || []).forEach(function (row) {
        row.data = row.data || {};
        board.plans.push(row);
      });
    } catch (e) { board.plans = []; }
    var stored = [];
    try { stored = App.db.boardItems(BOARD_ID) || []; } catch (e) { stored = []; }
    stored.forEach(function (row) {
      var item = row;
      item.data = row.data || {};
      board.items.push(item);
    });
    board.items.forEach(function (item) {
      if (item.kind !== 'image' || item.ref_kind || !item.data || !item.data.fileId) return;
      try { App.db.boardClaimFile(item.data.fileId, BOARD_ID); } catch (e) { }
    });
    paintLinks();
    var view = null;
    try { view = App.db.boardGet(BOARD_ID); } catch (e) { view = null; }
    board.view = view ? { x: view.vx || 0, y: view.vy || 0, z: view.vz || 1 } : { x: 0, y: 0, z: 1 };
    board.marks = [];
    try { board.marks = markData(JSON.parse((view && view.marks) || '[]')); } catch (e) { board.marks = []; }
    applyView();
    paintMarks();
    renderMarkList();
    binLoad();
  }

  function setMode(next, quiet) {
    board.mode = next === 'select' ? 'select' : 'grab';
    var on = board.mode === 'select';
    if (board.modeButton) {
      board.modeButton.textContent = '';
      var glyph = App.ui.icon(on ? 'marquee' : 'hand', 16);
      if (glyph) board.modeButton.appendChild(glyph);
      board.modeButton.classList.toggle('is-select', on);
      board.modeButton.title = on ? 'Drag to select blocks, hold Space to pan' : 'Drag to pan the board';
      board.modeButton.setAttribute('aria-label', board.modeButton.title);
      board.modeButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (board.stage) board.stage.classList.toggle('is-select-mode', on);
    if (!on) setSelection([], null);
    if (!quiet) util.toast(on ? 'Drag to select blocks' : 'Drag to pan the board');
  }

  function open() {
    if (board.open) return;
    BOARD_ID = activeBoardId();
    document.documentElement.classList.remove('is-board-boot');
    board.open = true;
    try { App.prefs.set('board.open', true); } catch (e) { }
    board.marking = false;
    board.moving = null;
    board.planner = null;
    if (board.plannerEl) board.plannerEl.hidden = true;
    board.railMarks = false;
    board.editors = [];
    if (board.stage) board.stage.classList.remove('is-marking');
    if (board.rail) board.rail.classList.remove('is-marks');
    if (board.root) board.root.classList.remove('is-marks');
    if (board.root) board.root.classList.remove('is-marking');
    if (board.stage) board.stage.classList.remove('is-moving');
    if (board.root) board.root.classList.remove('is-moving');
    if (!board.root) document.body.appendChild(buildRoot());
    board.root.classList.add('is-open');
    board.root.classList.toggle('is-maphidden', !!board.mapHidden);
    document.body.classList.add('is-board');
    try { App.db.boardEnsure(BOARD_ID, 'Xave'); } catch (e) { }
    syncBoardButton();
    load();
    setMode(board.mode, true);
    applyBgFromDb();
    consumeReveal();
    if (!board.bound) {
      board.bound = true;
      document.addEventListener('selectionchange', onSelectionChange);
      if (board.canvas) {
        board.canvas.addEventListener('pointerdown', richHide);
      }
      board.root.addEventListener('contextmenu', onBoardContext);
      document.addEventListener('paste', onPaste);
      document.addEventListener('mousedown', onCheckDown, true);
      document.addEventListener('pointerdown', commitEdits, true);
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', releasePointer);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releasePointer();
    });
    window.addEventListener('resize', function () { board.size = null; applyView(); });
    window.addEventListener('pagehide', flushBoardState);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushBoardState();
    });
  }

  function close() {
    if (!board.open) return;
    cancelViewGlide();
    board.items.forEach(flushItem);
    closePicker();
    board.open = false;
    setSelection([], null);
    setInkMode(false);
    try { App.prefs.set('board.open', false); } catch (e) { }
    board.root.classList.remove('is-open');
    document.body.classList.remove('is-board');
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    richHide();
    document.removeEventListener('pointerdown', commitEdits, true);
    setMarking(false);
    window.removeEventListener('resize', applyView);
    try { App.db.boardSaveView(BOARD_ID, board.view.x, board.view.y, board.view.z); } catch (e) { }
  }

  function restore() {
    if (App.prefs.get('board.open', false)) open();
  }

  App.board = {
    open: open,
    restore: restore,
    close: close,
    isOpen: function () { return board.open; },
    state: board,
    addItem: addItem,
    dropFiles: dropFiles,
    undo: undoLast,
    setBg: setBg,
    setMode: setMode,
    menu: showBoardMenu,
  };
})(window.NoteApp);
