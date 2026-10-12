/**
 * spawner.js - the Spawner view: a conversation with the local model about this notebook.
 *
 * Nothing here leaves the machine. Every request goes to the Ollama server on localhost,
 * and the excerpts that go with it are cut out of notes and attachments that are already
 * in IndexedDB. The model is told to answer from those excerpts and to name the notes it
 * used, so an answer can be checked against the page it came from.
 *
 * Retrieval is keyword based rather than embeddings. A 4B model on this hardware spends
 * its time generating, and the notebook is small enough that scoring every passage in
 * memory costs nothing measurable, so the simpler thing is also the faster thing. Chunks
 * are scored with a cut down BM25 (term frequency against document frequency, corrected
 * for length) and the best ones are packed into a character budget.
 *
 * The index is built from the notebook rather than stored: notes live in SQLite, so
 * rebuilding is a read, and a stale index is impossible.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
  // Only these two may be used here: both are non thinking builds, so answers stream as text.
  // The 4B reads the notebook better and cites it; the 1.5B is measured at roughly three times
  // the speed. The thinking variant qwen3:4b is not on the list on purpose.
  var MODELS = [
    { name: 'qwen3:4b-instruct-2507-q4_K_M', label: 'Best (4B)', note: 'about 9 words a second' },
    { name: 'qwen2.5:1.5b-instruct-q4_K_M', label: 'Fast (1.5B)', note: 'about 24 words a second' },
  ];
  var MODEL = MODELS[0].name;
  var BUILD = '__BUILD__';   // stamped by tools/build.js, so the page can say which build it is
  var PREF_KEY = 'noteapp.spawner.settings';

  // The window the model is asked for. 8192 is the same window the chat page asks for, and
  // asking for the same number matters: a different num_ctx makes Ollama reload the model,
  // which on this hardware costs more than the extra room would buy. It is sent per call, so
  // the page works even when the server was started without OLLAMA_CONTEXT_LENGTH.
  var NUM_CTX = 8192;
  // How much of the notebook is allowed into one prompt, in characters of excerpt text.
  // 9000 characters is roughly 2200 tokens, which leaves room for the conversation and the
  // answer inside a 16k window without making the prompt slow to read on this hardware.
  var BUDGET_CHARS = 2200;
  var CHUNK_CHARS = 900;
  var MAX_FILE_BYTES = 2 * 1024 * 1024;
  /** How long one answer may be. A knob because the wait is the whole cost of a local model. */
  var NUM_PREDICT = -1;   // -1 means no limit: the answer ends when the model is done, never on a cap

  var TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'js', 'ts', 'css', 'html', 'htm',
    'xml', 'yml', 'yaml', 'log', 'ini', 'py', 'ps1', 'sql', 'sh', 'rtf'];

  var STOP = (' a an and are as at be been but by can could did do does for from had has have how ' +
    'i if in into is it its me my not of on or should so than that the their them then there these ' +
    'they this to too us was we were what when where which who why will with you your ').split(' ');

  // A plain assistant now: no notebook, no excerpts, no citations.
  var SYSTEM = [
    'You are Spawner, a private assistant running on the user\'s own computer. Nothing you are sent leaves it.',
    'Answer the question directly. If you are unsure, say so instead of inventing anything.',
    'Answer in the language of the question. Be direct: two or three sentences, or a short list when the question asks for one.',
    'No preamble, and do not restate the question.',
  ].join(' ');

  var state = {
    workspaceId: null,
    scope: 'all',           // 'all' or 'note'
    messages: [],           // { role, text, cites, stats, error }
    draft: '',
    busy: false,
    controller: null,
    nodes: [],              // the rendered text nodes, so streaming can paint without a re-render
    index: null,
    indexing: false,
    indexError: '',
    lastCtx: null,
    warming: false,         // a load request is in flight
    modelReady: false,      // the server holds the model right now
    warmError: '',
    warmFor: '',            // the address the last attempt used, so a change retries
    endpoint: DEFAULT_ENDPOINT,
    maxTokens: NUM_PREDICT,
    model: MODEL,
    notice: '',
  };

  // ------------------------------------------------------------------------ small helpers

  /** Build an element. The app has one of these inside ui.js; this module keeps its own so it
   *  can be read and changed without reaching into that file. */
  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
        else if (key === 'on') Object.keys(value).forEach(function (k) { node.addEventListener(k, value[k]); });
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function text(value) { return value === null || value === undefined ? '' : String(value); }

  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(PREF_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && typeof saved.endpoint === 'string' && saved.endpoint) state.endpoint = saved.endpoint;
      // A stored model is honoured only if it is one of the two known good builds. An earlier
      // build stored the thinking variant qwen3:4b, whose first several hundred tokens arrive as
      // thinking instead of text: the bubble sat empty while that ran. That value is dropped.
      if (saved && MODELS.some(function (known) { return known.name === saved.model; })) state.model = saved.model;
      else if (saved && saved.model) savePrefs();
      if (saved && (saved.scope === 'all' || saved.scope === 'note')) state.scope = saved.scope;
    } catch (e) { /* a blocked or corrupt preference is not worth an error */ }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify({
        endpoint: state.endpoint, model: state.model, scope: state.scope,
      }));
    } catch (e) { /* quota or privacy mode: the session still works */ }
  }

  // ----------------------------------------------------------------------------- the index

  function isTextual(name, mime) {
    var lower = text(name).toLowerCase();
    var dot = lower.lastIndexOf('.');
    var ext = dot === -1 ? '' : lower.slice(dot + 1);
    if (TEXT_EXT.indexOf(ext) !== -1) return true;
    return !!mime && /^text\//.test(mime);
  }

  /** Lowercased word counts for one passage. */
  function termCounts(passage) {
    var counts = Object.create(null);
    var words = text(passage).toLowerCase().split(/[^a-z0-9_\u00c0-\u024f]+/);
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (word.length < 2 || STOP.indexOf(word) !== -1) continue;
      counts[word] = (counts[word] || 0) + 1;
    }
    return counts;
  }

  function termLen(counts) {
    var n = 0;
    Object.keys(counts).forEach(function (k) { n += counts[k]; });
    return n || 1;
  }

  /** Split a note body into passages on paragraph boundaries, then pack them up to CHUNK_CHARS. */
  function chunkText(body) {
    var blocks = text(body).split(/\n{2,}/);
    var out = [];
    var current = '';
    blocks.forEach(function (block) {
      var piece = block.trim();
      if (!piece) return;
      if (piece.length > CHUNK_CHARS * 2) {
        if (current) { out.push(current); current = ''; }
        for (var i = 0; i < piece.length; i += CHUNK_CHARS) out.push(piece.slice(i, i + CHUNK_CHARS));
        return;
      }
      if ((current + '\n\n' + piece).length > CHUNK_CHARS && current) { out.push(current); current = piece; }
      else current = current ? current + '\n\n' + piece : piece;
    });
    if (current) out.push(current);
    return out;
  }

  function addChunk(chunks, id, title, kind, body, updated) {
    var pieces = chunkText(body);
    if (!pieces.length) {
      // A note with no body is still a thing the notebook contains, and its title alone is
      // worth indexing: "which notes do I have about X" is answered by the title list.
      chunks.push({ id: id, title: title, kind: kind, text: '', tokens: termCounts(title), len: termLen(termCounts(title)), updated: updated || '' });
      return;
    }
    pieces.forEach(function (piece) {
      var tokens = termCounts(piece);
      chunks.push({ id: id, title: title, kind: kind, text: piece, tokens: tokens, len: termLen(tokens), updated: updated || '' });
    });
  }

  /** Read every note and every readable attachment in the workspace into memory, once. */
  function buildIndex(ctx) {
    state.indexing = true;
    state.indexError = '';
    var workspaceId = ctx.workspaceId;
    var chunks = [];

    function collectFiles() {
      var metas = [];
      try {
        metas = App.db.listFilesIn(workspaceId, null, 'name').slice();
        App.db.listFolders(workspaceId, 'name').forEach(function (folder) {
          metas = metas.concat(App.db.listFilesIn(workspaceId, folder.id, 'name'));
        });
      } catch (e) { metas = []; }
      var readable = metas.filter(function (meta) { return isTextual(meta.filename, meta.mime_type) && meta.size <= MAX_FILE_BYTES; });
      var skipped = metas.length - readable.length;
      var chain = Promise.resolve();
      readable.forEach(function (meta) {
        chain = chain.then(function () {
          return Promise.resolve(App.db.getFileBlob(meta.id)).then(function (blob) {
            return blob && blob.text ? blob.text() : '';
          }).then(function (body) {
            addChunk(chunks, meta.id, meta.filename, 'file', body, meta.created_at);
          }).catch(function () { /* a locked or unreadable file is skipped, not fatal */ });
        });
      });
      return chain.then(function () { return { files: readable.length, skippedFiles: skipped }; });
    }

    return Promise.resolve().then(function () {
      var notes = App.db.listAllNotes(workspaceId, 'updated');
      notes.forEach(function (meta) {
        var note = null;
        try { note = App.db.getNote(meta.id); } catch (e) { note = null; }
        var title = (note && note.title) || meta.title || 'Untitled note';
        var body = note && typeof note.content === 'string' ? note.content : '';
        addChunk(chunks, meta.id, title, 'note', body, meta.updated_at);
      });
      return { notes: notes.length };
    }).then(function (counts) {
      return collectFiles().then(function (files) { return { notes: counts.notes, files: files.files, skippedFiles: files.skippedFiles }; });
    }).then(function (counts) {
      var df = Object.create(null);
      var total = 0;
      chunks.forEach(function (chunk) {
        total += chunk.len;
        Object.keys(chunk.tokens).forEach(function (term) { df[term] = (df[term] || 0) + 1; });
      });
      state.index = {
        workspaceId: workspaceId,
        chunks: chunks,
        df: df,
        count: chunks.length,
        avg: chunks.length ? total / chunks.length : 1,
        notes: counts.notes,
        files: counts.files,
        skippedFiles: counts.skippedFiles,
      };
      state.indexing = false;
      if (state.lastCtx && state.lastCtx.render) state.lastCtx.render();
    }).catch(function (error) {
      state.indexing = false;
      state.index = null;
      state.indexError = text(error && error.message) || 'the notebook could not be read';
      if (state.lastCtx && state.lastCtx.render) state.lastCtx.render();
    });
  }

  function ensureIndex(ctx) {
    if (state.indexing) return;
    if (state.index && state.index.workspaceId === ctx.workspaceId) return;
    if (state.indexError && state.lastCtx && state.lastCtx.workspaceId === ctx.workspaceId) return;
    buildIndex(ctx);
  }

  function reindex(ctx) {
    state.index = null;
    state.indexError = '';
    state.notice = '';
    buildIndex(ctx);
    if (ctx.render) ctx.render();
  }

  // -------------------------------------------------------------------------- the retrieval

  /**
   * BM25 over the chunks, minus the tuning that a notebook this size cannot feel.
   *
   * k1 and b are the usual constants. A term nobody has (df 0) scores nothing, which keeps
   * a misspelling from dragging a random passage into the prompt.
   */
  function scoreChunk(chunk, terms, index) {
    var score = 0;
    terms.forEach(function (term) {
      var frequency = chunk.tokens[term];
      if (!frequency) return;
      var seen = index.df[term] || 0;
      if (!seen) return;
      var idf = Math.log(1 + (index.chunks.length - seen + 0.5) / (seen + 0.5));
      var norm = frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * chunk.len / index.avg));
      score += idf * norm;
    });
    return score;
  }

  /**
   * The passages that go into the prompt for one question.
   *
   * When nothing matches, the most recently edited notes are used instead of nothing at all:
   * a question like "summarise this notebook" has no keywords, and an empty prompt would
   * make the model answer from thin air.
   */
  function retrieve(question, ctx) {
    var index = state.index;
    var scoped = index.chunks;
    if (state.scope === 'note' && ctx.activeNoteId) {
      var only = index.chunks.filter(function (chunk) { return chunk.id === ctx.activeNoteId; });
      if (only.length) scoped = only;
    }
    var terms = Object.keys(termCounts(question));
    // One passage per place in the notebook, so the same text cannot be paid for twice.
    var already = {};

    var ranked = scoped.map(function (chunk) {
      return { chunk: chunk, score: scoreChunk(chunk, terms, index) };
    }).filter(function (row) { return row.score > 0; });

    var fallback = false;
    if (!ranked.length) {
      fallback = true;
      ranked = scoped.slice(0, 40).map(function (chunk) {
        return { chunk: chunk, score: chunk.updated ? idxFreshness(chunk.updated) : 0 };
      }).sort(function (a, b) { return b.score - a.score; });
    } else {
      ranked.sort(function (a, b) { return b.score - a.score || String(b.chunk.updated).localeCompare(String(a.chunk.updated)); });
    }

    var picked = [];
    var used = 0;
    for (var i = 0; i < ranked.length && used < BUDGET_CHARS; i++) {
      var chunk = ranked[i].chunk;
      if (already[chunk.id + ':' + chunk.text.slice(0, 24)]) continue;
      already[chunk.id + ':' + chunk.text.slice(0, 24)] = true;
      picked.push(chunk);
      used += chunk.text.length + 40;
    }
    return { chunks: picked, fallback: fallback };
  }

  /** Older notes never outrank newer ones on a tie, and a date parses to a number safely. */
  function idxFreshness(iso) {
    var stamp = Date.parse(iso);
    return isNaN(stamp) ? 0 : stamp / 1e13;
  }

  function excerptsToPrompt(result) {
    if (!result.chunks.length) return '';
    return result.chunks.map(function (chunk) {
      var head = '[Note: ' + chunk.title + ']';
      if (chunk.kind === 'file') head = '[File: ' + chunk.title + ']';
      return head + '\n' + (chunk.text || '(no text in this note, title only)');
    }).join('\n\n');
  }

  // ------------------------------------------------------------------------------- the chat

  var HISTORY_TURNS = 4;
  var HISTORY_CHARS = 400;   // how much of an earlier turn is worth re-sending

  /** The end of a long string, which is usually where the point is. */
  function tail(value, limit) {
    var str = text(value);
    return str.length <= limit ? str : '...' + str.slice(str.length - limit);
  }

  function buildPayload(question) {
    var payload = {
      model: state.model,
      stream: true,
      keep_alive: '30m',
      options: { num_ctx: NUM_CTX, temperature: 0.2, num_predict: state.maxTokens },
      messages: [{ role: 'system', content: SYSTEM }],
    };
    // Plain conversation: the earlier turns are the whole context, so the prompt stays short,
    // the server reads it in well under a second, and the answer starts almost at once.
    state.messages.slice(-1 - HISTORY_TURNS * 2, -1).forEach(function (message) {
      payload.messages.push({ role: message.role, content: tail(message.text, HISTORY_CHARS) });
    });
    payload.messages.push({ role: 'user', content: question });
    return payload;
  }

  function stop() {
    if (state.controller) {
      try { state.controller.abort(); } catch (e) { /* already finished */ }
      state.controller = null;
    }
    state.busy = false;
  }

  function finish(ctx, answer, started, tokens, errorText) {
    if (answer.waiting) {
      // Stopped, or the model sent nothing at all. Do not leave the waiting line standing as
      // if it were an answer.
      answer.waiting = false;
      answer.text = '';
    }
    state.busy = false;
    state.controller = null;
    var seconds = (Date.now() - started) / 1000;
    if (errorText) answer.error = errorText;
    else if (answer.text) {
      answer.stats = seconds.toFixed(1) + 's, ' + tokens + ' tokens' + (seconds > 0.2 ? ' (' + (tokens / seconds).toFixed(1) + '/s)' : '');
    }
    answer.cites = citeNames(answer.text, state.index);
    if (ctx.render) ctx.render();
  }

  /** The [Note name] tags the model was asked for, matched back to titles it was given. */
  function citeNames(answer, index) {
    var found = [];
    var matches = text(answer).match(/\[[^\]\n]{2,80}\]/g) || [];
    matches.forEach(function (raw) {
      var name = raw.slice(1, -1).trim();
      if (!name || found.indexOf(name) !== -1) return;
      if (/^(note|file|excerpt|source)/i.test(name)) return;
      found.push(name);
    });
    if (index) {
      found = found.filter(function (name) {
        return index.chunks.some(function (chunk) { return chunk.title.toLowerCase() === name.toLowerCase(); });
      });
    }
    return found.slice(0, 8);
  }

  function ask(ctx) {
    var question = state.draft.trim();
    if (!question || state.busy) return;

    state.messages.push({ role: 'user', text: question });
    var answer = { role: 'assistant', text: '', cites: [], stats: '', error: '', waiting: true, cut: false };
    state.messages.push(answer);
    state.draft = '';
    state.busy = true;

    // A cold model has to read 2.5 GB off the disk before the first token, and that is long
    // enough for an empty bubble to look like nothing is happening. Say so, and keep counting
    // seconds so it is visibly alive. The first token replaces this text.
    var waited = 0;
    answer.text = state.modelReady ? 'Thinking' : 'Waiting for the model to load';
    var waitingLead = answer.text;
    var ticker = setInterval(function () {
      if (!state.busy) { clearInterval(ticker); ticker = null; return; }
      waited += 1;
      answer.text = waitingLead + ' (' + waited + 's. ' + (state.modelReady
        ? 'The model is loaded, so this is the reading and writing part.'
        : 'Loading 2.5 GB from disk is about 25 seconds, and it is kept for 30 minutes after that.') + ')';
      if (answer.text.indexOf('Waiting') === 0 && waitingLead !== 'Waiting for the model to load') answer.text = waitingLead + answer.text.slice(waitingLead.length);
      var node = lastTextNode();
      if (node && node.isConnected) node.textContent = answer.text;
      pin();
    }, 1000);

    var payload = buildPayload(question);
    var started = Date.now();
    var tokens = 0;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = controller;

    if (ctx.render) ctx.render();
    var node = lastTextNode();

    fetch(state.endpoint.replace(/\/+$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (body) {
          throw new Error('the server answered ' + response.status + ': ' + body.slice(0, 200));
        });
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function pump() {
        return reader.read().then(function (read) {
          if (read.done) {
            // Flush the decoder and the last line, which has no newline and was being dropped.
            buffer += decoder.decode();
            if (buffer.trim()) {
              try {
                var last = JSON.parse(buffer.trim());
                if (last.message && last.message.content) answer.text = (answer.text || '') + last.message.content;
                if (last.eval_count) tokens = last.eval_count;
              } catch (e) { /* a half written line is not worth an error */ }
            }
            buffer = '';
            return null;
          }
          buffer += decoder.decode(read.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(function (line) {
            var trimmed = line.trim();
            if (!trimmed) return;
            var event = null;
            try { event = JSON.parse(trimmed); } catch (e) { return; }
            if (event.error) throw new Error(text(event.error));
            if (event.done_reason === 'length') answer.cut = true;
            if (event.eval_count) tokens = event.eval_count;
            if (event.message && event.message.thinking) {
              // Belt and braces: if a thinking model ever gets used, say so instead of going blank.
              answer.thinking = (answer.thinking || 0) + String(event.message.thinking).length;
              if (!answer.text && !answer.modelReady) {
                answer.text = 'The model is thinking first (' + answer.thinking + ' characters so far). No text yet.';
                if (node && node.isConnected) node.textContent = answer.text;
                pin();
              }
            }
            if (event.message && event.message.content) {
              if (ticker) { clearInterval(ticker); ticker = null; }
              if (answer.waiting || answer.thinking) { answer.waiting = false; answer.thinking = 0; answer.text = ''; }
              answer.text += event.message.content;
              tokens += 1;
              if (node && node.isConnected) node.textContent = answer.text;
              pin();
            }
          });
          return pump();
        });
      }
      return pump();
    }).then(function () {
      if (answer.cut) {
        answer.text = (answer.text || '') + '\n\n(stopped at the length limit, ask again and it will carry on)';
      }
      finish(ctx, answer, started, tokens, '');
    }).catch(function (error) {
      var message = text(error && error.message);
            if (error && error.name === 'AbortError') {
        message = 'stopped';
      } else if (/fetch|network|load failed/i.test(message)) {
        // A page opened from a file: address sends `Origin: null`. Ollama refuses that origin
        // unless OLLAMA_ORIGINS is set, and a server started without it answers nothing at all.
        message = 'The model server is not answering at ' + state.endpoint + '. Start it with ' +
          'Start-Local-AI.cmd in the qwen folder, then ask again. Build ' + BUILD + '.';
      } else if (message) {
        message = 'The answer stopped early (' + message + ', build ' + BUILD + '). Ask again, or switch model.';
      }
      finish(ctx, answer, started, tokens, message);
    });
  }

  /** Keep the newest text in view while an answer streams in. */
  function pin() {
    var box = state.scrollEl;
    if (box) box.scrollTop = box.scrollHeight;
  }

  function lastTextNode() {
    var entry = state.nodes[state.nodes.length - 1];
    return entry ? entry.text : null;
  }

  // ------------------------------------------------------------------------ the conversation

  function saveThread(ctx) {
    if (!state.messages.length) return;
    var firstUser = '';
    for (var i = 0; i < state.messages.length; i++) {
      if (state.messages[i].role === 'user') { firstUser = state.messages[i].text; break; }
    }
    var title = 'Spawner: ' + firstUser.replace(/\s+/g, ' ').slice(0, 60);
    var body = state.messages.map(function (message) {
      var who = message.role === 'user' ? 'You' : 'Spawner';
      return '### ' + who + '\n\n' + message.text;
    }).join('\n\n');
    body += '\n\n---\n\nSpawner is a local model (' + state.model + '). It read this notebook to answer.';

    var created = App.db.createNote(ctx.workspaceId, null, title);
    Promise.resolve(created).then(function (note) {
      if (!note || !note.id) return null;
      return Promise.resolve(App.db.updateNote(note.id, title, body)).then(function () { return note; });
    }).then(function (note) {
      state.notice = note ? 'Saved to the notebook as "' + title + '".' : 'The thread could not be saved.';
      if (ctx.render) ctx.render();
    }).catch(function (error) {
      state.notice = 'The thread could not be saved: ' + (text(error && error.message) || 'unknown error');
      if (ctx.render) ctx.render();
    });
  }

  function clearThread(ctx) {
    stop();
    state.messages = [];
    state.notice = '';
    state.nodes = [];
    if (ctx.render) ctx.render();
  }

  // ----------------------------------------------------------------------------- the render

  /**
   * Ask the server to load the model as soon as the pane is opened, instead of in front of the
   * first question. Reading 2.5 GB off the disk takes about 25 seconds on this machine, and the
   * server then holds it for OLLAMA_KEEP_ALIVE (30 minutes in the launcher). One attempt per
   * address: a different address in the box above is a different attempt.
   */
  /** Use one of the known good models, then load it now so the wait is not saved up for the ask. */
  function pickModel(name, ctx) {
    if (!MODELS.some(function (known) { return known.name === name; })) return;
    if (state.model === name) return;
    state.model = name;
    state.modelReady = false;
    state.warming = false;
    state.warmFor = '';
    state.warmError = '';
    savePrefs();
    if (ctx && ctx.render) ctx.render();
    warm(ctx);
  }

  function warm(ctx) {
    var url = (state.endpoint || '').replace(/\/+$/, '');
    var base = url + ' ' + state.model;   // one warm per address per model
    if (!url || state.modelReady || state.warming) return;
    if (state.warmFor === base) return;
    state.warmFor = base;
    state.warming = true;
    state.warmError = '';
    var body = {
      model: state.model,
      prompt: '',
      stream: false,
      keep_alive: '30m',
      options: { num_predict: 1, num_ctx: NUM_CTX },
    };
    fetch(url + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      state.warming = false;
      if (response.ok) {
        state.modelReady = true;
        state.warmError = '';
      } else {
        state.warmError = 'the server answered ' + response.status;
      }
      if (ctx && ctx.render) ctx.render();
    }).catch(function (error) {
      state.warming = false;
      state.warmError = text(error && error.message) || 'the server could not be reached';
      if (ctx && ctx.render) ctx.render();
    });
  }

  /** The title of the note the scope is limited to, so the pane can say what it is reading. */
  function openNoteTitle(ctx) {
    var id = ctx && ctx.activeNoteId;
    if (!id || !state.index) return 'the open note';
    var found = state.index.chunks.filter(function (chunk) { return chunk.id === id; });
    return found.length && found[0].title ? found[0].title : 'the open note';
  }

  function statusLine() {
    if (state.indexing) return 'Reading the notebook...';
    if (state.indexError) return 'The notebook could not be read: ' + state.indexError;
    if (!state.index) return 'The notebook has not been read yet.';
    var bits = [state.index.notes + (state.index.notes === 1 ? ' note' : ' notes')];
    if (state.index.files) bits.push(state.index.files + (state.index.files === 1 ? ' file' : ' files'));
    if (state.index.skippedFiles) bits.push(state.index.skippedFiles + ' attachment(s) with no readable text yet');
    bits.push(state.index.count + ' passages');
    return 'Read: ' + bits.join(', ') + '.';
  }

  var EXAMPLES = [
    'Explain what a database index is, in plain language.',
    'Draft a short email asking a client for feedback on the last delivery.',
    'Draft a polite reminder for an overdue invoice.',
    'What are three questions I should ask before signing a retainer?',
  ];

  function renderMessages(list, ctx) {
    state.nodes = [];
    if (!state.messages.length) {
      list.appendChild(el('div', { class: 'spawner__empty' }, [
        el('p', { class: 'spawner__empty-lead', text: 'Ask about anything in this notebook. It is read on this machine and nothing is sent anywhere else.' }),
        el('div', { class: 'spawner__examples' }, EXAMPLES.map(function (example) {
          return el('button', {
            class: 'spawner__example', type: 'button', text: example,
            on: { click: function () { state.draft = example; if (ctx.render) ctx.render(); } },
          });
        })),
      ]));
      return;
    }
    state.messages.forEach(function (message) {
      var isUser = message.role === 'user';
      var body = el('div', { class: 'spawner__bubble' });
      if (isUser) {
        body.appendChild(el('p', { class: 'spawner__text', text: message.text }));
        state.nodes.push({ text: null });
      } else {
        var node = el('p', { class: 'spawner__text', text: message.text });
        body.appendChild(node);
        state.nodes.push({ text: node });
        if (message.cites && message.cites.length) {
          body.appendChild(el('div', { class: 'spawner__cites' }, message.cites.map(function (name) {
            return el('span', { class: 'spawner__cite', text: name });
          })));
        }
        if (message.stats) body.appendChild(el('p', { class: 'spawner__stats', text: message.stats }));
        if (message.error) body.appendChild(el('p', { class: 'spawner__error', text: message.error }));
      }
      list.appendChild(el('article', { class: 'spawner__msg ' + (isUser ? 'is-user' : 'is-bot') }, [
        el('span', { class: 'spawner__role', text: isUser ? 'You' : 'Spawner' }),
        body,
      ]));
    });
  }

  function render(host, ctx) {
    // The pane is rebuilt from state on every render, so the host is emptied first: appending
    // would otherwise stack a second transcript every time the notebook re-rendered.
    host.textContent = '';
    state.workspaceId = ctx.workspaceId;
    state.lastCtx = ctx;
    loadPrefs();

    var scroll = el('div', { class: 'spawner__scroll' });
    state.scrollEl = scroll;
    var list = el('div', { class: 'spawner__list' });
    renderMessages(list, ctx);
    scroll.appendChild(list);


    // A two way switch, not a text box: the thinking variant cannot be typed back in.
    var modelInput = el('div', { class: 'spawner__seg spawner__seg-model' }, MODELS.map(function (choice) {
      var on = state.model === choice.name;
      return el('button', {
        class: 'spawner__seg-btn' + (on ? ' is-active' : ''), type: 'button', text: choice.label,
        title: choice.name + ', ' + choice.note,
        on: { click: function () { pickModel(choice.name, ctx); } },
      });
    }));
    var endpointInput = el('input', {
      class: 'spawner__input-text', type: 'text', value: state.endpoint, spellcheck: 'false',
      on: { change: function (event) { state.endpoint = event.target.value.trim() || DEFAULT_ENDPOINT; savePrefs(); } },
    });

    var head = el('header', { class: 'spawner__head' }, [
      el('div', {}, [
        el('h2', { class: 'spawner__title', text: 'Spawner' }),
        el('p', { class: 'spawner__sub', text: 'A private chat with the model on this computer. Nothing is sent anywhere. Works offline. Build ' + BUILD }),
      ]),
      el('div', { class: 'spawner__actions' }, [
        el('button', {
          class: 'spawner__btn', type: 'button', text: 'New thread',
          disabled: !state.messages.length || state.busy,
          on: { click: function () { clearThread(ctx); } },
        }),
      ]),
    ]);

    var bar = el('div', { class: 'spawner__bar' }, [
      el('label', { class: 'spawner__field' }, [el('span', { text: 'Model' }), modelInput]),
      el('label', { class: 'spawner__field' }, [el('span', { text: 'Server' }), endpointInput]),
      el('span', { class: 'spawner__scope-note', text: 'Offline, on this computer. Build ' + BUILD }),
    ]);

    var input = el('textarea', {
      class: 'spawner__ask', rows: '1', placeholder: 'Ask anything  (Enter to send, Shift+Enter for a new line)',
      value: state.draft,
      on: {
        input: function (event) { state.draft = event.target.value; },
        keydown: function (event) {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            ask(ctx);
          }
        },
      },
    });

    var send = el('button', {
      class: 'spawner__send', type: 'submit', text: state.busy ? 'Asking...' : 'Ask',
      disabled: state.busy || !state.draft.trim(),
    });
    var stopBtn = el('button', {
      class: 'spawner__btn spawner__btn--stop', type: 'button', text: 'Stop', hidden: !state.busy,
      on: { click: function () { stop(); if (ctx.render) ctx.render(); } },
    });

    var composer = el('form', {
      class: 'spawner__composer',
      on: {
        submit: function (event) { event.preventDefault(); ask(ctx); },
      },
    }, [input, el('div', { class: 'spawner__composer-actions' }, [stopBtn, send])]);

    var pane = el('div', { class: 'spawner' }, [head, bar]);
    pane.appendChild(scroll);
    pane.appendChild(composer);
    host.appendChild(pane);

    if (state.notice) pane.insertBefore(el('p', { class: 'spawner__notice', text: state.notice }), scroll);
    pin();
    return pane;
  }

  // The pane being opened is the moment to load the model, not the moment a question is asked.
  function renderAndWarm(host, ctx) {
    render(host, ctx);
    warm(ctx);
  }

  App.spawner = {
    render: renderAndWarm,
    stop: stop,
    state: state,
    __retrieve: retrieve,
  };
})(window.NoteApp);
