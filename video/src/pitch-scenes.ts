export type PitchScene = { id: string; at: number; length: number };

export const PITCH_FPS = 30;
export const PITCH_TOTAL = 1737;

export const PITCH_SCENES: PitchScene[] = [
  { id: "watch", at: 0, length: 167 },
  { id: "ask", at: 167, length: 241 },
  { id: "script", at: 408, length: 291 },
  { id: "track", at: 699, length: 231 },
  { id: "flag", at: 930, length: 262 },
  { id: "back", at: 1192, length: 199 },
  { id: "own", at: 1391, length: 165 },
  { id: "close", at: 1556, length: 181 },
];
