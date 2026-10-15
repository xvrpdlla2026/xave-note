window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var util = App.util;
  var el = util.el;

  var ICONS = {
    type: ['M5.5 6h13', 'M12 6v12.5', 'M9 18.5h6'],
    rect: ['M4 5.5h16v13h-16z'],
    ellipse: ['M12 5.5c4.7 0 8.5 2.9 8.5 6.5s-3.8 6.5-8.5 6.5-8.5-2.9-8.5-6.5 3.8-6.5 8.5-6.5z'],
    triangle: ['M12 4.5l8.5 15h-17z'],
    diamond: ['M12 3.5l8.5 8.5-8.5 8.5-8.5-8.5z'],
    pentagon: ['M12 3.4l8.6 6.2-3.3 10.1H6.7L3.4 9.6z'],
    octagon: ['M8.6 3.6h6.8l5 5v6.8l-5 5H8.6l-5-5V8.6z'],
    trapezoid: ['M8.2 5.5h7.6l4.2 13H4z'],
    parallelogram: ['M8.6 5.5h10.9l-4 13H4.5z'],
    sparkle: ['M12 2.4l2.1 7.5 7.5 2.1-7.5 2.1-2.1 7.5-2.1-7.5L2.4 12l7.5-2.1z'],
    check: ['M4.5 12.5l5 5.5 10-13'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    pin: ['M12 20.5c4-5.4 6-8.6 6-11a6 6 0 1 0-12 0c0 2.4 2 5.6 6 11z'],
    document: ['M5 3.5h14v11.9c-2.3-1.6-4.6-1.6-7 0s-4.7 1.6-7 0z'],
    note: ['M5 4.5h9.5l5 5v10H5z', 'M14.5 4.5v5h5'],
    cone: ['M12 3.5L5 17.5a7 2.6 0 0 0 14 0z'],
    cube: ['M12 3.5l7 3.6v9.4l-7 3.6-7-3.6V7.1z', 'M12 3.5l7 3.6-7 3.6-7-3.6', 'M12 10.7v9.4'],
    semicircle: ['M4.5 18.5a7.5 7.5 0 0 1 15 0z'],
    quarter: ['M4.5 18.5a14 14 0 0 1 14-14z'],
    chevron: ['M5 5.5h6.5l4 6.5-4 6.5H5l4-6.5z'],
    elbow: ['M5 4.5v10h9', 'M11.5 11l3.5 3.5-3.5 3.5'],
    cycle: ['M12 4.5a7.5 7.5 0 1 0 7.5 7.5', 'M9.4 2.6l2.6 1.9-1.9 2.6'],
    bolt: ['M13.4 2.5L5.4 13.4h5l-1 8.1 8.2-11h-5z'],
    moon: ['M20 15.6A9 9 0 1 1 12.4 3.2a7 7 0 0 0 7.6 12.4z'],
    cloud: ['M6.6 18.5h10.7a3.7 3.7 0 0 0 .4-7.4 5.6 5.6 0 0 0-10.6-1.4 4.1 4.1 0 0 0-.5 8.8z'],
    shield: ['M12 3.4l7 2.5v5.6c0 4.4-2.9 8-7 9.5-4.1-1.5-7-5.1-7-9.5V5.9z'],
    flag: ['M5 5.5h13.5l-3.2 4 3.2 4H5z'],
    gear: ['M10.3 3.2h3.4l.5 2.2 2 .8 1.9-1.2 2.4 2.4-1.2 1.9.8 2 2.2.5v3.4l-2.2.5-.8 2 1.2 1.9-2.4 2.4-1.9-1.2-2 .8-.5 2.2h-3.4l-.5-2.2-2-.8-1.9 1.2-2.4-2.4 1.2-1.9-.8-2L3 13.7v-3.4l2.2-.5.8-2-1.2-1.9 2.4-2.4 1.9 1.2 2-.8z', 'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z'],
    wave: ['M3 14.5q3-5.5 6 0t6 0t6 0'],
    star: ['M12 3.8l2.4 5.3 5.8.6-4.3 3.9 1.2 5.7-5.1-3-5.1 3 1.2-5.7-4.3-3.9 5.8-.6z'],
    hexagon: ['M8.2 5.5h7.6l3.8 6.5-3.8 6.5H8.2L4.4 12z'],
    cross: ['M9.5 5.5h5v3.9h3.9v5h-3.9v3.9h-5v-3.9H5.6v-5h3.9z'],
    heart: ['M12 19.7l-1.5-1.3C5.4 13.7 2 10.6 2 7.1 2 4.3 4.2 2 7 2c1.7 0 3.4.8 4.5 2.1C12.6 2.8 14.3 2 16 2c2.8 0 5 2.3 5 5.1 0 3.5-3.4 6.6-8.5 11.3z'],
    callout: ['M8 6.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-8l-4 4v-4H8a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z'],
    cylinder: ['M4.5 8.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3-3.4-3-7.5-3-7.5 1.3-7.5 3z', 'M4.5 8.5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7'],
    line: ['M4.5 19.5L19.5 4.5'],
    arrow: ['M4 12h13.5', 'M12.5 6.5l5.5 5.5-5.5 5.5'],
    eraser: ['M8.5 20.5 4.9 16.9a1.4 1.4 0 0 1 0-2l8.6-8.6a1.4 1.4 0 0 1 2 0l4.6 4.6a1.4 1.4 0 0 1 0 2L12.4 20.5Z', 'M20 20.5H8.5', 'M8.6 12.9l5.5 5.5'],
    slash: ['M5.5 18.5 18.5 5.5'],
    undo: ['M9 14.5 4.5 10 9 5.5', 'M4.5 10h9.5a5.5 5.5 0 0 1 0 11H11'],
    redo: ['M15 14.5 19.5 10 15 5.5', 'M19.5 10H10a5.5 5.5 0 0 0 0 11h3'],
    close: ['M6.5 6.5 17.5 17.5', 'M17.5 6.5 6.5 17.5'],
    hand: ['M8.5 12.5V7.5a1.5 1.5 0 0 1 3 0v5', 'M11.5 12.5V6a1.5 1.5 0 0 1 3 0v6.5', 'M14.5 12.5V7.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.7a4.5 4.5 0 0 1-3.4-1.6l-3-3.6a1.6 1.6 0 0 1 2.4-2.1l1.7 1.6'],
    marquee: ['M4.5 8.5V6a1.5 1.5 0 0 1 1.5-1.5h2.5', 'M13.5 4.5H16A1.5 1.5 0 0 1 17.5 6v2.5', 'M19.5 13.5V16a1.5 1.5 0 0 1-1.5 1.5h-2.5', 'M10.5 19.5H8A1.5 1.5 0 0 1 6.5 18v-2.5', 'M11 11h2v2h-2z'],
    lock: ['M6.5 10.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z', 'M9 10.5V8a3 3 0 0 1 6 0v2.5'],
    unlock: ['M6.5 10.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z', 'M9 10.5V8a3 3 0 0 1 5.6-1.4'],
    panel: ['M4.5 5.5h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z', 'M9.5 5.5v13'],
    search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M15.8 15.8 20 20'],
    check: ['M5 12.8 9.4 17 19 7'],
    plus: ['M12 5.5v13', 'M5.5 12h13'],
    upload: ['M12 16V5.5', 'M8 9.5 12 5.5l4 4', 'M5.5 16.5v1.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-1.5'],
    trash: ['M4.5 7h15', 'M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7', 'M6.5 7l0.9 11.5a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7', 'M10.5 10.5v6', 'M13.5 10.5v6'],
    move: ['M12 3.5v17', 'M3.5 12h17', 'M9 6.5l3-3 3 3', 'M9 17.5l3 3 3-3', 'M6.5 9l-3 3 3 3', 'M17.5 9l3 3-3 3'],
    pencil: ['M13.5 20.5H20', 'M16.6 4.4a1.6 1.6 0 0 1 2.3 0l0.7 0.7a1.6 1.6 0 0 1 0 2.3L9 18l-3.6 1 1-3.6Z'],
    folder: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2a1.5 1.5 0 0 1 1.2.6l0.9 1.2h7.7A1.5 1.5 0 0 1 20 9.3v8.2A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z'],
    link: ['M12 5.5v4', 'M6.5 18.5v-4.5L12 9.5', 'M17.5 18.5v-4.5L12 9.5'],
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

    restore: ['M3.6 12a8.4 8.4 0 1 0 2.5-6', 'M3.2 3.6V9h5.4', 'M12 7.9V12l3 1.7'],

    filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
    sort: ['M7 5v14', 'M4 16l3 3 3-3', 'M17 19V5', 'M14 8l3-3 3 3'],
    external: ['M14 4.5h5.5V10', 'M19.5 4.5 11 13', 'M18 14.5v4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4'],
    download: ['M12 4.5V15', 'M8 11l4 4 4-4', 'M5 19.5h14'],
    copy: ['M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5Z', 'M15.5 5.5H6A1.5 1.5 0 0 0 4.5 7v9.5'],
    eye: ['M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
    checkCircle: ['M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 'M8.4 12.2l2.6 2.6 4.8-5.2'],
    emptyTrash: ['M4.5 7h15', 'M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7', 'M6.5 7l0.9 11.5a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7', 'M9.8 10.5l4.4 6', 'M14.2 10.5l-4.4 6'],
    chart: ['M4 20.5h16', 'M7 20.5v-6', 'M12 20.5V7.5', 'M17 20.5v-3.5'],

    more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],

    grid: ['M4.5 4.5h6v6h-6Z', 'M13.5 4.5h6v6h-6Z', 'M4.5 13.5h6v6h-6Z', 'M13.5 13.5h6v6h-6Z'],
    list: ['M4.5 6.5h3.2', 'M10.6 6.5h8.9', 'M4.5 12h3.2', 'M10.6 12h8.9', 'M4.5 17.5h3.2', 'M10.6 17.5h8.9'],
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttributeNS(null, key, String(attrs[key]));
      });
    }
    return node;
  }

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

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var openDialogs = [];

  function dialog(cfg) {
    var config = cfg || {};

    return new Promise(function (resolve) {
      var settled = false;

      var titleId = 'dlg-title-' + util.uuid().slice(0, 8);
      var described = [];

      var returnFocus = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

      var dialogAttrs = {
        class: 'dialog'
          + (config.danger ? ' dialog--danger' : '')
          + (config.wide ? ' dialog--wide' : '')
          + (config.fullscreen ? ' dialog--full' : ''),
      };
      if (config.hideHeader && config.title) dialogAttrs['aria-label'] = config.title;
      else dialogAttrs['aria-labelledby'] = titleId;

      config.consequences = config.consequences == null || Array.isArray(config.consequences) ? config.consequences : [config.consequences];

      var node = el('dialog', dialogAttrs);

      var form = el('form', { class: 'dialog__form', novalidate: 'novalidate' });

      var closeBtn = null;
      if (!config.hideHeader) {
        var head = el('div', { class: 'dialog__head' });
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

      var body = el('div', { class: 'dialog__body' });

      if (config.message) {
        var msgId = 'dlg-msg-' + util.uuid().slice(0, 8);
        described.push(msgId);
        body.appendChild(el('p', { id: msgId, class: 'dialog__message', text: config.message }));
      }

      if (config.consequences && config.consequences.length) {
        var list = el('ul', { class: 'dialog__consequences' });
        (Array.isArray(config.consequences) ? config.consequences : [config.consequences]).forEach(function (line) { list.appendChild(el('li', { text: line })); });
        body.appendChild(list);
      }

      var field = null;
      var gate = null;

      if (config.input) {
        field = fieldShell(config.input);
        body.appendChild(field.root);
      }

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

      if (config.body) body.appendChild(config.body);

      form.appendChild(body);

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
      if (config.footer) footer.insertBefore(config.footer, cancelBtn);
      if (config.hideFooter) {
        footer = null;
      } else {
        form.appendChild(footer);
      }

      if (described.length) form.setAttribute('aria-describedby', described.join(' '));
      node.appendChild(form);

      if (gate) {
        confirmBtn.disabled = true;
        gate.input.addEventListener('input', function () {
          confirmBtn.disabled = gate.input.value.trim() !== config.gate.phrase;
          setFieldError(gate, null);
        });
      }

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
        syncDialogStack();
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      }

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
          var text = (err && err.message) || 'That did not work.';
          if (field) setFieldError(field, text);
          else body.appendChild(el('p', { class: 'field__message field__message--error', text: text }));
        });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (config.hideFooter) return;
        submit();
      });

      node.addEventListener('cancel', function (event) {
        event.preventDefault();
        dismiss(null);
      });

      node.addEventListener('click', function (event) {
        if (event.target !== node) return;
        var box = node.getBoundingClientRect();
        var outside = event.clientX < box.left || event.clientX > box.right ||
                      event.clientY < box.top || event.clientY > box.bottom;
        if (outside && config.closeOnBackdrop !== false) dismiss(null);
      });

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
      syncDialogStack();

      var api = { root: node, form: form, body: body, footer: footer, close: dismiss };
      if (typeof config.onOpen === 'function') {
        try { config.onOpen(api); } catch (err) {
          console.error('dialog onOpen failed', err);
        }
      }

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

  function syncDialogStack() {
    var open = Array.prototype.slice.call(document.querySelectorAll('dialog[open]'));
    open.forEach(function (node, index) {
      node.classList.toggle('is-behind', index < open.length - 1);
    });
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

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

    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true') setFieldError({ input: input, message: message }, null);
    });

    return { root: root, input: input, message: message, uid: uid };
  }

  function field(opts) {
    var o = opts || {};
    var control = o.control && o.control.root ? o.control.root : o.control;
    if (!control) return null;

    var uid = o.id || ('fld-' + util.uuid().slice(0, 8));
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

  function select(cfg) {
    var c = cfg || {};
    var options = (c.options || []).map(function (o) {
      return { value: String(o.value), label: String(o.label) };
    });

    var native = el('select', { class: 'select__native', tabindex: '-1', 'aria-hidden': 'true' });
    options.forEach(function (o) {
      native.appendChild(el('option', { value: o.value, text: o.label, selected: o.value === String(c.value) }));
    });
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
    root.native = native;

    return root;
  }

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

  var menuRoot = null;
  var menuState = null; 
  var menuHost = null;  

  function menuParent() {
    var dialogs = document.querySelectorAll('dialog[open]');
    return dialogs.length ? dialogs[dialogs.length - 1] : document.body;
  }

  function ensureMenuRoot() {
    var parent = menuParent();
    if (menuRoot && menuHost === parent && parent.contains(menuRoot)) return menuRoot;
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

    root.focus();

    return root;
  }

  function closeMenu() {
    if (!menuState) return;
    var state = menuState;
    menuState = null;
    if (menuRoot) menuRoot.classList.add('is-hidden');
    if (state.returnFocus && document.contains(state.returnFocus)
        && typeof state.returnFocus.focus === 'function') {
      try { state.returnFocus.focus(); } catch (err) {  }
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
