import type {
  SimMeta,
  SnapshotCellDto,
  SnapshotDataMessage,
  SnapshotDto,
} from '@spacetreevisualizer/contracts';
import type { CellRecord, StepSnapshot } from './domain';

export const SIM_DATA_FRAME_MAGIC = 0x53545631; // "STV1"

export function serializeRestSnapshot(snapshot: StepSnapshot): SnapshotDto {
  return {
    stepIndex: snapshot.stepIndex,
    timestamp: snapshot.timestamp,
    cellCount: snapshot.cellCount,
    treeIds: snapshot.treeIds,
    simFieldIndex: snapshot.simFieldIndex ?? null,
    cells: snapshot.cells.map(serializeRestCell),
    faces: snapshot.faces,
    vertices: snapshot.vertices,
  };
}

export function serializeWebSocketSnapshot(
  snapshot: StepSnapshot,
  simFieldIndex: number | null,
  simMeta: SimMeta | null,
): {
  json: SnapshotDataMessage;
  binary?: Buffer;
} {
  const extracted = simFieldIndex === null
    ? []
    : snapshot.cells.map(cell => extractSelectedField(cell, simFieldIndex, simMeta));
  const cells = snapshot.cells.map((c, index) => serializeWebSocketCell(c, simFieldIndex, extracted[index]));
  const json: SnapshotDataMessage = {
    type: 'snapshot_data',
    stepIndex: snapshot.stepIndex,
    timestamp: snapshot.timestamp,
    cellCount: snapshot.cellCount,
    treeIds: snapshot.treeIds,
    simFieldIndex,
    hasSimDataPayload: simFieldIndex !== null,
    cells,
    faces: snapshot.faces,
    vertices: snapshot.vertices,
  };

  if (simFieldIndex === null) {
    return { json };
  }

  const totalValues = extracted.reduce((sum, values) => sum + values.length, 0);
  const buffer = Buffer.allocUnsafe(16 + totalValues * 4);
  buffer.writeUInt32LE(SIM_DATA_FRAME_MAGIC, 0);
  buffer.writeInt32LE(snapshot.stepIndex, 4);
  buffer.writeInt32LE(simFieldIndex, 8);
  buffer.writeUInt32LE(totalValues, 12);

  let offset = 16;
  for (const values of extracted) {
    for (let i = 0; i < values.length; i++) {
      buffer.writeFloatLE(values[i]!, offset);
      offset += 4;
    }
  }

  return { json, binary: buffer };
}

function serializeRestCell(cell: CellRecord): SnapshotCellDto {
  return {
    cx: cell.cx,
    cy: cell.cy,
    cz: cell.cz,
    hx: cell.hx,
    hy: cell.hy,
    hz: cell.hz,
    level: cell.level,
    flags: cell.flags,
    relPosX: cell.relPosX,
    relPosY: cell.relPosY,
    relPosZ: cell.relPosZ,
    rank: cell.rank,
    treeId: cell.treeId,
    simData: cell.simData ? Array.from(cell.simData) : undefined,
    simDataLength: cell.simDataLength,
  };
}

function serializeWebSocketCell(
  cell: CellRecord,
  simFieldIndex: number | null,
  extracted: Float32Array | undefined,
): SnapshotCellDto {
  return {
    cx: cell.cx, cy: cell.cy, cz: cell.cz,
    hx: cell.hx, hy: cell.hy, hz: cell.hz,
    level: cell.level,
    flags: cell.flags,
    relPosX: cell.relPosX, relPosY: cell.relPosY, relPosZ: cell.relPosZ,
    rank: cell.rank,
    treeId: cell.treeId,
    simDataLength: simFieldIndex === null ? undefined : (extracted?.length ?? 0),
  };
}

function extractSelectedField(
  cell: CellRecord,
  simFieldIndex: number,
  simMeta: SimMeta | null,
): Float32Array {
  const source = cell.simData;
  if (!source || source.length === 0) {
    return new Float32Array(0);
  }

  const fullLength = cell.simDataLength ?? source.length;
  const totalFields = simMeta ? simMeta.nUnknowns + simMeta.nAux : 1;
  if (totalFields <= 1) {
    return source;
  }

  const selectedLength = Math.floor(fullLength / totalFields);
  if (selectedLength <= 0) {
    return source;
  }

  const values = new Float32Array(selectedLength);
  for (let i = 0; i < selectedLength; i++) {
    values[i] = source[i * totalFields + simFieldIndex] ?? 0;
  }
  return values;
}
