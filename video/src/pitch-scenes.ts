export type PitchScene = { id: string; at: number; length: number };

export const PITCH_FPS = 30;
export const PITCH_TOTAL = 908;

export const PITCH_SCENES: PitchScene[] = [
  { id: "rent", at: 0, length: 110 },
  { id: "own", at: 110, length: 118 },
  { id: "paths", at: 228, length: 121 },
  { id: "track", at: 349, length: 116 },
  { id: "flag", at: 465, length: 97 },
  { id: "dash", at: 562, length: 95 },
  { id: "data", at: 657, length: 124 },
  { id: "close", at: 781, length: 127 },
];
