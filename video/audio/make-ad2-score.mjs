// A darker score for the mesh film: sub drone, slow filtered pulse, metal ticks.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RATE = 44100;
const SCENES = JSON.parse(readFileSync(HERE + "mesh-scenes.json", "utf8")).scenes;
const ORDER = ["01-limit", "02-agents", "03-move", "04-mesh", "05-learn", "06-close"];
const END = SCENES[SCENES.length - 1].end;
const N = Math.ceil(RATE * (END + 0.08));
const music = new Float32Array(N);
const fx = new Float32Array(N);
const voice = new Float32Array(N);
const duck = new Float32Array(N).fill(1);

let seed = 24681357;
const noise = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return (seed / 1073741824) - 1;
};
const put = (buf, i, v) => { if (i >= 0 && i < N) buf[i] += v; };

const BPM = 96;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;

const sub = (start, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.6);
    const wob = 1 + Math.sin(2 * Math.PI * 0.08 * t) * 0.004;
    put(music, s0 + i, (Math.sin(2 * Math.PI * 41.2 * wob * t) * 0.9 + Math.sin(2 * Math.PI * 55 * t) * 0.16) * e * gain);
  }
};

const drone = (start, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  const notes = [55, 82.4, 110, 130.8];
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const p2 = i / len;
    const e = Math.min(1, t / 1.4) * Math.min(1, (dur - t) / 1.6);
    let v = 0;
    for (let k = 0; k < notes.length; k++) {
      const f = notes[k] * (1 + (k % 2 ? 0.003 : -0.002));
      v += Math.sin(2 * Math.PI * f * t + k) * (0.4 / (k + 1));
    }
    const cutoff = 0.02 + p2 * 0.1;
    lp += (v - lp) * cutoff;
    put(music, s0 + i, lp * e * gain);
  }
};

const thump = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.5 * RATE);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const f = 38 + 90 * Math.exp(-t / 0.05);
    phase += 2 * Math.PI * f / RATE;
    put(music, s0 + i, Math.sin(phase) * Math.exp(-t / 0.22) * gain);
  }
};

const tick = (start, gain, high) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.09 * RATE);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const n = noise();
    hp = n - prev + hp * 0.4;
    prev = n;
    const e = Math.exp(-t / (high ? 0.012 : 0.026));
    put(music, s0 + i, hp * e * gain);
  }
};

const riser = (start, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p2 = i / len;
    const lpCut = 0.004 + Math.pow(p2, 2.4) * 0.5;
    lp += (noise() - lp) * lpCut;
    const tone = Math.sin(2 * Math.PI * (110 + p2 * 660) * (i / RATE)) * 0.16 * p2;
    put(fx, s0 + i, (lp * 0.9 + tone) * Math.pow(p2, 1.8) * gain);
  }
};

const impact = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.9 * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.3);
    const f = 34 + 60 * Math.exp(-t / 0.08);
    lp += (noise() - lp) * 0.35;
    put(fx, s0 + i, (Math.sin(2 * Math.PI * f * t) * 0.8 + lp * 0.5 * Math.exp(-t / 0.06)) * e * gain);
  }
};

const shimmer = (start, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  const fs = [880, 1174.7, 1567.98, 2093];
  for (let k = 0; k < fs.length; k++) {
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      const e = Math.min(1, t / 0.8) * Math.min(1, (dur - t) / 1.2) * (0.4 + 0.6 * Math.abs(Math.sin(2 * Math.PI * 0.25 * t + k)));
      put(music, s0 + i, Math.sin(2 * Math.PI * fs[k] * t) * 0.02 * e * gain);
    }
  }
};

sub(0, END, 0.5);
drone(0.1, END - 0.2, 1.5);
SCENES.forEach((s, i) => {
  impact(s.at, i === 0 ? 0.5 : 0.36);
  if (i > 0) riser(s.at - 0.85, 0.85, 0.3);
});

const pulseStart = SCENES[1].at;
const pulseEnd = SCENES[SCENES.length - 1].at;
const steps = Math.floor((pulseEnd - pulseStart) / STEP);
for (let s = 0; s < steps; s++) {
  const t = pulseStart + s * STEP;
  const inBar = s % 8;
  if (inBar % 4 === 0) thump(t, 0.34);
  if (inBar === 2 || inBar === 6) tick(t, 0.16, true);
  if (inBar === 3 || inBar === 7) tick(t, 0.1, false);
}
shimmer(SCENES[3].at, SCENES[3].end - SCENES[3].at, 1);
shimmer(SCENES[4].at, SCENES[4].end - SCENES[4].at, 0.7);

for (let s = 0; s < Math.floor((pulseEnd - pulseStart) / STEP); s++) {
  if (s % 4 !== 0) continue;
  const s0 = Math.floor((pulseStart + s * STEP) * RATE);
  const len = Math.floor(BEAT * RATE);
  for (let i = 0; i < len && s0 + i < N; i++) {
    duck[s0 + i] = Math.min(duck[s0 + i], 0.5 + 0.5 * Math.min(1, Math.pow(i / len, 0.5)));
  }
}

const readWav = (path) => {
  const buf = readFileSync(path);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === "data") data = buf.subarray(body, body + size);
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
    const fr = x - i0;
    out[i] = mono[i0] * (1 - fr) + mono[i1] * fr;
  }
  return out;
};

const DUCK = 0.26;
const RAMP = Math.floor(0.28 * RATE);
ORDER.forEach((id, k) => {
  const at = SCENES[k].at;
  const clip = readWav(resolve(HERE, "vo-mesh", id + ".wav"));
  const s0 = Math.floor(at * RATE);
  for (let i = 0; i < clip.length; i++) put(voice, s0 + i, clip[i]);
  const s1 = Math.min(N, s0 + clip.length);
  for (let i = s0; i < s1; i++) duck[i] = Math.min(duck[i], DUCK);
  for (let i = 0; i < RAMP; i++) {
    if (s0 - RAMP + i >= 0) duck[s0 - RAMP + i] = Math.min(duck[s0 - RAMP + i], DUCK + (1 - DUCK) * (i / RAMP));
    if (s1 + i < N) duck[s1 + i] = Math.min(duck[s1 + i], 1 - (1 - DUCK) * (i / RAMP));
  }
});

const left = new Float32Array(N);
const right = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (RATE * 1.1)) * Math.min(1, i / (RATE * 0.05));
  const m = music[i] * duck[i] * 0.72 * fade;
  const f = fx[i] * (0.35 + duck[i] * 0.65) * fade;
  const v = voice[i] * 1.2 * fade;
  left[i] = m + f * 0.9 + v;
  right[i] = m * 0.92 + f + v;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const norm = peak > 0.95 ? 0.95 / peak : 1;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * norm * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * norm * 32767))), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
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
header.writeUInt32LE(pcm.length, 40);
mkdirSync(resolve(HERE, "../public"), { recursive: true });
writeFileSync(resolve(HERE, "../public/mesh.wav"), Buffer.concat([header, pcm]));
console.log("mesh.wav " + (Math.round((44 + pcm.length) / 1e5) / 10) + " MB, peak " + peak.toFixed(2) + ", gain " + norm.toFixed(2));