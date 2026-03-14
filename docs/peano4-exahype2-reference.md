# Peano 4 / ExaHype 2 Architecture Reference

This document is a reference for agents and developers working on SpaceTreeVisualizer. It describes the parts of the Peano 4 and ExaHype 2 framework that are relevant to instrumenting a simulation with a custom `ActionSet`.

**Peano 4 source:** `/mnt/Megafast/Peano`

---

## 1. Conceptual Model

Peano 4 maintains an adaptive Cartesian mesh (octree in 3D, quadtree in 2D) stored on a **Peano space-filling curve**. The curve defines a canonical traversal order of all cells. During each *grid traversal* the automaton visits every node (cell), calling `enterNode` and `leaveNode` on a registered **Observer**.

The Observer dispatches to a list of **ActionSets** which implement the user's logic (physics kernels, I/O, refinement criteria). ActionSets are the primary extension point.

The full call hierarchy per traversal step:

```
SpacetreeSet::traverse()
  └─ (for each spacetree, in parallel threads)
       Observer::prepareTraversal()        ← static, called once before all trees
       Observer::beginTraversal(x, h)      ← per-tree
       Observer::loadVertexData(event)
       Observer::enterNode(event)
         └─ ActionSet::touchCellFirstTime(...)
            ActionSet::touchFaceFirstTime(...)
            ActionSet::touchVertexFirstTime(...)
       Observer::leaveNode(event)
         └─ ActionSet::touchCellLastTime(...)
            ActionSet::touchFaceLastTime(...)
            ActionSet::touchVertexLastTime(...)
       Observer::storeVertexData(event)
       Observer::endTraversal(x, h)        ← per-tree
       Observer::unprepareTraversal()      ← static, called once after all trees
```

---

## 2. Grid Entities

### Cell

A cell is the fundamental computational unit. In a Finite Volume solver, each cell carries a *patch* of sub-cells (e.g. a 6×6×6 block of finite volumes).

**Marker:** `peano4::datamanagement::CellMarker`
Source: `/mnt/Megafast/Peano/src/peano4/datamanagement/CellMarker.h`

Key accessor methods:
| Method | Returns | Notes |
|--------|---------|-------|
| `getX()` | `tarch::la::Vector<D,double>` | Cell centre |
| `getH()` | `tarch::la::Vector<D,double>` | Cell size per dimension |
| `getLevel()` | `int` | Refinement level (root = 0) |
| `isLocal()` | `bool` | Cell belongs to this rank/tree |
| `hasBeenRefined()` | `bool` | Refined in previous traversal |
| `willBeRefined()` | `bool` | Refinement triggered for next traversal |
| `isParentCellLocal()` | `bool` | |
| `areAllVerticesInsideDomain()` | `bool` | |
| `willBeEnclave()` | `bool` | Marked for GPU enclave tasking |
| `hasBeenEnclave()` | `bool` | Was a GPU enclave in previous step |
| `getRelativePositionWithinFatherCell()` | `tarch::la::Vector<D,int>` | Position in parent (0 or 1 per axis) |

### Face

Each cell has `2D` faces (4 in 2D, 6 in 3D). Faces are shared between adjacent cells.

**Marker:** `peano4::datamanagement::FaceMarker`
Source: `/mnt/Megafast/Peano/src/peano4/datamanagement/FaceMarker.h`

Key accessor methods:
| Method | Returns | Notes |
|--------|---------|-------|
| `getX(int i)` | `Vector<D,double>` | Centre of face `i` |
| `normal(int i)` | `Vector<D,double>` | Unit normal for face `i` |
| `isLocal(int i)` | `bool` | |
| `isHanging(int i)` | `bool` | Hanging face on refinement boundary |
| `hasBeenRefined(int i)` | `bool` | |
| `willBeRefined(int i)` | `bool` | |

### Vertex

`2^D` vertices per cell (4 in 2D, 8 in 3D). Shared between all adjacent cells.

**Marker:** `peano4::datamanagement::VertexMarker`
Source: `/mnt/Megafast/Peano/src/peano4/datamanagement/VertexMarker.h`

Key accessor methods:
| Method | Returns | Notes |
|--------|---------|-------|
| `getX()` | `Vector<D,double>` | Vertex position |
| `getH()` | `Vector<D,double>` | Size of invoking cell |
| `isLocal(int i)` | `bool` | |
| `isHanging(int i)` | `bool` | |
| `hasBeenRefined(int i)` | `bool` | |
| `willBeRefined(int i)` | `bool` | |
| `isAdjacentToParallelDomainBoundary(int i)` | `bool` | |

---

## 3. ActionSet

An `ActionSet` is a C++ class (generated from a Python description) that implements callbacks for grid events. It is the primary way users add logic to a traversal.

**Base Python class:** `peano4.solversteps.ActionSet`
Source: `/mnt/Megafast/Peano/python/peano4/solversteps/ActionSet.py`

### Python API

```python
class MyActionSet(peano4.solversteps.ActionSet.ActionSet):

    def get_action_set_name(self) -> str:
        return "MyActionSet"

    def user_should_modify_template(self) -> bool:
        # True  → generates into actions/ for user editing
        # False → generates into observer/ (managed, not user-edited)
        return True

    def get_includes(self) -> str:
        return "#include <my_header.h>\n"

    def get_attributes(self) -> str:
        # C++ member declarations
        return "int _myMember;\n"

    def get_constructor_body(self) -> str:
        return "_myMember = 0;\n"

    def get_body_of_operation(self, operation_name: str) -> str:
        if operation_name == peano4.solversteps.ActionSet.OPERATION_TOUCH_CELL_FIRST_TIME:
            return "// called once per local cell\n"
        return ""

    def get_body_of_prepareTraversal(self) -> str:
        # Static method body, called once before all trees on this rank
        return ""

    def get_body_of_unprepareTraversal(self) -> str:
        # Static method body, called once after all trees on this rank
        return ""
```

### Operation name constants

Defined in `peano4.solversteps.ActionSet`:

| Constant | C++ callback | When called |
|----------|-------------|-------------|
| `OPERATION_TOUCH_CELL_FIRST_TIME` | `touchCellFirstTime` | Cell first encountered during descent |
| `OPERATION_TOUCH_CELL_LAST_TIME` | `touchCellLastTime` | Cell visited during ascent |
| `OPERATION_TOUCH_FACE_FIRST_TIME` | `touchFaceFirstTime` | Face first encountered |
| `OPERATION_TOUCH_FACE_LAST_TIME` | `touchFaceLastTime` | Face visited on way back |
| `OPERATION_TOUCH_VERTEX_FIRST_TIME` | `touchVertexFirstTime` | Vertex first encountered |
| `OPERATION_TOUCH_VERTEX_LAST_TIME` | `touchVertexLastTime` | Vertex visited on way back |
| `OPERATION_BEGIN_TRAVERSAL` | `beginTraversal` | Start of this tree's sweep |
| `OPERATION_END_TRAVERSAL` | `endTraversal` | End of this tree's sweep |
| `OPERATION_CREATE_CELL` | `createCell` | New cell created (AMR refine) |
| `OPERATION_DESTROY_CELL` | `destroyCell` | Cell destroyed (AMR coarsen) |
| `OPERATION_CREATE_FACE` | `createFace` | |
| `OPERATION_DESTROY_FACE` | `destroyFace` | |
| `OPERATION_CREATE_PERSISTENT_VERTEX` | `createPersistentVertex` | |
| `OPERATION_DESTROY_PERSISTENT_VERTEX` | `destroyPersistentVertex` | |

### Generated C++ signatures

The generated `.h` file will contain (for an FV solver with one cell type and no faces/vertices relevant here):

```cpp
class MyActionSet {
public:
  MyActionSet(int treeNumber);

  static void prepareTraversal();
  static void unprepareTraversal();

  void beginTraversal();
  void endTraversal();

  void touchCellFirstTime(
    const peano4::datamanagement::CellMarker& marker,
    MySolverCellData& fineGridCellMySolverCellData,        // fine grid data
    MySolverCellData& coarseGridCellMySolverCellData,      // coarse grid (parent)
    // faces and vertices if present...
  );

  void touchCellLastTime(
    const peano4::datamanagement::CellMarker& marker,
    MySolverCellData& fineGridCellMySolverCellData,
    MySolverCellData& coarseGridCellMySolverCellData
  );
};
```

The exact argument list is determined by which data models are registered on the step (via `step.use_cell()`, `step.use_face()`, `step.use_vertex()`).

### prepareTraversal / unprepareTraversal

These are **static** methods. They are called once per traversal, not once per spacetree. The call order is:

```
prepareTraversal()        ← once, before any tree starts
  for each tree (parallel):
    beginTraversal()
    [cell/face/vertex callbacks]
    endTraversal()
unprepareTraversal()      ← once, after all trees finish
```

Use `std::call_once` or a static atomic flag for one-time initialisation in `prepareTraversal`. Use `unprepareTraversal` for finalisation, reduction, or blocking (pause mode).

### descend_invocation_order

ActionSets within a step are sorted by `descend_invocation_order` (ascending = earlier during descent / `touchFirstTime`; the reverse order is used during ascent / `touchLastTime`). Set this attribute on the Python instance:

```python
action_set.descend_invocation_order = solver._action_set_update_cell.descend_invocation_order + 1
```

---

## 4. ExaHype 2 Project API

**Source:** `/mnt/Megafast/Peano/python/exahype2/Project.py`

### Adding action sets

```python
project.add_action_set_to_timestepping(action_set)
project.add_action_set_to_initialisation(action_set)
project.add_action_set_to_create_grid(action_set)   # adds to both with/without refinement
```

These methods call `step.add_action_set(action_set)` on the appropriate internal `Step` object:

| Method | Step |
|--------|------|
| `add_action_set_to_create_grid` | `create_grid_with_refinement`, `create_grid_without_refinement` |
| `add_action_set_to_initialisation` | `init_grid` |
| `add_action_set_to_timestepping` | `perform_time_step` |

### Solver internal action sets (FV)

The FV solver creates and owns these action sets internally (do not modify directly):

| Attribute | Class | Purpose |
|-----------|-------|---------|
| `_action_set_initial_conditions` | `InitialCondition` | Set initial values |
| `_action_set_update_cell` | `UpdatePatch` | Core Riemann solver |
| `_action_set_AMR` | `AdaptivityCriterion` | AMR refinement decision |
| `_action_set_handle_boundary` | `HandleBoundary` | Boundary conditions |
| `_action_set_project_patch_onto_faces` | `ProjectPatchOntoFaces` | Reconstruction |
| `_action_set_roll_over_update_of_faces` | `RollOverUpdatedFace` | Face data management |
| `_action_set_postprocess_solution` | `PostprocessSolution` | User postprocessing |

---

## 5. Solver Data Models (FV)

**Source:** `/mnt/Megafast/Peano/python/exahype2/solvers/fv/FV.py`

### Data structures per cell

| Python attribute | C++ type | Description |
|-----------------|----------|-------------|
| `solver._patch` | `peano4.datamodel.Patch` | Core cell data: `patch_size^D × (unknowns + aux_vars)` doubles |
| `solver._patch_reconstructed` | `Patch` | Cell data with halo: `(patch_size + 2×overlap)^D × ...` |
| `solver._patch_overlap_new` | `Patch` | Face overlap (new values): `2 × patch_size^(D-1) × overlap × ...` |
| `solver._patch_overlap_old` | `Patch` | Face overlap (previous step) |

### Accessing solver metadata in Python

```python
# Unknown identifier (used as variable name in generated C++)
uid = solver._unknown_identifier()  # e.g. "CCZ4Q"

# Patch size (cells per axis)
ps = solver._patch_size  # e.g. 6 for a 6×6×6 patch

# Number of unknowns (physics variables)
n_unknowns = solver._variable_shortcuts.unknowns  # e.g. 59 for CCZ4

# Number of auxiliary variables
n_aux = solver._variable_shortcuts.auxiliary_variables  # e.g. 0

# Total doubles per cell = ps^D × (n_unknowns + n_aux)
```

### Accessing cell data in C++ action sets

Inside `touchCellFirstTime`, the cell data is passed as a reference to the generated DaStGen2 class:

```cpp
void MyActionSet::touchCellFirstTime(
    const peano4::datamanagement::CellMarker& marker,
    CCZ4Q& fineGridCellCCZ4Q,
    CCZ4Q& coarseGridCellCCZ4Q,
    ...
) {
    // Raw pointer to the flat double array
    const double* data = fineGridCellCCZ4Q.data();

    // Total elements = patch_size^D × (unknowns + aux)
    // Layout: volume [0,0,0] unknowns, then volume [1,0,0] unknowns, etc.
    // (innermost index = x, as in the Peano dfor macro)
    int stride = N_UNKNOWNS + N_AUX;
    for (int v = 0; v < PATCH_SIZE * PATCH_SIZE * PATCH_SIZE; v++) {
        double q0 = data[v * stride + 0];  // first unknown of volume v
    }
}
```

The `fineGridCellCCZ4Q.data()` method returns a `double*` (or `float*` for lower precision) to the contiguous storage.

---

## 6. Data Repository and Stacks

**Source:** `/mnt/Megafast/Peano/src/peano4/datamanagement/`

Peano uses a stack-based data management system. During traversal, data is pushed onto and popped from stacks. The Observer template (`Observer.template.cpp`) manages this automatically — action sets never interact with stacks directly.

The relevant part for action set developers: the `fineGrid*` arguments are valid references to data on the stack. Do not store pointers to them beyond the scope of the callback. Data is moved (not copied) between stacks during the traversal.

---

## 7. Parallel Model

### Shared memory

`SpacetreeSet` manages all local spacetrees. Each spacetree runs in its own thread (a `TraverseTask`). The task executes `Observer::beginTraversal → [callbacks] → Observer::endTraversal` for its tree. The static `prepareTraversal`/`unprepareTraversal` hooks are serialisation points.

**Key invariant:** `beginTraversal`/`endTraversal` and all `touch*` callbacks for a given spacetree run in the same thread. You can use per-instance (non-static) data structures without synchronisation.

**Static data:** shared across all trees. Protect with `std::mutex` or `std::atomic`. Use `std::call_once` with a `std::once_flag` for one-time initialisation.

### MPI

Each MPI rank runs its own `SpacetreeSet`. Data exchange between ranks happens in horizontal data exchange stacks between traversals. The rank of the current process is:

```cpp
int myRank = tarch::mpi::Rank::getInstance().getRank();
int numRanks = tarch::mpi::Rank::getInstance().getNumberOfRanks();
```

Spacetree IDs are globally unique. The relationship between global tree ID and rank is:

```cpp
// From Node.h:
int rank   = treeId % numberOfRanks;
int local  = treeId / numberOfRanks;
int global = localId * numberOfRanks + rank;
```

---

## 8. Code Generation

Peano uses a two-step process:

1. User runs a Python script (e.g. `ccz4.py`) that builds up a `Project` object and calls `project.generate_Peano4_project()`.
2. The project writes C++ source files into a configured output directory. The user then compiles with CMake.

Generated files of interest:

| File | Generated by |
|------|-------------|
| `observer/MyStepObserver.h/.cpp` | `StepToObserver` from `Observer.template.h/cpp` |
| `observer/MyActionSet.h/.cpp` | `StepToActionSet` |
| `repositories/DataRepository.h/.cpp` | `ModelToDataRepository` |

The templates are Jinja2. Template variables are substituted by the generator using a dictionary from `solver._init_dictionary_with_default_parameters(d)` and `solver.add_entries_to_text_replacement_dictionary(d)`. Key variables:

| Variable | Value |
|----------|-------|
| `CLASSNAME` | Observer class name |
| `FULL_QUALIFIED_CLASSNAME` | Including namespace |
| `ACTIVE_ACTION_SETS` | List of action set objects |
| `CELLS` / `FACES` / `VERTICES` | Data model objects |
| `DIMENSIONS` | 2 or 3 (from CMake) |
| `TWO_POWER_D` | `2^D` |
| `TWO_TIMES_D` | `2×D` |

---

## 9. Key File Paths

| File | Purpose |
|------|---------|
| `/mnt/Megafast/Peano/python/peano4/solversteps/ActionSet.py` | ActionSet base class + operation constants |
| `/mnt/Megafast/Peano/python/peano4/solversteps/Step.py` | Step (holds list of action sets, sorts by priority) |
| `/mnt/Megafast/Peano/python/peano4/solversteps/Observer.py` | Observer code generator |
| `/mnt/Megafast/Peano/python/peano4/solversteps/Observer.template.cpp` | Observer implementation template (Jinja2) |
| `/mnt/Megafast/Peano/python/exahype2/Project.py` | ExaHype2 project + `add_action_set_to_*` |
| `/mnt/Megafast/Peano/python/exahype2/solvers/fv/FV.py` | FV base solver: data models, action set creation |
| `/mnt/Megafast/Peano/python/exahype2/solvers/fv/actionsets/` | Standard FV action sets |
| `/mnt/Megafast/Peano/python/peano4/plotter/BasePlotter.py` | Canonical example: static hooks, Jinja2 rendering |
| `/mnt/Megafast/Peano/src/peano4/datamanagement/CellMarker.h` | CellMarker: all accessor methods |
| `/mnt/Megafast/Peano/src/peano4/datamanagement/FaceMarker.h` | FaceMarker |
| `/mnt/Megafast/Peano/src/peano4/datamanagement/VertexMarker.h` | VertexMarker |
| `/mnt/Megafast/Peano/src/peano4/grid/GridTraversalEvent.h` | Raw event structure (rarely needed directly) |
| `/mnt/Megafast/Peano/src/peano4/parallel/Node.h` | Tree ID ↔ rank mapping |
| `/mnt/Megafast/Peano/src/tarch/mpi/Rank.h` | `getRank()`, `getNumberOfRanks()` |
| `/mnt/Megafast/Peano/src/tarch/plotter/VTUFileWriter.cpp` | Reference for `#ifdef USE_ZLIB` pattern |
| `/mnt/Megafast/Peano/applications/ccz4/ccz4.py` | Full application example |
