import type { CellRecord, StepSnapshot } from './types';

type MessageHandler = (msg: Record<string, unknown> | StepSnapshot) => void;

const SIM_DATA_FRAME_MAGIC = 0x53545631; // "STV1"

interface PendingSnapshot {
  snapshot: StepSnapshot;
}

/**
 * WebSocket client. Connects to the backend, dispatches incoming messages
 * to type-specific handlers, and reassembles geometry JSON + binary sim data.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private readonly url: string;
  private reconnectDelay = 2000;
  private pendingSnapshots: Map<number, PendingSnapshot> = new Map();

  constructor(url = 'ws://localhost:7422') {
    this.url = url;
    this.connect();
  }

  on(type: string, handler: MessageHandler): void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler]);
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[ws] connected');
      this.reconnectDelay = 2000;
      this.send({ type: 'subscribe_live' });
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleJson(event.data);
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        this.handleBinary(event.data);
      }
    };

    this.ws.onclose = () => {
      this.pendingSnapshots.clear();
      console.log(`[ws] disconnected, reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
    };

    this.ws.onerror = () => {
      // errors are followed by close, reconnect handles it
    };
  }

  private handleJson(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      if (msg['type'] === 'snapshot_data') {
        const snapshot = normalizeSnapshot(msg);
        const expectsSimData = msg['hasSimDataPayload'] === true;
        if (expectsSimData) {
          this.pendingSnapshots.set(snapshot.stepIndex, { snapshot });
        } else {
          this.emit('snapshot_data', snapshot);
        }
        return;
      }

      if (msg['type'] === 'simulation_reset') {
        this.pendingSnapshots.clear();
      }

      this.emit(msg['type'] as string, msg);
    } catch (e) {
      console.warn('[ws] failed to parse message', e);
    }
  }

  private handleBinary(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 16) {
      console.warn('[ws] ignoring truncated sim payload frame');
      return;
    }

    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    if (magic !== SIM_DATA_FRAME_MAGIC) {
      console.warn('[ws] ignoring unknown binary frame');
      return;
    }

    const stepIndex = view.getInt32(4, true);
    const simFieldIndex = view.getInt32(8, true);
    const valueCount = view.getUint32(12, true);
    const expectedBytes = 16 + valueCount * 4;
    if (buffer.byteLength < expectedBytes) {
      console.warn(
        `[ws] ignoring truncated sim payload frame for step ${stepIndex}: expected ${expectedBytes} bytes, got ${buffer.byteLength}`,
      );
      return;
    }
    const pending = this.pendingSnapshots.get(stepIndex);
    if (!pending) {
      console.warn(`[ws] missing snapshot metadata for sim payload step ${stepIndex}`);
      return;
    }

    const values = new Float32Array(buffer, 16, valueCount);
    let offset = 0;
    for (const cell of pending.snapshot.cells) {
      const len = cell.simDataLength ?? 0;
      if (offset + len > valueCount) {
        console.warn(`[ws] sim payload length mismatch for step ${stepIndex}`);
        this.pendingSnapshots.delete(stepIndex);
        return;
      }
      cell.simData = values.slice(offset, offset + len);
      offset += len;
    }
    if (offset !== valueCount) {
      console.warn(`[ws] sim payload count mismatch for step ${stepIndex}: consumed ${offset}, header ${valueCount}`);
      this.pendingSnapshots.delete(stepIndex);
      return;
    }
    pending.snapshot.simFieldIndex = simFieldIndex;
    this.pendingSnapshots.delete(stepIndex);
    this.emit('snapshot_data', pending.snapshot);
  }

  private emit(type: string, msg: Record<string, unknown> | StepSnapshot): void {
    const handlers = this.handlers.get(type) ?? [];
    for (const h of handlers) h(msg);
  }
}

function normalizeSnapshot(msg: Record<string, unknown>): StepSnapshot {
  const rawCells = (msg['cells'] as Record<string, unknown>[]) ?? [];
  const cells: CellRecord[] = rawCells.map(raw => ({
    cx: Number(raw['cx'] ?? 0),
    cy: Number(raw['cy'] ?? 0),
    cz: Number(raw['cz'] ?? 0),
    hx: Number(raw['hx'] ?? 0),
    hy: Number(raw['hy'] ?? 0),
    hz: Number(raw['hz'] ?? 0),
    level: Number(raw['level'] ?? 0),
    flags: Number(raw['flags'] ?? 0),
    relPosX: Number(raw['relPosX'] ?? 0),
    relPosY: Number(raw['relPosY'] ?? 0),
    relPosZ: Number(raw['relPosZ'] ?? 0),
    rank: Number(raw['rank'] ?? 0),
    treeId: Number(raw['treeId'] ?? 0),
    simDataLength: raw['simDataLength'] !== undefined ? Number(raw['simDataLength']) : undefined,
  }));

  return {
    stepIndex: Number(msg['stepIndex'] ?? -1),
    timestamp: Number(msg['timestamp'] ?? 0),
    cellCount: Number(msg['cellCount'] ?? cells.length),
    treeIds: ((msg['treeIds'] as string[]) ?? []).slice(),
    simFieldIndex: typeof msg['simFieldIndex'] === 'number' ? Number(msg['simFieldIndex']) : null,
    cells,
    faces: ((msg['faces'] as unknown[]) ?? []).slice(),
    vertices: ((msg['vertices'] as unknown[]) ?? []).slice(),
  };
}
