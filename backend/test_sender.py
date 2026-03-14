#!/usr/bin/env python3
"""
Quick integration test: simulates a C++ spacetree sender.
Connects to the backend TCP server, sends a handshake, one step with 3 cells,
then disconnects.

Usage:
  # Terminal 1: cd backend && npx ts-node src/server.ts
  # Terminal 2: python3 test_sender.py
"""
import socket
import struct
import zlib
import time

HOST = '127.0.0.1'
PORT = 7421

MAGIC   = 0x50454e30
VERSION = 0x01
DIMS    = 3  # 3D

# Handshake flags
FLAG_ZLIB      = 0x0001
FLAG_CELL_DATA = 0x0004

# Frame types
FRAME_STEP_BEGIN  = 0x01
FRAME_STEP_END    = 0x02
FRAME_CELL_BATCH  = 0x03


def make_handshake(rank=0, tree_id=0, dims=3, flags=0):
    return struct.pack('<IBBHii',
        MAGIC,     # uint32
        VERSION,   # uint8
        dims,      # uint8
        flags,     # uint16
        rank,      # int32
        tree_id,   # int32
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


def make_sim_data_section(values: list) -> bytes:
    """Pack simulation data section: uint32 byte_count + float64 values."""
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
    print(f"Sent handshake ({len(hs)} bytes)")

    # Wait for ACK
    ack = sock.recv(1)
    if ack == b'\x41':
        print("Got ACK")
    else:
        print(f"Unexpected ACK: {ack!r}")
        return

    # Send step 0
    sock.sendall(make_step_begin(0, 0.0))
    print("Sent STEP_BEGIN 0")

    def cell(geom, sim_values):
        """Combine geometry record with optional sim data section."""
        if with_cell_data:
            return geom + make_sim_data_section(sim_values)
        return geom

    # Send a batch of 3 cells — sim data: [rho, rhoU_x, rhoU_y, rhoU_z, rhoE]
    cell_records = [
        cell(make_cell_record_3d(0.25, 0.25, 0.25, 0.5,0.5,0.5, 1, 0b0000_0100, 0,0,0), [1.0, 0.1, 0.0, 0.0, 2.5]),
        cell(make_cell_record_3d(0.75, 0.25, 0.25, 0.5,0.5,0.5, 1, 0b0000_0100, 1,0,0), [1.2, 0.2, 0.0, 0.0, 3.0]),
        cell(make_cell_record_3d(0.25, 0.75, 0.25, 0.5,0.5,0.5, 1, 0b0000_0100, 0,1,0), [0.8, 0.0, 0.3, 0.0, 2.0]),
    ]
    sock.sendall(make_cell_batch(cell_records))
    print(f"Sent CELL_BATCH with {len(cell_records)} cells" + (" + sim data" if with_cell_data else ""))

    # End step
    sock.sendall(make_step_end(0))
    print("Sent STEP_END 0")

    time.sleep(0.5)

    # Send step 1 with refinement
    sock.sendall(make_step_begin(1, 0.1))
    refined_cells = []
    for ix in range(2):
        for iy in range(2):
            for iz in range(2):
                rho = 1.0 + 0.1 * (ix + iy + iz)
                refined_cells.append(cell(
                    make_cell_record_3d(
                        0.125 + 0.25*ix, 0.125 + 0.25*iy, 0.125 + 0.25*iz,
                        0.25, 0.25, 0.25,
                        2, 0b0000_0100,
                        ix, iy, iz,
                    ),
                    [rho, 0.05*ix, 0.05*iy, 0.05*iz, rho * 2.5],
                ))
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
                        help='Send sim data section after each cell (sets HAS_CELL_DATA flag)')
    args = parser.parse_args()
    run(with_cell_data=args.cell_data)
