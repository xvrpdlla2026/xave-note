// Narration, one file per scene so the film can be timed to the voice instead of the
// other way round. Edge's neural voices are free to use and need no key.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = HERE + "vo-ad/";
mkdirSync(OUT, { recursive: true });

const VOICE = "en-US-AndrewNeural";
const RATE = "+0%";
const FFMPEG = fileURLToPath(new URL("../node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe", import.meta.url));
const FFPROBE = fileURLToPath(new URL("../node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe", import.meta.url));

const LINES = [
  ["01-brand", "Xave. Notes, a board, and a planner."],
  ["02-classic", "Tabs, workspaces, and a tree of everything you have."],
  ["03-blocks", "Every block has a job. Notes, to-dos, links, files, comments, tables."],
  ["04-canvas", "Groups, landmarks, drawings, minimap. Drag to select, even pull blocks from your notes."],
  ["05-plan", "Plan the week, then take it fullscreen."],
  ["06-themes", "Six palettes, each with a dark side."],
  ["07-close", "Free, open source, and yours."],
];

const seconds = (file) => {
  if (existsSync(FFPROBE)) {
    const raw = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]).toString().trim();
    return Number(raw);
  }
  let err = "";
  try { execFileSync(FFMPEG, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] }); } catch (e) { err = String(e.stderr || ""); }
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(err);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

const durations = {};
for (const [name, text] of LINES) {
  const media = OUT + name + ".mp3";
  execFileSync("edge-tts", ["--voice", VOICE, "--rate=" + RATE, "--text", text, "--write-media", media], { stdio: "inherit" });
  execFileSync(FFMPEG, ["-y", "-v", "error", "-i", media, "-ar", "48000", "-ac", "1", OUT + name + ".wav"], { stdio: "inherit" });
  durations[name] = Math.round(seconds(media) * 1000) / 1000;
  console.log(name + "\t" + durations[name]);
}
writeFileSync(OUT + "timing.json", JSON.stringify(durations, null, 2) + "\n");
console.log("total " + Object.values(durations).reduce((a, b) => a + b, 0).toFixed(2) + "s of speech");
