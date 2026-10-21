// Writes the quiet bed under the film: one pad that follows the three chords, a low
// drone for body, and a soft bloom on each cut. No samples, so nothing to license.
import { writeFileSync } from "node:fs";

const RATE = 48000;
const SECONDS = 30;
const N = RATE * SECONDS;
const TAU = Math.PI * 2;

const left = new Float32Array(N);
const right = new Float32Array(N);

const CHORDS = [
  [110, 164.81, 261.63, 392],
  [87.31, 130.81, 220, 329.63],
  [130.81, 196, 329.63, 246.94],
];
const SPAN = 10;
const FADE = 2.5;
const CUTS = [0, 3.2, 8.73, 14.4, 20.13, 24.93, 27.6];

const chordAt = (t) => {
  const i = Math.min(CHORDS.length - 1, Math.floor(t / SPAN));
  const local = t - i * SPAN;
  const next = Math.min(CHORDS.length - 1, i + 1);
  const blend = i === next ? 0 : Math.min(1, Math.max(0, (local - (SPAN - FADE)) / FADE));
  return { a: CHORDS[i], b: CHORDS[next], blend };
};

const gainFor = (voices, f) => {
  let g = 0;
  for (const v of voices) g += v(1 / f);
  return g;
};

const pad = (f, t, detune, phaseOffset) => {
  const d = 1 + detune;
  let s = 0;
  s += Math.sin(TAU * f * d * t + phaseOffset) * 1.0;
  s += Math.sin(TAU * f * 2 * d * t + phaseOffset * 1.7) * 0.3;
  s += Math.sin(TAU * f * 3 * d * t + phaseOffset * 2.3) * 0.12;
  s += Math.sin(TAU * f * 4 * d * t + phaseOffset * 3.1) * 0.05;
  return s;
};

let lpL = 0;
let lpR = 0;
const LP = 0.16;

for (let i = 0; i < N; i++) {
  const t = i / RATE;
  const { a, b, blend } = chordAt(t);
  const trem = 0.93 + 0.07 * Math.sin(TAU * 0.09 * t);
  let slim = 0;
  let srim = 0;
  for (let v = 0; v < a.length; v++) {
    const fa = a[v];
    const fb = b[v];
    const pa = pad(fa, t, -0.0016, v * 1.3);
    const pb = pad(fa, t, 0.0018, v * 2.1);
    const qa = pad(fb, t, -0.0016, v * 1.3);
    const qb = pad(fb, t, 0.0018, v * 2.1);
    slim += (pa * (1 - blend) + qa * blend) * 0.25;
    srim += (pb * (1 - blend) + qb * blend) * 0.25;
  }
  slim *= trem;
  srim *= trem;

  const sub = Math.sin(TAU * 55 * t) * 0.5 + Math.sin(TAU * 82.41 * t) * 0.2;

  lpL += LP * (slim + sub * 0.5 - lpL);
  lpR += LP * (srim + sub * 0.5 - lpR);

  left[i] = lpL * 0.5;
  right[i] = lpR * 0.5;
}

for (const cut of CUTS) {
  const start = Math.floor(cut * RATE);
  const length = Math.floor(1.4 * RATE);
  let noise = 0;
  for (let k = 0; k < length && start + k < N; k++) {
    const t = k / RATE;
    const attack = Math.min(1, t / 0.35);
    const decay = Math.exp(-t / 0.45);
    const env = attack * decay;
    noise = noise * 0.72 + (Math.random() * 2 - 1) * 0.28;
    const bloom = noise * env * 0.085;
    const pluck = Math.sin(TAU * 659.25 * t) * Math.exp(-t / 0.28) * 0.05;
    const thump = Math.sin(TAU * 123.47 * t) * Math.exp(-t / 0.33) * 0.09;
    const sample = bloom + pluck + thump;
    left[start + k] += sample;
    right[start + k] += sample * 0.94;
  }
}

let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const gain = 0.62 / (peak || 1);
const fadeIn = 0.9 * RATE;
const fadeOut = 1.6 * RATE;
for (let i = 0; i < N; i++) {
  const t = i / RATE;
  let g = gain;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > N - fadeOut) g *= (N - i) / fadeOut;
  left[i] *= g;
  right[i] *= g;
}

const bytes = Buffer.alloc(44 + N * 4);
bytes.write("RIFF", 0);
bytes.writeUInt32LE(36 + N * 4, 4);
bytes.write("WAVE", 8);
bytes.write("fmt ", 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(RATE, 24);
bytes.writeUInt32LE(RATE * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write("data", 36);
bytes.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  bytes.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4);
  bytes.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4);
}
writeFileSync(new URL("./bed.wav", import.meta.url), bytes);
console.log("wrote bed.wav " + (bytes.length / 1048576).toFixed(2) + " MB");
