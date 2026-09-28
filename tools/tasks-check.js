#!/usr/bin/env node
/**
 * tasks-check.js — behavioural + visual check for the task list.
 *
 *   node tools/tasks-check.js
 *
 * Drives the real index.html in headless Chromium over the DevTools protocol, in a
 * throwaway profile seeded by tools/shot-seed.js (so the user's own database is never
 * touched). Everything here goes through the app's own surfaces: the header's Tasks button
 * is clicked,
 * the quick-add field is typed into and Enter is pressed on it, the checkbox is clicked,
 * the edit dialog is filled in and its own submit button is pressed. Nothing is asserted
 * from the database alone — a check that read only db.js would pass on a pane that never
 * drew anything.
 *
 * Writes PNGs to tools/shots/: 33-tasks-list.png, 34-tasks-dark.png, 35-tasks-mobile.png.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const url = require("url");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "index.html");
const OUT = path.join(__dirname, "shots");

if (!fs.existsSync(APP)) {
  console.error("index.html not found - run node tools/build.js first");
  process.exit(2);
}

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
];
const browser = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!browser) {
  console.error("no Chromium browser found");
  process.exit(2);
}

const appUrl = url.pathToFileURL(APP).href;
const profile = path.join(os.tmpdir(), "noteapp-tasks-profile-" + process.pid);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRELOAD = fs.readFileSync(path.join(__dirname, "shot-seed.js"), "utf8");
// A page-level error is a failure of this run, not a note in the log: the app has to boot
// clean, and an exception thrown inside a render is exactly what a screenshot cannot show.
const RECORDER = [
  "window.__SHOT_ERRORS__ = [];",
  "window.addEventListener(\"error\", function (e) { window.__SHOT_ERRORS__.push(\"error: \" + e.message); });",
  "window.addEventListener(\"unhandledrejection\", function (e) {",
  "  var r = e.reason;",
  "  window.__SHOT_ERRORS__.push(\"rejection: \" + ((r && r.message) || r));",
  "});",
].join("\n");

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
}

// Interpolation in this file is built by concatenation rather than by template literals,
// because every page-side expression below is itself a multi-line string: nesting one
// template inside another is how a harness starts needing escapes instead of checks.
const results = [];
const log = (name, value, expected) => {
  const ok = expected === undefined ? true : JSON.stringify(value) === JSON.stringify(expected);
  results.push({ name, value, expected, ok });
  console.log((ok ? "ok  " : "FAIL") + " " + name + " = " + JSON.stringify(value)
    + (ok ? "" : " (expected " + JSON.stringify(expected) + ")"));
};

const MIDDOT = String.fromCharCode(183);
const ELLIPSIS = String.fromCharCode(8230);
(async () => {
  const port = 9950 + Math.floor(Math.random() * 40);
  const child = spawn(browser, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--force-device-scale-factor=1",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=" + port,
    "about:blank",
  ], { stdio: "ignore" });

  let cdp = null;
  const notes = [];
  try {
    let targets = null;
    for (let i = 0; i < 80 && !targets; i++) {
      try {
        const res = await fetch("http://127.0.0.1:" + port + "/json/list");
        if (res.ok) targets = await res.json();
      } catch { /* not up yet */ }
      if (!targets) await sleep(250);
    }
    const page = (targets || []).find((t) => t.type === "page");
    if (!page) throw new Error("no page target");

    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELOAD });

    // Polling for readiness beats a fixed sleep, because the reload near the end of this
    // file would otherwise need its own tuned constant.
    const settle = async (timeoutMs = 25000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          const up = await cdp.evaluate("!!(window.NoteApp && window.NoteApp.app && window.NoteApp.app.ready)");
          if (up) {
            await cdp.evaluate("window.NoteApp.app.ready()");
            await sleep(900);
            return true;
          }
        } catch { /* navigating */ }
        await sleep(300);
      }
      return false;
    };

    await cdp.send("Page.navigate", { url: appUrl });
    await settle();
    await cdp.evaluate("window.NoteApp.app.ready().then(function(){ return window.__SEED__(); })");
    await sleep(1200);

    // Values that page-side code needs are parked on globals rather than interpolated into
    // an expression from Node: the expression strings below are already multi-line, and one
    // more layer of quoting is one more place for a harness to be wrong about itself.
    const setTheme = async (theme) => {
      await cdp.evaluate("window.__THEME__ = " + JSON.stringify(theme));
      await cdp.evaluate(`(function(){
        document.documentElement.setAttribute("data-theme", window.__THEME__);
        window.NoteApp.prefs.set("theme", window.__THEME__);
        return document.documentElement.getAttribute("data-theme");
      })()`);
      await sleep(260);
    };
    const shot = async (name, w, h, theme) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(460);
      const live = await cdp.evaluate("document.documentElement.getAttribute(\"data-theme\")");
      if (theme && live !== theme) throw new Error(name + ": page is " + live + ", expected " + theme);
      const r = await cdp.send("Page.captureScreenshot", { format: "png" });
      const out = path.join(OUT, name + ".png");
      fs.writeFileSync(out, Buffer.from(r.data, "base64"));
      notes.push(name + ".png  " + w + "x" + h + "  " + live + "  " + Math.round(fs.statSync(out).size / 1024) + " KB");
    };

    // ---------------------------------------------------------------- the fixture
    // Six tasks — one per bucket the pane documents, plus one already finished: overdue,
    // due today with a time, tomorrow, in five days, undated, and done. Every date is built
    // from LOCAL midnight, because that is what the app's own buckets are measured from: a
    // fixture built from UTC midnight lands in a different bucket for readers far enough
    // from Greenwich, and the check would then be measuring the harness.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      function dayIso(offset, hour, minute) {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        if (hour !== undefined && hour !== null) d.setHours(hour, minute || 0, 0, 0);
        return d.toISOString();
      }
      var ids = {};
      function add(key, title, fields) {
        return App.db.createTask(ws, null, title, fields).then(function (t) { ids[key] = t.id; return t; });
      }
      return add("overdue", "Overdue invoice", { due_at: dayIso(-1), due_has_time: 0 })
        .then(function () { return add("today", "Today standup", { due_at: dayIso(0, 9, 30), due_has_time: 1 }); })
        .then(function () { return add("tomorrow", "Tomorrow review", { due_at: dayIso(1), due_has_time: 0 }); })
        .then(function () { return add("week", "Next week planning", { due_at: dayIso(5), due_has_time: 0 }); })
        .then(function () { return add("none", "Someday idea", {}); })
        .then(function () { return add("done", "Finished thing", {}); })
        .then(function () { return App.db.setTaskDone(ids.done, true); })
        .then(function () { return App.app.render(); })
        .then(function () {
          window.__FIX__ = {
            ids: ids, ws: ws,
            tomorrow: ids.tomorrow,
            week: ids.week,
            plusThreeDate: dayIso(3).slice(0, 10)
          };
          return window.__FIX__.ids;
        });
    })()`);
    const ids = await cdp.evaluate("window.__FIX__.ids");
    log("fixture.created", Object.keys(ids).length, 6);

    // --------------------------------------------------- (a) the header entry point
    const entry = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var row = document.querySelector('[data-action="view-tasks"]');
      if (!row) return { exists: false };
      // It lives with the view-level controls at the right end of the header, which is after
      // the search field. Anchoring that to the search field rather than to the settings dialog
      // keeps the assertion about ORDER in the header, not about which buttons exist.
      var actions = row.closest(".topbar__actions");
      var search = document.getElementById("search");
      return {
        exists: true,
        label: (row.querySelector(".view-btn__label") || {}).textContent,
        count: (row.querySelector(".tree__badge") || {}).textContent,
        glyph: !!row.querySelector("svg.tree__glyph"),
        tag: row.tagName,
        inTheHeader: !!actions && !!(search && (search.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)),
        open: App.db.countOpenTasks(App.app.state.workspaceId),
        aria: row.getAttribute("aria-label")
      };
    })()`);
    log("view.exists", entry.exists, true);
    log("view.isARealButton", entry.tag, "BUTTON");
    log("view.label", entry.label, "Tasks");
    log("view.hasAGlyph", entry.glyph, true);
    log("view.sitsInTheHeader", entry.inTheHeader, true);
    log("view.countsOpenWork", entry.count, String(entry.open));
    log("view.countIsTheFiveOpenFixtureTasks", entry.open, 5);
    console.log("     Tasks button aria-label: " + JSON.stringify(entry.aria));

    await cdp.evaluate("document.querySelector(\"[data-action=\\\"view-tasks\\\"]\").click()");
    await sleep(560);
    const opened = await cdp.evaluate(`(function(){
      return {
        view: window.NoteApp.app.state.view,
        title: (document.querySelector("#main .pane-head__title") || {}).textContent,
        sub: (document.querySelector("#main .pane-head__sub") || {}).textContent,
        viewActive: !!document.querySelector(".view-btn.is-active"),
        quickAdd: !!document.getElementById("task-add"),
        focused: document.activeElement ? document.activeElement.getAttribute("data-action") : null
      };
    })()`);
    log("view.opensTheTasksPane", opened.view, "tasks");
    log("pane.title", opened.title, "Tasks");
    log("pane.subtitleNamesOpenAndOverdue", opened.sub, "5 open " + MIDDOT + " 1 overdue");
    log("view.showsTheActiveState", opened.viewActive, true);
    log("pane.quickAddIsPresent", opened.quickAdd, true);
    log("view.keepsFocusAfterTheRepaint", opened.focused, "view-tasks");

    // ----------------------------------------------- reading the list and the filters
    const readList = () => cdp.evaluate(`(function(){
      var groups = Array.prototype.map.call(document.querySelectorAll("#main .task-group"), function (g) {
        var head = g.querySelector(".pane-section");
        return {
          bucket: g.getAttribute("data-bucket"),
          label: head.querySelector("span").textContent,
          count: (head.querySelector(".pane-section__count") || {}).textContent,
          titles: Array.prototype.map.call(g.querySelectorAll(".task-row__title"), function (t) { return t.textContent; })
        };
      });
      var badges = {};
      Array.prototype.forEach.call(document.querySelectorAll("#main .segmented__item"), function (item) {
        badges[item.querySelector(".segmented__input").value] = (item.querySelector(".segmented__badge") || {}).textContent;
      });
      return {
        groups: groups,
        titles: Array.prototype.map.call(document.querySelectorAll("#main .task-row__title"), function (t) { return t.textContent; }),
        badges: badges,
        view: (document.querySelector("#main .segmented__input:checked") || {}).value,
        viewCount: (document.querySelector(".view-btn .tree__badge") || {}).textContent
      };
    })()`);

    const chooseView = async (value) => {
      await cdp.evaluate("window.__VIEW__ = " + JSON.stringify(value));
      const clicked = await cdp.evaluate(`(function(){
        var input = document.querySelector('#main .segmented__input[value="' + window.__VIEW__ + '"]');
        if (!input) return "missing";
        input.click();
        return "clicked";
      })()`);
      if (clicked === "missing") throw new Error("no view filter for " + value);
      await sleep(360);
      return readList();
    };

    // ----------------------------------------------------------- (e) the buckets
    const all = await readList();
    log("buckets.areTheDocumentedFiveInOrder",
      all.groups.map((g) => g.label),
      ["Overdue", "Today", "Tomorrow", "Next 7 days", "No date"]);
    log("buckets.eachHoldsItsOwnTask",
      all.groups.map((g) => g.titles),
      [["Overdue invoice"], ["Today standup"], ["Tomorrow review"], ["Next week planning"], ["Someday idea"]]);
    log("buckets.headingsCarryTheirCounts", all.groups.map((g) => g.count), ["1", "1", "1", "1", "1"]);
    log("buckets.theDoneTaskIsNotInTheOpenList", all.titles.indexOf("Finished thing"), -1);
    log("filters.everyBadgeIsCorrect", all.badges, { all: "5", today: "2", upcoming: "2", done: "1" });

    // -------------------------------------------------------- (d) each view filter
    const today = await chooseView("today");
    log("view.todayIsSelected", today.view, "today");
    log("view.todayShowsOverdueAndToday", today.titles, ["Overdue invoice", "Today standup"]);
    log("view.todayGroupsOnlyWhatItHolds", today.groups.map((g) => g.label), ["Overdue", "Today"]);

    const upcoming = await chooseView("upcoming");
    log("view.upcomingIsSelected", upcoming.view, "upcoming");
    log("view.upcomingStartsTomorrow", upcoming.titles, ["Tomorrow review", "Next week planning"]);
    log("view.upcomingGroupsOnlyWhatItHolds", upcoming.groups.map((g) => g.label), ["Tomorrow", "Next 7 days"]);

    const doneView = await chooseView("done");
    log("view.doneIsSelected", doneView.view, "done");
    log("view.doneShowsOnlyFinishedWork", doneView.titles, ["Finished thing"]);
    log("view.doneIsOneGroup", doneView.groups.map((g) => g.label), ["Done"]);

    const backToAll = await chooseView("all");
    log("view.backToAll", backToAll.titles.length, 5);

    // ------------------------------------------------------------- (b) quick add
    const addVia = async (text) => {
      await cdp.evaluate("window.__TEXT__ = " + JSON.stringify(text));
      await cdp.evaluate(`(function(){
        var f = document.getElementById("task-add");
        f.focus();
        f.value = window.__TEXT__;
        f.dispatchEvent(new Event("input", { bubbles: true }));
        f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        return "sent";
      })()`);
      await sleep(900);
      return cdp.evaluate(`(function(){
        return {
          focused: document.activeElement ? document.activeElement.id : null,
          value: (document.getElementById("task-add") || {}).value,
          draft: window.NoteApp.app.state.taskDraft,
          titles: Array.prototype.map.call(document.querySelectorAll("#main .task-row__title"), function (t) { return t.textContent; }),
          viewCount: (document.querySelector(".view-btn .tree__badge") || {}).textContent,
          stored: window.NoteApp.db.listTasks(window.NoteApp.app.state.workspaceId, {}).filter(function (t) { return t.title === window.__TEXT__; }).length
        };
      })()`);
    };

    const added = await addVia("Book the room");
    log("quickAdd.createsTheTask", added.stored, 1);
    log("quickAdd.appearsInTheList", added.titles.indexOf("Book the room") !== -1, true);
    log("quickAdd.keepsFocusInTheField", added.focused, "task-add");
    log("quickAdd.emptiesTheField", added.value, "");
    log("quickAdd.clearsTheDraft", added.draft, "");
    log("quickAdd.viewCountFollows", added.viewCount, "6");

    const escaped = await cdp.evaluate(`(function(){
      var f = document.getElementById("task-add");
      f.focus();
      f.value = "half typed";
      f.dispatchEvent(new Event("input", { bubbles: true }));
      f.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return {
        value: f.value,
        draft: window.NoteApp.app.state.taskDraft,
        view: window.NoteApp.app.state.view,
        rows: document.querySelectorAll("#main .task-row").length
      };
    })()`);
    log("quickAdd.escapeClearsTheField", escaped.value, "");
    log("quickAdd.escapeClearsTheDraft", escaped.draft, "");
    log("quickAdd.escapeLeavesThePaneAlone", escaped.view, "tasks");
    log("quickAdd.escapeCreatesNothing", escaped.rows, 6);
    // A task typed and then abandoned must not come back on the next repaint, which is
    // what the draft in app state exists to guarantee in the other direction.
    const clearedDraft = await cdp.evaluate(`(function(){
      window.NoteApp.app.render();
      return (document.getElementById("task-add") || {}).value;
    })()`);
    log("quickAdd.anAbandonedDraftStaysGone", clearedDraft, "");

    await setTheme("light");
    await shot("33-tasks-list", 1440, 900, "light");
    await setTheme("dark");
    await shot("34-tasks-dark", 1440, 900, "dark");
    await setTheme("light");

    // --------------------------------------------- (c) the checkbox and its counts
    const toggled = await cdp.evaluate(`(function(){
      var row = Array.prototype.filter.call(document.querySelectorAll("#main .task-row"), function (r) {
        return r.querySelector(".task-row__title").textContent === "Someday idea";
      })[0];
      if (!row) return "missing";
      row.querySelector(".checkbox__input").click();
      return "clicked";
    })()`);
    if (toggled !== "clicked") throw new Error("could not find the task row to tick: " + toggled);
    await sleep(900);
    const afterToggle = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var finished = App.db.listTasks(ws, { view: "done" }).filter(function (t) { return t.title === "Someday idea"; })[0];
      var badges = {};
      Array.prototype.forEach.call(document.querySelectorAll("#main .segmented__item"), function (item) {
        badges[item.querySelector(".segmented__input").value] = (item.querySelector(".segmented__badge") || {}).textContent;
      });
      return {
        stillOpen: App.db.listTasks(ws, { view: "all" }).some(function (t) { return t.title === "Someday idea"; }),
        done: finished ? finished.done : null,
        stamped: finished ? !!finished.done_at : false,
        badges: badges,
        viewCount: (document.querySelector(".view-btn .tree__badge") || {}).textContent,
        onScreen: Array.prototype.map.call(document.querySelectorAll("#main .task-row__title"), function (t) { return t.textContent; })
      };
    })()`);
    log("toggle.leavesTheOpenList", afterToggle.stillOpen, false);
    log("toggle.marksItDone", afterToggle.done, 1);
    log("toggle.stampsWhenItWasFinished", afterToggle.stamped, true);
    log("toggle.isGoneFromTheOpenRows", afterToggle.onScreen.indexOf("Someday idea"), -1);
    log("toggle.badgesFollow", afterToggle.badges, { all: "5", today: "2", upcoming: "2", done: "2" });
    log("toggle.viewCountFollows", afterToggle.viewCount, "5");

    // Unticking it has to be possible from the same box, and has to clear the stamp: a
    // finished task with a completion date it no longer has is a lie about the week.
    await chooseView("done");
    await cdp.evaluate(`(function(){
      var row = Array.prototype.filter.call(document.querySelectorAll("#main .task-row"), function (r) {
        return r.querySelector(".task-row__title").textContent === "Someday idea";
      })[0];
      if (row) row.querySelector(".checkbox__input").click();
      return "clicked";
    })()`);
    await sleep(900);
    const undone = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.listTasks(App.app.state.workspaceId, { view: "all" }).filter(function (x) { return x.title === "Someday idea"; })[0];
      return { open: !!t, done_at: t ? t.done_at : "missing" };
    })()`);
    log("toggle.untickingPutsItBack", undone.open, true);
    log("toggle.untickingClearsTheStamp", undone.done_at, null);
    await chooseView("all");

    // ------------------------------------------- (f) the edit dialog round-trips
    // A list that cannot scroll cannot prove that scroll is kept, so the fixture is padded
    // until the pane overflows. Every write re-serialises the whole database, so this stays
    // small: 24 rows is well past a 900px viewport of 38px rows.
    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      var chain = Promise.resolve();
      for (var i = 1; i <= 24; i++) {
        chain = chain.then(function (n) {
          return function () { return App.db.createTask(ws, null, "Filler " + n, {}); };
        }(i));
      }
      return chain.then(function () { return App.app.render(); });
    })()`);
    await sleep(420);

    const scrollable = await cdp.evaluate(`(function(){
      var main = document.getElementById("main");
      main.scrollTop = 420;
      return { top: main.scrollTop, overflows: main.scrollHeight > main.clientHeight + 40 };
    })()`);
    log("edit.theListOverflowsSoScrollIsMeaningful", scrollable.overflows, true);
    log("edit.scrolledBeforeEditing", scrollable.top > 0, true);

    const openedDialog = await cdp.evaluate(`(function(){
      var row = document.querySelector('#main .task-row[data-id="' + window.__FIX__.tomorrow + '"]');
      if (!row) return "missing";
      row.querySelector(".task-row__title").click();
      return "clicked";
    })()`);
    if (openedDialog !== "clicked") throw new Error("the task row to edit is not on screen");
    await sleep(800);

    const dialogShape = await cdp.evaluate(`(function(){
      var d = document.querySelector("dialog[open]");
      if (!d) return { open: false };
      return {
        open: true,
        title: (d.querySelector(".dialog__title") || {}).textContent,
        focus: document.activeElement ? document.activeElement.id : null,
        hasTitle: !!d.querySelector("#task-title"),
        hasNotes: !!d.querySelector("#task-notes"),
        hasDate: !!d.querySelector("#task-due"),
        hasTime: !!d.querySelector("#task-time"),
        hasToggle: !!d.querySelector("#task-allday"),
        selects: d.querySelectorAll("select.select__native").length,
        timeDisabled: d.querySelector("#task-time").disabled
      };
    })()`);
    log("edit.dialogOpens", dialogShape.open, true);
    log("edit.dialogIsNamed", dialogShape.title, "Edit task");
    log("edit.focusLandsOnTheTitleField", dialogShape.focus, "task-title");
    log("edit.hasEveryField",
      [dialogShape.hasTitle, dialogShape.hasNotes, dialogShape.hasDate, dialogShape.hasTime, dialogShape.hasToggle, dialogShape.selects === 2],
      [true, true, true, true, true, true]);
    log("edit.anAllDayTaskHasNoTimeField", dialogShape.timeDisabled, true);

    const written = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var d = document.querySelector("dialog[open]");
      function set(node, value) {
        node.value = value;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        return node;
      }
      set(d.querySelector("#task-title"), "Tomorrow review, revised");
      set(d.querySelector("#task-notes"), "Ask Priya for the revised numbers.");
      var allDay = d.querySelector("#task-allday");
      if (allDay.checked) allDay.click();
      set(d.querySelector("#task-time"), "14:45");
      set(d.querySelector("#task-due"), window.__FIX__.plusThreeDate);
      var selects = d.querySelectorAll("select.select__native");
      var writing = App.db.listFolders(App.app.state.workspaceId).filter(function (f) { return f.name === "Writing"; })[0];
      selects[0].value = writing.id;
      selects[1].value = "2";
      return { project: writing.id, timeEnabled: !d.querySelector("#task-time").disabled };
    })()`);
    log("edit.togglingOffAllDayEnablesTheTimeField", written.timeEnabled, true);

    await cdp.evaluate(`(function(){
      var d = document.querySelector("dialog[open]");
      Array.prototype.filter.call(d.querySelectorAll(".dialog__footer .btn"), function (b) { return b.type === "submit"; })[0].click();
      return "saved";
    })()`);
    await sleep(1150);

    const edited = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.getTask(window.__FIX__.tomorrow);
      var row = document.querySelector('#main .task-row[data-id="' + window.__FIX__.tomorrow + '"]');
      return {
        title: t.title,
        notes: t.notes,
        folder: t.folder_id,
        dueDate: t.due_at ? t.due_at.slice(0, 10) : null,
        hasTime: t.due_has_time,
        priority: t.priority,
        rowTitle: row ? row.querySelector(".task-row__title").textContent : null,
        rowChips: row ? Array.prototype.map.call(row.querySelectorAll(".task-chip"), function (c) { return c.textContent; }) : [],
        rowNamesTheProject: row ? row.textContent.indexOf("Writing") !== -1 : false,
        dialogs: document.querySelectorAll("dialog[open]").length,
        scrollTop: document.getElementById("main").scrollTop
      };
    })()`);
    log("edit.savedTheTitle", edited.title, "Tomorrow review, revised");
    log("edit.savedTheNotes", edited.notes, "Ask Priya for the revised numbers.");
    log("edit.savedTheProject", edited.folder, written.project);
    log("edit.savedTheDueDate", edited.dueDate, await cdp.evaluate("window.__FIX__.plusThreeDate"));
    log("edit.savedTheTimedFlag", edited.hasTime, 1);
    log("edit.savedThePriority", edited.priority, 2);
    log("edit.theRowReflectsIt", edited.rowTitle, "Tomorrow review, revised");
    log("edit.theRowNamesTheProject", edited.rowNamesTheProject, true);
    log("edit.theRowPrintsTheTime", /2:45|14:45/.test(edited.rowChips.join(" ")), true);
    log("edit.dialogIsGone", edited.dialogs, 0);
    log("edit.theScrollPositionSurvived", edited.scrollTop, scrollable.top);

    // -------------------------------------------------- (g) delete, and its confirm
    const menuOpened = await cdp.evaluate(`(function(){
      var row = document.querySelector('#main .task-row[data-id="' + window.__FIX__.week + '"]');
      if (!row) return "missing";
      var box = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
        clientX: Math.round(box.left + 80), clientY: Math.round(box.top + 12)
      }));
      return "fired";
    })()`);
    if (menuOpened !== "fired") throw new Error("the task row to right-click is not on screen");
    await sleep(480);
    const menuItems = await cdp.evaluate(`(function(){
      var live = Array.prototype.filter.call(document.querySelectorAll(".menu"), function (m) { return !m.classList.contains("is-hidden"); })[0];
      if (!live) return null;
      return {
        labels: Array.prototype.map.call(live.querySelectorAll(".menu__item"), function (b) { return b.querySelector(".menu__label").textContent; }),
        danger: Array.prototype.map.call(live.querySelectorAll(".menu__item--danger"), function (b) { return b.querySelector(".menu__label").textContent; })
      };
    })()`);
    if (!menuItems) throw new Error("right-clicking a task row opened no menu");
    log("menu.offersEditAndDoneAndBothMoves", menuItems.labels.slice(0, 4), ["Edit" + ELLIPSIS, "Mark done", "Move up", "Move down"]);
    log("menu.deleteIsLast", menuItems.labels[menuItems.labels.length - 1], "Delete task" + ELLIPSIS);
    log("menu.deleteUsesTheDangerTone", menuItems.danger, ["Delete task" + ELLIPSIS]);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent(\"keydown\", { key: \"Escape\", bubbles: true }))");
    await sleep(320);

    await cdp.evaluate(`(function(){
      var row = document.querySelector('#main .task-row[data-id="' + window.__FIX__.week + '"]');
      row.querySelector('[data-action="task-delete"]').click();
      return "asked";
    })()`);
    await sleep(800);
    const confirmShape = await cdp.evaluate(`(function(){
      var d = document.querySelector("dialog[open]");
      var App = window.NoteApp;
      if (!d) return { open: false };
      return {
        open: true,
        danger: d.classList.contains("dialog--danger"),
        confirm: Array.prototype.map.call(d.querySelectorAll(".dialog__footer .btn"), function (b) { return b.textContent; }),
        consequences: Array.prototype.map.call(d.querySelectorAll(".dialog__consequences li"), function (li) { return li.textContent; }),
        stillThere: !!App.db.getTask(window.__FIX__.week),
        rowStillDrawn: !!document.querySelector('#main .task-row[data-id="' + window.__FIX__.week + '"]')
      };
    })()`);
    log("delete.asksFirst", confirmShape.open, true);
    log("delete.confirmIsADangerDialog", confirmShape.danger, true);
    log("delete.confirmNamesTheAction", confirmShape.confirm, ["Cancel", "Delete task"]);
    log("delete.saysItCannotBeUndone",
      confirmShape.consequences.some((c) => /cannot be undone/.test(c)), true);
    log("delete.nothingHappenedYet", confirmShape.stillThere, true);
    log("delete.theRowIsStillDrawn", confirmShape.rowStillDrawn, true);

    await cdp.evaluate(`(function(){
      var d = document.querySelector("dialog[open]");
      Array.prototype.filter.call(d.querySelectorAll(".dialog__footer .btn"), function (b) { return b.type === "submit"; })[0].click();
      return "confirmed";
    })()`);
    await sleep(1050);
    const deleted = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      return {
        gone: !App.db.getTask(window.__FIX__.week),
        rowGone: !document.querySelector('#main .task-row[data-id="' + window.__FIX__.week + '"]'),
        dialogs: document.querySelectorAll("dialog[open]").length,
        viewCount: (document.querySelector(".view-btn .tree__badge") || {}).textContent
      };
    })()`);
    log("delete.takesItOutOfTheDatabase", deleted.gone, true);
    log("delete.takesTheRowOffScreen", deleted.rowGone, true);
    log("delete.leavesNoDialog", deleted.dialogs, 0);

    // ---------------------------------------- (f2) manual order and the move pair
    // The move pair is governed by the same rule as the tree's: it exists while manual
    // order is the sort, and is absent under any key whose order the next render would
    // restore. Both halves are exercised, because "present" alone would also pass on a
    // menu offering a move the database then ignored.
    await cdp.evaluate("document.getElementById('sort-menu').click()");
    await sleep(440);
    const choseName = await cdp.evaluate(`(function(){
      var live = Array.prototype.filter.call(document.querySelectorAll(".menu"), function (m) { return !m.classList.contains("is-hidden"); })[0];
      if (!live) return "no menu";
      var item = Array.prototype.filter.call(live.querySelectorAll(".menu__item"), function (b) {
        return b.querySelector(".menu__label").textContent === "Name";
      })[0];
      if (!item) return "no item";
      item.click();
      return "chose";
    })()`);
    if (choseName !== "chose") throw new Error("could not choose another sort key: " + choseName);
    await sleep(560);
    console.log("     sort preference is now " + JSON.stringify(await cdp.evaluate("window.NoteApp.prefs.get('sortOrder')")));

    const firedUnderName = await cdp.evaluate(`(function(){
      var row = document.querySelector("#main .task-row");
      if (!row) return "no row";
      var box = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(box.left + 80), clientY: Math.round(box.top + 12) }));
      return "fired";
    })()`);
    if (firedUnderName !== "fired") throw new Error("no task row to right-click under the Name sort");
    await sleep(480);
    const labelsUnderName = await cdp.evaluate(`(function(){
      var live = Array.prototype.filter.call(document.querySelectorAll(".menu"), function (m) { return !m.classList.contains("is-hidden"); })[0];
      return live ? Array.prototype.map.call(live.querySelectorAll(".menu__item"), function (b) { return b.querySelector(".menu__label").textContent; }) : null;
    })()`);
    log("move.absentWhenTheSortIsNotManual", labelsUnderName, ["Edit" + ELLIPSIS, "Mark done", "Delete task" + ELLIPSIS]);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent(\"keydown\", { key: \"Escape\", bubbles: true }))");
    await sleep(340);

    await cdp.evaluate("document.getElementById('sort-menu').click()");
    await sleep(440);
    const choseManual = await cdp.evaluate(`(function(){
      var live = Array.prototype.filter.call(document.querySelectorAll(".menu"), function (m) { return !m.classList.contains("is-hidden"); })[0];
      if (!live) return "no menu";
      var item = Array.prototype.filter.call(live.querySelectorAll(".menu__item"), function (b) {
        return b.querySelector(".menu__label").textContent === "Manual order";
      })[0];
      if (!item) return "no item";
      item.click();
      return "chose";
    })()`);
    if (choseManual !== "chose") throw new Error("could not get back to manual order: " + choseManual);
    await sleep(560);

    const positionsBefore = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      function pos(title) {
        var t = App.db.listTasks(ws, {}).filter(function (x) { return x.title === title; })[0];
        return t ? t.position : null;
      }
      var node = document.querySelector('#main .task-row .task-row__title');
      return { filler: pos("Filler 1"), room: pos("Book the room"), sort: App.app.state.sort.key };
    })()`);
    log("move.manualIsTheSortAgain", positionsBefore.sort, "manual");
    log("move.theListStartsInCreationOrder", positionsBefore.filler > positionsBefore.room, true);

    await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.listTasks(App.app.state.workspaceId, {}).filter(function (x) { return x.title === "Filler 1"; })[0];
      var node = document.querySelector('#main .task-row[data-id="' + t.id + '"]');
      var box = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(box.left + 80), clientY: Math.round(box.top + 12) }));
      return "fired";
    })()`);
    await sleep(480);
    const clickedMove = await cdp.evaluate(`(function(){
      var live = Array.prototype.filter.call(document.querySelectorAll(".menu"), function (m) { return !m.classList.contains("is-hidden"); })[0];
      if (!live) return "no menu";
      var item = Array.prototype.filter.call(live.querySelectorAll(".menu__item"), function (b) {
        return b.querySelector(".menu__label").textContent === "Move up";
      })[0];
      if (!item) return "no move item";
      item.click();
      return "moved";
    })()`);
    if (clickedMove !== "moved") throw new Error("the move command was not in the menu: " + clickedMove);
    await sleep(950);
    const afterMove = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var ws = App.app.state.workspaceId;
      function pos(title) {
        var t = App.db.listTasks(ws, {}).filter(function (x) { return x.title === title; })[0];
        return t ? t.position : null;
      }
      var group = document.querySelector('#main .task-group[data-bucket="none"]');
      return {
        filler: pos("Filler 1"),
        room: pos("Book the room"),
        rendered: group ? Array.prototype.map.call(group.querySelectorAll(".task-row__title"), function (t) { return t.textContent; }) : []
      };
    })()`);
    log("move.theOneStepSwapHappened", afterMove.filler < afterMove.room, true);
    log("move.itSwappedWithItsNeighbourOnly", afterMove.filler, positionsBefore.room);
    console.log("     No date bucket, in order: " + JSON.stringify(afterMove.rendered.slice(0, 4)));
    // The bucket is ordered by position, so the swapped pair has to have changed places
    // in it as well: a database swap the pane then draws in the old order is a move the
    // reader cannot see, which is the failure this project calls out by name.
    log("move.theRenderedGroupFollowsTheNewOrder",
      afterMove.rendered.indexOf("Filler 1") < afterMove.rendered.indexOf("Book the room"), true);


    // ------------------------------------------- (j) a selected folder files the task
    // Back to the notebook first, then a folder is selected in the tree: that is what "in
    // the selected folder" means, and the pane has to agree with the tree about it.
    await cdp.evaluate("document.querySelector(\"[data-action=\\\"view-tasks\\\"]\").click()");
    await sleep(480);
    const selectedFolder = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var folder = App.db.listFolders(App.app.state.workspaceId).filter(function (f) { return f.name === "Writing"; })[0];
      var row = document.querySelector('#tree .tree__row--folder[data-id="' + folder.id + '"]');
      if (!row) return { missing: true };
      row.click();
      return { id: folder.id, selection: App.app.state.selection.type, view: App.app.state.view };
    })()`);
    log("folder.selectingAFolderReturnsToTheNotesView", selectedFolder.view, "notes");
    log("folder.theSelectionIsThatFolder", selectedFolder.selection, "folder");

    await cdp.evaluate("document.querySelector(\"[data-action=\\\"view-tasks\\\"]\").click()");
    await sleep(560);
    const scoped = await cdp.evaluate(`(function(){
      return {
        sub: (document.querySelector("#main .pane-head__sub") || {}).textContent,
        viewCount: (document.querySelector(".view-btn .tree__badge") || {}).textContent,
        quickAdd: !!document.getElementById("task-add")
      };
    })()`);
    log("folder.thePaneNamesTheScope", scoped.sub.indexOf("in Writing") !== -1, true);
    log("folder.theViewCountIsStillAboutTheWorkspace", scoped.viewCount, deleted.viewCount);
    log("folder.quickAddIsStillThere", scoped.quickAdd, true);

    const filed = await addVia("Draft the brief");
    const filedWhere = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.listTasks(App.app.state.workspaceId, { view: "all" }).filter(function (x) { return x.title === "Draft the brief"; })[0];
      var row = t ? document.querySelector('#main .task-row[data-id="' + t.id + '"]') : null;
      return {
        found: !!t,
        folder: t ? t.folder_id : null,
        inThePane: !!row,
        namesTheProject: row ? row.textContent.indexOf("Writing") !== -1 : false
      };
    })()`);
    log("folder.quickAddFilesItInTheSelectedFolder", filedWhere.folder, selectedFolder.id);
    log("folder.itIsDrawnInTheScopedPane", filedWhere.inThePane, true);
    log("folder.theRowNamesItsProject", filedWhere.namesTheProject, true);
    log("folder.quickAddStillKeepsFocus", filed.focused, "task-add");

    // ----------------------------------------------- (i) a note takes the pane back
    // No click here on purpose: the Tasks button is a toggle, and this check is about being in
    // the task pane already — pressing it again would land back on the notebook and prove
    // the opposite of what is being asserted.
    const backIn = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      App.app.state.expanded = {};
      App.app.render();
      return { view: App.app.state.view };
    })()`);
    log("note.stillInTheTaskPane", backIn.view, "tasks");
    const pickedNote = await cdp.evaluate(`(function(){
      var row = document.querySelector('#tree .tree__row--note[data-ctx-label="Reading list"]');
      if (!row) return "missing";
      row.click();
      return "clicked";
    })()`);
    if (pickedNote !== "clicked") throw new Error("no root note row to click: " + pickedNote);
    await sleep(560);
    const afterNote = await cdp.evaluate(`(function(){
      return {
        view: window.NoteApp.app.state.view,
        editor: !!document.getElementById("note-body"),
        title: (document.getElementById("note-title") || {}).value
      };
    })()`);
    log("note.clickingANoteReturnsToTheNotesView", afterNote.view, "notes");
    log("note.theEditorIsShowing", afterNote.editor, true);
    log("note.itIsTheNoteThatWasClicked", afterNote.title, "Reading list");

    // A search is the other way out of the pane, and for the same reason: its hits are
    // notebook rows, so the pane has to be the notebook.
    await cdp.evaluate("document.querySelector(\"[data-action=\\\"view-tasks\\\"]\").click()");
    await sleep(440);
    await cdp.evaluate(`(function(){
      var s = document.getElementById("search");
      s.value = "Reading";
      s.dispatchEvent(new Event("input", { bubbles: true }));
      return "searched";
    })()`);
    await sleep(800);
    const afterSearch = await cdp.evaluate(`(function(){
      return {
        view: window.NoteApp.app.state.view,
        results: document.querySelectorAll("#tree .tree__row--note").length
      };
    })()`);
    log("search.typingAQueryReturnsToTheNotesView", afterSearch.view, "notes");
    log("search.theHitsAreDrawn", afterSearch.results > 0, true);
    const errsBeforeReload = await cdp.evaluate("window.__SHOT_ERRORS__ ? window.__SHOT_ERRORS__ : []");
    log("page.noRuntimeErrorsBeforeTheReload", errsBeforeReload, []);

    // -------------------------------------------------- (h) it all survives a reload
    const before = await cdp.evaluate(`(function(){
      var t = window.NoteApp.db.getTask(window.__FIX__.tomorrow);
      return { title: t.title, notes: t.notes, folder: t.folder_id, due: t.due_at, hasTime: t.due_has_time, priority: t.priority };
    })()`);
    await cdp.send("Page.reload", {});
    await settle();
    // The reload wiped every page global, so the id the reloaded page needs is parked
    // again on the new document before anything is read out of it.
    await cdp.evaluate("window.__FIX_ID__ = " + JSON.stringify(ids.tomorrow));
    await cdp.evaluate("document.querySelector(\"[data-action=\\\"view-tasks\\\"]\").click()");
    await sleep(600);
    const reloaded = await cdp.evaluate(`(function(){
      var App = window.NoteApp;
      var t = App.db.getTask(window.__FIX_ID__);
      var row = t ? document.querySelector('#main .task-row[data-id="' + t.id + '"]') : null;
      return {
        exists: !!t,
        title: t ? t.title : null,
        notes: t ? t.notes : null,
        folder: t ? t.folder_id : null,
        due: t ? t.due_at : null,
        hasTime: t ? t.due_has_time : null,
        priority: t ? t.priority : null,
        rowTitle: row ? row.querySelector(".task-row__title").textContent : null,
        view: App.app.state.view,
        viewCount: (document.querySelector(".view-btn .tree__badge") || {}).textContent,
        openCount: App.db.countOpenTasks(App.app.state.workspaceId),
        paneHasRows: document.querySelectorAll("#main .task-row").length
      };
    })()`);
    log("reload.theTaskIsStillThere", reloaded.exists, true);
    log("reload.titleSurvived", reloaded.title, before.title);
    log("reload.notesSurvived", reloaded.notes, before.notes);
    log("reload.projectSurvived", reloaded.folder, before.folder);
    log("reload.dueInstantSurvived", reloaded.due, before.due);
    log("reload.timedFlagSurvived", reloaded.hasTime, before.hasTime);
    log("reload.prioritySurvived", reloaded.priority, before.priority);
    log("reload.theRowIsDrawnFromTheStoredRow", reloaded.rowTitle, before.title);
    log("reload.theViewCountIsRecomputed", reloaded.viewCount, String(reloaded.openCount));
    log("reload.thePaneStillRenders", reloaded.paneHasRows > 0, true);

    // ------------------------------------------------------------ the mobile pane
    await setTheme("light");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 820, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const mobile = await cdp.evaluate(`(function(){
      var main = document.getElementById("main");
      var sidebar = document.querySelector(".sidebar");
      return {
        paneWidth: Math.round(main.getBoundingClientRect().width),
        sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
        rows: document.querySelectorAll("#main .task-row").length
      };
    })()`);
    log("mobile.thePaneFillsTheScreen", mobile.paneWidth > 300, true);
    // The sidebar is the list pane here, and the Tasks button is no longer inside it: this is
    // the width at which a control living in the rail was unreachable from the pane in front.
    log("mobile.theRailIsOffScreen", mobile.sidebarWidth, 0);
    log("mobile.theListIsStillDrawn", mobile.rows > 0, true);
    await shot("35-tasks-mobile", 420, 820, "light");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(440);

    // ------------------------------------------------- (n) the Add button
    // What used to sit here was a key cap reading "Enter". Enter still files a task, but the
    // control beside the field has to be a real one: the same filing, reached by hand.
    const addButton = await cdp.evaluate(`(function(){
      var button = document.querySelector('[data-action="add-task"]');
      var field = document.getElementById("task-add");
      if (!button || !field) return { found: false };
      var out = {
        found: true,
        tag: button.tagName,
        label: button.textContent.trim(),
        disabledWhileEmpty: button.disabled
      };
      field.focus();
      field.value = "Send the invoice";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      out.readyWithText = !button.disabled;
      button.click();
      return out;
    })()`);
    log("addButton.exists", addButton.found, true);
    log("addButton.isARealButton", addButton.tag, "BUTTON");
    log("addButton.saysWhatItDoes", addButton.label, "Add");
    log("addButton.isDisabledWhileTheFieldIsEmpty", addButton.disabledWhileEmpty, true);
    log("addButton.isReadyWithTextInTheField", addButton.readyWithText, true);
    await sleep(900);
    const byButton = await cdp.evaluate(`(function(){
      var button = document.querySelector('[data-action="add-task"]');
      return {
        stored: window.NoteApp.db.listTasks(window.NoteApp.app.state.workspaceId, {}).filter(function (t) { return t.title === "Send the invoice"; }).length,
        field: (document.getElementById("task-add") || {}).value,
        focused: document.activeElement ? document.activeElement.id : null,
        disabledAgain: button ? button.disabled : null
      };
    })()`);
    log("addButton.filesTheTask", byButton.stored, 1);
    log("addButton.emptiesTheField", byButton.field, "");
    log("addButton.keepsFocusInTheField", byButton.focused, "task-add");
    log("addButton.isDisabledAgainWhenTheFieldIsEmpty", byButton.disabledAgain, true);

    const errs = await cdp.evaluate("window.__SHOT_ERRORS__ ? window.__SHOT_ERRORS__ : []");
    log("page.noRuntimeErrors", errs, []);
    if (errs.length) console.log("     page errors: " + JSON.stringify(errs));

    console.log("");
    console.log("screenshots written to tools/shots/");
    console.log(notes.join("\n"));

    const failed = results.filter((r) => !r.ok);
    console.log("");
    console.log("=== " + (results.length - failed.length) + "/" + results.length + " checks passed ===");
    if (failed.length) {
      failed.forEach((f) => console.log("  FAIL " + f.name + ": got " + JSON.stringify(f.value) + ", expected " + JSON.stringify(f.expected)));
      process.exitCode = 1;
    }


  } catch (err) {
    console.error("TASKS CHECK ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.send(JSON.stringify({ id: 999999, method: "Browser.close", params: {} })); } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(200);
    if (child.exitCode === null) { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();

