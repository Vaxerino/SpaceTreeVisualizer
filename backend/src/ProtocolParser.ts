import * as zlib from 'zlib';
import {
  FRAME_HEADER_SIZE,
  FRAME_OFFSET_TYPE, FRAME_OFFSET_FLAGS, FRAME_OFFSET_PAYLOAD_LEN,
  FRAME_OFFSET_RAW_LEN,
  FRAME_FLAG_COMPRESSED,
  FrameType,
  cellRecordGeomSize,
} from './frameTypes';
import type { CellRecord, TreeConnection } from './types';
import type { SpaceTreeStore } from './SpaceTreeStore';

/**
 * Stateful per-connection binary frame parser.
 *
 * Accumulates incoming TCP chunks and extracts complete frames. Dispatches
 * parsed records to SpaceTreeStore. One instance per C++ spacetree connection.
 */
export class ProtocolParser {
  private buf: Buffer = Buffer.alloc(0);
  private currentStep: number = -1;

  constructor(
    private readonly conn: TreeConnection,
    private readonly store: SpaceTreeStore,
  ) {}

  /** Feed raw TCP data into the parser. */
  feed(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.buf.length >= FRAME_HEADER_SIZE) {
      const payloadLen = this.buf.readUInt32LE(FRAME_OFFSET_PAYLOAD_LEN);
      const totalLen = FRAME_HEADER_SIZE + payloadLen;
      if (this.buf.length < totalLen) break;

      const header = this.buf.subarray(0, FRAME_HEADER_SIZE);
      const rawPayload = this.buf.subarray(FRAME_HEADER_SIZE, totalLen);
      this.buf = this.buf.subarray(totalLen);

      const frameType: number = header.readUInt8(FRAME_OFFSET_TYPE);
      const frameFlags: number = header.readUInt8(FRAME_OFFSET_FLAGS);
      const rawLen: number = header.readUInt32LE(FRAME_OFFSET_RAW_LEN);

      let payload: Buffer;
      if (frameFlags & FRAME_FLAG_COMPRESSED) {
        try {
          payload = zlib.inflateSync(rawPayload);
          if (payload.length !== rawLen) {
            console.warn(`[parser ${this.conn.key}] decompressed size mismatch: expected ${rawLen}, got ${payload.length}`);
          }
        } catch (e) {
          console.error(`[parser ${this.conn.key}] zlib decompression failed:`, e);
          continue;
        }
      } else {
        payload = rawPayload;
      }

      this.processFrame(frameType, payload);
    }
  }

  private processFrame(type: number, payload: Buffer): void {
    switch (type) {
      case FrameType.STEP_BEGIN:
        this.onStepBegin(payload);
        break;
      case FrameType.STEP_END:
        this.onStepEnd(payload);
        break;
      case FrameType.CELL_BATCH:
        this.onCellBatch(payload);
        break;
      case FrameType.FACE_BATCH:
        // Phase 2
        break;
      case FrameType.VERTEX_BATCH:
        // Phase 2
        break;
      case FrameType.PAUSE_ACK:
        this.store.onPauseAck(this.conn.key);
        break;
      default:
        console.warn(`[parser ${this.conn.key}] unknown frame type 0x${type.toString(16)}`);
    }
  }

  private onStepBegin(payload: Buffer): void {
    if (payload.length < 12) return;
    const stepIndex = payload.readInt32LE(0);
    const timestamp = payload.readDoubleLE(4); // double is 8 bytes, little-endian
    this.currentStep = stepIndex;
    this.store.onStepBegin(this.conn.key, stepIndex, timestamp);
  }

  private onStepEnd(payload: Buffer): void {
    if (payload.length < 4) return;
    const stepIndex = payload.readInt32LE(0);
    this.store.onStepEnd(this.conn.key, stepIndex);
    this.currentStep = -1;
  }

  private onCellBatch(payload: Buffer): void {
    const { dims, rank, treeId, hasCellData } = this.conn;
    const geomSize = cellRecordGeomSize(dims);
    const cells: CellRecord[] = [];

    let offset = 0;
    while (offset < payload.length) {
      if (offset + geomSize > payload.length) {
        console.warn(`[parser ${this.conn.key}] truncated CellRecord at offset ${offset}`);
        break;
      }

      const cell: CellRecord = {
        cx: payload.readFloatLE(offset + 0),
        cy: payload.readFloatLE(offset + 4),
        cz: dims === 3 ? payload.readFloatLE(offset + 8) : 0,
        hx: 0, hy: 0, hz: 0,
        level: 0,
        flags: 0,
        relPosX: 0, relPosY: 0, relPosZ: 0,
        rank, treeId,
      };

      const hOffset = dims === 3 ? offset + 12 : offset + 8;
      cell.hx = payload.readFloatLE(hOffset + 0);
      cell.hy = payload.readFloatLE(hOffset + 4);
      cell.hz = dims === 3 ? payload.readFloatLE(hOffset + 8) : 0;

      const metaOffset = dims === 3 ? offset + 24 : offset + 16;
      cell.level    = payload.readInt16LE(metaOffset + 0);
      cell.flags    = payload.readUInt16LE(metaOffset + 2);
      cell.relPosX  = payload.readInt8(metaOffset + 4);
      cell.relPosY  = payload.readInt8(metaOffset + 5);
      cell.relPosZ  = payload.readInt8(metaOffset + 6);
      // metaOffset+7 is padding

      offset += geomSize;

      if (hasCellData) {
        if (offset + 4 > payload.length) break;
        const dataLen = payload.readUInt32LE(offset);
        offset += 4;
        if (offset + dataLen > payload.length) break;
        // Read doubles via Buffer API to avoid Float64Array alignment requirements.
        // (subarray byteOffset is not guaranteed to be 8-byte aligned)
        const nDoubles = dataLen / 8;
        const simData: number[] = new Array(nDoubles);
        for (let i = 0; i < nDoubles; i++) {
          simData[i] = payload.readDoubleLE(offset + i * 8);
        }
        cell.simData = simData;
        offset += dataLen;
      }

      cells.push(cell);
    }

    if (cells.length > 0) {
      this.store.addCells(this.conn.key, this.currentStep, cells);
    }
  }
}
