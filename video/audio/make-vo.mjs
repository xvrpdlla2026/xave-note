// Narration, one file per scene so the film can be timed to the voice instead of the
// other way round. Edge's neural voices are free to use and need no key.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = HERE + "vo/";
mkdirSync(OUT, { recursive: true });

const VOICE = "en-US-AndrewNeural";
const RATE = "-6%";
const FFMPEG = fileURLToPath(new URL("../node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe", import.meta.url));
const FFPROBE = fileURLToPath(new URL("../node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe", import.meta.url));

const LINES = [
  ["01-brand", "This is Xave. A notebook, an infinite board, and a planner, in one place."],
  ["02-classic", "Start in the classic view. Open as many tabs as you like, and keep a separate workspace for each part of your life."],
  ["03-editor", "The editor stays plain until you want more. Bold, headings, lists, checkboxes, highlights, and it saves on every keystroke."],
  ["04-tree", "Folders nest as deep as you need, and Control K finds any note by a word you remember."],
  ["05-blocks", "On the board, every block has a job. Notes, to-dos, links, files, comments, tables. And add from your notes pulls one straight in from the library."],
  ["06-canvas", "Drag to select several at once and group them. Drop a landmark, sketch on the canvas, and the minimap keeps the whole board in reach."],
  ["07-boards", "One board for the roadmap, another for the launch. Make as many as the work needs."],
  ["08-plan", "The planner is a real calendar, day to year, and it goes fullscreen when the week gets loud."],
  ["09-themes", "Six palettes, each with its own dark side."],
  ["10-close", "Xave. Free, open source, and yours."],
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
