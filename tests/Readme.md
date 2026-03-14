# SpaceTreeVisualizer — Integration Tests

## Tests

| Directory | What it tests |
|-----------|--------------|
| `exahype2-fv-euler/` | 3-component end-to-end: ExaHyPE2 FV point-explosion → backend → browser |

---

## Prerequisites

### 1. Peano4 / ExaHyPE2 build

The test script uses the Peano4 Python API to generate and build C++ code.
You need a compiled Peano build and its Python packages on your path:

```bash
export PEANO_CMAKE_BUILD_DIR=/path/to/peano/build   # must contain PeanoTargets.cmake
export PYTHONPATH=/path/to/peano/python:$PYTHONPATH
```

Load the same modules (MPI, compilers, etc.) that were used to compile Peano.

### 2. spacetree_visualizer package

Install the plugin in editable mode from the repository root:

```bash
pip install -e ./spacetree_visualizer
```

### 3. Backend and frontend dependencies

```bash
cd backend  && npm install
cd frontend && npm install
```

---

## Running the FV Euler test

### Step 1 — Generate C++ and build the simulation binary

```bash
cd tests/exahype2-fv-euler
python3 point-explosion.py -d 3 -m Release -md 4 -amr 2
```

This generates all C++ sources (including `STVConnection.h/cpp`) via Peano's
output pipeline and compiles the `ExaHyPE` binary. Key flags:

| Flag | Default | Description |
|------|---------|-------------|
| `-d 2\|3` | `2` | Spatial dimensions |
| `-m Release\|Asserts\|Debug` | `Release` | Build mode |
| `-md N` | `6` | Minimum AMR depth |
| `-amr N` | `0` | Extra AMR levels |
| `-et T` | `0.5` | Simulation end time |

### Step 2 — Start the backend

```bash
cd backend
npx ts-node src/server.ts
```

Listens on TCP 7421 (simulation) and HTTP/WS 7422 (browser).

### Step 3 — Start the frontend (optional)

```bash
cd frontend && npm run dev
# Open http://localhost:5173
```

### Step 4 — Run the simulation

```bash
cd tests/exahype2-fv-euler
./ExaHyPE
```

The simulation streams the AMR mesh to the backend in real time.

---

## Generated files

Running `point-explosion.py` writes C++ sources into `tests/exahype2-fv-euler/`.
These are listed in `.gitignore` and should not be committed.

The files generated include:
- `STVConnection.h / .cpp` — static TCP connection manager
- `observers/` — Peano observer classes (one per solver step)
- `repositories/` — data repository
- `AbstractFVSolver.h/.cpp`, `FVSolver.h/.cpp` — solver skeleton
- `ExaHyPE` — simulation binary
