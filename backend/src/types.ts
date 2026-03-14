/**
 * Shared TypeScript types for the SpaceTreeVisualizer backend.
 */

/** Parsed handshake info for one C++ spacetree connection. */
export interface TreeConnection {
  rank: number;
  treeId: number;
  dims: number;         // 2 or 3
  zlibEnabled: boolean;
  pauseMode: boolean;
  hasCellData: boolean;
  hasFaceData: boolean;
  key: string;          // "rank:treeId"
}

/** Geometry + metadata for one cell, as parsed from a CellRecord. */
export interface CellRecord {
  // Geometry
  cx: number; cy: number; cz: number;  // centre (z=0 for 2D)
  hx: number; hy: number; hz: number;  // cell size (z=0 for 2D)
  level: number;                        // refinement level (int16)
  flags: number;                        // CellMarker bitmask (uint16)
  relPosX: number; relPosY: number; relPosZ: number;  // int8
  // Source info
  rank: number;
  treeId: number;
  // Optional simulation data (raw doubles, length = unknowns * patch_volumes)
  simData?: number[];
}

export interface FaceRecord {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  faceNumber: number;
  isHanging: boolean;
  isLocal: boolean;
  rank: number;
  treeId: number;
}

export interface VertexRecord {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  isHanging: boolean;
  isLocal: boolean;
  rank: number;
  treeId: number;
}

/** One committed simulation step, holding all cells from all trees. */
export interface StepSnapshot {
  stepIndex: number;
  timestamp: number;
  cells: CellRecord[];
  faces: FaceRecord[];
  vertices: VertexRecord[];
  treeIds: string[];    // which trees contributed
  cellCount: number;
}

/** Summary entry used in snapshot list responses. */
export interface SnapshotSummary {
  stepIndex: number;
  timestamp: number;
  cellCount: number;
}

/** Status of the backend. */
export interface BackendStatus {
  connected: boolean;
  liveStep: number;
  totalSteps: number;
  paused: boolean;
  trees: string[];
}
