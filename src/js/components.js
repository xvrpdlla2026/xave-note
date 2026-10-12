/**
 * components.js — reusable interface pieces: vector icons, the dialog family
 * (settings, prompt, destructive confirm, fullscreen panel), the form controls and the
 * context menu.
 *
 * Why this file exists: the app used `window.prompt` and `window.confirm` for every
 * rename and every delete. Those are the browser's chrome, not the app's — they cannot
 * be styled, cannot state what a destructive action actually destroys, and cannot be
 * verified. Everything here is built on the platform rather than around it:
 *
 *   - Dialogs are real <dialog> elements, so focus trapping, Escape and scroll lock
 *     come from the browser instead of hand-rolled listeners. A fullscreen panel is the
 *     same element with a different size class, not a second mechanism.
 *   - Selects keep a real <select> in the DOM as the form control and the accessible
 *     value, with a styled button and listbox as the visible surface. Checkboxes and
 *     radios are the real inputs, restyled — never a div pretending to be one.
 *   - The context menu replaces the browser's default menu on the elements where the app
 *     has something more useful to offer, and leaves it alone inside text fields, where
 *     cut/copy/paste and spellcheck are the more useful menu.
 *   - Errors are rendered with an icon and text as well as colour.
 *
 * Loaded as a classic script: everything attaches to window.NoteApp.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var el = util.el;

  // ------------------------------------------------------------------- icons
  /**
   * Inline SVG paths, 24x24 grid, 1.6 stroke, no fill.
   *
   * These are hand-authored on purpose, and that is a deliberate departure from the
   * usual "never draw icon paths" rule: this project ships as ONE offline file with no
   * build step and no dependencies, so an icon package cannot be added. The set is
   * small, drawn on one grid with one stroke weight, and lives in a single place, which
   * is what keeps it coherent. Each path is a single element, not a traced outline.
   *
   * Two glyphs are constrained by what they have to sit next to, not by taste:
   *   - `settings` is a toothed gear outline. It previously read as a knob on eight
   *     radial stalks, which at 16px was the same visual sentence as `sun` — and since
   *     those two glyphs are the only two controls in the top bar, they were genuinely
   *     indistinguishable. A closed outline with an even tooth count is unmistakable.
   *   - `sun` / `moon` are the theme pair and share a silhouette family, so the button's
   *     meaning survives the swap without the label.
   */
  var ICONS = {
    close: ['M6.5 6.5 17.5 17.5', 'M17.5 6.5 6.5 17.5'],
    search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M15.8 15.8 20 20'],
    check: ['M5 12.8 9.4 17 19 7'],
    plus: ['M12 5.5v13', 'M5.5 12h13'],
    upload: ['M12 16V5.5', 'M8 9.5 12 5.5l4 4', 'M5.5 16.5v1.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-1.5'],
    trash: ['M4.5 7h15', 'M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7', 'M6.5 7l0.9 11.5a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7', 'M10.5 10.5v6', 'M13.5 10.5v6'],
    pencil: ['M13.5 20.5H20', 'M16.6 4.4a1.6 1.6 0 0 1 2.3 0l0.7 0.7a1.6 1.6 0 0 1 0 2.3L9 18l-3.6 1 1-3.6Z'],
    folder: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2a1.5 1.5 0 0 1 1.2.6l0.9 1.2h7.7A1.5 1.5 0 0 1 20 9.3v8.2A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z'],
    note: ['M6 4.5h7.5L18.5 9.5V19a0.5 0.5 0 0 1-0.5 0.5H6a0.5 0.5 0 0 1-0.5-0.5V5a0.5 0.5 0 0 1 0.5-0.5Z', 'M13 4.5V10h5.5', 'M8.5 13.5h6'],
    file: ['M13.5 3.5H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8Z', 'M13.5 3.5V8H18'],
    layers: ['M12 3.5 3.5 8.5 12 13.5l8.5-5Z', 'M3.5 13 12 18l8.5-5'],
    copy: [
      'M9.5 9.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
      'M5.5 15.5H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v.5',
    ],
    warning: ['M12 4.5 21 19.5H3Z', 'M12 10.5v4.5', 'M12 17.6h.01'],
    info: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M12 11.5v5', 'M12 8.2h.01'],
    database: ['M12 3.5c4.4 0 8 1.2 8 2.6S16.4 8.7 12 8.7 4 7.5 4 6.1 7.6 3.5 12 3.5Z', 'M4 6.1v5.8c0 1.4 3.6 2.6 8 2.6s8-1.2 8-2.6V6.1', 'M4 11.9v6c0 1.4 3.6 2.6 8 2.6s8-1.2 8-2.6v-6'],
    server: ['M4 5.5h16v5H4Z', 'M4 13.5h16v5H4Z', 'M7.2 8h.01', 'M7.2 16h.01'],
    chevron: ['M6.5 9.5 12 15l5.5-5.5'],

    /**
     * Settings, drawn as two control rails with their knobs — the current convention for
     * "settings", and the shape that survives this app's constraints.
     *
     * Three attempts at a gear are worth recording, because each looked fine in code:
     *   1. Eight radial stalks around a circle. At 16px that is the same visual sentence as
     *      the sun glyph beside it, so the top bar's two controls were indistinguishable.
     *   2. Eight teeth with arc crowns and arc valleys. Deep valleys plus a 1.6 stroke close
     *      the gaps between teeth, and a stroked path of arcs reads as a pinwheel.
     *   3. Eight flat-topped teeth with straight flanks. Legible on its own, but in a 24px
     *      viewBox at 16px the pitch leaves about 1.8px of valley after the stroke — a
     *      starburst, not a gear. Four teeth would fit; four teeth do not read as a gear.
     *
     * So the constraint is real and it is the pitch, not the drawing. Two rails carry the
     * same meaning, are unambiguous at 16px, and cannot be mistaken for a sun.
     */
    settings: [
      'M4 8.6h16',
      'M4 15.4h16',
      'M11.7 8.6a2.1 2.1 0 1 0-4.2 0 2.1 2.1 0 1 0 4.2 0Z',
      'M14.4 15.4a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 1 0-4.2 0Z',
    ],
    sun: ['M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Z', 'M12 2.6v2.3', 'M12 19.1v2.3', 'M4.4 4.4 6 6', 'M18 18l1.6 1.6', 'M2.6 12h2.3', 'M19.1 12h2.3', 'M4.4 19.6 6 18', 'M18 6l1.6-1.6'],
    moon: ['M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z'],
    arrowLeft: ['M19 12H5.5', 'M11 5.5 4.5 12l6.5 6.5'],
    spinner: ['M12 4.5a7.5 7.5 0 1 0 7.5 7.5'],

    // Restore: a counter-clockwise arrow around a clock face. The direction is the
    // whole message ("put it back"), which is why it is not a plain chevron.
    restore: ['M3.6 12a8.4 8.4 0 1 0 2.5-6', 'M3.2 3.6V9h5.4', 'M12 7.9V12l3 1.7'],

    // Context-menu and control glyphs. No separate `sliders` glyph: it would be the same
    // picture, and two names for one picture is how an icon set drifts.
    filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
    sort: ['M7 5v14', 'M4 16l3 3 3-3', 'M17 19V5', 'M14 8l3-3 3 3'],
    external: ['M14 4.5h5.5V10', 'M19.5 4.5 11 13', 'M18 14.5v4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4'],
    download: ['M12 4.5V15', 'M8 11l4 4 4-4', 'M5 19.5h14'],
    copy: ['M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5Z', 'M15.5 5.5H6A1.5 1.5 0 0 0 4.5 7v9.5'],
    eye: ['M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
    checkCircle: ['M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 'M8.4 12.2l2.6 2.6 4.8-5.2'],
    emptyTrash: ['M4.5 7h15', 'M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7', 'M6.5 7l0.9 11.5a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7', 'M9.8 10.5l4.4 6', 'M14.2 10.5l-4.4 6'],
    chart: ['M4 20.5h16', 'M7 20.5v-6', 'M12 20.5V7.5', 'M17 20.5v-3.5'],

    // The two arrangements the folder pane offers for the same items. Four squares, and a
    // stack of rows that each carry a leading marker: every picture is the layout it names,
    // so the control needs no legend, and the marker is what keeps `list` from reading as
    // the `filter` glyph three rules below it.
    grid: ['M4.5 4.5h6v6h-6Z', 'M13.5 4.5h6v6h-6Z', 'M4.5 13.5h6v6h-6Z', 'M13.5 13.5h6v6h-6Z'],
    list: ['M4.5 6.5h3.2', 'M10.6 6.5h8.9', 'M4.5 12h3.2', 'M10.6 12h8.9', 'M4.5 17.5h3.2', 'M10.6 17.5h8.9'],
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Build an SVG node in the *SVG* namespace.
   *
   * document.createElement() always produces HTML-namespace elements, and an <svg> or
   * <path> in the HTML namespace is parsed but never rendered — it has geometry and
   * computed styles and still draws nothing. Only createElementNS puts an element in the
   * namespace the SVG renderer looks at. Attribute names are also case-sensitive here
   * (viewBox, not viewbox), which is why they are set with setAttributeNS.
   */
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttributeNS(null, key, String(attrs[key]));
      });
    }
    return node;
  }

  /** One icon element. `size` is a font-size, so CSS controls the box it fills. */
  function icon(name, size) {
    var d = ICONS[name];
    if (!d) return null;
    var node = svgEl('svg', {
      class: 'icon' + (name === 'spinner' ? ' icon--spin' : ''),
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    d.forEach(function (path) {
      node.appendChild(svgEl('path', { d: path }));
    });
    if (size) node.style.fontSize = size + 'px';
    return node;
  }

  // ------------------------------------------------------------------ dialog
  /** The element that currently holds focus while a dialog is open, per dialog. */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var openDialogs = [];

  /**
   * Build and show a dialog. Resolves with the submitted value, `true` for a plain
   * confirm, or `null` when dismissed (Escape, the close control, or Cancel).
   *
   * @param {object} cfg
   * @param {string} cfg.title            headline, also the accessible name
   * @param {string} [cfg.icon]           icon name shown in the tinted tile
   * @param {boolean} [cfg.danger]        destructive: danger tile, danger confirm button
   * @param {string} [cfg.message]        leading sentence
   * @param {string[]} [cfg.consequences] concrete effects, listed under the message
   * @param {Node} [cfg.body]             arbitrary content appended after the consequences
   * @param {object} [cfg.input]          { label, value, placeholder, helper, select }
   * @param {object} [cfg.gate]           { label, phrase } type-to-confirm requirement
   * @param {string} [cfg.confirmLabel]
   * @param {string} [cfg.cancelLabel]
   * @param {Node} [cfg.footer]           extra footer controls, placed before Cancel
   * @param {boolean} [cfg.fullscreen]    render as a fullscreen panel rather than a card
   * @param {boolean} [cfg.hideFooter]    suppress the Cancel/confirm footer entirely
   * @param {boolean} [cfg.hideHeader]    suppress the shell header (title + close control).
   *                                      For a fullscreen panel that brings its own header:
   *                                      the shell draws no chrome of its own, and names
   *                                      itself with aria-label instead of aria-labelledby.
   * @param {boolean} [cfg.closeOnBackdrop]
   * @param {function} [cfg.onOpen]       ({ root, form, body, footer, close }) => void,
   *                                      called after the dialog is in the DOM, so a panel
   *                                      can wire its own controls without this file
   *                                      knowing anything about the feature
   * @param {function} [cfg.onSubmit]     (value) => Promise; keeps the dialog open with a
   *                                      busy footer, and shows the failure inline
   * @returns {Promise<string|boolean|null>}
   */
  function dialog(cfg) {
    var config = cfg || {};

    return new Promise(function (resolve) {
      var settled = false;

      var titleId = 'dlg-title-' + util.uuid().slice(0, 8);
      var described = [];

      // What had focus before the dialog opened, so it can be handed back on close.
      var returnFocus = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

      // A fullscreen panel brings its own header, and stacking two of them puts a
      // second title and a second close control on screen — the first of the pair
      // painting outside the surface the reader is actually looking at. `hideHeader`
      // is how a caller says "the panel *is* the header": the shell then draws no
      // chrome of its own and takes its accessible name from `title`.
      var dialogAttrs = {
        class: 'dialog'
          + (config.danger ? ' dialog--danger' : '')
          + (config.wide ? ' dialog--wide' : '')
          + (config.fullscreen ? ' dialog--full' : ''),
      };
      // Stated only when there is a title to state: an empty aria-label is an accessible
      // name that overrides whatever the content would have contributed, so omitting the
      // attribute is strictly better than setting it to nothing.
      if (config.hideHeader && config.title) dialogAttrs['aria-label'] = config.title;
      else dialogAttrs['aria-labelledby'] = titleId;

      var node = el('dialog', dialogAttrs);

      var form = el('form', { class: 'dialog__form', novalidate: 'novalidate' });

      // ---- header
      var closeBtn = null;
      if (!config.hideHeader) {
        var head = el('div', { class: 'dialog__head' });
        // No explicit size: the stylesheet owns the tile's icon scale, so it stays in step
        // with the tile rather than fighting an inline override.
        if (config.icon) head.appendChild(el('span', { class: 'dialog__icon' }, [icon(config.icon)]));
        head.appendChild(el('h2', { id: titleId, class: 'dialog__title', text: config.title || '' }));
        closeBtn = el('button', {
          class: 'dialog__close',
          type: 'button',
          'aria-label': 'Close',
          onclick: function () { dismiss(null); },
        }, [icon('close', 15)]);
        head.appendChild(closeBtn);
        form.appendChild(head);
      }

      // ---- body
      var body = el('div', { class: 'dialog__body' });

      if (config.message) {
        var msgId = 'dlg-msg-' + util.uuid().slice(0, 8);
        described.push(msgId);
        body.appendChild(el('p', { id: msgId, class: 'dialog__message', text: config.message }));
      }

      // Consequences are a list, not a paragraph: a delete dialog should name what goes,
      // and a sentence buries that.
      if (config.consequences && config.consequences.length) {
        var list = el('ul', { class: 'dialog__consequences' });
        config.consequences.forEach(function (line) { list.appendChild(el('li', { text: line })); });
        body.appendChild(list);
      }

      var field = null;
      var gate = null;

      if (config.input) {
        field = fieldShell(config.input);
        body.appendChild(field.root);
      }

      // Type-to-confirm gate, used for the one action that erases everything.
      if (config.gate) {
        gate = fieldShell({
          label: 'Confirmation',
          value: '',
          placeholder: config.gate.phrase,
          autocomplete: 'off',
        });
        body.appendChild(el('div', { class: 'dialog__gate' }, [
          el('p', { class: 'dialog__message' }, [
            document.createTextNode((config.gate.label || 'Type this phrase to confirm:') + ' '),
            el('code', { text: config.gate.phrase }),
          ]),
          gate.root,
        ]));
      }

      // Free-form content last, so a caller can append a list, a panel or a form
      // without this builder having to know what it is.
      if (config.body) body.appendChild(config.body);

      form.appendChild(body);

      // ---- footer
      var cancelBtn = el('button', {
        class: 'btn',
        type: 'button',
        onclick: function () { dismiss(null); },
      }, [config.cancelLabel || 'Cancel']);

      var confirmBtn = el('button', {
        class: 'btn ' + (config.danger ? 'btn--danger' : 'btn--primary'),
        type: 'submit',
      }, [config.confirmLabel || 'Save']);

      var footer = el('div', { class: 'dialog__footer' }, [cancelBtn, confirmBtn]);
      // Extra controls land on the leading edge of the footer, away from the confirm.
      if (config.footer) footer.insertBefore(config.footer, cancelBtn);
      if (config.hideFooter) {
        footer = null;
      } else {
        form.appendChild(footer);
      }

      if (described.length) form.setAttribute('aria-describedby', described.join(' '));
      node.appendChild(form);

      // A gate starts locked: the button only becomes available once the phrase matches.
      if (gate) {
        confirmBtn.disabled = true;
        gate.input.addEventListener('input', function () {
          confirmBtn.disabled = gate.input.value.trim() !== config.gate.phrase;
          setFieldError(gate, null);
        });
      }

      // ---- behaviour helpers
      function gateSatisfied() {
        return !gate || gate.input.value.trim() === config.gate.phrase;
      }

      function setBusy(busy) {
        confirmBtn.disabled = busy || !gateSatisfied();
        cancelBtn.disabled = busy;
        if (closeBtn) closeBtn.disabled = busy;
        confirmBtn.textContent = '';
        if (busy) {
          confirmBtn.appendChild(icon('spinner', 14));
          confirmBtn.appendChild(document.createTextNode(config.danger ? 'Deleting\u2026' : 'Saving\u2026'));
        } else {
          confirmBtn.appendChild(document.createTextNode(config.confirmLabel || 'Save'));
        }
      }

      function settle(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }

      function remove() {
        node.classList.remove('dialog--closing');
        if (node.open) node.close();
        if (node.parentNode) node.parentNode.removeChild(node);
        openDialogs = openDialogs.filter(function (d) { return d !== node; });
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      }

      /**
       * Close with an exit animation, then resolve. `dialog.close()` alone would snap;
       * the closing state is a class so reduced-motion collapses it cleanly.
       *
       * The removal timer is the authority, not `animationend`: a dialog that closed while
       * the viewport was resizing can have its animation cancelled, and an `animationend`
       * that never arrives would leave the element in the DOM and the promise unsettled.
       * The event is kept only so the usual path is instant.
       */
      function dismiss(value) {
        if (settled) return;
        node.classList.add('dialog--closing');
        if (reduceMotion()) { remove(); settle(value); return; }

        var done = function () { remove(); settle(value); };
        var timer = setTimeout(done, 260);
        node.addEventListener('animationend', function () {
          clearTimeout(timer);
          done();
        }, { once: true });
      }

      function submit() {
        var value = gate ? true : (field ? field.input.value.trim() : true);

        if (field && config.input.requireValue && !value) {
          setFieldError(field, config.input.emptyMessage || 'Enter a name to continue.');
          field.input.focus();
          return;
        }

        if (!config.onSubmit) { dismiss(value); return; }

        setBusy(true);
        Promise.resolve(config.onSubmit(value)).then(function () {
          settle(value);
          node.classList.add('dialog--closing');
          setTimeout(remove, reduceMotion() ? 0 : 140);
        }).catch(function (err) {
          setBusy(false);
          // Failures stay in the dialog, next to the retry, rather than in a toast the
          // user may never connect to the action they just took.
          var text = (err && err.message) || 'That did not work.';
          if (field) setFieldError(field, text);
          else body.appendChild(el('p', { class: 'field__message field__message--error', text: text }));
        });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        // A form with a single field submits implicitly on Enter, and a dialog that hides
        // its footer has no submit button for that to be reaching: the Enter belongs to the
        // field. Submitting there would dismiss the panel in the middle of a filter, which
        // is the one thing a list you are working through must not do.
        if (config.hideFooter) return;
        submit();
      });

      // Escape is the browser's job; this only settles the promise.
      node.addEventListener('cancel', function (event) {
        event.preventDefault();
        dismiss(null);
      });

      // Backdrop click: <dialog> reports the click target as the dialog element itself,
      // so the coordinates decide whether it landed outside the panel.
      node.addEventListener('click', function (event) {
        if (event.target !== node) return;
        var box = node.getBoundingClientRect();
        var outside = event.clientX < box.left || event.clientX > box.right ||
                      event.clientY < box.top || event.clientY > box.bottom;
        if (outside && config.closeOnBackdrop !== false) dismiss(null);
      });

      // Explicit focus containment: <dialog> traps Tab in current engines, but stating
      // the contract here keeps it true for the reduced/simplified paths too.
      node.addEventListener('keydown', function (event) {
        if (event.key !== 'Tab') return;
        var items = Array.prototype.filter.call(node.querySelectorAll(FOCUSABLE), function (n) {
          return !n.disabled && n.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });

      document.body.appendChild(node);
      openDialogs.push(node);

      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');

      // Hand the panel to its owner before anything is focused, so a fullscreen panel can
      // fill its list and pick its own first focus target.
      var api = { root: node, form: form, body: body, footer: footer, close: dismiss };
      if (typeof config.onOpen === 'function') {
        try { config.onOpen(api); } catch (err) {
          // eslint-disable-next-line no-console
          console.error('dialog onOpen failed', err);
        }
      }

      // Focus the field for an input dialog (the user came here to type); for a
      // destructive confirm, focus Cancel rather than Delete, so Enter cannot destroy
      // anything by reflex.
      var focusTarget = null;
      if (!config.focus) {
        focusTarget = field ? field.input : (gate ? gate.input : (config.danger ? cancelBtn : confirmBtn));
      } else if (typeof config.focus === 'string') {
        focusTarget = node.querySelector(config.focus);
      } else {
        focusTarget = config.focus;
      }
      if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
      if (field && config.input.selectOnOpen !== false) field.input.select();
    });
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /**
   * One labelled field: label above, control, then a message slot below that doubles as
   * the helper text and the error text. Returns the pieces so callers can set errors.
   */
  function fieldShell(opts) {
    var o = opts || {};
    var uid = 'fld-' + util.uuid().slice(0, 8);

    var input = el('input', {
      id: uid,
      class: 'field__input',
      type: o.type || 'text',
      value: o.value || '',
      placeholder: o.placeholder || '',
      autocomplete: o.autocomplete || 'off',
      spellcheck: 'false',
      'aria-invalid': 'false',
    });
    if (o.maxLength) input.maxLength = o.maxLength;

    var message = el('p', { class: 'field__message' + (o.helper ? '' : ' is-hidden'), id: uid + '-msg' });
    if (o.helper) message.textContent = o.helper;

    var root = el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: uid, text: o.label || '' }),
      el('div', { class: 'field__control' }, [input]),
      message,
    ]);

    // Clear an error as soon as the user starts fixing it, then re-validate on blur.
    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true') setFieldError({ input: input, message: message }, null);
    });

    return { root: root, input: input, message: message, uid: uid };
  }

  /**
   * A labelled field around any control, not just a text input: the same label-above /
   * control / message-below contract, with a label that is programmatically attached to
   * whatever is inside. `control` may be a Node or a widget with a `.root` element (the
   * select and checkbox factories below both return one).
   *
   * @param {object} opts { label, control, helper, id, className }
   */
  function field(opts) {
    var o = opts || {};
    var control = o.control && o.control.root ? o.control.root : o.control;
    if (!control) return null;

    var uid = o.id || ('fld-' + util.uuid().slice(0, 8));
    // Attach the label to the real focusable element when one can be found, so clicking
    // the label focuses the control the way a native form does.
    var focusable = control.matches && control.matches('input, select, textarea, button')
      ? control
      : control.querySelector('input, select, textarea, .select__trigger, .checkbox__input');
    if (focusable && !focusable.id) focusable.id = uid;
    var labelFor = focusable && focusable.id ? focusable.id : null;

    var helper = o.helper
      ? el('p', { class: 'field__message', id: uid + '-msg' })
      : null;
    if (helper) helper.textContent = o.helper;

    var root = el('div', { class: 'field' + (o.className ? ' ' + o.className : '') }, [
      el('label', { class: 'field__label', for: labelFor, text: o.label || '' }),
      control,
      helper,
    ]);
    if (helper && focusable) focusable.setAttribute('aria-describedby', uid + '-msg');

    return { root: root, control: control, helper: helper, uid: uid };
  }

  /** Set or clear a field's error state: text plus icon, never colour alone. */
  function setFieldError(field, text) {
    if (!field || !field.input || !field.message) return;
    var node = field.message;
    node.textContent = '';
    if (!text) {
      node.className = 'field__message is-hidden';
      field.input.setAttribute('aria-invalid', 'false');
      field.input.removeAttribute('aria-describedby');
      return;
    }
    node.className = 'field__message field__message--error';
    node.appendChild(icon('warning', 12));
    node.appendChild(el('span', { text: text }));
    field.input.setAttribute('aria-invalid', 'true');
    field.input.setAttribute('aria-describedby', field.uid + '-msg');
  }

  // ------------------------------------------------------------ named dialogs
  /** A plain confirmation. Resolves true or null. */
  function confirm(cfg) {
    var c = cfg || {};
    return dialog({
      title: c.title || 'Are you sure?',
      icon: c.icon || (c.danger ? 'warning' : 'info'),
      danger: c.danger,
      message: c.message,
      consequences: c.consequences,
      confirmLabel: c.confirmLabel || (c.danger ? 'Delete' : 'Confirm'),
      cancelLabel: c.cancelLabel,
      wide: c.wide,
    }).then(function (value) { return value === true; });
  }

  /**
   * A single-value text prompt. Resolves the trimmed string, or null if dismissed.
   * Replaces window.prompt entirely.
   */
  function prompt(cfg) {
    var c = cfg || {};
    return dialog({
      title: c.title || 'Rename',
      icon: c.icon || 'pencil',
      message: c.message,
      confirmLabel: c.confirmLabel || 'Save',
      input: {
        label: c.label || 'Name',
        value: c.value || '',
        placeholder: c.placeholder,
        helper: c.helper,
        maxLength: c.maxLength,
        requireValue: true,
        emptyMessage: c.emptyMessage || 'A name is required.',
      },
    }).then(function (value) { return typeof value === 'string' ? value : null; });
  }

  // ------------------------------------------------------------------ select
  /**
   * A custom select over a real native <select>.
   *
   * Progressive enhancement rather than replacement: the hidden select holds the value
   * and is what assistive tech and any automated check reads, while the button and
   * listbox are the visible surface. Keyboard support covers the usual listbox
   * contract: Up/Down to move, Home/End, Enter to commit, Escape to cancel, and
   * type-ahead to jump to an option by its first letters.
   *
   * @param {object} cfg { options: [{value,label}], value, onChange, className, label,
   *                       lead: icon name, hiddenLabel: bool }
   */
  function select(cfg) {
    var c = cfg || {};
    var options = (c.options || []).map(function (o) {
      return { value: String(o.value), label: String(o.label) };
    });

    var native = el('select', { class: 'select__native', tabindex: '-1', 'aria-hidden': 'true' });
    options.forEach(function (o) {
      native.appendChild(el('option', { value: o.value, text: o.label, selected: o.value === String(c.value) }));
    });
    // The native control stays reachable to assistive tech through its own label.
    if (c.label) {
      var labelId = 'sel-' + util.uuid().slice(0, 8);
      native.setAttribute('aria-label', c.label);
      native.id = labelId;
    }

    var valueLabel = el('span', { class: 'select__value' });
    var trigger = el('button', {
      class: 'select__trigger',
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
    }, [
      c.lead ? el('span', { class: 'select__lead' }, [icon(c.lead, 15)]) : null,
      valueLabel,
      el('span', { class: 'select__chevron' }, [icon('chevron', 14)]),
    ]);

    var listbox = el('ul', {
      class: 'select__list is-hidden',
      role: 'listbox',
      tabindex: '-1',
    });

    var root = el('div', { class: 'select' + (c.className ? ' ' + c.className : '') }, [native, trigger, listbox]);

    var open = false;
    var activeIndex = Math.max(0, indexOfValue(native.value));
    var typed = '';
    var typedTimer = null;

    function indexOfValue(value) {
      for (var i = 0; i < options.length; i++) if (options[i].value === value) return i;
      return -1;
    }

    function labelFor(value) {
      var i = indexOfValue(value);
      return i === -1 ? '' : options[i].label;
    }

    function syncDisplay() {
      valueLabel.textContent = labelFor(native.value);
      trigger.title = labelFor(native.value);
      Array.prototype.forEach.call(listbox.children, function (child) {
        var selected = child.getAttribute('data-value') === native.value;
        child.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }

    function buildOptions() {
      listbox.textContent = '';
      options.forEach(function (o, i) {
        listbox.appendChild(el('li', {
          class: 'select__option',
          role: 'option',
          'data-value': o.value,
          'data-index': String(i),
          'aria-selected': o.value === native.value ? 'true' : 'false',
          onmousemove: function () { setActive(i, false); },
          onclick: function (event) {
            event.preventDefault();
            commit(o.value);
          },
        }, [
          el('span', { class: 'select__option-label', text: o.label }),
          el('span', { class: 'select__option-check' }, [icon('check', 13)]),
        ]));
      });
    }

    function setActive(index, scroll) {
      if (index < 0 || index >= options.length) return;
      activeIndex = index;
      Array.prototype.forEach.call(listbox.children, function (child, i) {
        child.classList.toggle('is-active', i === index);
      });
      var node = listbox.children[index];
      if (node && scroll !== false) {
        var listBox = listbox.getBoundingClientRect();
        var itemBox = node.getBoundingClientRect();
        if (itemBox.top < listBox.top) listbox.scrollTop -= listBox.top - itemBox.top;
        else if (itemBox.bottom > listBox.bottom) listbox.scrollTop += itemBox.bottom - listBox.bottom;
      }
    }

    function openList() {
      if (open || !options.length) return;
      open = true;
      listbox.classList.remove('is-hidden');
      trigger.setAttribute('aria-expanded', 'true');
      activeIndex = Math.max(0, indexOfValue(native.value));
      setActive(activeIndex, true);
      listbox.focus();
    }

    function closeList(refocus) {
      if (!open) return;
      open = false;
      listbox.classList.add('is-hidden');
      trigger.setAttribute('aria-expanded', 'false');
      if (refocus !== false) trigger.focus();
    }

    function commit(value) {
      native.value = value;
      syncDisplay();
      closeList();
      if (typeof c.onChange === 'function') c.onChange(value);
    }

    trigger.addEventListener('click', function () {
      if (open) closeList();
      else openList();
    });

    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openList();
      }
    });

    listbox.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'ArrowDown') {
        event.preventDefault();
        setActive(Math.min(activeIndex + 1, options.length - 1));
        return;
      }
      if (key === 'ArrowUp') {
        event.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
        return;
      }
      if (key === 'Home') { event.preventDefault(); setActive(0); return; }
      if (key === 'End') { event.preventDefault(); setActive(options.length - 1); return; }
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (options[activeIndex]) commit(options[activeIndex].value);
        return;
      }
      if (key === 'Escape' || key === 'Tab') { closeList(key === 'Escape'); return; }
      // Type-ahead: accumulate letters briefly, then jump to the first match.
      if (key.length === 1 && /\S/.test(key)) {
        typed += key.toLowerCase();
        if (typedTimer) clearTimeout(typedTimer);
        typedTimer = setTimeout(function () { typed = ''; }, 700);
        for (var i = 0; i < options.length; i++) {
          var candidate = (i + activeIndex) % options.length;
          if (options[candidate].label.toLowerCase().indexOf(typed) === 0) {
            setActive(candidate);
            break;
          }
        }
      }
    });

    // Clicking away commits nothing, exactly like a native select.
    listbox.addEventListener('blur', function () {
      setTimeout(function () {
        if (open && !root.contains(document.activeElement)) closeList(false);
      }, 0);
    });

    buildOptions();
    syncDisplay();

    root.setValue = function (value, silent) {
      native.value = String(value);
      syncDisplay();
      if (!silent && typeof c.onChange === 'function') c.onChange(native.value);
    };
    root.getValue = function () { return native.value; };
    root.setDisabled = function (disabled) {
      trigger.disabled = !!disabled;
      if (disabled) closeList(false);
    };
    /** The real form control, for code that needs the element itself. */
    root.native = native;

    return root;
  }

  // --------------------------------------------------------------- checkbox
  /**
   * A real <input type="checkbox">, restyled. The input is the control, so the label,
   * the keyboard behaviour (Space), the indeterminate state and the accessibility tree
   * all come from the platform; only the painted box is ours.
   *
   * `indeterminate` has no HTML attribute — it is a property only — so a caller passing
   * `mixed: true` (the select-all box while part of the list is selected) gets it set
   * as a property after construction.
   *
   * @param {object} cfg { label, checked, mixed, disabled, onChange, className, hideLabel }
   */
  function checkbox(cfg) {
    var c = cfg || {};
    var uid = 'chk-' + util.uuid().slice(0, 8);

    var input = el('input', {
      id: uid,
      type: 'checkbox',
      class: 'checkbox__input',
      checked: c.checked ? 'checked' : null,
      disabled: c.disabled ? 'disabled' : null,
    });
    if (c.mixed) input.indeterminate = true;
    if (c.name) input.name = c.name;
    if (c.value !== undefined) input.value = String(c.value);
    // With the visible label hidden, the wrapping <label> has no text at all and
    // the control would be announced unnamed. The same string becomes its
    // accessible name instead of being discarded.
    if (c.hideLabel && c.label) input.setAttribute('aria-label', c.label);

    if (typeof c.onChange === 'function') {
      input.addEventListener('change', function () { c.onChange(input.checked, input); });
    }

    var label = el('label', {
      class: 'checkbox'
        + (c.className ? ' ' + c.className : '')
        + (c.hideLabel ? ' checkbox--bare' : ''),
      for: uid,
    }, [
      input,
      el('span', { class: 'checkbox__box', 'aria-hidden': 'true' }, [icon('check', 12)]),
      c.hideLabel ? null : el('span', { class: 'checkbox__label', text: c.label || '' }),
    ]);

    label.input = input;
    label.setChecked = function (value) {
      input.checked = !!value;
      input.indeterminate = false;
    };
    return label;
  }

  // ------------------------------------------------------------- radio group
  /**
   * A segmented radio group: real radio inputs behind a segmented surface, so arrow-key
   * navigation and "one of these" semantics are the platform's, not a re-implementation.
   *
   * @param {object} cfg { name, value, options: [{value,label,icon,badge}], onChange, className }
   */
  function radioGroup(cfg) {
    var c = cfg || {};
    var name = c.name || ('seg-' + util.uuid().slice(0, 8));
    var inputs = [];

    var root = el('div', { class: 'segmented' + (c.className ? ' ' + c.className : ''), role: 'radiogroup' });

    (c.options || []).forEach(function (o) {
      var uid = 'rad-' + util.uuid().slice(0, 8);
      var input = el('input', {
        id: uid,
        type: 'radio',
        class: 'segmented__input',
        name: name,
        value: String(o.value),
        checked: String(o.value) === String(c.value) ? 'checked' : null,
        disabled: o.disabled ? 'disabled' : null,
      });
      if (typeof c.onChange === 'function') {
        input.addEventListener('change', function () {
          if (input.checked) c.onChange(String(o.value));
        });
      }
      inputs.push(input);
      root.appendChild(el('label', { class: 'segmented__item', for: uid, title: o.title || o.label }, [
        input,
        o.icon ? el('span', { class: 'segmented__icon' }, [icon(o.icon, 14)]) : null,
        el('span', { class: 'segmented__label', text: o.label || '' }),
        o.badge !== undefined && o.badge !== null
          ? el('span', { class: 'segmented__badge', text: String(o.badge) })
          : null,
      ]));
    });

    root.setValue = function (value) {
      inputs.forEach(function (input) { input.checked = input.value === String(value); });
    };
    root.getValue = function () {
      var hit = inputs.filter(function (i) { return i.checked; })[0];
      return hit ? hit.value : null;
    };
    root.inputs = inputs;
    return root;
  }

  // ----------------------------------------------------------- context menu
  /**
   * The app's own right-click menu.
   *
   * The browser's default menu is not useless — inside a text field its cut/copy/paste
   * and spelling suggestions are exactly right, and app.js deliberately leaves it alone
   * there. Everywhere else it offers "Back", "Reload" and "Inspect", none of which
   * relate to the row under the cursor. Replacing it with the actions that do relate is
   * the difference between right-click being a habit and right-click being a shortcut.
   *
   * One root element is reused for every menu: opening a second menu replaces the first
   * rather than stacking portals, and there is exactly one listener set to reason about.
   */
  var menuRoot = null;
  var menuState = null; // { items, buttons, onClose, returnFocus }
  var menuHost = null;  // the node the root is currently parented to

  /**
   * Where the menu has to live.
   *
   * A modal `<dialog>` paints its `::backdrop` between the page and the top layer, so
   * anything appended to `<body>` while a dialog is open renders *behind* that backdrop —
   * visible in the DOM, reported by every query, and invisible on screen. The menu is
   * therefore a child of the open dialog when there is one, and of `<body>` otherwise.
   */
  function menuParent() {
    var dialogs = document.querySelectorAll('dialog[open]');
    return dialogs.length ? dialogs[dialogs.length - 1] : document.body;
  }

  function ensureMenuRoot() {
    var parent = menuParent();
    if (menuRoot && menuHost === parent && parent.contains(menuRoot)) return menuRoot;
    // Reparenting means building a fresh root (a node cannot be in two places), so the old
    // one is removed rather than left behind as a second, hidden `.menu` in the document.
    if (menuRoot && menuRoot.parentNode) menuRoot.parentNode.removeChild(menuRoot);
    menuRoot = el('div', {
      class: 'menu is-hidden',
      role: 'menu',
      tabindex: '-1',
      'aria-label': 'Actions',
    });
    menuHost = parent;
    parent.appendChild(menuRoot);
    return menuRoot;
  }

  /**
   * Open a menu at a point in the viewport.
   *
   * @param {object} cfg
   * @param {number} cfg.x            client coordinates of the pointer
   * @param {number} cfg.y
   * @param {Array} cfg.items         [{ label, icon, onclick, danger, disabled, checked,
   *                                     shortcut, sep }]
   * @param {string} [cfg.title]      small heading naming what was clicked
   * @param {function} [cfg.onClose]
   */
  function openMenu(cfg) {
    var c = cfg || {};
    closeMenu();

    var root = ensureMenuRoot();
    root.textContent = '';

    var items = (c.items || []).filter(Boolean);
    if (!items.length) return;

    if (c.title) root.appendChild(el('div', { class: 'menu__title', text: c.title }));

    var buttons = [];
    items.forEach(function (item) {
      if (item.sep) {
        root.appendChild(el('div', { class: 'menu__sep', role: 'separator' }));
        return;
      }
      var button = el('button', {
        class: 'menu__item'
          + (item.danger ? ' menu__item--danger' : '')
          + (item.disabled ? ' is-disabled' : ''),
        type: 'button',
        role: 'menuitem',
        tabindex: '-1',
        disabled: item.disabled ? 'disabled' : null,
        onclick: function () { run(item); },
      }, [
        el('span', { class: 'menu__check' }, [item.checked ? icon('check', 13) : null]),
        item.icon ? el('span', { class: 'menu__icon' }, [icon(item.icon, 14)]) : null,
        el('span', { class: 'menu__label', text: item.label }),
        item.shortcut ? el('span', { class: 'menu__shortcut', text: item.shortcut }) : null,
      ]);
      buttons.push(button);
      root.appendChild(button);
    });

    function run(item) {
      if (item.disabled) return;
      var handler = item.onclick;
      closeMenu();
      if (typeof handler === 'function') handler();
    }

    // Visible before measuring: an element with `display: none` reports a zero-size box,
    // which is how a menu ends up clamped to the top-left corner.
    root.classList.remove('is-hidden');
    root.style.left = '0px';
    root.style.top = '0px';

    var box = root.getBoundingClientRect();
    var pad = 8;
    var x = Math.max(pad, Math.min(c.x, window.innerWidth - box.width - pad));
    var y = Math.max(pad, Math.min(c.y, window.innerHeight - box.height - pad));
    root.style.left = Math.round(x) + 'px';
    root.style.top = Math.round(y) + 'px';

    menuState = { items: items, buttons: buttons, onClose: c.onClose, returnFocus: document.activeElement };

    // Focus lands on the first enabled item so the arrow keys work straight away; the
    // menu itself takes focus when everything is disabled, so Escape still closes it.
    var first = buttons.filter(function (b) { return !b.disabled; })[0];
    (first || root).focus();

    return root;
  }

  function closeMenu() {
    if (!menuState) return;
    var state = menuState;
    menuState = null;
    if (menuRoot) menuRoot.classList.add('is-hidden');
    // Focus goes back where the menu came from — a menu that steals focus and drops it
    // on <body> breaks keyboard navigation from that point on.
    if (state.returnFocus && document.contains(state.returnFocus)
        && typeof state.returnFocus.focus === 'function') {
      try { state.returnFocus.focus(); } catch (err) { /* not focusable any more */ }
    }
    if (typeof state.onClose === 'function') state.onClose();
  }

  function menuIsOpen() {
    return !!menuState;
  }

  document.addEventListener('pointerdown', function (event) {
    if (!menuState) return;
    if (menuRoot && menuRoot.contains(event.target)) return;
    closeMenu();
  }, true);

  document.addEventListener('keydown', function (event) {
    if (!menuState) return;
    var enabled = menuState.buttons.filter(function (b) { return !b.disabled; });

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') { closeMenu(); return; }

    var current = enabled.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      var next = enabled[(current + 1 + enabled.length) % enabled.length];
      if (next) next.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      var prev = enabled[(current - 1 + enabled.length) % enabled.length];
      if (prev) prev.focus();
      return;
    }
    if (event.key === 'Home') { event.preventDefault(); if (enabled[0]) enabled[0].focus(); return; }
    if (event.key === 'End') { event.preventDefault(); if (enabled[enabled.length - 1]) enabled[enabled.length - 1].focus(); }
  }, true);

  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);

  App.ui = App.ui || {};
  App.ui.icon = icon;
  App.ui.ICONS = ICONS;
  App.ui.dialog = dialog;
  App.ui.confirm = confirm;
  App.ui.prompt = prompt;
  App.ui.select = select;
  App.ui.checkbox = checkbox;
  App.ui.radioGroup = radioGroup;
  App.ui.field = fieldShell;
  App.ui.setFieldError = setFieldError;
  App.ui.openMenu = openMenu;
  App.ui.closeMenu = closeMenu;
  App.ui.menuIsOpen = menuIsOpen;
})(window.NoteApp);
