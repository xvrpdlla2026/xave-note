export type MeshScene = { id: string; at: number; length: number };

export const MESH_FPS = 30;
export const MESH_TOTAL = 824;

export const MESH_SCENES: MeshScene[] = [
  { id: "limit", at: 0, length: 100 },
  { id: "agents", at: 100, length: 128 },
  { id: "beyond", at: 228, length: 149 },
  { id: "move", at: 377, length: 126 },
  { id: "mesh", at: 503, length: 124 },
  { id: "learn", at: 627, length: 114 },
  { id: "close", at: 741, length: 83 },
];
