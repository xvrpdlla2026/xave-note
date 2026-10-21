// Lays out the mesh film: one beat per line of voice, cut fast.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const timing = JSON.parse(readFileSync(HERE + "audio/vo-mesh/timing.json", "utf8"));
const FPS = 30;
const ORDER = ["01-limit", "02-agents", "03-beyond", "04-move", "05-mesh", "06-learn", "07-close"];
const PAD = 0.4;

let cursor = 0;
const scenes = ORDER.map((id) => {
  const length = Math.max(40, Math.round((timing[id] + PAD) * FPS));
  const scene = { id: id.slice(3), at: cursor, length };
  cursor += length;
  return scene;
});

writeFileSync(
  HERE + "src/ad2-scenes.ts",
  "export type MeshScene = { id: string; at: number; length: number };\n\n" +
    "export const MESH_FPS = " + FPS + ";\n" +
    "export const MESH_TOTAL = " + cursor + ";\n\n" +
    "export const MESH_SCENES: MeshScene[] = [\n" +
    scenes.map((s) => "  { id: \"" + s.id + "\", at: " + s.at + ", length: " + s.length + " },").join("\n") +
    "\n];\n"
);
writeFileSync(
  HERE + "audio/mesh-scenes.json",
  JSON.stringify({ total: cursor / FPS, scenes: scenes.map((s) => ({ id: s.id, at: s.at / FPS, end: (s.at + s.length) / FPS })) }, null, 2) + "\n"
);
console.log(scenes.map((s) => s.id + " " + (s.at / FPS).toFixed(1) + "+" + (s.length / FPS).toFixed(1)).join("  "));
console.log("total " + (cursor / FPS).toFixed(2) + "s");
