/**
 * Wire protocol constants for the SpaceTreeVisualizer binary protocol.
 * Must stay in sync with the C++ STVConnection implementation.
 */

export const MAGIC = 0x50454e30; // "PEN0"
export const VERSION = 0x01;
export const ACK_BYTE = 0x41; // 'A'

// --- Handshake flags (FLAGS[2] in handshake) ---
export const HANDSHAKE_FLAG_ZLIB       = 0x0001;
export const HANDSHAKE_FLAG_PAUSE_MODE = 0x0002;
export const HANDSHAKE_FLAG_CELL_DATA  = 0x0004;
export const HANDSHAKE_FLAG_FACE_DATA  = 0x0008;

// --- Frame types ---
export const enum FrameType {
  STEP_BEGIN    = 0x01,
  STEP_END      = 0x02,
  CELL_BATCH    = 0x03,
  FACE_BATCH    = 0x04,
  VERTEX_BATCH  = 0x05,
  PAUSE_ACK     = 0x06,
  CONTINUE      = 0x07,
}

// --- Frame flags ---
export const FRAME_FLAG_COMPRESSED = 0x01;

// --- Frame header layout (16 bytes total) ---
export const FRAME_HEADER_SIZE = 16;
export const FRAME_OFFSET_TYPE        = 0;  // uint8
export const FRAME_OFFSET_FLAGS       = 1;  // uint8
export const FRAME_OFFSET_RESERVED    = 2;  // uint16
export const FRAME_OFFSET_PAYLOAD_LEN = 4;  // uint32 LE
export const FRAME_OFFSET_RAW_LEN     = 8;  // uint32 LE
export const FRAME_OFFSET_CHECKSUM    = 12; // uint32 LE (crc32)

// --- Handshake layout (16 bytes) ---
// MAGIC(4) + VERSION(1) + DIMS(1) + FLAGS(2) + RANK(4) + TREE_ID(4) = 16
export const HANDSHAKE_SIZE = 16;
export const HANDSHAKE_OFFSET_MAGIC   = 0;  // uint32 LE
export const HANDSHAKE_OFFSET_VERSION = 4;  // uint8
export const HANDSHAKE_OFFSET_DIMS    = 5;  // uint8
export const HANDSHAKE_OFFSET_FLAGS   = 6;  // uint16 LE
export const HANDSHAKE_OFFSET_RANK    = 8;  // int32 LE
export const HANDSHAKE_OFFSET_TREE_ID = 12; // int32 LE

// --- CellRecord field sizes and layout ---
// 3D: centre(12) + h(12) + level(2) + flags(2) + rel_pos(3) + pad(1) = 32 bytes geometry
// 2D: centre(8)  + h(8)  + level(2) + flags(2) + rel_pos(3) + pad(1) = 24 bytes geometry
export function cellRecordGeomSize(dims: number): number {
  return dims === 3 ? 32 : 24;
}

// --- CellMarker flag bitmasks (from CellMarker.h) ---
// These are the bit positions in the uint16 flags field of CellRecord.
export const CELL_FLAG_HAS_BEEN_REFINED  = 1 << 0;
export const CELL_FLAG_WILL_BE_REFINED   = 1 << 1;
export const CELL_FLAG_IS_LOCAL          = 1 << 2;
export const CELL_FLAG_IS_PARENT_LOCAL   = 1 << 3;
export const CELL_FLAG_ALL_VTXS_REFINED  = 1 << 4;
export const CELL_FLAG_ONE_VTX_HANGING   = 1 << 5;
export const CELL_FLAG_INSIDE_DOMAIN     = 1 << 6;
export const CELL_FLAG_WILL_BE_ENCLAVE   = 1 << 9;
export const CELL_FLAG_HAS_BEEN_ENCLAVE  = 1 << 10;
