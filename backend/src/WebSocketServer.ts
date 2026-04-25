import { WebSocketServer as WSS, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { Server as HttpServer } from 'http';
import type { SpaceTreeStore } from './SpaceTreeStore';
import type { StepSnapshot } from './domain';
import { serializeWebSocketSnapshot } from './snapshotSerializer';

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
          hasPauseMode: this.store.hasPauseModeTrees(),
          autoAdvanceSim: this.store.isAutoAdvancing(),
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
          this.sendSnapshot(ws, state, snapshot, false);
        } else {
          this.send(ws, {
            type: 'snapshot_data',
            stepIndex: -1,
            timestamp: 0,
            cellCount: 0,
            treeIds: [],
            simFieldIndex: null,
            cells: [],
            faces: [],
            vertices: [],
          });
        }
        break;
      }

      case 'get_latest': {
        const snapshot = this.store.getLatestSnapshot();
        if (snapshot) {
          this.sendSnapshot(ws, state, snapshot, false);
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

      case 'reach_live':
        this.store.setAutoAdvanceSim(true);
        if (this.store.isPaused()) this.store.sendContinueToAllPaused();
        break;

      case 'pause_sim':
        this.store.setAutoAdvanceSim(false);
        break;

      case 'resume_sim':
        if (this.store.isPaused()) this.store.sendContinueToAllPaused();
        break;

      case 'continue':
        if (this.store.isPaused()) this.store.sendContinueToAllPaused();
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
    this.sendSnapshot(ws, state, liveSnapshot, true);
  }

  private sendSnapshot(ws: WebSocket, state: ClientState, snapshot: StepSnapshot, live: boolean): void {
    const simMeta = this.store.getSimMeta();
    const serialized = serializeWebSocketSnapshot(snapshot, state.includeSimData ? state.simFieldIndex : null, simMeta);
    state.snapshotInFlight = live;
    state.lastSentStepIndex = snapshot.stepIndex;
    state.lastSentViewKey = this.viewKey(state);
    this.send(ws, serialized.json);
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
