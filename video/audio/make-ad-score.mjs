// The ad needs its own score: 128 bpm, four on the floor, ducked under the voice.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RATE = 44100;
const SCENES = JSON.parse(readFileSync(HERE + "ad-scenes.json", "utf8")).scenes;
const TIMING = JSON.parse(readFileSync(HERE + "vo-ad/timing.json", "utf8"));
const ORDER = ["01-brand", "02-classic", "03-blocks", "04-canvas", "05-plan", "06-themes", "07-close"];
const VO_AT = {};
SCENES.forEach((s, i) => { VO_AT[ORDER[i]] = s.at; });

const END = SCENES[SCENES.length - 1].end;
const N = Math.ceil(RATE * (END + 0.06));
const musicL = new Float32Array(N);
const musicR = new Float32Array(N);
const fx = new Float32Array(N);
const voice = new Float32Array(N);
const voiceEnv = new Float32Array(N).fill(1);

let seed = 987654321;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return (seed / 2147483648) - 1;
};

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const put = (buf, i, v) => { if (i >= 0 && i < N) buf[i] += v; };
const stereo = (i, v, pan) => {
  const l = Math.cos((pan + 1) * Math.PI / 4);
  const r = Math.sin((pan + 1) * Math.PI / 4);
  put(musicL, i, v * l * 1.414);
  put(musicR, i, v * r * 1.414);
};

const BPM = 128;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const STEP = BEAT / 4;

const kick = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.34 * RATE);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const f = 46 + 150 * Math.exp(-t / 0.028);
    phase += 2 * Math.PI * f / RATE;
    const body = Math.sin(phase) * Math.exp(-t / 0.15);
    const click = Math.exp(-t / 0.004) * 0.5;
    put(musicL, s0 + i, (body + click) * gain);
    put(musicR, s0 + i, (body + click) * gain);
  }
};

const clap = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.2 * RATE);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.055) * (1 - Math.exp(-t / 0.002));
    const n = noise();
    hp = n - prev + hp * 0.6;
    prev = n;
    stereo(s0 + i, hp * e * gain, 0.1);
  }
};

const hat = (start, gain, open) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor((open ? 0.16 : 0.05) * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / (open ? 0.06 : 0.014));
    const n = noise();
    lp += (n - lp) * 0.85;
    stereo(s0 + i, (n - lp) * e * gain, 0.35);
  }
};

const bass = (start, freq, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const p = t / dur;
    const e = Math.min(1, t / 0.006) * Math.exp(-t / (dur * 1.4)) * (1 - p * 0.35);
    const saw = 2 * ((freq * t) % 1) - 1;
    const sq = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.35;
    lp += ((saw + sq) - lp) * 0.22;
    stereo(s0 + i, lp * e * gain, 0);
  }
};

const pluck = (start, freq, gain, pan, decay) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(decay * 3.2 * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.003));
    const raw = Math.sin(2 * Math.PI * freq * t) + 0.45 * Math.sin(4 * Math.PI * freq * t) + 0.18 * Math.sin(6 * Math.PI * freq * t);
    lp += (raw - lp) * 0.45;
    stereo(s0 + i, lp * e * gain, pan);
  }
};

const pad = (start, notes, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  notes.forEach((n, k) => {
    const f = midi(n);
    const pan = (k - 1.5) * 0.25;
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      const e = Math.min(1, t / 0.22) * Math.min(1, (dur - t) / 0.3);
      const v = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 1.004 * t) + 0.16 * Math.sin(2 * Math.PI * f * 0.5 * t);
      stereo(s0 + i, v * e * gain, pan);
    }
  });
};

const riser = (start, dur, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(dur * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const p = i / len;
    lp += (noise() - lp) * (0.03 + p * p * 0.55);
    const e = p * p;
    put(fx, s0 + i, lp * e * gain);
  }
};

const impact = (start, gain) => {
  const s0 = Math.floor(start * RATE);
  const len = Math.floor(0.5 * RATE);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const e = Math.exp(-t / 0.16);
    const sub = Math.sin(2 * Math.PI * (72 - 20 * Math.min(1, t / 0.2)) * t) * 0.7;
    lp += (noise() - lp) * 0.6;
    put(fx, s0 + i, (sub + lp * 0.4 * Math.exp(-t / 0.05)) * e * gain);
  }
};

const CHORDS = [
  { root: 45, notes: [57, 60, 64, 69], arp: [0, 2, 3, 1, 3, 2, 1, 3] },
  { root: 41, notes: [53, 57, 60, 65], arp: [0, 3, 1, 2, 3, 1, 2, 1] },
  { root: 48, notes: [55, 60, 64, 67], arp: [1, 2, 0, 3, 2, 3, 1, 2] },
  { root: 43, notes: [55, 59, 62, 67], arp: [2, 0, 3, 1, 0, 2, 3, 1] },
];

// Some bars drop the offbeat bass and one hat so the loop does not turn into wallpaper.
const HOOK = { LIFT: 0, DRIVE: 1, BREAK: 2, RUSH: 3 };
const barMode = (bar) => (bar % 16 === 12 ? HOOK.BREAK : bar % 8 === 7 ? HOOK.RUSH : bar % 4 === 2 ? HOOK.LIFT : HOOK.DRIVE);

const TOTAL_BEATS = Math.ceil((END + 0.4) / BEAT);
for (let b = 0; b < TOTAL_BEATS; b++) {
  const t = b * BEAT;
  const bar = Math.floor(b / 4);
  const beatInBar = b % 4;
  const mode = barMode(bar);
  const chord = CHORDS[bar % CHORDS.length];
  kick(t, t < 0.3 ? 0.5 : 0.95);
  if (beatInBar === 1 || beatInBar === 3) clap(t, 0.34);
  for (let s = 0; s < 4; s++) {
    const st = t + s * STEP;
    const gated = mode === HOOK.BREAK && s > 1;
    if (!gated) {
      if (s === 2) hat(st, 0.16, true);
      else hat(st, 0.1 + (s === 0 ? 0.03 : 0), false);
    }
    if (s % 2 === 0 || mode === HOOK.RUSH) {
      const octave = s === 2 ? 12 : 0;
      bass(st, midi(chord.root + octave), STEP * 1.6, 0.42);
    }
    if (!gated && (s !== 3 || mode === HOOK.RUSH)) {
      const note = chord.notes[chord.arp[(b * 4 + s) % chord.arp.length]] + 12;
      const accent = s === 0 ? 0.34 : 0.24;
      pluck(st, midi(note), accent, s === 0 ? -0.4 : s === 2 ? 0.45 : 0.05, mode === HOOK.BREAK ? 0.3 : 0.17);
    }
  }
  if (beatInBar === 0) {
    const dur = BAR * (mode === HOOK.BREAK ? 1.4 : 1.02);
    pad(t, chord.notes, dur, mode === HOOK.LIFT ? 0.09 : 0.07);
  }
}

// The music breathes with the kick instead of sitting flat.
for (let b = 0; b < TOTAL_BEATS; b++) {
  const s0 = Math.floor(b * BEAT * RATE);
  const len = Math.floor(BEAT * RATE);
  for (let i = 0; i < len && s0 + i < N; i++) {
    const p = i / len;
    const duck = 0.42 + 0.58 * Math.min(1, Math.pow(p, 0.55));
    musicL[s0 + i] *= duck;
    musicR[s0 + i] *= duck;
  }
}

// Every new beat of the edit gets an impact and a riser into it.
SCENES.slice(1).forEach((s) => {
  impact(s.at, 0.4);
  riser(s.at - 0.5, 0.5, 0.22);
});
impact(END - 0.02, 0.5);

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

const DUCK = 0.3;
const RAMP = Math.floor(0.3 * RATE);
ORDER.forEach((id) => {
  const at = VO_AT[id];
  const clip = readWav(resolve(HERE, "vo-ad", id + ".wav"));
  const s0 = Math.floor(at * RATE);
  for (let i = 0; i < clip.length; i++) put(voice, s0 + i, clip[i]);
  const s1 = Math.min(N, s0 + clip.length);
  for (let i = s0; i < s1; i++) voiceEnv[i] = Math.min(voiceEnv[i], DUCK);
  for (let i = 0; i < RAMP; i++) {
    const g = DUCK + (1 - DUCK) * (i / RAMP);
    if (s0 - RAMP + i >= 0) voiceEnv[s0 - RAMP + i] = Math.min(voiceEnv[s0 - RAMP + i], g);
    if (s1 + i < N) voiceEnv[s1 + i] = Math.min(voiceEnv[s1 + i], 1 - (1 - DUCK) * (i / RAMP));
  }
});

const left = new Float32Array(N);
const right = new Float32Array(N);
let peak = 0;
let nanAt = -1;
for (let i = 0; i < N; i++) {
  if (nanAt < 0 && (!Number.isFinite(musicL[i]) || !Number.isFinite(fx[i]) || !Number.isFinite(voice[i]))) nanAt = i;
  const fade = Math.min(1, (N - i) / (RATE * 0.9));
  const m = (musicL[i] * 0.62 + fx[i] * 1.05) * voiceEnv[i] * fade;
  const v = voice[i] * 1.15 * fade;
  left[i] = m + v;
  right[i] = (musicR[i] * 0.62 + fx[i] * 1.05) * voiceEnv[i] * fade + v;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
if (nanAt >= 0) throw new Error("nan at " + (nanAt / RATE).toFixed(3) + "s");
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
writeFileSync(resolve(HERE, "../public/ad.wav"), Buffer.concat([header, pcm]));
console.log("ad.wav " + (Math.round((44 + pcm.length) / 1e5) / 10) + " MB, peak " + peak.toFixed(2) + ", gain " + norm.toFixed(2));
