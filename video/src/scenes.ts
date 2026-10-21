export type Clip = { src: string; from: number; seconds: number };
export type Scene = {
  id: string;
  at: number;
  length: number;
  kicker: string;
  line: string;
  camera: { scale: number; ox: number; oy: number };
  clips: Clip[];
};

export const FPS = 30;
export const WINDOW = { w: 1400, h: 875, x: 260, y: 96 };
export const TOTAL = 2225;

export const SCENES: Scene[] = [
  {
    id: "brand",
    at: 0,
    length: 132,
    kicker: "",
    line: "A notebook, a board, and a planner.",
    camera: { scale: 1.03, ox: 50, oy: 50 },
    clips: [

    ],
  },
  {
    id: "classic",
    at: 132,
    length: 245,
    kicker: "Classic view",
    line: "Tabs and workspaces",
    camera: { scale: 1.04, ox: 50, oy: 12 },
    clips: [
      { src: "live/classic.mp4", from: 0.70, seconds: 3.88 },
      { src: "live/classic.mp4", from: 5.65, seconds: 4.29 },
    ],
  },
  {
    id: "editor",
    at: 377,
    length: 310,
    kicker: "Editor",
    line: "Format when you need it",
    camera: { scale: 1.05, ox: 50, oy: 34 },
    clips: [
      { src: "live/notes.mp4", from: 2.40, seconds: 4.93 },
      { src: "live/notes.mp4", from: 6.60, seconds: 5.40 },
    ],
  },
  {
    id: "tree",
    at: 687,
    length: 222,
    kicker: "Sidebar",
    line: "Folders, and Control K",
    camera: { scale: 1.04, ox: 34, oy: 26 },
    clips: [
      { src: "live/tree.mp4", from: 0.56, seconds: 7.40 },
    ],
  },
  {
    id: "blocks",
    at: 909,
    length: 376,
    kicker: "Board",
    line: "A block for every job",
    camera: { scale: 1.04, ox: 50, oy: 46 },
    clips: [
      { src: "live/board.mp4", from: 2.40, seconds: 7.74 },
      { src: "live/board.mp4", from: 9.00, seconds: 4.79 },
    ],
  },
  {
    id: "canvas",
    at: 1285,
    length: 295,
    kicker: "Canvas",
    line: "Select, group, mark, draw",
    camera: { scale: 1.035, ox: 52, oy: 52 },
    clips: [
      { src: "live/canvas.mp4", from: 21.84, seconds: 4.87 },
      { src: "live/canvas.mp4", from: 29.96, seconds: 2.82 },
      { src: "live/canvas.mp4", from: 32.67, seconds: 2.14 },
    ],
  },
  {
    id: "boards",
    at: 1580,
    length: 188,
    kicker: "Boards",
    line: "As many as the work needs",
    camera: { scale: 1.03, ox: 50, oy: 30 },
    clips: [
      { src: "live/boards.mp4", from: 0.61, seconds: 3.18 },
      { src: "live/boards.mp4", from: 6.01, seconds: 3.09 },
    ],
  },
  {
    id: "plan",
    at: 1768,
    length: 214,
    kicker: "Planner",
    line: "Day to year, fullscreen",
    camera: { scale: 1.03, ox: 50, oy: 40 },
    clips: [
      { src: "live/planner.mp4", from: 3.89, seconds: 3.00 },
      { src: "live/views.mp4", from: 4.60, seconds: 1.14 },
      { src: "live/plan.mp4", from: 15.12, seconds: 3.00 },
    ],
  },
  {
    id: "themes",
    at: 1982,
    length: 129,
    kicker: "Themes",
    line: "Six palettes, dark included",
    camera: { scale: 1.045, ox: 50, oy: 30 },
    clips: [
      { src: "live/palettes.mp4", from: 3.49, seconds: 2.15 },
      { src: "live/theme.mp4", from: 0.60, seconds: 2.15 },
    ],
  },
  {
    id: "close",
    at: 2111,
    length: 114,
    kicker: "",
    line: "",
    camera: { scale: 1.03, ox: 50, oy: 50 },
    clips: [

    ],
  },
];
