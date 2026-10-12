window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; 
    bytes[8] = (bytes[8] & 0x3f) | 0x80; 
    var hex = [];
    for (var j = 0; j < 16; j++) hex.push((bytes[j] + 0x100).toString(16).slice(1));
    return (
      hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') +
      '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('')
    );
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function debounce(fn, wait) {
    var timer = null;
    var lastArgs = null;
    var lastThis = null;

    function invoke() {
      var args = lastArgs;
      var self = lastThis;
      timer = null;
      lastArgs = null;
      lastThis = null;
      if (args) fn.apply(self, args);
    }

    function debounced() {
      lastArgs = arguments;
      lastThis = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(invoke, wait);
    }

    debounced.flush = function () {
      if (timer) {
        clearTimeout(timer);
        invoke();
      }
    };
    debounced.cancel = function () {
      if (timer) clearTimeout(timer);
      timer = null;
      lastArgs = null;
    };
    debounced.pending = function () {
      return timer !== null;
    };
    return debounced;
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.keys(value).forEach(function (d) { node.dataset[d] = value[d]; });
        else if (key === 'style') node.setAttribute('style', value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function htmlToText(html) {
    var s = String(html === null || html === undefined ? '' : html);
    if (s.indexOf('<') === -1) return s;
    var tmp = document.createElement('div');
    tmp.innerHTML = s;
    Array.prototype.forEach.call(tmp.querySelectorAll('.wikilink__x'), function (x) {
      if (x.parentNode) x.parentNode.removeChild(x);
    });
    return tmp.textContent || '';
  }

  function isRichHtml(value) {
    return /<[a-zA-Z][^>]*>/.test(String(value || ''));
  }

  function normTitle(value) {
    return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  }

  function decodeEntities(value) {
    var box = document.createElement('textarea');
    box.innerHTML = String(value === null || value === undefined ? '' : value);
    return box.value;
  }

  function buildWikiPill(doc, title) {
    var pill = doc.createElement('span');
    pill.className = 'wikilink';
    pill.setAttribute('contenteditable', 'false');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute('role', 'link');
    pill.setAttribute('data-title', title);
    pill.setAttribute('data-ctx', 'wikilink');
    pill.appendChild(doc.createTextNode(title));
    var x = doc.createElement('span');
    x.className = 'wikilink__x';
    x.setAttribute('aria-hidden', 'true');
    x.textContent = '\u00d7';
    pill.appendChild(x);
    return pill;
  }

  function ensureWikiPillX(pill) {
    if (!pill || pill.querySelector('.wikilink__x')) return pill;
    var x = pill.ownerDocument.createElement('span');
    x.className = 'wikilink__x';
    x.setAttribute('aria-hidden', 'true');
    x.textContent = '\u00d7';
    pill.appendChild(x);
    return pill;
  }

  function linkifyWikiText(root) {
    if (!root || !root.ownerDocument) return 0;
    var doc = root.ownerDocument;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf('[[') === -1) return NodeFilter.FILTER_SKIP;
        if (node.parentNode && node.parentNode.closest
            && node.parentNode.closest('.wikilink')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var count = 0;
    nodes.forEach(function (textNode) {
      if (!textNode.parentNode || count >= 200) return;
      var src = textNode.nodeValue;
      var pattern = /\[\[([^\[\]\n]{1,200})\]\]/g;
      var frag = doc.createDocumentFragment();
      var last = 0;
      var match = pattern.exec(src);
      var touched = false;
      while (match && count < 200) {
        var raw = String(match[1]).trim();
        if (!raw) {
          match = pattern.exec(src);
          continue;
        }
        frag.appendChild(doc.createTextNode(src.slice(last, match.index)));
        frag.appendChild(buildWikiPill(doc, raw.slice(0, 200)));
        last = match.index + match[0].length;
        touched = true;
        count++;
        match = pattern.exec(src);
      }
      if (touched) {
        frag.appendChild(doc.createTextNode(src.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
      }
    });
    return count;
  }

  function extractWikiLinks(html) {
    var source = String(html === null || html === undefined ? '' : html);
    var found = [];
    var seen = {};
    function take(raw) {
      var clean = String(raw || '').trim().slice(0, 200);
      var norm = normTitle(clean);
      if (clean && norm && !seen[norm] && found.length < 100) {
        seen[norm] = true;
        found.push({ raw: clean, norm: norm });
      }
    }
    var tagPattern = /<span\b[^>]*>/gi;
    var tag = tagPattern.exec(source);
    while (tag) {
      var markup = tag[0];
      if (/\bwikilink\b/.test(markup)) {
        var title = /data-title="([^"]*)"/i.exec(markup);
        if (title) take(decodeEntities(title[1]));
      }
      tag = tagPattern.exec(source);
    }
    var text = htmlToText(source);
    var pattern = /\[\[([^\[\]\n]{1,200})\]\]/g;
    var match = pattern.exec(text);
    while (match && found.length < 100) {
      take(match[1]);
      match = pattern.exec(text);
    }
    return found;
  }

  function noteToPlainText(html) {
    var source = String(html === null || html === undefined ? '' : html);
    if (source.indexOf('<') === -1) return source;
    var box = document.createElement('div');
    box.innerHTML = source;
    var pills = box.querySelectorAll('.wikilink');
    Array.prototype.forEach.call(pills, function (pill) {
      var title = pill.getAttribute('data-title') || pill.textContent;
      pill.parentNode.replaceChild(document.createTextNode('[[' + title + ']]'), pill);
    });
    var pictures = box.querySelectorAll('img');
    Array.prototype.forEach.call(pictures, function (img) {
      img.parentNode.replaceChild(document.createTextNode('[image]'), img);
    });
    var blocks = box.querySelectorAll('div, p, li, br, .task-row, ul, ol, h1, h2, h3');
    Array.prototype.forEach.call(blocks, function (node) {
      if (node.tagName === 'BR') {
        node.parentNode.replaceChild(document.createTextNode('\n'), node);
      } else if (node !== box) {
        node.appendChild(document.createTextNode('\n'));
      }
    });
    return box.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  var IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i;

  function sanitizeRichHtml(html) {
    var s = String(html || '');
    var images = [];
    s = s.replace(/<img\b[^>]*>/gi, function (tag) {
      var srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      var src = String((srcMatch && (srcMatch[2] || srcMatch[3] || srcMatch[4])) || '');
      if (IMAGE_DATA_URL.test(src)) {
        images.push(src);
        return '\u0000img' + (images.length - 1) + '\u0000';
      }
      var idMatch = /\bdata-file-id\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      var id = String((idMatch && (idMatch[2] || idMatch[3] || idMatch[4])) || '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return '';
      images.push('file:' + id);
      return '\u0000img' + (images.length - 1) + '\u0000';
    });
    s = s.replace(/<(script|style|iframe|object|embed|form|button|select|textarea|video|audio|link|meta|base)[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    s = s.replace(/<(script|style|iframe|object|embed|form|button|select|textarea|video|audio|link|meta|base)[^>]*\/?>/gi, '');
    s = s.replace(/<input\b[^>]*>/gi, function (tag) {
      if (!/type\s*=\s*["']?checkbox["']?/i.test(tag)) return '';
      return /checked/i.test(tag)
        ? '<input type="checkbox" tabindex="-1" checked>'
        : '<input type="checkbox" tabindex="-1">';
    });
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, function (m, attr, q, d1, d2, d3) {
      var url = (d1 || d2 || d3 || '').trim();
      if (/^(https?:|mailto:|#)/i.test(url)) return attr + '="' + url + '"';
      return '';
    });
    s = s.replace(/\u0000img(\d+)\u0000/g, function (m, index) {
      var value = images[Number(index)];
      if (!value) return '';
      if (value.indexOf('file:') === 0) {
        return '<img class="note-img" data-file-id="' + value.slice(5)
          + '" contenteditable="false" alt="Pasted picture">';
      }
      return '<img class="note-img" src="' + value + '" contenteditable="false" alt="Pasted picture">';
    });
    return s;
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
  }

  function formatWhen(iso) {
    if (!iso) return '';
    var then = new Date(iso);
    if (isNaN(then.getTime())) return '';
    var diff = Date.now() - then.getTime();
    var min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hrs = Math.round(min / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.round(hrs / 24);
    if (days < 7) return days + 'd ago';
    return then.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isImageMime(mime) {
    return /^image\//i.test(mime || '');
  }

  function fileGlyph(filename, mime) {
    var m = (mime || '').toLowerCase();
    var ext = (filename || '').split('.').pop().toLowerCase();
    if (m.indexOf('image/') === 0) return 'IMG';
    if (m === 'application/pdf' || ext === 'pdf') return 'PDF';
    if (ext === 'md' || m === 'text/markdown') return 'MD';
    if (ext === 'txt' || m.indexOf('text/') === 0) return 'TXT';
    if (ext === 'docx' || ext === 'doc') return 'DOC';
    if (ext === 'csv') return 'CSV';
    if (ext === 'json') return 'JSON';
    return 'FILE';
  }

  var toastHost = null;

  function toast(message, kind, timeout) {
    if (!toastHost) {
      document.addEventListener('DOMContentLoaded', function () { toastHost = toastHost || ensureToastHost(); });
      toastHost = ensureToastHost();
    }
    var node = el('div', { class: 'toast toast--' + (kind || 'info'), role: 'status' }, [
      el('span', { class: 'toast__msg', text: String(message) }),
    ]);
    toastHost.appendChild(node);
    if (typeof toastHost.showPopover === 'function') {
      try {
        if (toastHost.matches(':popover-open')) toastHost.hidePopover();
        toastHost.showPopover();
      } catch (err) {
      }
    }
    var life = timeout || (kind === 'error' ? 7000 : 3200);
    var hideTimer = setTimeout(remove, life);

    function remove() {
      clearTimeout(hideTimer);
      if (!node.parentNode) return;
      node.classList.add('toast--out');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        if (!toastHost.childNodes.length && typeof toastHost.hidePopover === 'function'
            && toastHost.matches(':popover-open')) {
          try { toastHost.hidePopover(); } catch (err) {  }
        }
      }, 180);
    }
    return remove;
  }

  function ensureToastHost() {
    var host = document.getElementById('toast-host');
    if (!host) {
      host = el('div', {
        id: 'toast-host',
        class: 'toast-host',
        'aria-live': 'polite',
        popover: 'manual',
      });
      document.body.appendChild(host);
    }
    return host;
  }

  function buildImagePill(doc, value) {
    var source = String(value || '');
    var img = doc.createElement('img');
    img.className = 'note-img';
    img.setAttribute('contenteditable', 'false');
    img.setAttribute('alt', 'Pasted picture');
    if (source.indexOf('data:image/') === 0) img.setAttribute('src', source);
    else img.setAttribute('data-file-id', source);
    return img;
  }

  App.util = {
    uuid: uuid,
    nowIso: nowIso,
    debounce: debounce,
    $: $,
    el: el,
    escapeHtml: escapeHtml,
    htmlToText: htmlToText,
    isRichHtml: isRichHtml,
    normTitle: normTitle,
    decodeEntities: decodeEntities,
    buildWikiPill: buildWikiPill,
    buildImagePill: buildImagePill,
    ensureWikiPillX: ensureWikiPillX,
    linkifyWikiText: linkifyWikiText,
    extractWikiLinks: extractWikiLinks,
    noteToPlainText: noteToPlainText,
    sanitizeRichHtml: sanitizeRichHtml,
    formatBytes: formatBytes,
    formatWhen: formatWhen,
    isImageMime: isImageMime,
    fileGlyph: fileGlyph,
    toast: toast,
  };
})(window.NoteApp);
