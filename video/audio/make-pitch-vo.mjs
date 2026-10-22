// Narration for the PurPOSEFUL PARENTING pitch, one file per beat so the film can be timed to the voice.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = HERE + "vo-pitch/";
mkdirSync(OUT, { recursive: true });

const VOICE = "en-US-AndrewNeural";
const RATE = "+2%";
const FFMPEG = fileURLToPath(new URL("../node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe", import.meta.url));
const FFPROBE = fileURLToPath(new URL("../node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe", import.meta.url));

const LINES = [
  ["01-rent", "Right now, your members live on someone else's platform."],
  ["02-own", "You could own it. Your brand, your data, your rules."],
  ["03-paths", "Curriculums that sequence themselves, module by module."],
  ["04-track", "Progress that tracks behaviour, not just a finished video."],
  ["05-flag", "When a parent stalls, you know before they leave."],
  ["06-dash", "And every parent always knows their next step."],
  ["07-data", "Their progress lands in your CRM, not a rented dashboard."],
  ["08-close", "Own the platform once. Four to ten thousand, and it is yours."],
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
