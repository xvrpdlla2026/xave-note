// Records the real app as it is used: real clicks, real typing, a drawn cursor, and the
// browser's own compositor frames. Footage goes out as numbered JPEGs per take, plus a
// timeline so the film can be cut to what actually happened.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../..");
const APP = pathToFileURL(resolve(ROOT, "index.html")).href;
const OUT = HERE + "out/";
const SEED = (await import("node:fs")).readFileSync(resolve(ROOT, "tools/shot-seed.js"), "utf8");

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) throw new Error("no browser");

const CURSOR = `(() => {
  if (document.getElementById("__cur")) return "already";
  var css = document.createElement("style");
  css.textContent = [
    "#__cur{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;transform:translate(700px,500px);transition:transform 80ms linear;will-change:transform}",
    "#__cur svg{display:block;filter:drop-shadow(0 2px 4px rgba(10,10,20,.35))}",
    "#__ring{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:99px;border:2px solid rgba(77,90,232,.9);background:rgba(77,90,232,.18);pointer-events:none;z-index:2147482999;opacity:0;transform:scale(.3)}",
    "#__ring.on{animation:__pop 460ms ease-out}",
    "@keyframes __pop{0%{opacity:.85;transform:scale(.35)}70%{opacity:.35;transform:scale(1.1)}100%{opacity:0;transform:scale(1.25)}}",
    "#__tick{position:fixed;left:0;top:0;width:2px;height:2px;background:#fff;opacity:.02;z-index:0;animation:__beat 240ms steps(2,end) infinite}",
    "@keyframes __beat{0%{opacity:.02}50%{opacity:.035}}",
  ].join("");
  document.documentElement.appendChild(css);
  var cur = document.createElement("div");
  cur.id = "__cur";
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4.6 2.6l13.2 8.6-5.7 1 2.9 6.6-2.9 1.2-2.9-6.6-4.6 4.1z" fill="#15151d" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(cur);
  var ring = document.createElement("div");
  ring.id = "__ring";
  document.documentElement.appendChild(ring);
  var tick = document.createElement("div");
  tick.id = "__tick";
  document.documentElement.appendChild(tick);
  window.__cur = function (x, y) { cur.style.transform = "translate(" + x + "px," + y + "px)"; };
  window.__ring = function (x, y) {
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    ring.classList.remove("on");
    void ring.offsetWidth;
    ring.classList.add("on");
  };
  window.__cur(700, 500);
})();`;

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        return;
      }
      const list = this.handlers.get(msg.method);
      if (list) list.forEach((fn) => fn(msg.params));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("ws error")), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
}

const port = 9600 + Math.floor(Math.random() * 300);
const profile = HERE + "profile";
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(OUT, { recursive: true });

const child = spawn(browser, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  "--user-data-dir=" + profile,
  "--remote-debugging-port=" + port,
  "about:blank",
], { stdio: "ignore" });

let cdp;
let current = null;
let frames = [];
let startedAt = 0;

const t0 = Date.now();
const log = (msg) => console.log("[" + ((Date.now() - t0) / 1000).toFixed(2) + "s] " + msg);

try {
  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (res.ok) targets = await res.json();
    } catch {}
    if (!targets) await sleep(200);
  }
  const page = (targets || []).find((t) => t.type === "page");
  if (!page) throw new Error("no page target");

  cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR });
  await cdp.send("Page.navigate", { url: APP });
  await sleep(6500);
  await cdp.evaluate(`window.NoteApp.app.ready().then(function () {
    document.documentElement.setAttribute("data-theme", "light");
    window.NoteApp.prefs.set("theme", "light");
    if (window.__SEED__) return window.__SEED__();
  })`);
  await sleep(1800);
  await cdp.evaluate(CURSOR);
  log("seeded, cursor " + (await cdp.evaluate("!!document.getElementById('__cur')")));

  cdp.on("Page.screencastFrame", (p) => {
    if (current) frames.push({ t: Date.now(), data: p.data });
    cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 2160, maxHeight: 1350, everyNthFrame: 1 });

  const box = async (target) => {
    const expr = typeof target === "string"
      ? `(function(){var e=document.querySelector(${JSON.stringify(target)});if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})()`
      : `(function(){var t=${JSON.stringify(target.text)};var css=${JSON.stringify(target.css || "*")};var els=[].slice.call(document.querySelectorAll(css));for(var i=0;i<els.length;i++){var e=els[i];var r=e.getBoundingClientRect();if(r.width<5||r.height<5||r.top<0)continue;var s=(e.getAttribute("aria-label")||e.textContent||"").trim().replace(/\\s+/g," ");if(s.indexOf(t)===0)return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,label:s.slice(0,40)};}return null;})()`;
    return cdp.evaluate(expr);
  };

  const moveTo = async (x, y, ms = 320) => {
    const from = await cdp.evaluate("(function(){var c=document.getElementById('__cur');if(!c)return {x:700,y:500};var m=/([\\d.-]+)px,\\s*([\\d.-]+)px/.exec(c.style.transform);return m?{x:+m[1],y:+m[2]}:{x:700,y:500};})()");
    const steps = Math.max(6, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const cx = from.x + (x - from.x) * e;
      const cy = from.y + (y - from.y) * e;
      await cdp.evaluate("window.__cur(" + cx.toFixed(1) + "," + cy.toFixed(1) + ")");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, buttons: 0 });
      await sleep(ms / steps);
    }
  };

  const press = async (x, y) => {
    await cdp.evaluate("window.__ring(" + x + "," + y + ")");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await sleep(70);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };

  const click = async (target, opts = {}) => {
    const b = await box(target);
    if (!b) throw new Error("not found: " + JSON.stringify(target));
    await moveTo(b.x, b.y, opts.moveMs ?? 340);
    await sleep(opts.before ?? 90);
    await press(b.x, b.y);
    await sleep(opts.after ?? 260);
    return b;
  };

  const drag = async (from, to, opts = {}) => {
    const a = await box(from);
    const b = await box(to);
    if (!a || !b) throw new Error("drag target missing");
    await moveTo(a.x, a.y, 260);
    await sleep(80);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1 });
    await sleep(90);
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const x = a.x + (b.x - a.x) * e;
      const y = a.y + (b.y - a.y) * e;
      await cdp.evaluate("window.__cur(" + x.toFixed(1) + "," + y.toFixed(1) + ")");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      await sleep(opts.stepMs ?? 22);
    }
    await sleep(120);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(320);
  };

  const hotkey = async (letter, modifiers = 2) => {
    const code = letter.toUpperCase().charCodeAt(0);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: letter, code: "Key" + letter.toUpperCase(), windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
    await sleep(60);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: letter, code: "Key" + letter.toUpperCase(), windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
    await sleep(160);
  };

  const KEYCODES = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27 };
  const key = async (name, modifiers = 0) => {
    const code = KEYCODES[name] || 0;
    const text = name === "Enter" ? "\r" : undefined;
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, text, unmodifiedText: text, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
    await sleep(40);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
    await sleep(80);
  };

  const type = async (text, cps = 18) => {
    for (const ch of text) {
      if (ch === "\n") { await key("Enter"); continue; }
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(1000 / cps + Math.random() * 26);
    }
    await sleep(220);
  };

  const clickAt = async (x, y, opts = {}) => {
    await moveTo(x, y, opts.moveMs ?? 320);
    await sleep(90);
    await press(x, y);
    await sleep(opts.after ?? 260);
  };

  const dragFrom = async (selector, offsetX, offsetY, toX, toY, opts = {}) => {
    const b = await box(selector);
    if (!b) throw new Error("drag source missing: " + selector);
    const r = await cdp.evaluate("(function(){var e=document.querySelector(" + JSON.stringify(selector) + ");var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
    const from = { x: r.x + offsetX, y: r.y + offsetY };
    await moveTo(from.x, from.y, 260);
    await sleep(90);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
    await sleep(110);
    const steps = 26;
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const x = from.x + (toX - from.x) * e;
      const y = from.y + (toY - from.y) * e;
      await cdp.evaluate("window.__cur(" + x.toFixed(1) + "," + y.toFixed(1) + ")");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      await sleep(opts.stepMs ?? 24);
    }
    await sleep(140);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toX, y: toY, button: "left", buttons: 0, clickCount: 1 });
    await sleep(340);
  };

  const clickExpr = async (expr, after = 500) => {
    const b = await cdp.evaluate(expr);
    if (!b) throw new Error("expr miss: " + expr.slice(0, 70));
    await moveTo(b.x, b.y, 340);
    await sleep(90);
    await press(b.x, b.y);
    await sleep(after);
  };

  const api = {
    cdp, box, click, clickExpr, drag, dragFrom, clickAt, hotkey, key, type, moveTo, press,
    sleep: (ms) => sleep(ms),
    mark: (label) => marks.push({ label, ms: Date.now() - startedAt }),
    log,
  };

  // ---------------------------------------------------------------- the takes
  const TAKES_FILTER = (process.env.TAKES || "").split(",").filter(Boolean);
  const TAKES = (await import("./takes.mjs")).default.filter(
    (t) => !TAKES_FILTER.length || TAKES_FILTER.includes(t.name)
  );

  const timeline = {};
  let marks = [];
  for (const take of TAKES) {
    current = take.name;
    // reset between takes: a fresh document re-runs the seed so every pass starts clean
    await cdp.send("Page.navigate", { url: APP }).catch(() => {});
    await sleep(2800);
    await cdp.evaluate(CURSOR).catch(() => {});
    frames = [];
    startedAt = Date.now();
    marks = [];
    log("take " + take.name + " start");
    await take.run(api);
    await sleep(500);
    const end = Date.now();
    const dir = OUT + take.name + "/";
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const fps = 30;
    const durationMs = end - startedAt;
    const total = Math.round((durationMs / 1000) * fps);
    let idx = 0;
    for (let f = 0; f < total; f++) {
      const t = startedAt + (f * 1000) / fps;
      while (idx + 1 < frames.length && frames[idx + 1].t <= t) idx++;
      const data = frames[idx] ? frames[idx].data : frames[0]?.data;
      if (!data) continue;
      writeFileSync(dir + String(f).padStart(5, "0") + ".jpg", Buffer.from(data, "base64"));
    }
    timeline[take.name] = { frames: total, durationMs, captured: frames.length, marks };
    log("take " + take.name + " done: " + total + " frames from " + frames.length + " captures");
  }
  writeFileSync(OUT + "timeline.json", JSON.stringify(timeline, null, 2) + "\n");
  log("all takes recorded");
} finally {
  await cdp?.send("Page.stopScreencast").catch(() => {});
  child.kill();
  await sleep(600);
  rmSync(profile, { recursive: true, force: true });
}
