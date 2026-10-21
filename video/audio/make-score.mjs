// Builds the soundtrack: a score that moves through sections, sound effects on the
// moments that matter, and the narration sitting on top with the music ducked under it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RATE = 44100;
const SCENE_FILE = JSON.parse(readFileSync(HERE + (process.env.SCENES || "scenes.json"), "utf8"));
const DURATION = SCENE_FILE.total;
const N = Math.ceil(RATE * DURATION);
const music = new Float32Array(N);
const fx = new Float32Array(N);

const rand = (() => {
  let s = 12345;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
})();

const SCENES = SCENE_FILE.scenes.map((s) => ({ at: s.at, end: s.end }));

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [
  { root: 53, notes: [65, 69, 72, 76] },
  { root: 48, notes: [64, 67, 71, 74] },
  { root: 55, notes: [62, 67, 69, 74] },
  { root: 57, notes: [64, 69, 72, 76] },
];

const add = (buf, i, v) => {
  if (i >= 0 && i < N) buf[i] += v;
};

const env = (t, dur, a = 0.01, r = 0.12) => {
  if (t < 0 || t > dur) return 0;
  const up = Math.min(1, t / a);
  const down = Math.min(1, (dur - t) / r);
  return Math.max(0, Math.min(up, down));
};

const pad = (freq, start, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = env(t, dur, 0.35, 0.5);
    const v =
      Math.sin(2 * Math.PI * freq * t) * 0.6 +
      Math.sin(2 * Math.PI * freq * 2.002 * t) * 0.16 +
      Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.22;
    add(music, s0 + i, v * e * gain);
  }
};

const pluck = (freq, start, gain, decay = 0.45) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(decay * 4 * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.004));
    const raw = Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(4 * Math.PI * freq * t);
    lp += (raw - lp) * 0.35;
    add(music, s0 + i, lp * e * gain);
  }
};

const bell = (freq, start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(2.4 * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.85) * (1 - Math.exp(-t / 0.006));
    const v =
      Math.sin(2 * Math.PI * freq * t) * 0.7 +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.2 +
      Math.sin(2 * Math.PI * freq * 3.01 * t) * 0.08;
    add(music, s0 + i, v * e * gain);
  }
};

const kick = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.32 * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const f = 118 * Math.exp(-t / 0.045) + 44;
    const e = Math.exp(-t / 0.11);
    add(music, s0 + i, Math.sin(2 * Math.PI * f * t) * e * gain);
  }
};

const clap = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.16 * RATE);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.045);
    const n = rand();
    hp = n - prev + hp * 0.55;
    prev = n;
    add(music, s0 + i, hp * e * gain);
  }
};

const shaker = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.07 * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.018);
    lp += (rand() - lp) * 0.7;
    add(music, s0 + i, lp * e * gain);
  }
};

const whoosh = (start, gain, len = 0.55) => {
  const s0 = Math.floor((start - len * 0.6) * RATE);
  const n = Math.floor(len * RATE);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const p = i / n;
    const cut = 0.06 + p * 0.5;
    lp += (rand() - lp) * cut;
    add(fx, s0 + i, lp * Math.sin(Math.PI * p) * gain);
  }
};

const tick = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.035 * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.006);
    lp += (rand() - lp) * 0.9;
    add(fx, s0 + i, lp * e * gain);
  }
};

const pop = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.22 * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const f = 320 + 220 * (1 - Math.exp(-t / 0.03));
    add(fx, s0 + i, Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.07) * gain);
  }
};

// Two bars of one chord, cycling every four bars.
const bar = 2.4;
const beat = 0.6;
let chordIndex = 0;
for (let t = 0; t < DURATION - 0.2; t += bar) {
  const scene = SCENES.findIndex((s) => t >= s.at && t < s.end);
  const chord = CHORDS[chordIndex % CHORDS.length];
  const gain = scene === 0 ? 0.15 : scene === 6 ? 0.17 : 0.13;
  chord.notes.forEach((n, i) => pad(midi(n), t, bar * 1.02, gain * (i === 0 ? 1 : 0.72)));
  chordIndex++;
}

// Arpeggio and percussion, section by section.
const ARP = [0, 2, 1, 3, 2, 1, 3, 1];
for (let s = 1; s <= 6; s++) {
  const scene = SCENES[s];
  const step = s === 1 ? 0.3 : 0.15;
  const loud = s === 5 ? 0.0 : s === 6 ? 0.03 : 0.055;
  const chordFor = (t) => CHORDS[Math.floor(t / (bar * 2)) % CHORDS.length];
  for (let t = scene.at; t < scene.end - 0.05; t += step) {
    const chord = chordFor(t);
    const idx = Math.round((t - scene.at) / step) % ARP.length;
    const note = chord.notes[ARP[idx]] + 12;
    if (loud > 0) pluck(midi(note), t, loud, s === 1 ? 0.4 : 0.22);
  }
  if (s === 2 || s === 3 || s === 4 || s === 6) {
    for (let t = scene.at; t < scene.end - 0.1; t += beat * 2) {
      kick(t, s === 3 ? 0.3 : 0.22);
      if (s !== 2) clap(t + beat, s === 3 ? 0.12 : 0.09);
    }
    for (let t = scene.at; t < scene.end - 0.1; t += beat / 2) {
      shaker(t, s === 4 ? 0.02 : 0.035);
    }
  }
}

// A bell motif on the plan and close sections.
bell(midi(77), 19.9, 0.1);
bell(midi(81), 21.5, 0.08);
bell(midi(79), 23.1, 0.08);
bell(midi(84), 36.9, 0.11);
bell(midi(88), 38.2, 0.07);

// Section transitions.
SCENES.slice(1).forEach((s) => whoosh(s.at, 0.1));
whoosh(36.0, 0.07, 0.8);

// Interaction sounds, placed on what the picture actually does.
const typing = (from, to, gap) => {
  for (let t = from; t < to; t += gap + Math.abs(rand()) * 0.03) tick(t, 0.05);
};
typing(6.9, 12.3, 0.075);
typing(13.9, 16.1, 0.08);
typing(20.6, 21.4, 0.09);
pop(17.9, 0.16);
bell(midi(84), 26.1, 0.06);
pop(27.4, 0.12);
pop(31.9, 0.1);

const scan = (name, buf) => {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) { console.log("NaN in " + name + " at " + i + " (" + (i / RATE).toFixed(3) + "s)"); return; }
  console.log(name + " clean");
};
scan("music", music);
scan("fx", fx);

// Narration on top, music ducked under it.
const vo = [
  ["01-brand", 0.45],
  ["02-write", 6.45],
  ["03-board", 12.85],
  ["04-plan", 19.75],
  ["05-find", 26.65],
  ["06-trust", 31.65],
  ["07-close", 36.35],
];

const readWav = (path) => {
  const buf = readFileSync(path);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("bad wav " + path);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      sum += bytes === 2 ? data.readInt16LE(o) / 32768 : data.readFloatLE(o);
    }
    mono[i] = sum / fmt.channels;
  }
  const out = new Float32Array(Math.ceil((frames / fmt.rate) * RATE));
  for (let i = 0; i < out.length; i++) {
    const x = Math.min(frames - 1.001, (i / RATE) * fmt.rate);
    const i0 = Math.floor(x);
    const i1 = Math.min(frames - 1, i0 + 1);
    const f = x - i0;
    out[i] = mono[i0] * (1 - f) + mono[i1] * f;
  }
  return out;
};

const voice = new Float32Array(N);
const voiceEnv = new Float32Array(N).fill(1);
vo.forEach(([name, at]) => {
  const clip = readWav(resolve(HERE, "vo", name + ".wav"));
  const s0 = Math.floor(at * RATE);
  for (let i = 0; i < clip.length; i++) add(voice, s0 + i, clip[i]);
});

vo.forEach(([name, at], index) => {
  const len = readWav(resolve(HERE, "vo", name + ".wav")).length;
  const s0 = Math.floor(at * RATE);
  const s1 = Math.min(N, s0 + len);
  for (let i = s0; i < s1; i++) voiceEnv[i] = 0.38;
  const ramp = Math.floor(0.28 * RATE);
  for (let i = 0; i < ramp; i++) {
    const g = 0.38 + (1 - 0.38) * (i / ramp);
    if (s0 - ramp + i >= 0) voiceEnv[s0 - ramp + i] = Math.min(voiceEnv[s0 - ramp + i], g);
    if (s1 + i < N) voiceEnv[s1 + i] = Math.min(voiceEnv[s1 + i], 1 - (1 - 0.38) * (i / ramp));
  }
  if (index === vo.length - 1) {
    for (let i = s1; i < N; i++) voiceEnv[i] = Math.min(voiceEnv[i], 0.7);
  }
});

scan("voice", voice);
scan("voiceEnv", voiceEnv);
const out = Buffer.alloc(N * 4);
let peak = 0;
const left = new Float32Array(N);
const right = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (RATE * 1.2));
  const m = (music[i] * 0.85 + fx[i] * 1.2) * voiceEnv[i] * fade;
  const v = voice[i] * 1.0 * fade;
  left[i] = m * 0.94 + v;
  right[i] = m * 1.0 + v;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const norm = peak > 0.98 ? 0.98 / peak : 1;
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * norm * 32767))), i * 4);
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * norm * 32767))), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + out.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(out.length, 40);
mkdirSync(resolve(HERE, "../public"), { recursive: true });
writeFileSync(resolve(HERE, "../public/sound.wav"), Buffer.concat([header, out]));
console.log("sound.wav " + (Math.round((44 + out.length) / 1e5) / 10) + " MB, peak " + peak.toFixed(2) + ", gain " + norm.toFixed(2));
