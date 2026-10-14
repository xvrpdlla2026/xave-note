window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var BOARD_ID = 'xave';
  var MIN_Z = 0.3;
  var MAX_Z = 2.5;
  var STEP = 1.15;
  var SIZES = { note: [268, 176], todo: [256, 196], link: [268, 96], image: [288, 216], comment: [268, 132], ref: [244, 168], line: [260, 44], column: [280, 340], table: [320, 208], group: [232, 62], file: [300, 236] };

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
    pickModel: [],
    root: null,
    stage: null,
    canvas: null,
    grid: null,
    zoomLabel: null,
    hint: null,
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
    if (kind === 'line') return {};
    if (kind === 'column') return { text: '' };
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
      if (item.data.syncLink) item.data.syncLink();
    });
    input.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
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
    var wrap = node('div', 'bd-comment');
    var list = node('div', 'bd-comment__list');
    wrap.appendChild(list);
    var composer = node('div', 'bd-comment__composer');
    composer.appendChild(avatarNode());
    var input = node('input', 'bd-comment__input');
    input.type = 'text';
    input.placeholder = 'Write a comment...';
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
        handler();
      });
      return button;
    }

    function finishEdit(row, value, keep) {
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
    }

    function submit() {
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
    if (data.image) {
      var shot = node('img', 'bd-linkcard__shot');
      shot.src = data.image;
      shot.alt = '';
      shot.setAttribute('referrerpolicy', 'no-referrer');
      shot.setAttribute('loading', 'lazy');
      shot.addEventListener('error', function () { if (shot.parentNode) shot.parentNode.removeChild(shot); fitLinkCard(item); });
      box.appendChild(shot);
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
    box.appendChild(node('span', 'bd-linkcard__name', String(data.title || '').trim() || data.host || hostOf(url)));
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
    item.data.linkBusy = url;
    renderLinkCard(item);
    unfurl(url).then(function (meta) {
      if (item.data.linkBusy !== url) return;
      item.data.linkBusy = '';
      item.data.link = { url: url, title: meta.title, description: meta.description, image: meta.image, favicon: meta.favicon, host: meta.host || hostOf(url) };
      saveItem(item);
      renderLinkCard(item);
    }).catch(function () {
      if (item.data.linkBusy !== url) return;
      item.data.linkBusy = '';
      item.data.link = { url: url, title: '', description: '', image: '', favicon: '', host: hostOf(url), failed: true };
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

  function boardWorkspace() {
    var state = App.app && App.app.state;
    if (state && state.workspaceId) return state.workspaceId;
    var list = safeList(function () { return App.db.listWorkspaces(); });
    return list.length ? list[0].id : '';
  }

  function fileLoad(data) {
    return function () {
      return Promise.resolve(App.db.getFileBlob(data.fileId)).then(function (res) { return res ? res.blob : null; });
    };
  }

  function imageBody(item) {
    var wrap = node('div', 'bd-image');
    var data = item.data || {};
    if (data.fileId && App.ui.filePreviewContent) {
      var holder = App.ui.filePreviewContent(filePreview(data), fileLoad(data), {
        image: 'bd-image__img',
        video: 'bd-file__video',
        audio: 'bd-file__audio',
        pdf: 'bd-file__pdf',
        doc: 'bd-file__doc',
        pdfChrome: false,
      });
      if (holder) {
        wrap.appendChild(holder);
        return wrap;
      }
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
        var wsId = boardWorkspace();
        if (!wsId) { util.toast('Create a workspace first'); return; }
        util.toast('Adding ' + file.name + '\u2026');
        App.db.addFile(wsId, null, file.name, file.type || 'application/octet-stream', file).then(function (row) {
          item.data.fileId = row.id;
          item.data.filename = row.filename;
          item.data.mime = row.mime_type;
          item.data.size = row.size;
          saveItem(item);
          repaintBody(item);
          if (App.app && App.app.render) App.app.render();
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
      var holder = App.ui.filePreviewContent(filePreview(data), load, {});
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
    if (item.kind === 'line') return lineBody();
    if (item.kind === 'column') return columnBody(item);
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
  }

  function paintItem(item) {
    var box = node('div', 'bd-item bd-item--' + item.kind);
    box.setAttribute('data-board-id', item.id);
    var bar = node('div', 'bd-item__bar');
    bar.appendChild(node('span', 'bd-item__kind', item.kind === 'ref' ? (item.ref_kind || 'item') : item.kind === 'group' ? (item.data && item.data.scope === 'workspace' ? 'workspace' : 'folder') : item.kind === 'image' && item.data && item.data.filename ? ((item.data.filename.match(/\.[a-z0-9]+$/i) || ['file'])[0].slice(1).toLowerCase()) : item.kind));
    var remove = node('button', 'bd-item__x', '\u00d7');
    remove.type = 'button';
    remove.setAttribute('data-board-del', item.id);
    remove.setAttribute('aria-label', 'Remove from board');
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      removeItem(item);
    });
    var tools = node('div', 'bd-item__tools');
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
    paintLock(item);
    placeItem(item);
    board.canvas.appendChild(box);
    if (item.kind === 'link') renderLinkCard(item);
    return box;
  }

  function addItem(kind, payload) {
    pushUndo('add');
    var now = util.nowIso();
    var size = SIZES[kind] || SIZES.note;
    var at = payload && payload.at ? payload.at : centerOfView(board.items.length);
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
  }

  function toggleLock(item) {
    if (!item.data) item.data = {};
    item.data.locked = !item.data.locked;
    saveItem(item);
    paintLock(item);
    util.toast(item.data.locked ? 'Card locked' : 'Card unlocked');
  }

  function removeItem(item) {
    if (lockOf(item)) { util.toast('Unlock this card first'); return; }
    pushUndo('remove');
    var doomed = [item].concat(descendantsOf(item.id)).filter(function (row) { return !lockOf(row); });
    doomed.forEach(function (row) {
      if (row.saveTimer) { clearTimeout(row.saveTimer); row.saveTimer = null; }
      if (row.node && row.node.parentNode) row.node.parentNode.removeChild(row.node);
      try { App.db.boardDeleteItem(row.id); } catch (e) { }
    });
    board.items = board.items.filter(function (other) { return doomed.indexOf(other) < 0; });
    if (doomed.some(function (row) { return row.id === board.selectedId; })) board.selectedId = null;
    paintLinks();
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
    if (lockOf(item)) return;
    event.stopPropagation();
    var grip = target.closest('.bd-item__resize');
    var start = { x: event.clientX, y: event.clientY, w: item.w, h: item.h, ix: item.x, iy: item.y };
    pushUndo(grip ? 'resize' : 'move');
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
      paintLinks();
      return;
    }
    if (board.resize) {
      var size = board.resize;
      size.item.w = Math.max(170, Math.round(size.start.w + (event.clientX - size.start.x) / scale));
      size.item.h = Math.max(110, Math.round(size.start.h + (event.clientY - size.start.y) / scale));
      placeItem(size.item);
      paintLinks();
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
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      if (editing) return;
      event.preventDefault();
      undoLast();
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
    group.appendChild(railButton('file', 'File', function () { addItem('image'); }));
    group.appendChild(railButton('info', 'Comment', function () { addItem('comment'); }));
    group.appendChild(railButton('list', 'Line', function () { addItem('line'); }));
    group.appendChild(railButton('panel', 'Column', function () { addItem('column'); }));
    group.appendChild(railButton('grid', 'Table', function () { addItem('table'); }));
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

  function lineBody() {
    return node('div', 'bd-line');
  }

  function columnBody(item) {
    var wrap = node('div', 'bd-column');
    var head = textArea(item, 'text', 'Column title');
    head.classList.add('bd-column__title');
    wrap.appendChild(head);
    wrap.appendChild(node('div', 'bd-column__space'));
    return wrap;
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
        cell.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); cell.blur(); }
        });
        line.appendChild(cell);
      });
      wrap.appendChild(line);
    });
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
    };
  }

  function pushUndo(label) {
    if (!board.open || board.batch) return;
    board.undo.push({ label: label, snap: snapshotBoard() });
    if (board.undo.length > 30) board.undo.shift();
  }

  function repaintAll() {
    if (!board.canvas) return;
    clearCanvas();
    board.items.forEach(function (item) {
      delete item.node;
      paintItem(item);
    });
    paintLinks();
  }

  function undoLast() {
    var entry = board.undo.pop();
    if (!entry) {
      util.toast('Nothing to undo');
      return;
    }
    var snap = entry.snap;
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
    board.selectedId = null;
    if (snap.bg && snap.bg !== board.bg) setBg(snap.bg, true);
    board.view.x = snap.view.x;
    board.view.y = snap.view.y;
    board.view.z = snap.view.z;
    applyView();
    repaintAll();
    queueViewSave();
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
    if (item.kind === 'ref') return (item.data && item.data.title) || 'Reference';
    if (item.kind === 'image') return (item.data && item.data.name) || 'Image';
    if (item.kind === 'link') return (item.data && (item.data.title || item.data.url)) || 'Link';
    if (item.kind === 'todo') return (item.data && item.data.title) || 'To-do';
    var text = util.htmlToText((item.data && item.data.text) || '').slice(0, 44);
    if (text) return text;
    return item.kind.charAt(0).toUpperCase() + item.kind.slice(1);
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
    if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]')) return;
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
        { label: 'New Line', icon: 'list', onclick: newItem('line') },
        { label: 'New Column', icon: 'panel', onclick: newItem('column') },
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

  function showItemMenu(item, at) {
    App.ui.openMenu({
      x: at.x,
      y: at.y,
      title: itemLabel(item),
      items: [
        { label: 'Duplicate', shortcut: 'Ctrl+D', icon: 'copy', onclick: function () { duplicateItem(item); } },
        { label: 'Remove', shortcut: 'Delete', icon: 'trash', danger: true, onclick: function () { removeItem(item); } },
        { sep: true },
        { label: 'Bring to front', icon: 'layers', onclick: function () { reorder(item, true); } },
        { label: 'Send to back', icon: 'layers', onclick: function () { reorder(item, false); } },
      ],
    });
  }

  function onBoardContext(event) {
    if (!board.open) return;
    var target = event.target;
    if (target && target.closest && target.closest('.board__picker')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]')) return;
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
    paintLinks();
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
    undo: undoLast,
    setBg: setBg,
    menu: showBoardMenu,
  };
})(window.NoteApp);
