export type PitchScene = { id: string; at: number; length: number };

export const PITCH_FPS = 30;
export const PITCH_TOTAL = 1984;

export const PITCH_SCENES: PitchScene[] = [
  { id: "rent", at: 0, length: 121 },
  { id: "own", at: 121, length: 107 },
  { id: "g1", at: 228, length: 290 },
  { id: "g2", at: 518, length: 263 },
  { id: "g3", at: 781, length: 299 },
  { id: "g4", at: 1080, length: 371 },
  { id: "g5", at: 1451, length: 349 },
  { id: "close", at: 1800, length: 184 },
];
