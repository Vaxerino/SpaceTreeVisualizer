# SpaceTreeVisualizer — Wire Protocol Specification

Version: 1
Encoding: little-endian throughout (unless noted)
Source of truth: `backend/src/frameTypes.ts`, `peano_plugin/_templates/STVConnection.cpp.jinja2`

---

## Overview

Each Peano spacetree (one per thread) opens a dedicated TCP connection to the backend. This avoids any mutex in the C++ sender — each thread owns its file descriptor. The connection lifecycle is:

```
C++ sender                          backend
──────────                          ───────
connect()
── Handshake (14 bytes) ──────────▶
                         parse, register tree
◀── ACK (1 byte) ────────────────
[optional: STEP_BEGIN, CELL_BATCH, STEP_END, PAUSE_ACK / CONTINUE loop]
close()
```

All binary values are unsigned unless prefixed with `int`. All multi-byte integers are little-endian.

---

## Handshake

The C++ sender transmits a fixed 16-byte header immediately after the TCP connection is established. The backend replies with a 1-byte ACK.

### Request (C++ → backend, 16 bytes)

| Offset | Size | Type   | Name     | Value / Notes |
|--------|------|--------|----------|---------------|
| 0      | 4    | uint32 | MAGIC    | `0x50454E30` = ASCII `PEN0` |
| 4      | 1    | uint8  | VERSION  | `0x01` |
| 5      | 1    | uint8  | DIMS     | `2` or `3` (spatial dimensions) |
| 6      | 2    | uint16 | FLAGS    | see flag bits below |
| 8      | 4    | int32  | RANK     | MPI rank (0 for serial) |
| 12     | 4    | int32  | TREE_ID  | Peano spacetree ID |

**Handshake FLAGS bits:**

| Bit | Mask   | Meaning |
|-----|--------|---------|
| 0   | 0x0001 | `ZLIB` — sender will zlib-compress batches when above threshold |
| 1   | 0x0002 | `PAUSE_MODE` — sender will block at `unprepareTraversal` |
| 2   | 0x0004 | `HAS_CELL_DATA` — `CELL_BATCH` frames include simulation data blobs |
| 3   | 0x0008 | `HAS_FACE_DATA` — `FACE_BATCH` frames include simulation data blobs |

### Response (backend → C++, 1 byte)

| Value | Meaning |
|-------|---------|
| `0x41` ('A') | Connection accepted |
| `0x52` ('R') | Rejected (version mismatch or bad magic) |

---

## Frame Format

After the handshake all communication is frame-based. Every frame begins with a 16-byte header.

### Frame Header (16 bytes)

| Offset | Size | Type   | Name        | Notes |
|--------|------|--------|-------------|-------|
| 0      | 1    | uint8  | FRAME_TYPE  | see frame type table |
| 1      | 1    | uint8  | FRAME_FLAGS | bit 0 = `COMPRESSED` |
| 2      | 2    | uint16 | RESERVED    | must be zero |
| 4      | 4    | uint32 | PAYLOAD_LEN | length of the payload bytes that follow (after compression, if any) |
| 8      | 4    | uint32 | RAW_LEN     | uncompressed payload length (= `PAYLOAD_LEN` when not compressed) |
| 12     | 4    | uint32 | CHECKSUM    | CRC32 of the payload bytes (zlib `crc32()`) |

**FRAME_FLAGS bits:**

| Bit | Mask   | Meaning |
|-----|--------|---------|
| 0   | 0x01   | `COMPRESSED` — payload is zlib-compressed (`zlib::compress()`). Decompress to `RAW_LEN` bytes before parsing. |

### Frame Types

| Hex  | Name          | Direction        | Payload description |
|------|---------------|------------------|---------------------|
| 0x01 | `STEP_BEGIN`  | C++ → backend    | step index + timestamp |
| 0x02 | `STEP_END`    | C++ → backend    | step index |
| 0x03 | `CELL_BATCH`  | C++ → backend    | array of `CellRecord` |
| 0x04 | `FACE_BATCH`  | C++ → backend    | array of `FaceRecord` (Phase 2) |
| 0x05 | `VERTEX_BATCH`| C++ → backend    | array of `VertexRecord` (Phase 2) |
| 0x06 | `PAUSE_ACK`   | C++ → backend    | zero-length payload; C++ blocks |
| 0x07 | `CONTINUE`    | backend → C++    | zero-length payload; unblocks C++ |

---

## Payload Formats

### STEP_BEGIN payload (12 bytes)

| Offset | Size | Type    | Name       |
|--------|------|---------|------------|
| 0      | 4    | int32   | step_index |
| 4      | 8    | float64 | timestamp  |

### STEP_END payload (4 bytes)

| Offset | Size | Type  | Name       |
|--------|------|-------|------------|
| 0      | 4    | int32 | step_index |

### CELL_BATCH payload

An array of `CellRecord` entries packed end-to-end. Each record has a fixed geometry section followed by an optional simulation data section (present if `HAS_CELL_DATA` flag was set in the handshake).

#### CellRecord geometry section

**3D (DIMS=3): 32 bytes**

| Offset | Size | Type    | Name      | Notes |
|--------|------|---------|-----------|-------|
| 0      | 4    | float32 | cx        | cell centre x |
| 4      | 4    | float32 | cy        | cell centre y |
| 8      | 4    | float32 | cz        | cell centre z |
| 12     | 4    | float32 | hx        | cell size x |
| 16     | 4    | float32 | hy        | cell size y |
| 20     | 4    | float32 | hz        | cell size z |
| 24     | 2    | int16   | level     | refinement level (root = 0) |
| 26     | 2    | uint16  | flags     | `CellMarker` bitmask (see below) |
| 28     | 1    | int8    | rel_pos_x | `relativePositionWithinFatherCell.x` |
| 29     | 1    | int8    | rel_pos_y | |
| 30     | 1    | int8    | rel_pos_z | |
| 31     | 1    | —       | pad       | zero |

**2D (DIMS=2): 24 bytes** — same layout without the z fields:

| Offset | Size | Type    | Name      |
|--------|------|---------|-----------|
| 0      | 4    | float32 | cx        |
| 4      | 4    | float32 | cy        |
| 8      | 4    | float32 | hx        |
| 12     | 4    | float32 | hy        |
| 16     | 2    | int16   | level     |
| 18     | 2    | uint16  | flags     |
| 20     | 1    | int8    | rel_pos_x |
| 21     | 1    | int8    | rel_pos_y |
| 22     | 2    | —       | pad       |

#### CellRecord simulation data section (optional, appended after geometry)

Present only when `HAS_CELL_DATA` handshake flag is set.

| Offset | Size      | Type     | Name      | Notes |
|--------|-----------|----------|-----------|-------|
| 0      | 4         | uint32   | data_len  | byte count of the raw data that follows |
| 4      | `data_len`| float64[]| data      | raw solver patch values in row-major order |

The number of float64 values = `patch_size^DIMS × (n_unknowns + n_aux_vars)`. The ordering matches the Peano `dfor` traversal (innermost index = x).

#### CellMarker flags bitmask (uint16)

| Bit | Mask   | Name                  | Source in Peano |
|-----|--------|-----------------------|-----------------|
| 0   | 0x0001 | `HAS_BEEN_REFINED`    | `CellMarker::hasBeenRefined()` |
| 1   | 0x0002 | `WILL_BE_REFINED`     | `CellMarker::willBeRefined()` |
| 2   | 0x0004 | `IS_LOCAL`            | `CellMarker::isLocal()` |
| 3   | 0x0008 | `IS_PARENT_LOCAL`     | `CellMarker::isParentLocal()` |
| 4   | 0x0010 | `ALL_VTXS_REFINED`    | |
| 5   | 0x0020 | `ONE_VTX_HANGING`     | |
| 6   | 0x0040 | `INSIDE_DOMAIN`       | `CellMarker::areAllVerticesInsideDomain()` |
| 9   | 0x0200 | `WILL_BE_ENCLAVE`     | `CellMarker::willBeEnclave()` |
| 10  | 0x0400 | `HAS_BEEN_ENCLAVE`    | `CellMarker::hasBeenEnclave()` |

### FACE_BATCH payload (Phase 2)

Array of `FaceRecord`. 3D size: 40 bytes per record.

| Offset | Size | Type    | Name         | Notes |
|--------|------|---------|--------------|-------|
| 0      | 4    | float32 | cx           | adjacent cell centre x |
| 4      | 4    | float32 | cy           | |
| 8      | 4    | float32 | cz           | |
| 12     | 4    | float32 | hx           | cell size |
| 16     | 4    | float32 | hy           | |
| 20     | 4    | float32 | hz           | |
| 24     | 1    | int8    | face_number  | 0..2D-1, encodes which face of the cell |
| 25     | 1    | uint8   | cell_is_local| |
| 26     | 1    | uint8   | has_been_refined | bitmask |
| 27     | 1    | uint8   | will_be_refined  | bitmask |
| 28     | 1    | uint8   | is_local     | |
| 29     | 1    | uint8   | is_hanging   | |
| 30     | 3    | int8×3  | rel_pos      | |
| 33–39  | 7    | —       | pad          | zero |

### VERTEX_BATCH payload (Phase 2)

Array of `VertexRecord`. 3D size: 32 bytes per record.

| Offset | Size | Type    | Name              | Notes |
|--------|------|---------|-------------------|-------|
| 0      | 4    | float32 | x                 | vertex position |
| 4      | 4    | float32 | y                 | |
| 8      | 4    | float32 | z                 | |
| 12     | 4    | float32 | hx                | invoking cell size |
| 16     | 4    | float32 | hy                | |
| 20     | 4    | float32 | hz                | |
| 24     | 1    | uint8   | is_hanging        | |
| 25     | 1    | uint8   | is_local          | |
| 26     | 1    | uint8   | has_been_refined  | |
| 27     | 1    | uint8   | will_be_refined   | |
| 28     | 1    | uint8   | is_adjacent_to_parallel_boundary | |
| 29–31  | 3    | —       | pad               | zero |

---

## Compression

The sender compresses a batch payload when its uncompressed size exceeds `COMPRESS_THRESHOLD` bytes (default 4096). Compression uses the standard `zlib compress()` function at default level. The `FRAME_FLAG_COMPRESSED` bit is set in the frame header.

The backend decompresses using Node's built-in `zlib.inflateSync()`.

**C++ pattern** (matches existing Peano VTUFileWriter):
```cpp
#ifdef USE_ZLIB
  #include <zlib.h>
  if (rawPayload.size() > COMPRESS_THRESHOLD) {
    uLongf compLen = compressBound(rawPayload.size());
    std::vector<uint8_t> compBuf(compLen);
    compress(compBuf.data(), &compLen, rawPayload.data(), rawPayload.size());
    compBuf.resize(compLen);
    sendFrameInternal(FRAME_CELL_BATCH, 0x01, compBuf, rawPayload.size());
    return;
  }
#endif
  sendFrameInternal(FRAME_CELL_BATCH, 0x00, rawPayload, rawPayload.size());
```

---

## Pause / Resume Flow

When `PAUSE_MODE` is set in the handshake:

1. After all spacetrees on a rank complete their traversal, `unprepareTraversal()` (static) sends `FRAME_PAUSE_ACK` (frame type `0x06`, zero payload).
2. The C++ thread then blocks in a `read(fd, &byte, 1)` loop waiting for `FRAME_CONTINUE`.
3. The backend receives `PAUSE_ACK` from each tree, records it.
4. When the browser sends `{type:"continue"}` over WebSocket, the backend writes `0x07` (the `CONTINUE` byte) to all blocked tree sockets.
5. All blocked `read()` calls return; `unprepareTraversal()` returns; Peano proceeds to the next step.

This gives the browser full per-step control over the simulation timeline.

---

## Step Commit Logic

The backend tracks per-step state:

```
pending[step_index] = Map<treeKey, CellRecord[]>   // cells accumulated per tree
pendingEnded[step_index] = Set<treeKey>             // trees that sent STEP_END
```

A step is committed when:
```
pendingEnded[step_index] == pending[step_index].keys()
```
i.e., every tree that sent `STEP_BEGIN` for this step has also sent `STEP_END`.

After commit the step is appended to the ring buffer (max 200 steps). Oldest step is evicted when the buffer is full.

---

## Versioning

The `VERSION` byte in the handshake allows future incompatible changes. Currently only version `0x01` is defined. The backend logs a warning but accepts connections with unknown versions.
