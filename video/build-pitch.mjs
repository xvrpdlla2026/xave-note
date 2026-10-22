// Lays out the platform proposal: one slide per line of voice.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const timing = JSON.parse(readFileSync(HERE + "audio/vo-pitch/timing.json", "utf8"));
const FPS = 30;
const ORDER = ["01-rent","02-own","03-g1","04-g2","05-g3","06-g4","07-g5","08-close"];
const PAD = 0.5;

let cursor = 0;
const scenes = ORDER.map((id) => {
  const length = Math.max(50, Math.round((timing[id] + PAD) * FPS));
  const scene = { id: id.slice(3), at: cursor, length };
  cursor += length;
  return scene;
});

writeFileSync(
  HERE + "src/pitch-scenes.ts",
  "export type PitchScene = { id: string; at: number; length: number };\n\n" +
    "export const PITCH_FPS = " + FPS + ";\n" +
    "export const PITCH_TOTAL = " + cursor + ";\n\n" +
    "export const PITCH_SCENES: PitchScene[] = [\n" +
    scenes.map((s) => "  { id: \"" + s.id + "\", at: " + s.at + ", length: " + s.length + " },").join("\n") +
    "\n];\n"
);
writeFileSync(
  HERE + "audio/pitch-scenes.json",
  JSON.stringify({ total: cursor / FPS, scenes: scenes.map((s) => ({ id: s.id, at: s.at / FPS, end: (s.at + s.length) / FPS })) }, null, 2) + "\n"
);
console.log(scenes.map((s) => s.id + " " + (s.at / FPS).toFixed(1) + "+" + (s.length / FPS).toFixed(1)).join("  "));
console.log("total " + (cursor / FPS).toFixed(2) + "s");
