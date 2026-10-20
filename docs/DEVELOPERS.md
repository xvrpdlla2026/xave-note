> Technical documentation. For the friendly introduction for everyone else, see [../README.md](../README.md).

# Xave: a local-first note app on SQLite (WASM) + IndexedDB

A single-page note-taking app with **no backend, no account, and no build tooling needed to
run it**. Open `index.html` in a browser and it works — including offline.

- **Storage engine:** SQLite compiled to WebAssembly ([sql.js](https://sql.js.org) 1.10.3)
- **Persistence:** the SQLite database is written to IndexedDB after *every* write
- **Attachments:** uploaded files live in an IndexedDB blob store with metadata in SQLite, so a
  large video never inflates the database or slows a write
- **Portability:** the settings panel exports a genuine `.db` file that any SQLite tool can open

---

## Quick start

```
open index.html          # Windows:  start index.html
```

That is the whole install. `index.html` is self-contained: the CSS, the application code, the
sql.js engine, **and** the 640 KB SQLite WASM binary (inlined as a `data:` URI) are all embedded.

### Working on the source

The readable sources live in `src/`; `index.html` is generated.

```
node tools/build.js            # rebuild index.html from src/ + vendor/
node tools/build.js --refresh  # re-download the sql.js engine from cdnjs first
node tools/run-flow.js         # end-to-end test: create data, restart, verify it survived
node tools/verify-db.js x.db   # open an exported .db and print its contents

node tools/shots.js            # screenshot every UI state to tools/shots/ (light + dark)
node tools/trash-check.js      # trash panel, context menus and rail footer: behaviour + shots
node tools/browser-check.js "file:///.../index.html" \
  --preload=tools/shot-interact.js --eval="window.__CHECK__()"   # tree interaction checks

node tools/browser-check.js "file:///.../index.html" \
  --preload=tools/place-check.js --eval="window.__CHECK__()" --reload   # reload keeps your place
```

`tools/place-check.js` arranges a real place in the first session — a folder open, a note open
with text typed into it, the task list in front on one of its filters — reloads, and reports what
came back. Add `#poison` to the URL and it deletes the note behind the stored id first, so the
same run proves that a stale id is dropped rather than restored as an empty pane.

`tools/shots.js` seeds a **throwaway browser profile** with a realistic notebook (three
nesting levels, a long note, an empty note, an attachment) through the app's own `db` API,
then captures the editor, folder listing, search, settings and narrow-viewport states in
both themes. Your own database is never read or written, and the generated PNGs are
gitignored review artifacts. Each screenshot records the theme it was taken in and fails
if the page is not in that theme, because a mislabelled screenshot is worse than none.

`index.html` is generated rather than hand-written because of a hard browser constraint: on the
`file://` protocol, `fetch`/`XHR` to local files is blocked by CORS, so a `<script src="js/app.js">`
chain and a sibling `sql-wasm.wasm` cannot be loaded reliably. Inlining everything — WASM included —
is what makes a genuine double-click work offline.

---

## Layout

```
index.html                 generated, self-contained, ~1.1 MB  ← the app
src/index.html             markup shell (placeholders for CSS/scripts)
src/css/style.css          design tokens (light + dark) and every rule in the app
src/js/util.js             ids, debounce, escaping, formatting, toasts
src/js/storage.js          IndexedDB persistence + localStorage fallback   ← read this
src/js/db.js               schema, CRUD, and the single write funnel       ← and this
src/js/components.js       icons, dialogs, form controls (no app state)
src/js/ui.js               rendering only (no state, no database access)
src/js/app.js              state + event wiring
vendor/                    pinned sql.js 1.10.3 engine (wasm + glue)
tools/                     build and verification scripts
tools/shots.js             screenshot harness (visual review)
tools/shot-seed.js         the sample notebook that harness seeds
tools/shot-interact.js     behavioural checks for the tree, dialogs and form controls
tools/trash-check.js       behavioural checks + shots for the trash panel and context menus
```

### Interface components

There is no UI framework here, by design: the app must run by double-clicking one offline
file. `src/js/components.js` is the small component layer instead.

- **Dialogs** are real `<dialog>` elements, so focus trapping, Escape and scroll lock come
  from the browser rather than hand-rolled listeners. There is one dialog builder
  (`App.ui.dialog`) and two named wrappers, `App.ui.confirm` and `App.ui.prompt`. **No
  `window.prompt` or `window.confirm` remains anywhere in the app**; every rename and every
  delete goes through a styled dialog that names what is about to be destroyed.
- **Destructive dialogs state the concrete consequence** rather than asking "are you sure":
  the note dialog counts the words in the body, the folder dialog counts the notes, files
  and subfolders in the subtree, and focus lands on Cancel so Enter cannot delete by reflex.
- **The two bulk deletes ask for a typed phrase** (the workspace name; `delete everything`
  for the whole database) and keep the confirm button disabled until it matches.
- **The select is progressive enhancement**: a real `<select>` stays in the DOM as the value
  and the accessible name, with a styled button and listbox over it, supporting Up/Down,
  Home/End, Enter, Escape, type-ahead and `aria-activedescendant`-free `role="listbox"`
  semantics. `renderWorkspaceSelect` only rebuilds the widget when the option set actually
  changes, so an open dropdown is not closed by an unrelated re-render.
- **Form fields** put the label above the control and the message below it. Errors carry an
  icon and `aria-invalid`, never colour alone, and clear as soon as the user starts typing.
- **Every non-text control is a real form control wearing the app's clothes.** The select is
  a styled button and listbox over a hidden `<select>`; the checkbox and the segmented radio
  group are real `input`s whose painted box is CSS. That is what keeps Space, the arrow keys,
  `:checked`, `indeterminate` and the accessibility tree working without re-implementing any
  of them. `App.ui.field()` wraps any of them in the label-above / message-below shell, and
  attaches the label to the control it names.
- **The trash is a fullscreen panel, not a dialog.** Recovering data is a browsing task —
  scan a list, tick several rows, act once — and a 480px card in the middle of the screen is
  the wrong shape for browsing. It is still a `<dialog>` (`dialog--full`), so focus trapping,
  Escape and scroll lock remain the browser's job. It is also the one surface that repaints
  *in place*: selection, filters and the name filter run through `__refresh()`, so the list
  keeps its scroll position instead of being rebuilt under the cursor. **Fullscreen means edge
  to edge, not full measure.** The header, toolbar, list and footer bands span the viewport so
  their hairlines and tints do, but the column inside them stays on the app's 940px listing
  measure, because a row stretched across a 2560px monitor is a row nobody can read across.
  The gutter is one derived value (`max(20px, (100% - 940px) / 2)`) declared on the panel, so
  all four bands land on the same column at any width without a wrapper element.
- **Right-click is a first-class path.** Every row, card and the empty pane carry a
  `data-ctx` describing what they are; `contextmenu` reads that and builds the menu for the
  surface under the pointer. Menu items do not carry behaviour of their own — they synthesise
  a `[data-action]` button and click it, which is what stops the menu drifting out of step
  with the buttons. Text fields keep the browser's own menu, because cut/copy/paste and
  spellcheck live there.
- **The rail's floor** is `New note`, `Upload` and a live storage readout. The readout is a
  button, not a label: it opens the settings panel that can actually do something about what
  it is reporting, and it shows a quota meter or a plain file count depending on whether the
  browser has told us the quota (a percentage of an unknown quota would be an invented number).
  Its last line is the readout and the trash control side by side. The trash closes the rail's
  bottom-right corner, and because it is a flow item in that row rather than an overlay it
  cannot cover the readout it shares the line with — `tools/trash-check.js` asserts that the
  two share a line *and* never overlap, which is the pair of claims a floating control could
  not make.
- **Icons** are one inline set in `components.js`, 1.6 stroke on a 24px grid. They are
  hand-authored because an icon package cannot be a dependency of a zero-dependency offline
  file. Note the namespace trap in there: `document.createElement('svg')` produces an
  HTML-namespace element that parses, has geometry, computes styles, and never renders.
  A command that appears both in an action bar and in the right-click menu wears the *same*
  glyph in both (new note, folder, upload, pencil, layers, trash), because two pictures for
  one command is how a menu and the toolbar beside it start to read as different features.
  The glyph inherits the button's own colour, so the hierarchy — one filled primary, the rest
  quiet, the destructive action in the danger tone — carries into the icons for free.

Verification: `tools/shot-interact.js` asserts 41 behaviours across the tree, the select,
the dialog lifecycle, the type-to-confirm gate and field validation. `tools/trash-check.js`
asserts 76 more across the trash panel (multi-select, select-all, filtering, restore,
restore-with-ancestors, permanent delete and its confirm), the phone-width panel, the context
menus and the rail footer — and writes its own screenshots to `tools/shots/17..29`.


### Design notes

The interface is one token system, defined at the top of `src/css/style.css`:

- **Surfaces are tonal, not boxed.** The rail (`--bg`), the canvas (`--bg-canvas`) and a
  raised card (`--bg-raised`) are three steps of the same neutral, so zones read without a
  border around everything.
- **One accent, one neutral family, one radius scale** (4 / 8 / 12), one shadow tier per
  elevation. Dark mode redefines variables only — no rule is duplicated for it.
- **Scrollbars are part of the theme, not the browser's chrome.** One design covers every
  scroller in the app — rail, canvas, editor, dialog bodies, the panel list, the menus and the
  select listbox — as a 6px pill thumb inset in a transparent track, drawn from the same
  tokens as everything else, so dark mode redefines it with no second rule set. It used to be
  declared on `.tree` and `.main` alone, which left a default grey bar on every surface added
  since. Blink and WebKit get the `::-webkit-scrollbar` pseudo-elements, because they are the
  only way to inset a thumb inside its track; Firefox gets `scrollbar-width` / `scrollbar-color`
  behind `@supports not selector(::-webkit-scrollbar)`, because declaring `scrollbar-color`
  unconditionally switches Chrome 121+ off the legacy pseudo-elements and every WebKit rule
  above it stops applying — so the two mechanisms cannot be written side by side.
- **The sidebar tree is the densest surface and gets the most care.** A row is a four-track
  CSS grid — leading gutter, glyph/disclosure slot, label, trailing count — with every child
  assigned to an explicit track. Grid rather than flex because the columns have to line up
  down the whole tree, and because it removed the negative-margin hack that used to pull the
  chevron outside the row's padding. Tracks are never left to auto-placement: a note row has
  no chevron, and auto-placement slides its icon and label one track left.
- **The disclosure slot is part of the indent step, not an extra column.** A folder's
  chevron occupies the same 16px its children are indented by, and depth is expressed
  purely as leading padding:
  `inset + 7px + chevron + (depth × indent)`. That single rule is what makes a folder's icon
  and label share a column with the notes inside it. Treating the chevron as an extra column
  instead pushed every folder's label one slot right of its own children's labels, so the
  hierarchy read inside-out. `--tree-chevron` is therefore *derived* from `--tree-indent`
  rather than stated twice: changing one without the other slides every nested label out of
  its parent's column.
- **The leading cluster is tight on purpose.** The selection bar (2px, in the 7px lane at
  the row's edge), the chevron, its icon and the label are separated by 4px steps, so they
  read as one leading mark. Widening those steps to a single uniform 7px gap is what made
  the chevron look marooned between the bar and the icon.
- **Selection is the pill plus a 2px accent bar at the row's own leading edge**, with a
  weight shift and an accent-tinted icon, so the state never depends on colour alone. The
  bar is positioned at the row's edge rather than in an outer gutter: a gutter-drawn bar
  detaches from its own row as soon as the row is nested, ending up beside the indent guide
  instead of against the row it marks.
- **Every row speaks one language.** Folders, notes, files and the whole-workspace row all
  use the same tracks and the same trailing count; the differences are the icon, whether
  there is a chevron, and weight.
- **Rhythm is three tokens**, declared in the tree block: `--tree-gap` (3px) between adjacent
  rows, `--tree-group` (7px) opening a child group, and `--tree-break` (14px) below the
  "All notes" row. The second is why a parent's children cluster to their parent rather than
  sitting equidistant from it and from the next sibling folder; the third is why the
  workspace root reads as a section rather than as one more row. The whole ladder is tight on
  purpose — a 296px rail has to carry three levels, so depth is carried by indent, icon and
  weight rather than by air. Hovering a folder lights its whole subtree with it.
- **Clicking a folder row both selects it and opens or closes it.** The arrow is a 20px
  target and the row is the whole width, so requiring the arrow to see inside a folder makes
  the tree something you fight (a second click on the row closes it again). The arrow is
  kept as the precision control: it toggles *without* moving the selection, which is what
  you want while reorganising. The chevrons are `clip-path` shapes rather than the geometric
  glyphs, which fall back to a symbol font on Windows and render inconsistently.
- **A collapsed folder shows how many items it holds**, and the open note's age is the only
  row that carries a timestamp — the rest would be repeated noise. Right/left arrows open,
  close and step in and out.

`node tools/shots.js --geo` prints the rail's box geometry per row: the box of the row,
chevron, icon and label, plus whether the label is clipped. It is what caught both the
auto-placement bug and the chevron-as-extra-column bug, and it is how the alignment at each
indent level is verified rather than eyeballed.
- **Prose gets a narrower measure** than the rest of the canvas: the editor and its sticky
  footer share 760px, while listings use 940px.
- **The layout is light or dark from `prefers-color-scheme`**, overridable with the top-bar
  toggle, and set before first paint so there is no flash of the wrong palette.
- **The two top-bar controls have to be tellable apart at 16px**, and the glyph pair that
  achieves it is not the obvious one. `settings` is drawn as two control rails with their
  knobs; the theme control is the `sun` / `moon` pair. Three gear attempts failed on the same
  constraint — a 24px viewBox rendered at 16px leaves about 1.8px of valley between eight
  teeth after a 1.6 stroke, so every gear came out a starburst or a pinwheel, and the version
  before that (eight radial stalks) was the same visual sentence as the sun itself.
  `tools/trash-check.js` asserts the two glyphs' path data differ, because "they look
  different" is not something a human should have to re-check after every icon edit.
- **A closed dialog must not paint**, and the app now states that itself
  (`dialog:not([open]) { display: none }`). The UA stylesheet hides a closed `<dialog>`
  through a rule with no author counterpart, so adding `display: flex` to `.dialog` — which
  the fullscreen panel needed, to get a header/body/footer stack — silently defeated it and
  rendered the closed settings panel in the middle of the page. `tools/trash-check.js` asserts
  the resting state for exactly this reason: every other screenshot in that file shows an
  *open* dialog, which is why the regression survived the first pass.
- **The trash is a round control in the rail's bottom-right corner**, not a row in the
  Contents list. It is not part of the column of rows above it, which is why it is the one
  thing in this interface that breaks the 4/8/12 radius scale — a square there would read as
  one more button in the rail. It used to float 96px *above* the floor, which left it hanging
  in the tree's empty space with nothing to belong to; it now closes the floor's last line, so
  it sits on the edge the eye leaves the rail through and its relationship with the readout
  beside it is a flex fact rather than a bottom offset kept in sync by hand. Its badge carries
  a number rather than a dot, it is hidden while the trash is empty (an empty trash is not a
  destination), and its count is database-wide: the first version summed `state.workspaces`,
  so with the user looking at a clean workspace the badge read 0 while the panel behind it
  showed 3.
- **One file, one job.** `components.js` knows nothing about notes; `ui.js` renders plain data
  and never touches the database; `app.js` is the only module that mutates state. The trash
  panel follows that split: `ui.js` owns the panel's markup, `app.js` owns what a tick means.


Scripts are loaded as **classic** scripts, not ES modules, because `type="module"` is also
blocked on `file://`. Each file attaches to one global `NoteApp` namespace.

---

## 1. How the auto-save-to-IndexedDB mechanism works

There is no save button because there is no unsaved state. Every mutation in `db.js` goes
through one funnel, `write()`:

```js
// src/js/db.js — the only path that changes data
return App.storage.save(db.export()).then(...)
```

Concretely, for each write:

1. **Execute the SQL.** `BEGIN` → parameterised statement(s) → `COMMIT`. On any error the
   transaction is rolled back, so the snapshot can never contain a half-applied change.
2. **Serialise.** `db.export()` returns the *entire* database as a `Uint8Array`.
3. **Store.** `storage.save()` copies those bytes and `put`s them into IndexedDB under one
   fixed key (`sqlite-snapshot-v1`, database `note-app`, object store `kv`).

On page load `db.init()` calls `storage.load()`, and if bytes come back it constructs
`new SQL.Database(bytes)` — the exact state from the last write. First run instead creates an
empty database, applies migrations, and seeds a starter workspace.

Details that matter:

- **Writes are queued, not raced.** sql.js is synchronous but persistence is async, so two
  rapid writes (a debounced autosave landing next to a folder rename) are executed and stored
  in order rather than overwriting each other's snapshot.
- **Bytes are copied before storing.** `db.export()` hands out a view onto the WASM heap, which
  the engine reuses on the next export — IndexedDB would otherwise be handed memory that a later
  write mutates. Same reason `export()` is used for the `.db` download.
- **Prepared statements are explicitly freed.** sql.js caches every statement internally until
  `Database.close()`, so each read frees its statement to avoid leaking WASM memory.
- **Typing is debounced by 500 ms** (`util.debounce`). The debounce has `.flush()`, which is
  called when you switch notes and on `beforeunload`/`visibilitychange` — that is what stops the
  last half-second of typing from being lost.
- **`navigator.storage.persist()` is requested once per install** so the browser is less likely
  to evict the data under storage pressure. A refusal is normal (private windows) and is not
  treated as an error.
- **Foreign keys are enabled per connection.** SQLite defaults them off; without
  `PRAGMA foreign_keys = ON`, `ON DELETE CASCADE` silently does nothing and deletes leave orphans.

### Why the WAL/transaction ordering is safe

Each write is one SQLite transaction. If the process dies mid-write, IndexedDB still holds the
previous complete snapshot — you lose the change in flight, never the database.

---

## 2. Migrating to a real desktop SQLite file later

This is the easy part, because **the stored bytes already are a SQLite file** — the same format
`sqlite3` writes, page for page. No conversion or export step is required for the *format*.

**Step 1 — get the file.** Settings (⚙) → **Export .db file**. That writes `notes-<timestamp>.db`
straight from `db.export()`, byte for byte.

**Step 2 — use it.** Verify and open it like any other database:

```bash
sqlite3 notes-2026-09-25.db ".tables"
# files  folders  notes  workspaces

sqlite3 notes-2026-09-25.db "SELECT title, updated_at FROM notes ORDER BY updated_at DESC;"
```

`tools/verify-db.js` does the same thing programmatically (it checks the `SQLite format 3`
header, lists tables, runs `PRAGMA foreign_key_check`, and prints every row). A real export from
the test suite looks like:

```
header: "SQLite format 3" (valid SQLite)
tables: files, folders, notes, workspaces
user_version: 2
foreign_key_check: clean
workspaces: 2 row(s)   folders: 3 row(s)   notes: 2 row(s)   files: 1 row(s)
  - ... | flow-upload.png | application/octet-stream | <blob 8 bytes> | 8 | ...
```

Uploaded attachments come along for the ride. In the live browser they are parked in the
IndexedDB blob store rather than inside the database file, but the export inlines them first, so
the `.db` you get is complete and `blob_data` is an ordinary BLOB you can read out with any
SQLite client:

```sql
SELECT writefile('/tmp/' || filename, blob_data) FROM files;
```

**Step 3 — if you are also changing character encoding.** All ids are UUID text and all
timestamps are ISO-8601 UTC, so nothing needs re-typing on the way over. The schema is plain
SQLite with no sql.js-specific types.

**Step 4 — safer re-migration.** To pull changes back out of the browser later, do it *in the
app* rather than by scraping IndexedDB: the snapshot blob under the `sqlite-snapshot-v1` key is
exactly the file you want, but its on-disk representation is Chromium's internal LevelDB format
and is not directly readable. Use the export button, or `storage.load()` from the console:

```js
// in the browser console, on the app page
const { bytes } = await NoteApp.storage.load();
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.sqlite3' }));
a.download = 'notes.db';
a.click();
```

**Schema versioning.** `PRAGMA user_version` is currently `2` (version 2 added the
`deleted_at` columns and their indexes, which is what the trash reads), and `MIGRATIONS` in
`db.js` is an ordered array — append a new array entry to evolve the schema, and both existing
browser databases and the desktop file migrate on next open. Note that migration 2 uses
`ALTER TABLE ... ADD COLUMN` with no guard: it is only ever applied to a database whose
`user_version` is still 1, which is what makes the unguarded form safe. A fresh database runs
both migrations in order.

---

## 3. Limitations you should know about

**File size and memory**

- `db.export()` serialises the **whole database** on every write, and sql.js holds the whole
  database in WASM memory. Cost is proportional to total database size, not to the size of the
  change. Attachment payloads are deliberately *not* in the database, so uploads do not move this
  number: 24 MB of video leaves the database at 168 KB, and a note saved straight afterwards
  still snapshots in about 5 ms. Text-heavy databases are the ones to watch, and they stay
  comfortable into the tens of MB.
- Attachments are parked in the IndexedDB blob store and handed to the browser as Blobs, so an
  upload never copies the file into memory and a video preview streams through the media element.
  Two paths still walk payload bytes: **Settings then Export** inlines every payload into the
  exported `.db`, which is what makes a backup complete, and a vault conversion moves payloads
  in and out of the database once per toggle.
- A database that once held payloads inline keeps their pages free rather than gone, so the
  sweep reads the freelist on load and vacuums whenever a meaningful amount is free. A notebook
  that grew under the old layout returns to its metadata size on the next load.
- Uploading a file the folder already holds is detected by comparing the size plus the first and
  last 64 KB, not every byte. Files that agree on all three are reported as duplicates, which is
  the intended reading of "you already uploaded this".
- Every keystroke burst writes a full snapshot. Debouncing is what keeps this cheap — do not
  drop it below ~250 ms.

**Browser quota and durability**

- Quota is a share of free disk, and `navigator.storage.estimate()` in Settings shows it. Note
  that the *quota* can look enormous while the browser still reserves the right to evict data.
- `navigator.storage.persist()` is the mitigation, and it is often **refused** — notably in
  private/incognito windows, where everything is deleted when the window closes. Settings shows
  whether it was granted.
- Private windows aside, IndexedDB data can be removed by clearing site data, by "clear browsing
  data", or by the browser under storage pressure. **This is a single copy of your data. Export a
  `.db` occasionally if it matters.**
- Chromium does not flush IndexedDB to disk immediately, so a *hard* process kill can lose the
  most recent commits. Normal tab/window closing is fine. (This is also why the test suite
  restarts the browser within one process — separate processes see false data loss.)

**`file://` quirks**

- The app is engineered to work from `file://`, but that origin is special: it is opaque, so some
  browsers treat every local file as its own storage area. Chromium and Firefox both keep
  IndexedDB for `file://`, which is what the app relies on.
- `localStorage` is capped at roughly 5 MB, so it is only a fallback: if IndexedDB cannot be
  opened, the app stores the base64 snapshot there and says so in a toast. Attachments will hit
  that ceiling almost immediately — treat the fallback as "your notes, but not your files", and
  move to a local web server if you see it.
- Opening a `blob:` URL in a new tab is blocked from `file://` in Chrome; the "Open in new tab"
  button detects that and downloads instead.
- Serving the folder over `http://localhost` (e.g. `python -m http.server`) removes all of these
  caveats and is the recommended setup if you plan to store many files.

**Feature limits (by design, not oversight)**

- The editor is a rich surface (contenteditable): bold, italic, yellow highlight, bullet   lists, checkboxes and clear-formatting, with Tab-insert indentation. Bodies store HTML; notes written before formatting existed render as plain text, and card snippets, search rows, word counts and clipboard copies all read the plain text underneath.
- Notes link to each other with `[[note title]]`, rendered as pills: typing `[[` offers
  completions, clicking (or Enter on) a pill opens its note, links and backlinks list
  under the editor, a link with no note behind it offers to create one, and renaming a
  note rewrites the links that named it. A link is removed from its chip's ×, from the
  pill's right-click menu, or with Backspace over the pill — the linked note itself is
  never touched. Links resolve by title, so they survive everything except the rename
  of an exact-spelling match made while locked.
- Search is a SQL `LIKE` scan over titles, bodies and file names. Fine for thousands of notes;
  there is no full-text index (SQLite's FTS5 is not compiled into the stock sql.js build).
- Open tabs pin (compact, survive bulk closes), reorder by drag, jump back with `Alt+Q`,
  and reopen after closing via the strip menu or `Alt+Shift+T`. The strip's `+`, or `Alt+N`,
  opens a blank tab that the next note, file or upload takes over, which is the only way to
  start one on purpose. `Ctrl+Tab` and `Ctrl+T` belong to the browser and never reach the
  page, so `Alt+Q` and `Alt+N` are the substitutes.
- The file pane previews whatever the browser renders natively: images, and video or audio with
  the browser's own controls. Anything else, and any file whose bytes cannot be read, shows a card
  with Download and Open instead.
- Search, and the sidebar, are scoped to the current workspace. There is no cross-workspace view.
- Deleting a folder deletes its whole subtree, after a confirmation that counts what will go.
- Delete is a **soft delete**: the row is stamped with `deleted_at` and disappears from every
  list, until it is restored or permanently removed from the trash panel. Restoring a note or
  file whose folder is also deleted brings the folder back with it, because restoring the item
  alone would leave it live but invisible in every query. Purging is the only irreversible
  action in the app, and it re-serialises the whole database once per item — a 200-item purge
  is 200 snapshots, which is why it shows a busy dialog rather than looking frozen.
- Nothing is swept automatically: the trash has no age limit and never empties itself.
- No conflict resolution: two tabs open on the same data will each hold their own in-memory copy,
  and the last snapshot written wins. Use one tab.

---

## Offline

Everything the app needs is inside `index.html`: SQLite is compiled to WebAssembly and inlined as
a data URI, styles and icons are inline, and there is no font, script or CDN fetch anywhere in
`src/` (the only URLs in there are SVG namespace strings and a data-URI favicon). Open the file
with the network down and the app boots, reads and writes.

- `sw.js` is regenerated by `tools/build.js` and its cache name carries the build hash. It
  precaches the shell on install, serves navigations network-first with the cached copy as the
  fallback, and everything else cache-first, so a reload works offline and a new build replaces
  the cache on the next visit.
- Attachments sit in IndexedDB next to the database snapshot, so files uploaded offline stay
  readable offline. Nothing opens a socket after boot.
- `navigator.storage.persist()` is requested at boot, because a notebook the browser is free to
  evict is not durable; Settings reports whether it was granted.
- Service workers are unavailable on `file://`, so double-clicking `index.html` gives you the app
  without the installable shell. Serve the folder (`node tools/serve.js`, or any static server)
  for the offline-capable, installable version.

---

## Testing

`tools/run-flow.js` is the real acceptance test. It drives the actual `index.html` in headless
Chromium over the DevTools Protocol and checks the storage claims end to end:

1. **Round A** — fresh profile: create a workspace, nested folders, a note typed through the
   editor (exercising the 500 ms autosave), and a BLOB upload.
2. **Round B** — close the browser, relaunch on the same profile, and assert the data came back.
3. **Ground truth** — export the restored database and open it with sql.js *in Node*, with no app
   code involved, confirming the migration path.

Current result: all seven assertions pass (workspace, folder nesting, note, note body, attachment
bytes, search index, and sidebar rendering from the restored database).

`tools/browser-check.js` is the reusable harness — it exists because `--dump-dom` destroys the page
as soon as virtual time expires, which truncates WASM init and IndexedDB work and produces
misleading answers.

The other suites drive the same harness over one feature each and all report pass counts:

| Suite | Checks | Covers |
| --- | --- | --- |
| `tools/run-flow.js` | 7 assertions, 2 rounds | create, reload, ground-truth export |
| `tools/order-check.js` | 112 | list order, columns, drag and drop |
| `tools/vault-check.js` | 133 | encryption on/off, locking, leak scans, failures |
| `tools/trash-check.js` | 83 of 86 | soft delete, restore, purge (3 known rail-footer failures) |
| `tools/tasks-check.js` | 5 known failures | task views, recurrence |

---

## Dependency

Only one, and it is vendored: **sql.js 1.10.3** (MIT), which embeds SQLite (public domain).
Pinned in `tools/build.js` and committed under `vendor/` so the build works with no network.
