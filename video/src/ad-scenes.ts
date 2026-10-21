export type AdScene = { id: string; at: number; length: number; kicker: string };

export const AD_FPS = 30;
export const AD_TOTAL = 899;

export const AD_SCENES: AdScene[] = [
  { id: "brand", at: 0, length: 108, kicker: "" },
  { id: "classic", at: 108, length: 126, kicker: "Classic view" },
  { id: "blocks", at: 234, length: 195, kicker: "Blocks" },
  { id: "canvas", at: 429, length: 210, kicker: "Canvas" },
  { id: "plan", at: 639, length: 83, kicker: "Planner" },
  { id: "themes", at: 722, length: 90, kicker: "Themes" },
  { id: "close", at: 812, length: 87, kicker: "" },
];
