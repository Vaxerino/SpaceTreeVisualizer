import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from '../../WebSocketClient';
import type { StepSnapshot } from '../../types';

// SIM_DATA_FRAME_MAGIC = 0x53545631 ("STV1")
const SIM_DATA_FRAME_MAGIC = 0x53545631;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a valid binary sim-data frame.
 *
 * Layout (little-endian):
 *   [0]  u32  magic
 *   [4]  i32  stepIndex
 *   [8]  i32  simFieldIndex
 *   [12] u32  valueCount
 *   [16] f32* values (valueCount floats)
 */
function buildSimFrame(opts: {
  magic?: number;
  stepIndex: number;
  simFieldIndex: number;
  values: number[];
}): ArrayBuffer {
  const { magic = SIM_DATA_FRAME_MAGIC, stepIndex, simFieldIndex, values } = opts;
  const buf = new ArrayBuffer(16 + values.length * 4);
  const view = new DataView(buf);
  view.setUint32(0, magic, true);
  view.setInt32(4, stepIndex, true);
  view.setInt32(8, simFieldIndex, true);
  view.setUint32(12, values.length, true);
  const f32 = new Float32Array(buf, 16);
  values.forEach((v, i) => (f32[i] = v));
  return buf;
}

/**
 * Build a JSON snapshot_data message string.
 *
 * @param stepIndex      Step index to register in pendingSnapshots.
 * @param cellDataLengths Array of simDataLength values — one per cell.
 * @param hasSimDataPayload When true the client stores the snapshot pending binary data.
 */
function buildSnapshotJson(
  stepIndex: number,
  cellDataLengths: number[],
  hasSimDataPayload = true,
): string {
  const cells = cellDataLengths.map((len, i) => ({
    cx: i,
    cy: 0,
    cz: 0,
    hx: 0.1,
    hy: 0.1,
    hz: 0.1,
    level: 1,
    flags: 0,
    relPosX: 0,
    relPosY: 0,
    relPosZ: 0,
    rank: 0,
    treeId: 0,
    simDataLength: len,
  }));

  return JSON.stringify({
    type: 'snapshot_data',
    stepIndex,
    timestamp: 0,
    cellCount: cells.length,
    treeIds: [],
    simFieldIndex: null,
    hasSimDataPayload,
    cells,
    faces: [],
    vertices: [],
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// WebSocket stub
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A minimal WebSocket mock that captures the onmessage/onopen handlers
 * so we can inject messages directly into WebSocketClient.
 */
class MockWebSocket {
  binaryType = 'arraybuffer';
  readyState = 1; // OPEN

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(_data: string) {
    // no-op
  }
  close() {
    // no-op
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Test setup
// ──────────────────────────────────────────────────────────────────────────────

let mockWs: MockWebSocket;

beforeEach(() => {
  mockWs = new MockWebSocket();
  // Replace the global WebSocket constructor so WebSocketClient connects
  // to our mock instead of a real server.
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => mockWs));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Create a WebSocketClient and return it together with a helper that injects
 * messages via the mock WebSocket.
 */
function createClient() {
  const client = new WebSocketClient('ws://test');

  // Trigger onopen so the client knows it is connected (sends subscribe_live)
  mockWs.onopen?.();

  function sendJson(raw: string) {
    mockWs.onmessage?.({ data: raw });
  }
  function sendBinary(buf: ArrayBuffer) {
    mockWs.onmessage?.({ data: buf });
  }

  return { client, sendJson, sendBinary };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('WebSocketClient.handleBinary', () => {
  it('happy path: emits snapshot_data with per-cell simData slices', () => {
    const { client, sendJson, sendBinary } = createClient();

    const emitted: StepSnapshot[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg as StepSnapshot));

    // Cells expect [2, 3] floats → valueCount = 5
    sendJson(buildSnapshotJson(0, [2, 3]));

    const values = [1.0, 2.0, 3.0, 4.0, 5.0];
    sendBinary(buildSimFrame({ stepIndex: 0, simFieldIndex: 1, values }));

    expect(emitted).toHaveLength(1);
    const snap = emitted[0]!;
    expect(snap.stepIndex).toBe(0);
    expect(snap.simFieldIndex).toBe(1);

    // Cell 0 gets values[0..1] = [1.0, 2.0]
    const cell0SimData = snap.cells[0]!.simData as Float32Array;
    expect(cell0SimData.length).toBe(2);
    expect(cell0SimData[0]).toBeCloseTo(1.0);
    expect(cell0SimData[1]).toBeCloseTo(2.0);

    // Cell 1 gets values[2..4] = [3.0, 4.0, 5.0]
    const cell1SimData = snap.cells[1]!.simData as Float32Array;
    expect(cell1SimData.length).toBe(3);
    expect(cell1SimData[0]).toBeCloseTo(3.0);
    expect(cell1SimData[1]).toBeCloseTo(4.0);
    expect(cell1SimData[2]).toBeCloseTo(5.0);
  });

  it('unknown magic: does not emit snapshot_data, calls console.warn', () => {
    const { client, sendJson, sendBinary } = createClient();

    const emitted: unknown[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Seed a pending snapshot so we know the failure is due to magic, not missing metadata
    sendJson(buildSnapshotJson(0, [2]));

    sendBinary(buildSimFrame({ magic: 0xdeadbeef, stepIndex: 0, simFieldIndex: 0, values: [1.0, 2.0] }));

    expect(emitted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ws] ignoring unknown binary frame'));

    warnSpy.mockRestore();
  });

  it('buffer too short (< 16 bytes): returns gracefully without throwing or emitting', () => {
    const { client, sendBinary } = createClient();

    const emitted: unknown[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A 4-byte buffer — way too short for the 16-byte header
    sendBinary(new ArrayBuffer(4));

    expect(emitted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ws] ignoring truncated sim payload frame'));

    warnSpy.mockRestore();
  });

  it('valueCount mismatch (header > actual cell sum): does not emit, warns', () => {
    const { client, sendJson, sendBinary } = createClient();

    const emitted: unknown[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Cells expect [2, 2] = 4 values total, but we send 6 values in the header
    sendJson(buildSnapshotJson(0, [2, 2]));

    // Build a frame manually with valueCount=6 but only two cells that consume 4
    const buf = new ArrayBuffer(16 + 6 * 4);
    const view = new DataView(buf);
    view.setUint32(0, SIM_DATA_FRAME_MAGIC, true);
    view.setInt32(4, 0, true);   // stepIndex
    view.setInt32(8, 0, true);   // simFieldIndex
    view.setUint32(12, 6, true); // valueCount = 6, but cells only sum to 4
    const f32 = new Float32Array(buf, 16);
    f32.set([1, 2, 3, 4, 5, 6]);

    sendBinary(buf);

    expect(emitted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/sim payload count mismatch.*consumed 4.*header 6/),
    );

    warnSpy.mockRestore();
  });

  it('missing pending snapshot: does not emit, warns', () => {
    const { client, sendBinary } = createClient();

    const emitted: unknown[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // No prior handleJson call → no pending snapshot for stepIndex=99
    sendBinary(buildSimFrame({ stepIndex: 99, simFieldIndex: 0, values: [1.0, 2.0] }));

    expect(emitted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing snapshot metadata for sim payload step 99'),
    );

    warnSpy.mockRestore();
  });

  it('valueCount mismatch (cell slice overruns buffer): does not emit, warns', () => {
    // This exercises the `offset + len > valueCount` guard inside the cell loop.
    const { client, sendJson, sendBinary } = createClient();

    const emitted: unknown[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Cell 0 claims simDataLength=5, but we only send 3 values
    sendJson(buildSnapshotJson(0, [5]));
    sendBinary(buildSimFrame({ stepIndex: 0, simFieldIndex: 0, values: [1, 2, 3] }));

    expect(emitted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/sim payload length mismatch.*step 0/),
    );

    warnSpy.mockRestore();
  });

  it('snapshot without hasSimDataPayload is emitted immediately (no binary needed)', () => {
    const { client, sendJson } = createClient();

    const emitted: unknown[] = [];
    client.on('snapshot_data', (msg) => emitted.push(msg));

    // hasSimDataPayload=false → client emits right away via handleJson
    sendJson(buildSnapshotJson(0, [], false));

    expect(emitted).toHaveLength(1);
  });
});
