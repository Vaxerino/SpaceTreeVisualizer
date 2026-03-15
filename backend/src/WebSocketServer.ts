import { WebSocketServer as WSS, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { Server as HttpServer } from 'http';
import type { SpaceTreeStore } from './SpaceTreeStore';
import type { CellRecord, SimMeta, StepSnapshot } from './types';

const SIM_DATA_FRAME_MAGIC = 0x53545631; // "STV1"

interface ClientState {
  live: boolean;
  includeSimData: boolean;
  simFieldIndex: number;
  snapshotInFlight: boolean;
  lastSentStepIndex: number;
  lastSentViewKey: string;
}

/**
 * WebSocket server that serves browser clients.
 *
 * Handles:
 *   subscribe_live      — register for step_committed events + live snapshots
 *   get_snapshot        — request snapshot data by step index
 *   get_latest          — request latest snapshot data
 *   set_view            — update live snapshot preferences
 *   snapshot_consumed   — browser finished rendering the last pushed snapshot
 *   continue            — unblock paused C++ trees
 */
export class WebSocketServer {
  private wss: WSS;
  private clientStates: Map<WebSocket, ClientState> = new Map();

  constructor(
    httpServer: HttpServer,
    private readonly store: SpaceTreeStore,
  ) {
    this.wss = new WSS({ server: httpServer });

    store.onStepCommitted(snapshot => this.broadcastStepCommitted(snapshot));
    store.onReset(() => this.broadcastReset());

    this.wss.on('connection', ws => this.handleClient(ws));
    console.log('[ws] WebSocket server attached');
  }

  private handleClient(ws: WebSocket): void {
    console.log('[ws] browser connected');
    this.clientStates.set(ws, {
      live: false,
      includeSimData: false,
      simFieldIndex: 0,
      snapshotInFlight: false,
      lastSentStepIndex: -1,
      lastSentViewKey: '',
    });

    ws.on('message', raw => this.handleMessage(ws, raw));

    ws.on('close', () => {
      this.clientStates.delete(ws);
      console.log('[ws] browser disconnected');
    });
  }

  private handleMessage(ws: WebSocket, raw: RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const state = this.clientStates.get(ws);
    if (!state) return;

    switch (msg.type) {
      case 'subscribe_live':
        state.live = true;
        this.send(ws, {
          type: 'status',
          paused: this.store.isPaused(),
          liveStep: this.store.getLiveStep(),
          totalSteps: this.store.getSummaries().length,
          trees: this.store.getRegisteredTrees(),
        });
        this.trySendLiveSnapshot(ws, state);
        break;

      case 'get_snapshot': {
        const stepIndex = Number(msg.stepIndex);
        const snapshot = this.store.getSnapshot(stepIndex)
          ?? this.store.getLatestSnapshot();
        if (snapshot) {
          this.sendSnapshot(ws, state, snapshot);
        } else {
          this.send(ws, { type: 'snapshot_data', stepIndex: -1, cells: [], faces: [], vertices: [] });
        }
        break;
      }

      case 'get_latest': {
        const snapshot = this.store.getLatestSnapshot();
        if (snapshot) {
          this.sendSnapshot(ws, state, snapshot);
        }
        break;
      }

      case 'set_view':
        state.includeSimData = msg.colorMode === 'sim';
        if (typeof msg.simFieldIndex === 'number' && Number.isFinite(msg.simFieldIndex)) {
          state.simFieldIndex = Math.max(0, Math.floor(msg.simFieldIndex));
        }
        this.trySendLiveSnapshot(ws, state);
        break;

      case 'snapshot_consumed': {
        // Validate that the ack is for the snapshot we actually sent.
        // If stepIndex doesn't match lastSentStepIndex this is a stale ack
        // (e.g. from a previous in-flight snapshot that arrived out of order).
        // Clearing snapshotInFlight on a stale ack would incorrectly unblock
        // the send pipeline for a snapshot the client has not yet consumed.
        const stepIndex = msg.stepIndex;
        if (typeof stepIndex !== 'number' || stepIndex !== state.lastSentStepIndex) {
          console.warn(
            `[ws] snapshot_consumed stepIndex=${String(stepIndex)} does not match lastSentStepIndex=${state.lastSentStepIndex} — ignoring stale ack`,
          );
          break;
        }
        state.snapshotInFlight = false;
        this.trySendLiveSnapshot(ws, state);
        break;
      }

      case 'continue':
        this.store.sendContinueToAllPaused();
        this.send(ws, { type: 'continue_ack' });
        break;

      default:
        break;
    }
  }

  private broadcastStepCommitted(snapshot: StepSnapshot): void {
    const msg = JSON.stringify({
      type: 'step_committed',
      stepIndex: snapshot.stepIndex,
      timestamp: snapshot.timestamp,
      cellCount: snapshot.cellCount,
      treeIds: snapshot.treeIds,
    });

    for (const [ws, state] of this.clientStates.entries()) {
      if (ws.readyState !== WebSocket.OPEN || !state.live) continue;
      ws.send(msg);
      this.trySendLiveSnapshot(ws, state, snapshot);
    }
  }

  private broadcastReset(): void {
    const msg = JSON.stringify({
      type: 'simulation_reset',
      liveStep: -1,
      totalSteps: 0,
      trees: [],
    });
    for (const [ws, state] of this.clientStates.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      state.snapshotInFlight = false;
      state.lastSentStepIndex = -1;
      state.lastSentViewKey = '';
      ws.send(msg);
    }
  }

  private trySendLiveSnapshot(ws: WebSocket, state: ClientState, snapshot?: StepSnapshot): void {
    if (!state.live || state.snapshotInFlight || ws.readyState !== WebSocket.OPEN) return;
    const liveSnapshot = snapshot ?? this.store.getLatestSnapshot();
    if (!liveSnapshot) return;
    const viewKey = this.viewKey(state);
    if (liveSnapshot.stepIndex === state.lastSentStepIndex && viewKey === state.lastSentViewKey) return;
    this.sendSnapshot(ws, state, liveSnapshot);
  }

  private sendSnapshot(ws: WebSocket, state: ClientState, snapshot: StepSnapshot): void {
    const simMeta = this.store.getSimMeta();
    const serialized = serializeSnapshot(snapshot, state.includeSimData ? state.simFieldIndex : null, simMeta);
    state.snapshotInFlight = true;
    state.lastSentStepIndex = snapshot.stepIndex;
    state.lastSentViewKey = this.viewKey(state);
    this.send(ws, { type: 'snapshot_data', ...serialized.json });
    if (serialized.binary) {
      ws.send(serialized.binary);
    }
  }

  private viewKey(state: ClientState): string {
    return state.includeSimData ? `sim:${state.simFieldIndex}` : 'geometry';
  }

  private send(ws: WebSocket, obj: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }
}

function serializeSnapshot(
  snapshot: StepSnapshot,
  simFieldIndex: number | null,
  simMeta: SimMeta | null,
): {
  json: Record<string, unknown>;
  binary?: Buffer;
} {
  const extracted = simFieldIndex === null
    ? []
    : snapshot.cells.map(cell => extractSelectedField(cell, simFieldIndex, simMeta));
  const cells = snapshot.cells.map((c, index) => serializeCell(c, simFieldIndex, extracted[index]));
  const json: Record<string, unknown> = {
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

function serializeCell(
  cell: CellRecord,
  simFieldIndex: number | null,
  extracted: Float32Array | undefined,
): Record<string, unknown> {
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
