// Voice first, then a soft piano figure under it. A proposal can carry a bed, just not a mood piece.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RATE = 48000;
const { total, scenes } = JSON.parse(readFileSync(HERE + "pitch-scenes.json", "utf8"));
const ORDER = ["01-watch","02-ask","03-script","04-track","05-flag","06-back","07-own","08-close"];
const N = Math.ceil(RATE * (total + 0.1));
const voice = new Float32Array(N);

const readWav = (path) => {
  const buf = readFileSync(path);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
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
  return mono;
};

scenes.forEach((scene, i) => {
  const clip = readWav(HERE + "vo-pitch/" + ORDER[i] + ".wav");
  const start = Math.floor(scene.at * RATE);
  for (let s = 0; s < clip.length && start + s < N; s++) {
    const t = s / RATE;
    const edge = Math.min(1, t / 0.02) * Math.min(1, (clip.length / RATE - t) / 0.05);
    voice[start + s] += clip[s] * edge;
  }
});

const note = (semitone) => 261.63 * Math.pow(2, semitone / 12);
const CHORDS = [[0, 4, 7], [-5, 0, 4], [-3, 2, 5], [-7, -3, 0]];
const BAR = 2.6;
const music = new Float32Array(N);
const arp = [0, 2, 1, 2, 0, 1, 2, 1];

for (let bar = 0; bar * BAR < total + 2; bar++) {
  const chord = CHORDS[bar % CHORDS.length];
  const start = Math.floor(bar * BAR * RATE);
  const bloom = Math.min(1, (bar * BAR) / 1.6) * Math.min(1, (total + 0.6 - bar * BAR) / 2.2);
  for (let i = 0; i < BAR * RATE; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / RATE;
    const swell = Math.min(1, t / 0.9) * Math.min(1, (BAR - t) / 0.7);
    let pad = 0;
    for (const c of chord) pad += Math.sin(2 * Math.PI * note(c - 12) * t);
    music[idx] += pad * 0.016 * swell * bloom;
  }
  const step = BAR / 8;
  for (let k = 0; k < 8; k++) {
    const s0 = Math.floor((bar * BAR + k * step) * RATE);
    const freq = note(chord[arp[k]] + 12);
    for (let i = 0; i < 0.9 * RATE; i++) {
      const idx = s0 + i;
      if (idx >= N) break;
      const t = i / RATE;
      music[idx] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 4.2) * 0.05 * bloom;
    }
  }
}

let voicePeak = 0;
for (let i = 0; i < N; i++) voicePeak = Math.max(voicePeak, Math.abs(voice[i]));
const vGain = voicePeak > 0 ? 0.89 / voicePeak : 1;
const mix = new Float32Array(N);
for (let i = 0; i < N; i++) mix[i] = voice[i] * vGain * 0.92 + music[i];

let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix[i]));
const norm = peak > 0.97 ? 0.97 / peak : 1;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const v = Math.max(-32768, Math.min(32767, Math.round(mix[i] * norm * 32767)));
  pcm.writeInt16LE(v, i * 4);
  pcm.writeInt16LE(v, i * 4 + 2);
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
writeFileSync(resolve(HERE, "../public/pitch.wav"), Buffer.concat([header, pcm]));
console.log("pitch.wav " + (Math.round((44 + pcm.length) / 1e5) / 10) + " MB, voice " + vGain.toFixed(2) + ", peak " + peak.toFixed(2));
