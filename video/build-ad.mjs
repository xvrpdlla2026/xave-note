// Lays the ad out from the recorded narration: one beat per line of voice.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const timing = JSON.parse(readFileSync(HERE + "audio/vo-ad/timing.json", "utf8"));
const FPS = 30;
const ORDER = ["01-brand", "02-classic", "03-blocks", "04-canvas", "05-plan", "06-themes", "07-close"];
const PAD = 0.35;
const KICKER = {
  "01-brand": "",
  "02-classic": "Classic view",
  "03-blocks": "Blocks",
  "04-canvas": "Canvas",
  "05-plan": "Planner",
  "06-themes": "Themes",
  "07-close": "",
};

let cursor = 0;
const scenes = ORDER.map((id) => {
  const length = Math.max(45, Math.round((timing[id] + PAD) * FPS));
  const scene = { id: id.slice(3), at: cursor, length, kicker: KICKER[id] };
  cursor += length;
  return scene;
});

writeFileSync(
  HERE + "src/ad-scenes.ts",
  `export type AdScene = { id: string; at: number; length: number; kicker: string };

export const AD_FPS = ${FPS};
export const AD_TOTAL = ${cursor};

export const AD_SCENES: AdScene[] = [
${scenes.map((s) => `  { id: "${s.id}", at: ${s.at}, length: ${s.length}, kicker: "${s.kicker}" },`).join("\n")}
];
`
);
writeFileSync(
  HERE + "audio/ad-scenes.json",
  JSON.stringify(
    {
      total: cursor / FPS,
      scenes: scenes.map((s) => ({ id: s.id, at: s.at / FPS, end: (s.at + s.length) / FPS })),
    },
    null,
    2
  ) + "\n"
);
console.log(scenes.map((s) => s.id + " " + (s.at / FPS).toFixed(1) + "+" + (s.length / FPS).toFixed(1)).join("  "));
console.log("total " + (cursor / FPS).toFixed(2) + "s");
