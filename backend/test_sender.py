#!/usr/bin/env python3
"""
Quick integration test: simulates a C++ spacetree sender.
Connects to the backend TCP server, sends a handshake, two steps with optional
patch cell data, then disconnects.

Usage:
  # Terminal 1: cd backend && npx ts-node src/server.ts
  # Terminal 2: python3 test_sender.py [--cell-data]
"""
import socket
import struct
import zlib
import time

HOST = '127.0.0.1'
PORT = 7421

MAGIC   = 0x50454e30
VERSION = 0x02   # v2 handshake (20 bytes)
DIMS    = 3      # 3D

# Patch / field metadata (used in handshake + data layout)
PATCH_SIZE = 3
N_UNKNOWNS = 5
N_AUX      = 0
UNKNOWN_NAMES = ['rho', 'vx', 'vy', 'vz', 'E']

# Handshake flags
FLAG_ZLIB      = 0x0001
FLAG_CELL_DATA = 0x0004

# Frame types
FRAME_STEP_BEGIN      = 0x01
FRAME_STEP_END        = 0x02
FRAME_CELL_BATCH      = 0x03
FRAME_METADATA_NAMES  = 0x08


def make_handshake(rank=0, tree_id=0, dims=3, flags=0,
                   patch_size=PATCH_SIZE, n_unknowns=N_UNKNOWNS, n_aux=N_AUX):
    """Pack a 20-byte VERSION=0x02 handshake."""
    return struct.pack('<IBBHiiBBBx',
        MAGIC,        # uint32
        VERSION,      # uint8
        dims,         # uint8
        flags,        # uint16
        rank,         # int32
        tree_id,      # int32
        patch_size,   # uint8
        n_unknowns,   # uint8
        n_aux,        # uint8
                      # x = 1 pad byte (zero)
    )


def make_frame(frame_type: int, payload: bytes, compress=False) -> bytes:
    if compress and len(payload) > 64:
        compressed = zlib.compress(payload)
        frame_flags = 0x01
        payload_bytes = compressed
    else:
        frame_flags = 0x00
        payload_bytes = payload

    checksum = zlib.crc32(payload_bytes) & 0xFFFFFFFF
    header = struct.pack('<BBHIII',
        frame_type,
        frame_flags,
        0,                    # reserved
        len(payload_bytes),   # PAYLOAD_LEN
        len(payload),         # RAW_LEN
        checksum,
    )
    return header + payload_bytes


def make_metadata_names_frame(names: list) -> bytes:
    """Pack METADATA_NAMES frame: NUL-separated UTF-8 unknown names."""
    payload = b'\x00'.join(n.encode('utf-8') for n in names)
    return make_frame(FRAME_METADATA_NAMES, payload)


def make_step_begin(step_index: int, timestamp: float) -> bytes:
    payload = struct.pack('<id', step_index, timestamp)
    return make_frame(FRAME_STEP_BEGIN, payload)


def make_step_end(step_index: int) -> bytes:
    payload = struct.pack('<i', step_index)
    return make_frame(FRAME_STEP_END, payload)


def make_cell_record_3d(cx, cy, cz, hx, hy, hz, level, flags, rx=0, ry=0, rz=0):
    """Pack one CellRecord for DIMS=3 (32 bytes geometry)."""
    return struct.pack('<ffffffhHbbbx',
        cx, cy, cz,   # centre float32 x 3
        hx, hy, hz,   # h float32 x 3
        level,        # int16
        flags,        # uint16
        rx, ry, rz,   # rel_pos int8 x 3
                      # pad (x = 1 pad byte)
    )


def make_patch_sim_data(base_rho: float, ix_cell: int = 0) -> bytes:
    """
    Pack a PATCH_SIZE^3 × N_UNKNOWNS diagonal-gradient patch.

    Layout: Q[sub_linear * (N_UNKNOWNS + N_AUX) + unknown_idx]
    where sub_linear = ix + PATCH_SIZE * (iy + PATCH_SIZE * iz).

    The 'rho' field (index 0) varies diagonally from base_rho at (0,0,0)
    to base_rho + 1 at (PS-1, PS-1, PS-1).  Other fields are small offsets
    to give all unknowns distinct, non-trivial values.
    """
    N = N_UNKNOWNS + N_AUX
    denom = 3.0 * (PATCH_SIZE - 1) if PATCH_SIZE > 1 else 1.0
    values = []
    for iz in range(PATCH_SIZE):
        for iy in range(PATCH_SIZE):
            for ix in range(PATCH_SIZE):
                diag = (ix + iy + iz) / denom  # 0.0 .. 1.0
                sub = [
                    base_rho + diag,          # rho
                    0.1 * ix / (PATCH_SIZE-1) if PATCH_SIZE > 1 else 0.1,  # vx
                    0.1 * iy / (PATCH_SIZE-1) if PATCH_SIZE > 1 else 0.1,  # vy
                    0.1 * iz / (PATCH_SIZE-1) if PATCH_SIZE > 1 else 0.1,  # vz
                    (base_rho + diag) * 2.5,  # E
                ]
                values.extend(sub)
    data_bytes = struct.pack(f'<{len(values)}d', *values)
    return struct.pack('<I', len(data_bytes)) + data_bytes


def make_cell_batch(cells: list) -> bytes:
    payload = b''.join(cells)
    return make_frame(FRAME_CELL_BATCH, payload)


def run(with_cell_data: bool = False):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((HOST, PORT))
    print(f"Connected to {HOST}:{PORT}")

    # Send handshake — include HAS_CELL_DATA flag when streaming sim data
    hs_flags = FLAG_CELL_DATA if with_cell_data else 0
    hs = make_handshake(rank=0, tree_id=0, dims=DIMS, flags=hs_flags)
    sock.sendall(hs)
    print(f"Sent handshake v{VERSION} ({len(hs)} bytes, patchSize={PATCH_SIZE})")

    # Wait for ACK
    ack = sock.recv(1)
    if ack == b'\x41':
        print("Got ACK")
    else:
        print(f"Unexpected ACK: {ack!r}")
        return

    # Send METADATA_NAMES frame immediately after ACK (v2 protocol)
    if with_cell_data:
        sock.sendall(make_metadata_names_frame(UNKNOWN_NAMES))
        print(f"Sent METADATA_NAMES: {UNKNOWN_NAMES}")

    # ---- Step 0 ----
    sock.sendall(make_step_begin(0, 0.0))
    print("Sent STEP_BEGIN 0")

    def cell(geom):
        return geom

    def cell_with_data(geom, base_rho):
        return geom + make_patch_sim_data(base_rho)

    if with_cell_data:
        # 3 AMR cells at level 1; each gets a distinct base density so subcell
        # gradients are clearly separated in the colormap.
        cell_records = [
            cell_with_data(make_cell_record_3d(0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 1, 0b0000_0100, 0, 0, 0), 1.0),
            cell_with_data(make_cell_record_3d(0.75, 0.25, 0.25, 0.5, 0.5, 0.5, 1, 0b0000_0100, 1, 0, 0), 2.0),
            cell_with_data(make_cell_record_3d(0.25, 0.75, 0.25, 0.5, 0.5, 0.5, 1, 0b0000_0100, 0, 1, 0), 3.0),
        ]
    else:
        cell_records = [
            cell(make_cell_record_3d(0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 1, 0b0000_0100, 0, 0, 0)),
            cell(make_cell_record_3d(0.75, 0.25, 0.25, 0.5, 0.5, 0.5, 1, 0b0000_0100, 1, 0, 0)),
            cell(make_cell_record_3d(0.25, 0.75, 0.25, 0.5, 0.5, 0.5, 1, 0b0000_0100, 0, 1, 0)),
        ]

    sock.sendall(make_cell_batch(cell_records))
    n_per = f" ({PATCH_SIZE}^3 × {N_UNKNOWNS} doubles each)" if with_cell_data else ""
    print(f"Sent CELL_BATCH with {len(cell_records)} cells{n_per}")

    sock.sendall(make_step_end(0))
    print("Sent STEP_END 0")

    time.sleep(0.5)

    # ---- Step 1: refined cells ----
    sock.sendall(make_step_begin(1, 0.1))
    refined_cells = []
    for ix in range(2):
        for iy in range(2):
            for iz in range(2):
                geom = make_cell_record_3d(
                    0.125 + 0.25 * ix, 0.125 + 0.25 * iy, 0.125 + 0.25 * iz,
                    0.25, 0.25, 0.25,
                    2, 0b0000_0100,
                    ix, iy, iz,
                )
                if with_cell_data:
                    refined_cells.append(geom + make_patch_sim_data(1.0 + 0.1 * (ix + iy + iz)))
                else:
                    refined_cells.append(geom)
    sock.sendall(make_cell_batch(refined_cells))
    sock.sendall(make_step_end(1))
    print(f"Sent step 1 with {len(refined_cells)} refined cells")

    time.sleep(0.5)
    sock.close()
    print("Done.")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--cell-data', action='store_true',
                        help='Send patch sim data after each cell (sets HAS_CELL_DATA flag)')
    args = parser.parse_args()
    run(with_cell_data=args.cell_data)
