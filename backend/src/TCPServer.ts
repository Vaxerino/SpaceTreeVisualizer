import * as net from 'net';
import {
  MAGIC, VERSION, ACK_BYTE,
  HANDSHAKE_SIZE,
  HANDSHAKE_OFFSET_MAGIC, HANDSHAKE_OFFSET_VERSION, HANDSHAKE_OFFSET_DIMS,
  HANDSHAKE_OFFSET_FLAGS, HANDSHAKE_OFFSET_RANK, HANDSHAKE_OFFSET_TREE_ID,
  HANDSHAKE_OFFSET_PATCH_SIZE, HANDSHAKE_OFFSET_N_UNKNOWNS, HANDSHAKE_OFFSET_N_AUX,
  HANDSHAKE_FLAG_ZLIB, HANDSHAKE_FLAG_PAUSE_MODE,
  HANDSHAKE_FLAG_CELL_DATA, HANDSHAKE_FLAG_FACE_DATA,
  FrameType,
} from './frameTypes';
import type { TreeConnection } from './types';
import { ProtocolParser } from './ProtocolParser';
import type { SpaceTreeStore } from './SpaceTreeStore';

/**
 * TCP server that accepts connections from C++ spacetree senders.
 *
 * Each connection corresponds to one spacetree (one Peano thread). The server
 * reads the handshake, sends an ACK, then hands subsequent data to a
 * ProtocolParser for frame-level processing.
 */
export class TCPServer {
  private server: net.Server;

  constructor(
    private readonly store: SpaceTreeStore,
    private readonly port: number = 7421,
  ) {
    this.server = net.createServer(socket => this.handleConnection(socket));
  }

  listen(): void {
    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[tcp] listening on :${this.port}`);
    });
    this.server.on('error', err => {
      console.error('[tcp] server error:', err);
    });
  }

  private handleConnection(socket: net.Socket): void {
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[tcp] new connection from ${addr}`);

    let handshakeBuffer: Buffer = Buffer.alloc(0);
    let parser: ProtocolParser | null = null;
    let conn: TreeConnection | null = null;
    let finalized = false;

    socket.on('data', (chunk: Buffer) => {
      if (parser) {
        // Handshake done — feed directly to parser.
        parser.feed(chunk);
        return;
      }

      // Still accumulating the handshake.
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);

      if (handshakeBuffer.length < HANDSHAKE_SIZE) return;

      // Parse handshake.
      const magic = handshakeBuffer.readUInt32LE(HANDSHAKE_OFFSET_MAGIC);
      if (magic !== MAGIC) {
        console.error(`[tcp] ${addr}: bad magic 0x${magic.toString(16)}, closing`);
        socket.destroy();
        return;
      }

      const version = handshakeBuffer.readUInt8(HANDSHAKE_OFFSET_VERSION);
      if (version !== VERSION) {
        console.warn(`[tcp] ${addr}: version mismatch (got ${version}, expected ${VERSION})`);
      }

      const dims      = handshakeBuffer.readUInt8(HANDSHAKE_OFFSET_DIMS);
      const flags     = handshakeBuffer.readUInt16LE(HANDSHAKE_OFFSET_FLAGS);
      const rank      = handshakeBuffer.readInt32LE(HANDSHAKE_OFFSET_RANK);
      const treeId    = handshakeBuffer.readInt32LE(HANDSHAKE_OFFSET_TREE_ID);
      const patchSize = handshakeBuffer.readUInt8(HANDSHAKE_OFFSET_PATCH_SIZE);
      const nUnknowns = handshakeBuffer.readUInt8(HANDSHAKE_OFFSET_N_UNKNOWNS);
      const nAux      = handshakeBuffer.readUInt8(HANDSHAKE_OFFSET_N_AUX);

      conn = {
        rank, treeId, dims,
        zlibEnabled:  (flags & HANDSHAKE_FLAG_ZLIB)       !== 0,
        pauseMode:    (flags & HANDSHAKE_FLAG_PAUSE_MODE)  !== 0,
        hasCellData:  (flags & HANDSHAKE_FLAG_CELL_DATA)   !== 0,
        hasFaceData:  (flags & HANDSHAKE_FLAG_FACE_DATA)   !== 0,
        key: `${rank}:${treeId}`,
        patchSize, nUnknowns, nAux,
      };

      if (this.store.continueSenders.size === 0 && this.store.hasRetainedRunState()) {
        this.store.resetForNewRun();
      }

      this.store.setSimMeta(patchSize, nUnknowns, nAux);

      console.log(`[tcp] ${addr}: handshake ok — tree ${conn.key}, dims=${dims}, ` +
        `zlib=${conn.zlibEnabled}, pause=${conn.pauseMode}, cellData=${conn.hasCellData}, ` +
        `patchSize=${patchSize}, nUnknowns=${nUnknowns}, nAux=${nAux}`);

      // Register tree so store knows the expected tree count before any STEP_BEGIN.
      this.store.registerTree(conn.key);

      // Send ACK.
      socket.write(Buffer.from([ACK_BYTE]));

      // Register CONTINUE sender so the store can unblock this tree.
      const continueByte = Buffer.from([FrameType.CONTINUE]);
      this.store.continueSenders.set(conn.key, () => {
        try { socket.write(continueByte); } catch { /* socket may be closed */ }
      });

      // Create parser and feed any remaining bytes after the handshake.
      parser = new ProtocolParser(conn, this.store);
      const remainder = handshakeBuffer.subarray(HANDSHAKE_SIZE);
      if (remainder.length > 0) {
        parser.feed(remainder);
      }
    });

    const finalize = (reason: 'disconnected' | 'error', message?: string) => {
      if (finalized) return;
      finalized = true;
      if (reason === 'error') {
        console.error(`[tcp] ${addr} error:`, message ?? 'unknown error');
      } else {
        console.log(`[tcp] ${addr} disconnected`);
      }
      if (conn) {
        this.store.continueSenders.delete(conn.key);
        this.store.unregisterTree(conn.key);
      }
    };

    socket.on('end', () => finalize('disconnected'));
    socket.on('close', () => finalize('disconnected'));
    socket.on('error', err => finalize('error', err.message));
  }
}
