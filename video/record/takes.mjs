// Real sessions through the app. Every press, keystroke and drag is dispatched to the page.
const caretToEnd = (id) =>
  "(function(){var b=document.getElementById(" + JSON.stringify(id) + ");b.focus();var r=document.createRange();r.selectNodeContents(b);r.collapse(false);var s=getSelection();s.removeAllRanges();s.addRange(r);return true;})()";

const byText = (text, tag) =>
  "(function(){var t=" + JSON.stringify(text) + ";var bs=[].slice.call(document.querySelectorAll(" + JSON.stringify(tag || "button") + "));var m=bs.filter(function(x){return (x.textContent||'').trim().toLowerCase()===t.toLowerCase();})[0]||bs.filter(function(x){return (x.textContent||'').trim().toLowerCase().indexOf(t.toLowerCase())>-1;})[0];if(!m)return null;var r=m.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()";

const byClass = (part, index) =>
  "(function(){var e=[].slice.call(document.querySelectorAll('*')).filter(function(x){return (x.className||'').toString().toLowerCase().indexOf(" + JSON.stringify(part) + ")>-1;})[" + (index || 0) + "];if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()";

export default [
  {
    name: "classic",
    async run(a) {
      await a.sleep(600);
      await a.mark("tabs");
      await a.click(".tab-add", { moveMs: 380, after: 1500 });
      await a.clickExpr("(function(){var t=document.querySelectorAll('.tab')[0];if(!t)return null;var r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 1400);
      await a.mark("ws");
      await a.click(".ws-trigger", { moveMs: 380, after: 1100 });
      await a.clickExpr(byText("New workspace", "button") + "", 1200).catch(() => {});
      await a.clickExpr("(function(){var i=document.querySelector('dialog[open] input');if(!i)return null;i.focus();var r=i.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 500).catch(() => {});
      await a.type("Studio", 11).catch(() => {});
      await a.clickExpr(byText("Create", "button"), 2200).catch(() => {});
      await a.click(".ws-trigger", { moveMs: 380, after: 1100 }).catch(() => {});
      await a.clickExpr("(function(){var e=[].slice.call(document.querySelectorAll('.ws-menu *,dialog[open] *')).filter(function(x){return /Personal/i.test(x.textContent||'');})[0];if(!e)return null;var r=e.getBoundingClientRect();if(!r.width)return null;return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 1400).catch(() => {});
      await a.moveTo(700, 470, 700);
      await a.sleep(900);
    },
  },
  {
    name: "editor",
    async run(a) {
      await a.sleep(600);
      await a.clickExpr("(function(){return null;})()", 0).catch(() => {});
      await a.mark("formats");
      await a.click(".tree__row", { moveMs: 420, after: 1200 }).catch(() => {});
      await a.clickExpr("(function(){var b=[].slice.call(document.querySelectorAll('#tree .tree__row')).filter(function(x){return /Aurora|Kickoff|Naming/i.test(x.textContent);})[0];if(!b)return null;var r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 1400).catch(() => {});
      await a.cdp.evaluate(caretToEnd("note-body")).catch(() => {});
      await a.hotkey("End", 2);
      await a.key("Enter");
      await a.key("Enter");
      await a.sleep(300);
      await a.click({ css: ".fmt-btn", text: "Bold" }, { moveMs: 320, after: 260 }).catch(() => {});
      await a.type("Launch week", 15);
      await a.click({ css: ".fmt-btn", text: "Bold" }, { moveMs: 260, after: 260 }).catch(() => {});
      await a.key("Enter");
      await a.click({ css: ".fmt-btn", text: "Bulleted list" }, { moveMs: 320, after: 300 }).catch(() => {});
      await a.type("Send the invoice", 15);
      await a.key("Enter");
      await a.type("Book the dentist", 15);
      await a.key("Enter");
      await a.key("Enter");
      await a.click({ css: ".fmt-btn", text: "Highlight" }, { moveMs: 320, after: 300 }).catch(() => {});
      await a.type("Priya owns this", 15);
      await a.mark("formats-done");
      await a.moveTo(900, 560, 700);
      await a.sleep(1400);
    },
  },
  {
    name: "tree",
    async run(a) {
      await a.sleep(500);
      await a.mark("folders");
      await a.clickExpr("(function(){var t=[].slice.call(document.querySelectorAll('.tree__twisty'))[0];if(!t)return null;var r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 1100).catch(() => {});
      await a.clickExpr("(function(){var rows=[].slice.call(document.querySelectorAll('#tree .tree__row'));var r2=rows.filter(function(x){return /Clients|Writing|Later/i.test(x.textContent);});var b=r2[1];if(!b)return null;var r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 1300).catch(() => {});
      await a.mark("search");
      await a.hotkey("k", 2);
      await a.sleep(900);
      await a.type("kick", 12);
      await a.mark("hits");
      await a.sleep(1700);
      await a.clickExpr("(function(){var b=document.querySelector('#tree .tree__row');if(!b)return null;var r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 1500).catch(() => {});
      await a.sleep(1200);
    },
  },
  {
    name: "canvas",
    async run(a) {
      await a.click('[data-action="open-board"]', { moveMs: 480, after: 2000 });
      await a.mark("blocks");
      await a.click({ css: ".board__tool", text: "Note" }, { moveMs: 320, after: 500 });
      await a.clickAt(700, 420, { after: 700 });
      await a.key("Escape").catch(() => {});
      await a.type("Ship the pricing page", 15);
      await a.dragFrom(".bd-item--note", 70, 14, 400, 300, { stepMs: 26 }).catch(() => {});
      await a.sleep(1200);
      await a.click({ css: ".board__tool", text: "To-do" }, { moveMs: 320, after: 600 });
      await a.clickAt(700, 420, { after: 700 });
      await a.key("Escape").catch(() => {});
      await a.type("Chase the invoice", 15);
      await a.click({ css: ".board__tool", text: "To-do" }, { moveMs: 300, after: 400 }).catch(() => {});
      await a.dragFrom(".bd-item", 60, 12, 1060, 300, { stepMs: 26 }).catch(() => {});
      await a.sleep(1200);
      await a.mark("select");
      await a.drag({ x: 260, y: 200 }, { x: 1180, y: 700 }, { stepMs: 22 }).catch(() => {});
      await a.sleep(1600);
      await a.mark("group");
      await a.click({ css: ".board__tool", text: "Group" }, { moveMs: 320, after: 700 }).catch(() => {});
      await a.clickAt(700, 470, { after: 1500 }).catch(() => {});
      await a.click({ css: ".board__tool", text: "Group" }, { moveMs: 300, after: 500 }).catch(() => {});
      await a.sleep(1200);
      await a.mark("draw");
      await a.click({ css: ".board__tool", text: "Draw" }, { moveMs: 320, after: 800 }).catch(() => {});
      await a.drag({ x: 420, y: 760 }, { x: 620, y: 800 }, { stepMs: 22 }).catch(() => {});
      await a.drag({ x: 640, y: 800 }, { x: 860, y: 730 }, { stepMs: 22 }).catch(() => {});
      await a.sleep(700);
      await a.clickExpr(byText("Done", "button"), 1400).catch(() => {});
      await a.mark("minimap");
      await a.drag({ x: 1352, y: 130 }, { x: 1300, y: 250 }, { stepMs: 30 }).catch(() => {});
      await a.sleep(1400);
    },
  },
  {
    name: "boards",
    async run(a) {
      await a.sleep(500);
      await a.mark("landmark");
      await a.click({ css: ".board__tool", text: "Landmarks" }, { moveMs: 340, after: 1200 }).catch(() => {});
      await a.clickAt(760, 300, { after: 1400 }).catch(() => {});
      await a.key("Escape").catch(() => {});
      await a.sleep(900);
      await a.mark("list");
      await a.click({ css: ".board__tool", text: "Back" }, { moveMs: 360, after: 2000 }).catch(() => {});
      await a.clickExpr(byText("New board", "button"), 1800).catch(() => {});
      await a.type("Roadmap", 12).catch(() => {});
      await a.clickExpr(byText("Create", "button"), 2200).catch(() => {});
      await a.moveTo(760, 520, 700);
      await a.sleep(1400);
    },
  },
  {
    name: "plan",
    async run(a) {
      await a.click('[data-action="open-board"]', { moveMs: 460, after: 1800 }).catch(() => {});
      await a.mark("week");
      await a.click({ css: ".board__plan", text: "Planner" }, { moveMs: 520, after: 2400 }).catch(() => {});
      await a.mark("views");
      await a.click({ css: ".bd-cal__btn", text: "Day" }, { moveMs: 380, after: 1700 }).catch(() => {});
      await a.click({ css: ".bd-cal__btn", text: "Month" }, { moveMs: 380, after: 1700 }).catch(() => {});
      await a.click({ css: ".bd-cal__btn", text: "Year" }, { moveMs: 380, after: 1700 }).catch(() => {});
      await a.mark("full");
      await a.clickExpr(byText("Fullscreen", "button"), 2400).catch(() => {});
      await a.moveTo(720, 640, 800);
      await a.sleep(1600);
    },
  },
  {
    name: "palettes",
    async run(a) {
      await a.sleep(500);
      await a.clickExpr(byText("Back", "button"), 2000).catch(() => {});
      await a.mark("palette");
      await a.click('[aria-label="Settings"]', { moveMs: 400, after: 1500 }).catch(() => {});
      for (const name of ["Teal", "Amber", "Rose", "Violet", "Graphite", "Indigo"]) {
        await a.clickExpr("(function(){var l=[].slice.call(document.querySelectorAll('.palette-option')).filter(function(x){return (x.textContent||'').trim().indexOf(" + JSON.stringify(name) + ")>-1;})[0];if(!l)return null;var i=l.querySelector('input')||l;var r=i.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 900).catch(() => {});
      }
      await a.mark("dark");
      await a.click('[aria-label="Close settings"]', { moveMs: 320, after: 900 }).catch(() => {});
      await a.click("#theme-toggle", { moveMs: 480, after: 1800 }).catch(() => {});
      await a.moveTo(780, 460, 800);
      await a.sleep(1600);
    },
  },
];
