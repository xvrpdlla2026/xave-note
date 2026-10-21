// Turns the recorded takes and the narration timing into the film's scene file:
// every cut is pinned to a beat the recorder marked, so nothing is guessed.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const timing = JSON.parse(readFileSync(HERE + "audio/vo/timing.json", "utf8"));
const marks = JSON.parse(readFileSync(HERE + "record/out/timeline.json", "utf8")).marks
  ? JSON.parse(readFileSync(HERE + "record/out/timeline.json", "utf8"))
  : JSON.parse(readFileSync(HERE + "record/out/timeline.json", "utf8"));

const FALLBACK = {
  notes: { typing: 3.39, checklist: 6.43, done: 11.48 },
  board: { typing: 6.04, drag: 9.19, dragged: 11.41 },
  planner: { week: 3.79, chooser: 6.39, created: 16.07 },
  views: { day: 0.0 },
  search: { open: 5.49, typing: 6.53, results: 8.61 },
  theme: { toggle: 0.0 },
  tree: { folders: 0.51, search: 2.54, hits: 4.4 },
  boards: { landmark: 0.51, list: 5.91 },
  plan: { week: 3.07, views: 6.86, full: 15.02 },
  editor: { formats: 0.6 },
  classic: { tabs: 0.6, ws: 5.55 },
  canvas: { blocks: 3.28, select: 21.74, group: 23.45, draw: 29.96, minimap: 32.67 },
  palettes: { palette: 3.39, dark: 17.0 },
};

const at = (take, label) => {
  const row = marks[take];
  const hit = row && row.marks.find((m) => m.label === label);
  if (hit) return hit.ms / 1000;
  const fb = FALLBACK[take] && FALLBACK[take][label];
  if (fb === undefined) throw new Error("no mark " + take + "/" + label);
  return fb;
};

const BEATS = [
  {
    id: "brand", vo: "01-brand", len: 4.4, kicker: "", line: "A notebook, a board, and a planner.",
    camera: { scale: 1.03, ox: 50, oy: 50 }, clips: [],
  },
  {
    id: "classic", vo: "02-classic", kicker: "Classic view", line: "Tabs and workspaces",
    camera: { scale: 1.04, ox: 50, oy: 12 },
    clips: [
      { take: "classic", mark: "tabs", off: 0.1, seconds: 4.7 },
      { take: "classic", mark: "ws", off: 0.1, seconds: 5.2 },
    ],
  },
  {
    id: "editor", vo: "03-editor", kicker: "Editor", line: "Format when you need it",
    camera: { scale: 1.05, ox: 50, oy: 34 },
    clips: [
      { take: "notes", at: 2.4, seconds: 4.2 },
      { take: "notes", at: 6.6, seconds: 4.6 },
    ],
  },
  {
    id: "tree", vo: "04-tree", kicker: "Sidebar", line: "Folders, and Control K",
    camera: { scale: 1.04, ox: 34, oy: 26 },
    clips: [{ take: "tree", mark: "folders", off: 0.05, seconds: 6.1 }],
  },
  {
    id: "blocks", vo: "05-blocks", kicker: "Board", line: "A block for every job",
    camera: { scale: 1.04, ox: 50, oy: 46 },
    clips: [
      { take: "board", at: 2.4, seconds: 4.2 },
      { take: "board", at: 9.0, seconds: 2.6 },
    ],
  },
  {
    id: "canvas", vo: "06-canvas", kicker: "Canvas", line: "Select, group, mark, draw",
    camera: { scale: 1.035, ox: 52, oy: 52 },
    clips: [
      { take: "canvas", mark: "select", off: 0.1, seconds: 5.0 },
      { take: "canvas", mark: "draw", off: 0.0, seconds: 2.9 },
      { take: "canvas", mark: "minimap", off: 0.0, seconds: 2.2 },
    ],
  },
  {
    id: "boards", vo: "07-boards", kicker: "Boards", line: "As many as the work needs",
    camera: { scale: 1.03, ox: 50, oy: 30 },
    clips: [
      { take: "boards", mark: "landmark", off: 0.1, seconds: 3.3 },
      { take: "boards", mark: "list", off: 0.1, seconds: 3.2 },
    ],
  },
  {
    id: "plan", vo: "08-plan", kicker: "Planner", line: "Day to year, fullscreen",
    camera: { scale: 1.03, ox: 50, oy: 40 },
    clips: [
      { take: "planner", mark: "week", off: 0.1, seconds: 4.2 },
      { take: "views", at: 4.6, seconds: 1.6 },
      { take: "plan", mark: "full", off: 0.1, seconds: 4.2 },
    ],
  },
  {
    id: "themes", vo: "09-themes", kicker: "Themes", line: "Six palettes, dark included",
    camera: { scale: 1.045, ox: 50, oy: 30 },
    clips: [
      { take: "palettes", mark: "palette", off: 0.1, seconds: 3.9 },
      { take: "theme", at: 0.6, seconds: 3.9 },
    ],
  },
  {
    id: "close", vo: "10-close", len: 3.8, kicker: "", line: "",
    camera: { scale: 1.03, ox: 50, oy: 50 }, clips: [],
  },
];

const FPS = 30;
let cursor = 0;
const scenes = [];
let total = 0;
for (const beat of BEATS) {
  const spoken = timing[beat.vo] || 0;
  const want = beat.clips.length ? spoken + 1.0 : beat.len;
  let length = Math.round(want * FPS);
  const sum = beat.clips.reduce((a, c) => a + c.seconds, 0);
  const clips = beat.clips.map((c) => {
    const from = c.mark ? at(c.take, c.mark) + (c.off || 0) : c.at;
    return { src: "live/" + c.take + ".mp4", from, seconds: c.seconds };
  });
  if (clips.length && sum !== 0 && Math.abs(sum - length / FPS) > 0.15) {
    const k = length / FPS / sum;
    clips.forEach((c, i) => {
      c.seconds = i === clips.length - 1 ? Math.max(0.6, c.seconds * k) : c.seconds * k;
    });
  }
  scenes.push({
    id: beat.id,
    at: cursor,
    length,
    kicker: beat.kicker,
    line: beat.line,
    camera: beat.camera,
    clips,
  });
  cursor += length;
}
total = cursor;

const body = scenes
  .map(
    (s) => `  {
    id: "${s.id}",
    at: ${s.at},
    length: ${s.length},
    kicker: "${s.kicker}",
    line: "${s.line}",
    camera: { scale: ${s.camera.scale}, ox: ${s.camera.ox}, oy: ${s.camera.oy} },
    clips: [
${s.clips.map((c) => `      { src: "${c.src}", from: ${c.from.toFixed(2)}, seconds: ${c.seconds.toFixed(2)} },`).join("\n")}
    ],
  },`
  )
  .join("\n");

writeFileSync(
  HERE + "src/scenes.ts",
  `export type Clip = { src: string; from: number; seconds: number };
export type Scene = {
  id: string;
  at: number;
  length: number;
  kicker: string;
  line: string;
  camera: { scale: number; ox: number; oy: number };
  clips: Clip[];
};

export const FPS = ${FPS};
export const WINDOW = { w: 1400, h: 875, x: 260, y: 96 };
export const TOTAL = ${total};

export const SCENES: Scene[] = [
${body}
];
`
);
writeFileSync(
  HERE + "audio/scenes.json",
  JSON.stringify(
    {
      total: total / FPS,
      scenes: scenes.map((s) => ({ id: s.id, at: s.at / FPS, end: (s.at + s.length) / FPS })),
    },
    null,
    2
  ) + "\n"
);
console.log(scenes.map((s) => s.id + " " + (s.at / FPS).toFixed(1) + "s +" + (s.length / FPS).toFixed(1) + "s").join("\n"));
console.log("total " + (total / FPS).toFixed(2) + "s / " + total + " frames");
