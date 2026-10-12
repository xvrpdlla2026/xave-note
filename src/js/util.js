/**
 * util.js — small shared helpers: ids, timestamps, debounce, escaping, formatting, toasts.
 *
 * Loaded as a classic script (not an ES module) on purpose: `type="module"` scripts are
 * blocked on the file:// protocol, and this app must run by double-clicking index.html.
 * Everything attaches to the single global NoteApp namespace.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  // ------------------------------------------------------------------ identifiers
  /**
   * UUID v4. Uses the platform generator when available and falls back to
   * crypto.getRandomValues, then Math.random (only reachable in exotic environments).
   * Ids are text in SQLite so they stay human-readable in the .db file.
   */
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
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    var hex = [];
    for (var j = 0; j < 16; j++) hex.push((bytes[j] + 0x100).toString(16).slice(1));
    return (
      hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') +
      '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('')
    );
  }

  /** ISO-8601 UTC — sorts lexicographically, which is how notes/files are ordered. */
  function nowIso() {
    return new Date().toISOString();
  }

  // -------------------------------------------------------------------- debounce
  /**
   * Trailing-edge debounce with .flush() and .cancel().
   * The note editor needs .flush(): switching notes (or closing the tab) must not lose
   * the last few keystrokes that are still sitting inside the 500 ms window.
   */
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

  // ------------------------------------------------------------------- DOM helpers
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /** Create an element with attributes/children in one call. */
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
      // A null/false child is how callers skip an element conditionally.
      if (child === null || child === undefined || child === false) return;
      // Only primitives are text below. Callers must not hand a String *object* to this
      // position — it would be appended as an empty node (the search result count hit
      // exactly that, and silently rendered nothing).
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /**
   * Escape text for safe insertion as HTML *content* or into a quoted attribute.
   * Every piece of user data (titles, file names, workspace names) goes through this
   * before it is handed to innerHTML. Note *bodies* are the one exception: the editor
   * renders them as HTML, so they go through sanitizeRichHtml on the way in instead.
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Plain-text rendering of a note body for the surfaces that never show formatting:
   * card snippets, copy-to-clipboard, the delete dialog's word count. Tags become
   * nothing (so "hello<b>world</b>" never reads "helloworld" — the space the tag
   * replaced is already in the text nodes around it), entities decode through
   * textContent, and plain legacy bodies pass through untouched.
   */
  function htmlToText(html) {
    var s = String(html === null || html === undefined ? '' : html);
    if (s.indexOf('<') === -1) return s;
    var tmp = document.createElement('div');
    // innerHTML parses without executing: scripts never run from a parsed fragment.
    tmp.innerHTML = s;
    // Hover removes are chrome, not prose: a pseudo-element cannot take clicks, so
    // the × is a real node, and real nodes have to be excluded here explicitly.
    Array.prototype.forEach.call(tmp.querySelectorAll('.wikilink__x'), function (x) {
      if (x.parentNode) x.parentNode.removeChild(x);
    });
    return tmp.textContent || '';
  }

  /** True when a stored body already carries formatting markup (vs legacy plain text). */
  function isRichHtml(value) {
    return /<[a-zA-Z][^>]*>/.test(String(value || ''));
  }

  /**
   * Canonical form of a note title for link matching: trimmed, case-folded. Links
   * resolve by title rather than by id, which is what makes them survive renames —
   * and what makes this normalisation the one both sides must share.
   */
  function normTitle(value) {
    return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  }

  /** Decode the entities serialised HTML carries (`&quot;` in a data-title). */
  function decodeEntities(value) {
    var box = document.createElement('textarea');
    box.innerHTML = String(value === null || value === undefined ? '' : value);
    return box.value;
  }

  /**
   * A link pill element: how `[[Title]]` is stored AND shown. One representation
   * for both, so rendering never has to transform text into widgets and back —
   * that round trip is where link editors lose caret position and duplicate
   * brackets. Atomic (contenteditable=false): the caret cannot enter it, one
   * Backspace removes it whole, and clicking navigates instead of editing.
   */
  function buildWikiPill(doc, title) {
    var pill = doc.createElement('span');
    pill.className = 'wikilink';
    pill.setAttribute('contenteditable', 'false');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute('role', 'link');
    pill.setAttribute('data-title', title);
    // data-ctx-label / data-resolved are filled in by the editor render, which is
    // the one place that knows whether the title resolves. Right-click reads them
    // to offer Open versus Create without re-resolving.
    pill.setAttribute('data-ctx', 'wikilink');
    pill.appendChild(doc.createTextNode(title));
    // The hover remove: a mouse-only affordance (aria-hidden, since keyboard users
    // already have Backspace, the chip × and the menu). A real button would be
    // stripped by the sanitizer and would steal the pill's own click.
    var x = doc.createElement('span');
    x.className = 'wikilink__x';
    x.setAttribute('aria-hidden', 'true');
    x.textContent = '\u00d7';
    pill.appendChild(x);
    return pill;
  }

  /** Ensure the hover remove exists on pills stored before it did. */
  function ensureWikiPillX(pill) {
    if (!pill || pill.querySelector('.wikilink__x')) return pill;
    var x = pill.ownerDocument.createElement('span');
    x.className = 'wikilink__x';
    x.setAttribute('aria-hidden', 'true');
    x.textContent = '\u00d7';
    pill.appendChild(x);
    return pill;
  }

  /**
   * Convert hand-typed or imported `[[Title]]` runs into pills, in place. Runs
   * once per editor render (legacy bodies) and after paste; the autocomplete
   * inserts pills directly so the ordinary typing path never needs it.
   */
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

  /**
   * The `[[wiki links]]` inside a body, as [{ raw, norm }]. Pills are read from
   * their data-title (the stored format); any raw `[[...]]` runs — hand-typed,
   * pasted, imported — are read as text too, so the graph never depends on which
   * of the two shapes a body happens to be in. Capped so one pathological note
   * cannot flood the links table; duplicates collapse by normalised title.
   */
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
    // Pills: order-independent tag match, then the data-title inside it.
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
    // Raw runs, for bodies that were never normalised.
    var text = htmlToText(source);
    var pattern = /\[\[([^\[\]\n]{1,200})\]\]/g;
    var match = pattern.exec(text);
    while (match && found.length < 100) {
      take(match[1]);
      match = pattern.exec(text);
    }
    return found;
  }

  /**
   * Plain text of a body for the clipboard: pills become `[[Title]]` again, so a
   * copy-paste round trip keeps the links instead of silently flattening them to
   * bare words. Block boundaries become line breaks.
   */
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
    // A pasted picture has no text of its own, so it becomes a placeholder rather than
    // disappearing: a copy should say a picture was here, not silently drop it.
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

  /**
   * The raster types a body may carry, base64, and nothing else: SVG is a document that
   * can hold a script, and a data: URL is the one thing this sanitizer lets past its src
   * rule, so it names exactly what it accepts rather than trusting a MIME prefix.
   */
  var IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i;

  /**
   * Blocklist sanitizer for bodies rendered into the rich editor. Stored bodies reach
   * innerHTML there, so active content is stripped on the way in: scripts, frames,
   * objects, non-checkbox inputs, inline event handlers, and non-web links. The formatting
   * the toolbar produces (b/i/u/mark/lists/task rows) passes through untouched.
   *
   * Images are the one element transformed rather than dropped, and they are rebuilt from
   * nothing but a value that passed a test here: either a raster image base64-encoded
   * inside a data: URL (how a pasted picture is stored, so that it lives in the note and
   * nowhere else), or an id from the files table (how a picture pasted by an older build
   * is still readable). Every other attribute of the tag is discarded, so a src that
   * survives is one this line recognised.
   */
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
    // Only checkbox inputs survive (the task rows); every other input is dropped, and
    // survivors are normalised so no extra attribute rides along.
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

  // -------------------------------------------------------------------- formatting
  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
  }

  /** Relative for recent items, absolute date beyond a week — keeps the tree scannable. */
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

  /** Single-glyph marker for a file row, chosen from its MIME type then extension. */
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

  // ------------------------------------------------------------------------- toasts
  var toastHost = null;

  function toast(message, kind, timeout) {
    if (!toastHost) {
      document.addEventListener('DOMContentLoaded', function () { toastHost = toastHost || ensureToastHost(); });
      toastHost = ensureToastHost();
    }
    // One line of text and nothing else: the notification arrives, is read, and leaves on its
    // own timer — no accent stripe, no dismiss button, no chrome around it.
    var node = el('div', { class: 'toast toast--' + (kind || 'info'), role: 'status' }, [
      el('span', { class: 'toast__msg', text: String(message) }),
    ]);
    toastHost.appendChild(node);
    // Into the top layer, on the first toast rather than from boot. A modal dialog and its
    // backdrop are painted by the browser above everything the page has drawn, so a toast left
    // in the ordinary stacking order is a toast the reader never sees. The popover attribute on
    // the host is the browser's own "above all of that" state; the z-index in the stylesheet is
    // what covers a browser that has no popover support.
    if (typeof toastHost.showPopover === 'function') {
      try {
        // Re-entered on EVERY toast rather than merely shown once. The top layer paints in the
        // order things were added to it, so a popover that has been up since the last
        // notification sits under any dialog opened since; hiding and showing again puts the
        // toast back on top of that order, which is the whole point of it.
        if (toastHost.matches(':popover-open')) toastHost.hidePopover();
        toastHost.showPopover();
      } catch (err) {
        // Refused (the layer is unavailable, or the element is not connected yet): the
        // notification still appears, just at the stylesheet's own index.
      }
    }
    // Errors stay up longer — they usually carry something the user needs to read.
    var life = timeout || (kind === 'error' ? 7000 : 3200);
    var hideTimer = setTimeout(remove, life);

    function remove() {
      clearTimeout(hideTimer);
      if (!node.parentNode) return;
      node.classList.add('toast--out');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        // Nothing left to say: leave the top layer instead of holding it open with an empty box.
        if (!toastHost.childNodes.length && typeof toastHost.hidePopover === 'function'
            && toastHost.matches(':popover-open')) {
          try { toastHost.hidePopover(); } catch (err) { /* already gone */ }
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
        // See toast(): a popover is the one element the browser paints above a modal dialog.
        popover: 'manual',
      });
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * An image pill: how a pasted picture is stored AND shown.
   *
   * The element carries the file id and nothing else, so the bytes stay in one place (the
   * files table, encrypted with the rest of the notebook when the vault is on) and the
   * resolved src is filled in by the editor on every render. Atomic like the link pill, so
   * the caret cannot land inside it and one Backspace removes the whole picture.
  /**
   * An image pill: how a pasted picture is stored AND shown.
   *
   * The element is the storage. For a picture pasted today that means a data: URL inside
   * the note itself, so nothing else in the notebook refers to it, nothing else has to be
   * kept in step with it, and deleting it is editing the note. A value that is not one of
   * those is an id from the files table, which is how a picture pasted by an older build
   * still resolves. Atomic like the link pill, so the caret cannot land inside it and one
   * Backspace removes the whole picture.
   */
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
