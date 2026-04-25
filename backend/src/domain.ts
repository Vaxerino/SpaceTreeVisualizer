import type { SimMeta } from '@spacetreevisualizer/contracts';

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
  patchSize: number;    // PATCH_SIZE^DIMS subcells per AMR cell
  nUnknowns: number;    // number of PDE unknowns per subcell
  nAux: number;         // number of auxiliary variables per subcell
}

/** Geometry + metadata for one cell, as parsed from a CellRecord. */
export interface CellRecord {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  level: number;
  flags: number;
  relPosX: number; relPosY: number; relPosZ: number;
  rank: number;
  treeId: number;
  simData?: Float32Array;
  simDataLength?: number;
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
  treeIds: string[];
  cellCount: number;
  simFieldIndex?: number;
  hasSimData?: boolean;
}

export type { SimMeta };
