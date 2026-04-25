/** Browser-facing API contracts shared by backend and frontend. */

/** Simulation patch metadata exposed through /api/meta. */
export interface SimMeta {
  patchSize: number;
  nUnknowns: number;
  nAux: number;
  unknownNames: string[] | null;
}

/** JSON-safe cell DTO sent over REST/WebSocket metadata messages. */
export interface SnapshotCellDto {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  level: number;
  flags: number;
  relPosX: number; relPosY: number; relPosZ: number;
  rank: number;
  treeId: number;
  simData?: number[];
  simDataLength?: number;
}

export interface SnapshotFaceDto {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  faceNumber: number;
  isHanging: boolean;
  isLocal: boolean;
  rank: number;
  treeId: number;
}

export interface SnapshotVertexDto {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  isHanging: boolean;
  isLocal: boolean;
  rank: number;
  treeId: number;
}

export interface SnapshotDto {
  stepIndex: number;
  timestamp: number;
  cellCount: number;
  treeIds: string[];
  simFieldIndex: number | null;
  cells: SnapshotCellDto[];
  faces: SnapshotFaceDto[];
  vertices: SnapshotVertexDto[];
  hasSimDataPayload?: boolean;
}

export interface SnapshotSummary {
  stepIndex: number;
  timestamp: number;
  cellCount: number;
}

export interface BackendStatusDto {
  connected: boolean;
  liveStep: number;
  totalSteps: number;
  paused: boolean;
  trees: string[];
}

export interface StatusMessage {
  type: 'status';
  paused: boolean;
  hasPauseMode: boolean;
  autoAdvanceSim: boolean;
  liveStep: number;
  totalSteps: number;
  trees: string[];
}

export interface StepCommittedMessage extends SnapshotSummary {
  type: 'step_committed';
  treeIds: string[];
}

export interface SnapshotDataMessage extends SnapshotDto {
  type: 'snapshot_data';
}

export interface SimulationResetMessage {
  type: 'simulation_reset';
  liveStep: number;
  totalSteps: number;
  trees: string[];
}

export type ServerMessage =
  | StatusMessage
  | StepCommittedMessage
  | SnapshotDataMessage
  | SimulationResetMessage;

export type ClientMessage =
  | { type: 'subscribe_live' }
  | { type: 'get_snapshot'; stepIndex: number }
  | { type: 'get_latest' }
  | { type: 'set_view'; colorMode: string; simFieldIndex: number }
  | { type: 'snapshot_consumed'; stepIndex: number }
  | { type: 'reach_live' }
  | { type: 'pause_sim' }
  | { type: 'resume_sim' }
  | { type: 'continue' };

// CellMarker flag bitmasks mirrored from the TCP binary protocol.
export const CELL_FLAG_HAS_BEEN_REFINED = 1 << 0;
export const CELL_FLAG_WILL_BE_REFINED = 1 << 1;
export const CELL_FLAG_IS_LOCAL = 1 << 2;
export const CELL_FLAG_IS_PARENT_LOCAL = 1 << 3;
export const CELL_FLAG_ALL_VTXS_REFINED = 1 << 4;
export const CELL_FLAG_ONE_VTX_HANGING = 1 << 5;
export const CELL_FLAG_INSIDE_DOMAIN = 1 << 6;
export const CELL_FLAG_WILL_BE_ENCLAVE = 1 << 9;
export const CELL_FLAG_HAS_BEEN_ENCLAVE = 1 << 10;
