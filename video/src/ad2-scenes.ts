export type MeshScene = { id: string; at: number; length: number };

export const MESH_FPS = 30;
export const MESH_TOTAL = 675;

export const MESH_SCENES: MeshScene[] = [
  { id: "limit", at: 0, length: 100 },
  { id: "agents", at: 100, length: 128 },
  { id: "move", at: 228, length: 126 },
  { id: "mesh", at: 354, length: 124 },
  { id: "learn", at: 478, length: 114 },
  { id: "close", at: 592, length: 83 },
];
