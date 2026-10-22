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
    "01-rent",
    "Right now, your parents learn inside a platform you rent."
  ],
  [
    "02-own",
    "Here is what owning it replaces, in five groups."
  ],
  [
    "03-g1",
    "Platform and branding. A hundred percent white label platform matching her premium authority, with zero per member fees and no platform ceilings."
  ],
  [
    "04-g2",
    "Curriculum and student experience. Custom learning paths with step by step sequencing, and parent dashboards that always show the next step."
  ],
  [
    "05-g3",
    "Tracking and retention. Implementation is tracked by action, worksheets rather than videos, and automated early warning triggers catch stalled students."
  ],
  [
    "06-g4",
    "Native tools that replace third party subscriptions. Built in chat and community messaging instead of ManyChat, integrated email and notifications, and native checkout with subscription management."
  ],
  [
    "07-g5",
    "Operations and data. Review and approval before anything publishes, AI assisted production to speed lesson creation up, and full data ownership with native CRM integration."
  ],
  [
    "08-close",
    "That is the proposal. Four to ten thousand, scoped to your goals, built once and yours."
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
