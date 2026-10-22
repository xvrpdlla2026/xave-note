// Narration for the platform proposal, one file per slide so the film is timed to the voice.
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
  [
    "01-watch",
    "Maria joined for the promise of change. Every night she opened a lesson, and watched."
  ],
  [
    "02-ask",
    "A week passed, and nothing in her house had changed. So the platform stopped asking her to watch. It asked her to do one small thing."
  ],
  [
    "03-script",
    "Tonight's next step: run the bedtime script. Twelve minutes, one page. She ran it, the house went quiet, and for the first time the platform knew."
  ],
  [
    "04-track",
    "Because progress here is not a finished video. It is a worksheet on the fridge, a script that worked, a behaviour that changed."
  ],
  [
    "05-flag",
    "Then life got loud again, and Maria went quiet for five days. The platform noticed before she left, flagged it, and told her coach."
  ],
  [
    "06-back",
    "A message went out that afternoon. Maria came back. That is retention you can see, instead of guess."
  ],
  [
    "07-own",
    "Your brand on all of it. No per member fees, and no ceiling on how far it grows."
  ],
  [
    "08-close",
    "One platform, built once, owned by you. Four to ten thousand, scoped to your goals."
  ]
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
