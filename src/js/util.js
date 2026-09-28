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
   * before it is handed to innerHTML — note content is never rendered as HTML at all.
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  App.util = {
    uuid: uuid,
    nowIso: nowIso,
    debounce: debounce,
    $: $,
    el: el,
    escapeHtml: escapeHtml,
    formatBytes: formatBytes,
    formatWhen: formatWhen,
    isImageMime: isImageMime,
    fileGlyph: fileGlyph,
    toast: toast,
  };
})(window.NoteApp);
