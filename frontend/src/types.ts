/** Shared types mirroring the backend types.ts */

export interface SimMeta {
  patchSize: number;
  nUnknowns: number;
  nAux: number;
  unknownNames: string[] | null;
  initialFieldRanges: Array<[number, number]> | null;
}


export interface CellRecord {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  level: number;
  flags: number;
  relPosX: number; relPosY: number; relPosZ: number;
  rank: number;
  treeId: number;
  simData?: Float32Array | number[];
  simDataLength?: number;
}

export interface StepSnapshot {
  stepIndex: number;
  timestamp: number;
  cellCount: number;
  treeIds: string[];
  simFieldIndex?: number | null;
  cells: CellRecord[];
  faces: unknown[];
  vertices: unknown[];
}

export interface SnapshotSummary {
  stepIndex: number;
  timestamp: number;
  cellCount: number;
}

// CellMarker flag bitmasks (mirrored from frameTypes.ts on the backend)
export const CELL_FLAG_HAS_BEEN_REFINED  = 1 << 0;
export const CELL_FLAG_WILL_BE_REFINED   = 1 << 1;
export const CELL_FLAG_IS_LOCAL          = 1 << 2;
export const CELL_FLAG_IS_PARENT_LOCAL   = 1 << 3;
export const CELL_FLAG_ALL_VTXS_REFINED  = 1 << 4;
export const CELL_FLAG_ONE_VTX_HANGING   = 1 << 5;
export const CELL_FLAG_INSIDE_DOMAIN     = 1 << 6;
export const CELL_FLAG_WILL_BE_ENCLAVE   = 1 << 9;
export const CELL_FLAG_HAS_BEEN_ENCLAVE  = 1 << 10;

export type ColorMode = 'level' | 'local' | 'enclave' | 'refinement' | 'sim' | 'treeId';

export type ColormapName =
  | 'turbo'
  | 'viridis'
  | 'plasma'
  | 'magma'
  | 'inferno'
  | 'rdbu'
  | 'grayscale';

export interface FilterSpec {
  level: number;            // selected AMR level
  levelCumulative: boolean; // true = show levels 0..level, false = show only level
  showLocal: boolean;
  showRemote: boolean;
}
