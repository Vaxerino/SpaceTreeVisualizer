import { WebSocketServer as WSS, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { SpaceTreeStore } from './SpaceTreeStore';
import type { StepSnapshot } from './types';

/**
 * WebSocket server that serves browser clients.
 *
 * Handles:
 *   subscribe_live   — register for step_committed events
 *   get_snapshot     — request full snapshot data by step index
 *   continue         — unblock paused C++ trees
 */
export class WebSocketServer {
  private wss: WSS;
  private liveSubscribers: Set<WebSocket> = new Set();

  constructor(
    httpServer: HttpServer,
    private readonly store: SpaceTreeStore,
  ) {
    this.wss = new WSS({ server: httpServer });

    // Broadcast step_committed whenever a step is committed.
    store.onStepCommitted(snapshot => this.broadcastStepCommitted(snapshot));

    this.wss.on('connection', ws => this.handleClient(ws));
    console.log('[ws] WebSocket server attached');
  }

  private handleClient(ws: WebSocket): void {
    console.log('[ws] browser connected');

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'subscribe_live':
          this.liveSubscribers.add(ws);
          // Send current status immediately.
          this.send(ws, {
            type: 'status',
            paused: this.store.isPaused(),
            liveStep: this.store.getLiveStep(),
            totalSteps: this.store.getSummaries().length,
            trees: this.store.getRegisteredTrees(),
          });
          break;

        case 'get_snapshot': {
          const stepIndex = msg.stepIndex as number;
          const snapshot = this.store.getSnapshot(stepIndex)
            ?? this.store.getLatestSnapshot();
          if (snapshot) {
            this.send(ws, { type: 'snapshot_data', ...serializeSnapshot(snapshot) });
          } else {
            this.send(ws, { type: 'snapshot_data', stepIndex: -1, cells: [], faces: [], vertices: [] });
          }
          break;
        }

        case 'get_latest': {
          const snapshot = this.store.getLatestSnapshot();
          if (snapshot) {
            this.send(ws, { type: 'snapshot_data', ...serializeSnapshot(snapshot) });
          }
          break;
        }

        case 'continue':
          this.store.sendContinueToAllPaused();
          this.send(ws, { type: 'continue_ack' });
          break;

        default:
          break;
      }
    });

    ws.on('close', () => {
      this.liveSubscribers.delete(ws);
      console.log('[ws] browser disconnected');
    });
  }

  private broadcastStepCommitted(snapshot: StepSnapshot): void {
    const msg = JSON.stringify({
      type: 'step_committed',
      stepIndex: snapshot.stepIndex,
      timestamp: snapshot.timestamp,
      cellCount: snapshot.cellCount,
      treeIds: snapshot.treeIds,
    });
    for (const ws of this.liveSubscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  private send(ws: WebSocket, obj: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }
}

/** Serialize a snapshot to a JSON-safe form (strip TypedArrays). */
function serializeSnapshot(snapshot: StepSnapshot) {
  return {
    stepIndex: snapshot.stepIndex,
    timestamp: snapshot.timestamp,
    cellCount: snapshot.cellCount,
    treeIds: snapshot.treeIds,
    cells: snapshot.cells.map(c => ({
      cx: c.cx, cy: c.cy, cz: c.cz,
      hx: c.hx, hy: c.hy, hz: c.hz,
      level: c.level,
      flags: c.flags,
      relPosX: c.relPosX, relPosY: c.relPosY, relPosZ: c.relPosZ,
      rank: c.rank,
      treeId: c.treeId,
      simData: c.simData ? Array.from(c.simData) : undefined,
    })),
    faces: snapshot.faces,
    vertices: snapshot.vertices,
  };
}
