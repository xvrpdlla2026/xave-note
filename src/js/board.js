window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var BOARD_ID = 'xave';
  var MIN_Z = 0.3;
  var MAX_Z = 2.5;
  var STEP = 1.15;
  var SIZES = { note: [268, 176], todo: [256, 196], link: [268, 96], image: [288, 216], comment: [268, 132], ref: [244, 168], column: [420, 320], table: [320, 208], group: [232, 62], file: [300, 236], draw: [380, 280] };

  var board = {
    marks: [],
    marking: false,
    railMarks: false,
    open: false,
    items: [],
    view: { x: 0, y: 0, z: 1 },
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
    inkRepaintCards();
    scaleMarks();
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
    if (isChild(item)) return;
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
    box.textContent = (item.data && item.data[key]) || '';
    box.addEventListener('input', function () {
      if (lockOf(item)) return;
      item.data[key] = box.textContent;
      queueItemSave(item);
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

  function fontButton(item, label, dir) {
    var button = node('button', 'bd-item__font', label);
    button.type = 'button';
    button.setAttribute('aria-label', dir > 0 ? 'Bigger text' : 'Smaller text');
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
    else if (!media) box.appendChild(node('span', 'bd-linkcard__name', data.host || hostOf(url)));
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

  function imageBody(item) {
    var wrap = node('div', 'bd-image');
    var data = item.data || {};
    if (data.fileId) {
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
      var img = node('img', 'bd-image__img');
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

  function refBody(item) {
    var wrap = node('div', 'bd-ref');
    var data = item.data || {};
    var glyph = node('span', 'bd-ref__glyph');
    glyph.appendChild(App.ui.icon(item.ref_kind === 'folder' ? 'folder' : item.ref_kind === 'file' ? 'file' : 'note', 16));
    var head = node('div', 'bd-ref__head');
    head.appendChild(glyph);
    head.appendChild(node('span', 'bd-ref__title', data.title || 'Untitled'));
    wrap.appendChild(head);
    var stage = null;
    if (item.ref_kind === 'file' && data.fileId && App.ui.filePreviewContent) {
      var load = function () {
        return Promise.resolve(App.db.getFileBlob(data.fileId)).then(function (res) { return res ? res.blob : null; });
      };
      var holder = App.ui.filePreviewContent(filePreview(data), load, { pdfChrome: false });
      if (holder) {
        stage = node('div', 'bd-ref__preview');
        stage.appendChild(holder);
        wrap.appendChild(stage);
      }
    }
    if (!stage) {
      wrap.appendChild(node('span', 'bd-ref__meta', data.meta || ''));
      if (data.snippet) wrap.appendChild(node('p', 'bd-ref__snippet', data.snippet));
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
    if (label) label.textContent = labelText(item);
  }

  function labelText(item) {
    var title = item.data && item.data.title;
    return title ? title : kindLabel(item);
  }

  function barLabel(item) {
    var span = node('span', 'bd-item__kind', labelText(item));
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
      span.textContent = labelText(item);
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
    input.focus();
    input.select();
  }

  function paintItem(item) {
    var box = node('div', 'bd-item bd-item--' + item.kind);
    box.setAttribute('data-board-id', item.id);
    var bar = node('div', 'bd-item__bar');
    bar.appendChild(barLabel(item));
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
      tools.appendChild(fontButton(item, 'A-', -1));
      tools.appendChild(fontButton(item, 'A+', 1));
    }
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
    var grip = node('div', 'bd-item__resize');
    grip.setAttribute('data-board-resize', item.id);
    box.appendChild(grip);
    box.addEventListener('pointerdown', onItemDown);
    item.node = box;
    applyFont(item);
    paintLock(item);
    placeItem(item);
    board.canvas.appendChild(box);
    if (isChild(item)) attachChild(item);
    if (item.kind === 'link') renderLinkCard(item);
    return box;
  }

  function addItem(kind, payload) {
    pushUndo('add');
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

  function lockOf(item) {
    return !!(item.data && item.data.locked);
  }

  function paintLock(item) {
    if (!item.node) return;
    var locked = lockOf(item);
    var button = item.node.querySelector('.bd-item__lock');
    var remove = item.node.querySelector('.bd-item__x');
    var grip = item.node.querySelector('.bd-item__resize');
    item.node.classList.toggle('is-locked', locked);
    if (button) {
      button.textContent = '';
      button.appendChild(App.ui.icon(locked ? 'lock' : 'unlock', 12));
      button.setAttribute('aria-label', locked ? 'Unlock this card' : 'Lock this card');
      button.title = locked ? 'Unlock this card' : 'Lock this card';
    }
    if (remove) remove.style.display = locked ? 'none' : '';
    if (grip) grip.style.display = locked ? 'none' : '';
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

  function removeItem(item) {
    if (lockOf(item)) { util.toast('Unlock this card first'); return; }
    pushUndo('remove');
    containerKids(item.id).forEach(function (kid) { releaseChild(kid, item); });
    var doomed = [item].concat(descendantsOf(item.id)).filter(function (row) { return !lockOf(row); });
    doomed.forEach(deleteRow);
    board.items = board.items.filter(function (other) { return doomed.indexOf(other) < 0; });
    setSelection([], null);
    paintLinks();
  }

  function removeSelected() {
    var rows = board.selectedIds.map(findItem).filter(Boolean);
    if (rows.length < 2) { if (rows.length) removeItem(rows[0]); return; }
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
    pushUndo('remove');
    doomed.forEach(deleteRow);
    board.items = board.items.filter(function (other) { return doomed.indexOf(other) < 0; });
    setSelection([], null);
    paintLinks();
    if (free.length < rows.length) util.toast('Locked cards were kept');
  }

  function onItemDown(event) {
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
      board.resize = { item: item, start: start };
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
    if (event.button !== 0) return;
    var target = event.target;
    var card = target.closest ? target.closest('.bd-item') : null;
    var handle = target.closest ? target.closest('.bd-item__bar') : null;
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
    if (target.closest && target.closest('.board__rail, .board__picker, .board__mode')) return;
    if (board.mode === 'select' && !board.space) {
      startMarquee(event);
      return;
    }
    select(null);
    board.pan = { x: event.clientX, y: event.clientY, vx: board.view.x, vy: board.view.y };
    board.stage.classList.add('is-panning');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
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
      if (isChild(size.item)) {
        var parent = containerOf(size.item);
        var geom = parent ? containerGeom(parent) : { cols: 1, colW: 200 };
        var stepX = geom.colW + CONTAINER_GAP;
        var stepY = CONTAINER_ROW + CONTAINER_GAP;
        var baseSpan = Math.max(1, Math.min(geom.cols, Math.round((size.start.w + CONTAINER_GAP) / stepX)));
        var baseRows = Math.max(1, Math.round((size.start.h + CONTAINER_GAP) / stepY));
        var dCol = Math.round((event.clientX - size.start.x) / scale / stepX);
        var dRow = Math.round((event.clientY - size.start.y) / scale / stepY);
        var span = Math.max(1, Math.min(geom.cols, baseSpan + dCol));
        var count = Math.max(1, baseRows + dRow);
        size.item.data.span = span;
        size.item.data.rows = count;
        size.item.w = Math.round(span * geom.colW + CONTAINER_GAP * (span - 1));
        size.item.h = Math.round(count * CONTAINER_ROW + CONTAINER_GAP * (count - 1));
        if (parent) layoutContainer(parent, null);
      } else {
        size.item.w = Math.max(170, Math.round(size.start.w + (event.clientX - size.start.x) / scale));
        size.item.h = Math.max(110, Math.round(size.start.h + (event.clientY - size.start.y) / scale));
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
    if (board.marquee) {
      if (board.marquee.node && board.marquee.node.parentNode) board.marquee.node.parentNode.removeChild(board.marquee.node);
      board.marquee = null;
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
      if (board.picker) { closePicker(); return; }
      if (editing) { event.target.blur(); return; }
      if (board.marking) { setMarking(false); return; }
      if (board.railMarks) { openMarks(false); return; }
      if (board.selectedIds.length) { event.preventDefault(); setSelection([], null); return; }
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
    board.space = false;
    if (board.stage) board.stage.classList.remove('is-space');
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
      return { id: mark.id, x: mark.x, y: mark.y, name: mark.name, icon: mark.icon || 'pin' };
    });
  }

  function saveMarks(now) {
    if (board.markTimer) clearTimeout(board.markTimer);
    var flush = function () {
      board.markTimer = null;
      try { App.db.boardSaveMarks(BOARD_ID, JSON.stringify(markData(board.marks))); } catch (e) { }
    };
    if (now) { flush(); return; }
    board.markTimer = setTimeout(flush, 260);
  }

  function addMark(x, y, name, icon) {
    if (!board.marks) board.marks = [];
    pushUndo('landmark');
    var mark = {
      id: util.uuid(),
      x: Math.round(x),
      y: Math.round(y),
      name: name || 'Landmark ' + (board.marks.length + 1),
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
        head.addEventListener('dblclick', function (event) { event.preventDefault(); markEdit(mark); });
        var label = node('span', 'bd-mark__name', mark.name);
        label.addEventListener('dblclick', function (event) { event.preventDefault(); event.stopPropagation(); markEdit(mark); });
        pin.appendChild(head);
        pin.appendChild(label);
        board.canvas.appendChild(pin);
        mark.node = pin;
        mark.head = head;
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
      moved = true;
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
      if (moved) saveMarks(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function markEdit(mark) {
    if (!mark.node || !mark.node.isConnected) return;
    if (mark.node.querySelector('.bd-mark__edit')) return;
    var input = node('input', 'bd-mark__edit');
    input.type = 'text';
    input.value = mark.name;
    input.setAttribute('aria-label', 'Landmark name');
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    mark.label.style.display = 'none';
    mark.node.appendChild(input);
    input.focus();
    input.select();
    var done = function (keep) {
      if (!input.parentNode) return;
      var value = input.value.trim();
      if (keep && value && value !== mark.name) { mark.name = value; saveMarks(true); }
      input.parentNode.removeChild(input);
      mark.label.style.display = '';
      paintMarks();
      renderMarkList();
    };
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); done(true); }
      else if (event.key === 'Escape') { event.preventDefault(); done(false); }
    });
    input.addEventListener('blur', function () { done(true); });
  }

  function setMarking(on) {
    board.marking = !!on;
    if (board.stage) board.stage.classList.toggle('is-marking', board.marking);
    if (board.marksAdd) board.marksAdd.classList.toggle('is-on', board.marking);
    if (board.marking) util.toast('Click the board to drop a landmark');
  }

  function openMarks(on) {
    board.railMarks = on !== false;
    if (board.rail) board.rail.classList.toggle('is-marks', board.railMarks);
    if (board.root) board.root.classList.toggle('is-marks', board.railMarks);
    if (!board.railMarks) setMarking(false);
    renderMarkList();
  }

  function goToMark(mark) {
    var rect = board.stage.getBoundingClientRect();
    board.view.x = Math.round(rect.width / 2 - mark.x * board.view.z);
    board.view.y = Math.round(rect.height / 2 - mark.y * board.view.z);
    applyView();
    if (mark.node && mark.node.isConnected) {
      mark.node.classList.add('is-hot');
      setTimeout(function () { if (mark.node) mark.node.classList.remove('is-hot'); }, 900);
    }
  }

  function renameRow(row, mark) {
    if (row.querySelector('.board__mark-edit')) return;
    var name = row.querySelector('.board__mark-name');
    var input = node('input', 'board__mark-edit');
    input.type = 'text';
    input.value = mark.name;
    input.setAttribute('aria-label', 'Landmark name');
    name.style.display = 'none';
    row.insertBefore(input, name);
    input.focus();
    input.select();
    var done = function (keep) {
      if (!input.parentNode) return;
      var value = input.value.trim();
      if (keep && value && value !== mark.name) { mark.name = value; saveMarks(true); }
      input.parentNode.removeChild(input);
      name.style.display = '';
      paintMarks();
      renderMarkList();
    };
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); done(true); }
      else if (event.key === 'Escape') { event.preventDefault(); done(false); }
    });
    input.addEventListener('blur', function () { done(true); });
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
      name.addEventListener('dblclick', function (event) { event.preventDefault(); renameRow(row, mark); });
      var tools = node('div', 'board__mark-tools');
      var edit = node('button', 'board__mark-act');
      edit.type = 'button';
      edit.title = 'Rename';
      edit.setAttribute('aria-label', 'Rename');
      edit.appendChild(App.ui.icon('pencil', 14));
      edit.addEventListener('click', function (event) { event.stopPropagation(); renameRow(row, mark); });
      var drop = node('button', 'board__mark-act');
      drop.type = 'button';
      drop.title = 'Remove';
      drop.setAttribute('aria-label', 'Remove');
      drop.appendChild(App.ui.icon('trash', 14));
      drop.addEventListener('click', function (event) { event.stopPropagation(); removeMark(mark); });
      tools.appendChild(edit);
      tools.appendChild(drop);
      row.appendChild(pick);
      row.appendChild(name);
      row.appendChild(tools);
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
    panel.appendChild(node('p', 'board__marks-hint', 'Drop a pin on the board, then name it. Drag a pin to move it, double click to rename.'));
    var list = node('div', 'board__marks-list');
    panel.appendChild(list);
    board.marksPanel = panel;
    board.marksList = list;
    board.marksAdd = add;
    return panel;
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
    board.rail = rail;
    var top = node('div', 'board__rail-group');
    top.appendChild(railButton('pin', 'Landmarks', function () { openMarks(!board.railMarks); }));
    rail.appendChild(top);
    var group = node('div', 'board__rail-group');
    group.appendChild(railButton('note', 'Note', function () { addItem('note'); }));
    group.appendChild(railButton('check', 'To-do', function () { addItem('todo'); }));
    group.appendChild(railButton('external', 'Link', function () { addItem('link'); }));
    group.appendChild(railButton('file', 'File', function () { addItem('image'); }));
    group.appendChild(railButton('info', 'Comment', function () { addItem('comment'); }));
    group.appendChild(railButton('panel', 'Group', function () { addItem('column'); }));
    group.appendChild(railButton('grid', 'Table', function () { addItem('table'); }));
    group.appendChild(railButton('pencil', 'Draw', function () { setInkMode(!inkState.on); }));
    board.inkButton = group.lastElementChild;
    rail.appendChild(group);
    var source = node('div', 'board__rail-group');
    source.appendChild(railButton('layers', 'From notes', openPicker));
    source.appendChild(railButton('restore', 'Fit', fitView));
    rail.appendChild(source);
    var foot = node('div', 'board__rail-group board__rail--foot');
    foot.appendChild(railButton('arrowLeft', 'Back', close));
    rail.appendChild(foot);
    rail.appendChild(buildMarks());
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
      return function () { addItem(kind, { parent: item.id }); };
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

  function snapshotBoard() {
    return {
      items: JSON.parse(JSON.stringify(board.items, function (key, value) {
        if (key === 'node' || key === 'saveTimer' || key === 'src') return undefined;
        return value;
      })),
      view: { x: board.view.x, y: board.view.y, z: board.view.z },
      bg: board.bg,
      marks: markData(board.marks),
    };
  }

  function pushUndo(label) {
    if (!board.open || board.batch) return;
    board.undo.push({ label: label, snap: snapshotBoard() });
    if (board.undo.length > 30) board.undo.shift();
    board.redo.length = 0;
  }

  function repaintAll() {
    if (!board.canvas) return;
    clearCanvas();
    board.items.forEach(function (item) {
      delete item.node;
      paintItem(item);
    });
    settleChildren();
    paintLinks();
    paintSelection();
    paintMarks();
  }

  function applySnap(snap) {
    var keep = {};
    snap.items.forEach(function (row) { keep[row.id] = true; });
    board.items.forEach(function (item) {
      if (keep[item.id]) return;
      if (item.saveTimer) { clearTimeout(item.saveTimer); item.saveTimer = null; }
      if (item.node && item.node.parentNode) item.node.parentNode.removeChild(item.node);
      try { App.db.boardDeleteItem(item.id); } catch (e) { }
    });
    clearCanvas();
    board.items = snap.items.map(function (row) {
      var copy = JSON.parse(JSON.stringify(row));
      try { App.db.boardAddItem(copy); } catch (e) { }
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
    if (board.redo.length > 30) board.redo.shift();
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
    var copy = JSON.parse(JSON.stringify(item, function (key, value) {
      if (key === 'node' || key === 'saveTimer' || key === 'src') return undefined;
      return value;
    }));
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
    var at = board.menuAt || centerOfView(board.items.length);
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      util.toast('Press Ctrl+V to paste');
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      if (!text) {
        util.toast('Clipboard is empty');
        return;
      }
      pushUndo('paste');
      addItem('note', { at: at, data: { text: util.escapeHtml(text).replace(/\n/g, '<br>') } });
    }).catch(function () {
      util.toast('Press Ctrl+V to paste');
    });
  }

  function onPaste(event) {
    if (!board.open || board.picker) return;
    var target = event.target;
    if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]') && !target.closest('.bd-table__cell')) return;
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
    pushUndo('paste');
    addItem('note', { at: at, data: { text: util.escapeHtml(text).replace(/\n/g, '<br>') } });
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
    closeDrawPad();
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
      var k = inkScale(w, h);
      if (canvas.inkScale && canvas.inkW === w && canvas.inkH === h && Math.abs(k - canvas.inkScale) / canvas.inkScale < 0.2) return;
      canvas.inkScale = k;
      canvas.inkW = w;
      canvas.inkH = h;
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      var ctx = canvas.getContext('2d');
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (item.data && typeof item.data.ox === 'number') {
        ctx.setTransform(k, 0, 0, k, k * (item.data.ox - item.x - 1), k * (item.data.oy - item.y - 1 - INK_BAR));
      } else {
        var box = strokeBox(strokes);
        ctx.setTransform(k, 0, 0, k, k * ((w - box.w) / 2 - box.x), k * ((h - box.h) / 2 - box.y));
      }
      strokes.forEach(function (stroke) { paintStroke(ctx, stroke); });
    };
    canvas.inkPaint = paint;
    wrap.addEventListener('dblclick', function (event) {
      event.stopPropagation();
      startInk(item);
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
    board.items = [];
    var stored = [];
    try { stored = App.db.boardItems(BOARD_ID) || []; } catch (e) { stored = []; }
    stored.forEach(function (row) {
      var item = row;
      item.data = row.data || {};
      board.items.push(item);
      paintItem(item);
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
  }

  function setMode(next, quiet) {
    board.mode = next === 'select' ? 'select' : 'grab';
    var on = board.mode === 'select';
    if (board.modeButton) {
      board.modeButton.textContent = '';
      var glyph = App.ui.icon(on ? 'marquee' : 'hand', 16);
      if (glyph) board.modeButton.appendChild(glyph);
      board.modeButton.classList.toggle('is-select', on);
      board.modeButton.title = on ? 'Drag to select blocks' : 'Drag to pan the board';
      board.modeButton.setAttribute('aria-label', board.modeButton.title);
      board.modeButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (board.stage) board.stage.classList.toggle('is-select-mode', on);
    if (!on) setSelection([], null);
    if (!quiet) util.toast(on ? 'Drag to select blocks' : 'Drag to pan the board');
  }

  function open() {
    if (board.open) return;
    board.open = true;
    board.marking = false;
    board.railMarks = false;
    if (board.stage) board.stage.classList.remove('is-marking');
    if (board.rail) board.rail.classList.remove('is-marks');
    if (board.root) board.root.classList.remove('is-marks');
    if (!board.root) document.body.appendChild(buildRoot());
    board.root.classList.add('is-open');
    document.body.classList.add('is-board');
    try { App.db.boardEnsure(BOARD_ID, 'Xave'); } catch (e) { }
    load();
    setMode(board.mode, true);
    applyBgFromDb();
    if (!board.bound) {
      board.bound = true;
      board.root.addEventListener('contextmenu', onBoardContext);
      document.addEventListener('paste', onPaste);
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', applyView);
  }

  function close() {
    if (!board.open) return;
    board.items.forEach(flushItem);
    closePicker();
    board.open = false;
    setSelection([], null);
    setInkMode(false);
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
    dropFiles: dropFiles,
    undo: undoLast,
    setBg: setBg,
    setMode: setMode,
    menu: showBoardMenu,
  };
})(window.NoteApp);
