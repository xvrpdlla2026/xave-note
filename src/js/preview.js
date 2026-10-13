(function () {
  var App = window.NoteApp = window.NoteApp || {};

  var TEXT_LIMIT = 20000;
  var SHEET_ROWS = 80;
  var SHEET_COLS = 24;

  function decode(str) {
    return String(str == null ? '' : str)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (m, code) { return String.fromCharCode(Number(code)); })
      .replace(/&amp;/g, '&');
  }

  function utf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('no inflate support'));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function zipEntries(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    var floor = Math.max(0, bytes.length - 66000);
    for (var i = bytes.length - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return {};
    var count = view.getUint16(eocd + 10, true);
    var cursor = view.getUint32(eocd + 16, true);
    var out = {};
    for (var n = 0; n < count && cursor + 46 <= bytes.length; n++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) break;
      var method = view.getUint16(cursor + 10, true);
      var size = view.getUint32(cursor + 20, true);
      var nameLen = view.getUint16(cursor + 28, true);
      var extraLen = view.getUint16(cursor + 30, true);
      var commentLen = view.getUint16(cursor + 32, true);
      var local = view.getUint32(cursor + 42, true);
      var name = utf8(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
      if (local + 30 <= bytes.length && view.getUint32(local, true) === 0x04034b50) {
        var localNameLen = view.getUint16(local + 26, true);
        var localExtraLen = view.getUint16(local + 28, true);
        out[name] = { method: method, size: size, start: local + 30 + localNameLen + localExtraLen };
      }
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function entryBytes(bytes, entry) {
    if (!entry) return Promise.reject(new Error('missing entry'));
    var slice = bytes.subarray(entry.start, entry.start + entry.size);
    if (entry.method === 0) return Promise.resolve(slice);
    if (entry.method === 8) return inflateRaw(slice);
    return Promise.reject(new Error('unsupported compression'));
  }

  function textOf(xml) {
    var parts = String(xml).match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return parts.map(function (part) { return decode(part.replace(/<[^>]*>/g, '')); }).join('');
  }

  function docxText(bytes) {
    return entryBytes(bytes, zipEntries(bytes)['word/document.xml']).then(function (xml) {
      return decode(utf8(xml)
        .replace(/<w:p\b[^>]*>/g, '\n')
        .replace(/<w:br\b[^>]*>/g, '\n')
        .replace(/<w:tab\b[^>]*>/g, '\t')
        .replace(/<w:tc\b[^>]*>/g, '\t')
        .replace(/<[^>]*>/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim());
    });
  }

  function xlsxRows(bytes) {
    var entries = zipEntries(bytes);
    var sheet = Object.keys(entries).filter(function (name) {
      return /^xl\/worksheets\/sheet\d*\.xml$/.test(name);
    })[0];
    if (!sheet) return Promise.reject(new Error('no worksheet'));
    var shared = entries['xl/sharedStrings.xml']
      ? entryBytes(bytes, entries['xl/sharedStrings.xml']).then(function (xml) {
        return utf8(xml).split(/<si[ >]/).slice(1).map(function (chunk) {
          return textOf(chunk.split('</si>')[0]);
        });
      })
      : Promise.resolve([]);
    return Promise.all([shared, entryBytes(bytes, entries[sheet])]).then(function (res) {
      var strings = res[0];
      var xml = utf8(res[1]);
      var rows = [];
      (xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).slice(0, SHEET_ROWS).forEach(function (rowXml) {
        var cells = [];
        (rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []).slice(0, SHEET_COLS).forEach(function (cell) {
          var raw = (cell.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1];
          if (/t="s"/.test(cell) && raw != null) cells.push(strings[Number(raw)] || '');
          else if (raw != null) cells.push(decode(raw));
          else if (/t="(inlineStr|str)"/.test(cell)) cells.push(textOf(cell));
          else cells.push('');
        });
        rows.push(cells);
      });
      return rows;
    });
  }

  function pre(text) {
    var node = document.createElement('pre');
    node.className = 'pane-preview__text';
    node.textContent = text;
    return node;
  }

  function sheetNode(rows) {
    var wrap = document.createElement('div');
    wrap.className = 'pane-preview__sheetwrap';
    var table = document.createElement('table');
    table.className = 'pane-preview__sheet';
    rows.forEach(function (cells, index) {
      var tr = document.createElement('tr');
      cells.forEach(function (value) {
        var cell = document.createElement(index === 0 ? 'th' : 'td');
        cell.textContent = value;
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function docxNode(blob) {
    if (!window.docx || typeof window.docx.renderAsync !== 'function') return Promise.resolve(null);
    var host = document.createElement('div');
    host.className = 'pane-preview__docx';
    return window.docx.renderAsync(blob, host, null, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: true,
      ignoreHeight: true,
      breakPages: false,
      renderHeaders: false,
      renderFooters: false,
      useBase64URL: true,
      experimental: true,
    }).then(function () { return host; }).catch(function () { return null; });
  }

  function render(meta, blob) {
    if (!blob) return Promise.resolve(null);
    var bytes = blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    if (meta.docx) {
      return docxNode(blob).then(function (node) {
        if (node) return node;
        return bytes.then(docxText).then(function (text) { return text ? pre(text) : null; });
      });
    }
    if (meta.xlsx) return bytes.then(xlsxRows).then(function (rows) { return rows.length ? sheetNode(rows) : null; });
    if (meta.text) {
      return blob.text().then(function (text) {
        var trimmed = text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) + '\n\u2026' : text;
        return trimmed.trim() ? pre(trimmed) : null;
      });
    }
    return Promise.resolve(null);
  }

  App.preview = { render: render };
})();
