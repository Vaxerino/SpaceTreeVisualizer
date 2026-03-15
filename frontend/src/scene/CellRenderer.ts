import * as THREE from 'three';
import type { CellRecord, FilterSpec, ColorMode, ColormapName, SimMeta } from '../types';
import { CELL_FLAG_IS_LOCAL } from '../types';
import { ColorMapper } from './ColorMapper';
import { sample } from './ColormapRegistry';

// Pre-allocated instance count. 500K × ~76 bytes ≈ 38 MB GPU — fits comfortably
// on any modern GPU. Do NOT raise to 2M+: large allocations silently fail in
// some WebGL implementations (SwiftShader, some mobile drivers).
const MAX_INSTANCES = 500_000;
const CELL_GAP = 0.95; // scale factor to leave a small visible gap between AMR cells

/**
 * Renders AMR cells as instanced axis-aligned boxes.
 *
 * In non-sim modes: one instance per AMR cell.
 * In sim mode with patchSize>1: PATCH_SIZE^DIMS instances per AMR cell (subcells),
 * tiled flush inside the CELL_GAP extent. Gap between AMR cells is preserved.
 *
 * Uses THREE.InstancedMesh for performance. Per-instance position/scale is set
 * via setMatrixAt; per-instance color via setColorAt.
 */
export class CellRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly mapper = new ColorMapper();
  private currentCells: CellRecord[] = [];

  /** Set after every updateFromSnapshot call in 'sim' mode; [0,1] otherwise. */
  lastSimRange: [number, number] = [0, 1];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // Three.js r183 color_vertex.glsl multiplies vColor.rgb by the geometry's
    // 'color' attribute when USE_COLOR (vertexColors:true) is active, THEN by
    // instanceColor.  BoxGeometry has no 'color' attribute, so WebGL supplies
    // (0,0,0), which zeros out every instance color.  Providing a white 'color'
    // attribute makes that multiplication a no-op and lets instanceColor through.
    const vertCount = geo.attributes['position'].count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3).fill(1), 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Disable frustum culling: the base geometry's bounding sphere is a unit cube
    // at the origin, which may lie outside the camera frustum for a 2D top-down
    // camera. All instances are within [0,1]³ so culling has no benefit here.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Replace the currently rendered cells with a new snapshot. */
  updateFromSnapshot(
    cells: CellRecord[],
    filter: FilterSpec,
    colorMode: ColorMode,
    colormap: ColormapName,
    simFieldIndex: number,
    maxLevel: number,
    simMeta: SimMeta | null,
  ): void {
    const useSubcells = colorMode === 'sim' && simMeta !== null && simMeta.patchSize > 1;

    const [simMin, simMax] = colorMode === 'sim'
      ? ColorMapper.simRange(cells, simFieldIndex, simMeta)
      : [0, 1];
    this.lastSimRange = [simMin, simMax];

    let count = 0;
    this.currentCells = [];

    if (useSubcells) {
      count = this._updateSubcells(cells, filter, colormap, simFieldIndex, simMin, simMax, simMeta!);
    } else {
      count = this._updateCells(cells, filter, colorMode, colormap, simFieldIndex, simMin, simMax, maxLevel);
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Render one instance per AMR cell (non-sim modes, or sim with patchSize=1). */
  private _updateCells(
    cells: CellRecord[],
    filter: FilterSpec,
    colorMode: ColorMode,
    colormap: ColormapName,
    simFieldIndex: number,
    simMin: number,
    simMax: number,
    maxLevel: number,
  ): number {
    let count = 0;
    for (const c of cells) {
      if (!this.passesFilter(c, filter)) continue;
      if (count >= MAX_INSTANCES) break;

      this.dummy.position.set(c.cx, c.cy, c.cz);
      const scaleZ = c.hz > 0.0001 ? c.hz * CELL_GAP : 0.001;
      this.dummy.scale.set(c.hx * CELL_GAP, c.hy * CELL_GAP, scaleZ);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);

      const color = this.mapper.forCell(c, colorMode, colormap, simMin, simMax, simFieldIndex, maxLevel);
      this.mesh.setColorAt(count, color);

      this.currentCells[count] = c;
      count++;
    }
    return count;
  }

  /**
   * Render PATCH_SIZE^DIMS subcell instances per AMR cell.
   *
   * Each subcell is positioned within the gapped extent of the AMR cell
   * (h * CELL_GAP), tiled flush edge-to-edge within that area.
   * Colors come from the correct subcell index in the interleaved simData array.
   *
   * For 3D cells (hz > 0), all PS^3 subcells are emitted as small 3D boxes
   * (naive — culling of z-occluded subcells is a future optimisation).
   * For 2D cells (hz ≈ 0), only PS^2 subcells in the xy-plane are emitted.
   */
  private _updateSubcells(
    cells: CellRecord[],
    filter: FilterSpec,
    colormap: ColormapName,
    simFieldIndex: number,
    simMin: number,
    simMax: number,
    simMeta: SimMeta,
  ): number {
    const PS = simMeta.patchSize;
    const N = simMeta.nUnknowns + simMeta.nAux;
    const color = new THREE.Color();
    let count = 0;

    for (const c of cells) {
      if (!this.passesFilter(c, filter)) continue;
      if (!c.simData) continue;

      const is2D = c.hz < 0.0001;
      const nz = is2D ? 1 : PS;

      const gapHx = c.hx * CELL_GAP;
      const gapHy = c.hy * CELL_GAP;
      const gapHz = is2D ? 0.001 : c.hz * CELL_GAP;

      const subSx = gapHx / PS;
      const subSy = gapHy / PS;
      const subSz = is2D ? gapHz : gapHz / PS;

      // Bottom-left corner of the gapped patch in world space
      const ox = c.cx - gapHx * 0.5;
      const oy = c.cy - gapHy * 0.5;
      const oz = is2D ? c.cz : c.cz - gapHz * 0.5;

      for (let iz = 0; iz < nz; iz++) {
        for (let iy = 0; iy < PS; iy++) {
          for (let ix = 0; ix < PS; ix++) {
            if (count >= MAX_INSTANCES) break;

            this.dummy.position.set(
              ox + (ix + 0.5) * subSx,
              oy + (iy + 0.5) * subSy,
              is2D ? oz : oz + (iz + 0.5) * subSz,
            );
            this.dummy.scale.set(subSx, subSy, subSz);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(count, this.dummy.matrix);

            const linearIdx = ix + PS * (iy + PS * iz);
            const val = c.simData[linearIdx * N + simFieldIndex] ?? 0;
            const t = simMax !== simMin ? (val - simMin) / (simMax - simMin) : 0.5;
            this.mesh.setColorAt(count, color.set(sample(colormap, t)));

            this.currentCells[count] = c;
            count++;
          }
        }
      }
    }
    return count;
  }

  /** Get the CellRecord for a given instance index (set by last updateFromSnapshot). */
  getCellAt(instanceId: number): CellRecord | null {
    return this.currentCells[instanceId] ?? null;
  }

  getCells(): CellRecord[] {
    return this.currentCells;
  }

  private passesFilter(c: CellRecord, f: FilterSpec): boolean {
    const levelOk = f.levelCumulative ? c.level <= f.level : c.level === f.level;
    if (!levelOk) return false;
    const isLocal = (c.flags & CELL_FLAG_IS_LOCAL) !== 0;
    if (isLocal && !f.showLocal) return false;
    if (!isLocal && !f.showRemote) return false;
    return true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
