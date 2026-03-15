import * as THREE from 'three';
import type { CellRecord, FilterSpec, ColorMode, ColormapName } from '../types';
import { CELL_FLAG_IS_LOCAL } from '../types';
import { ColorMapper } from './ColorMapper';

// Pre-allocated instance count. 500K × ~76 bytes ≈ 38 MB GPU — fits comfortably
// on any modern GPU. Do NOT raise to 2M+: large allocations silently fail in
// some WebGL implementations (SwiftShader, some mobile drivers).
const MAX_INSTANCES = 500_000;
const CELL_GAP = 0.95; // scale factor to leave a small visible gap

/**
 * Renders AMR cells as instanced axis-aligned boxes.
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
  ): void {
    const [simMin, simMax] = colorMode === 'sim'
      ? ColorMapper.simRange(cells, simFieldIndex)
      : [0, 1];
    this.lastSimRange = [simMin, simMax];

    let count = 0;
    const filtered: CellRecord[] = [];

    for (const c of cells) {
      if (!this.passesFilter(c, filter)) continue;
      if (count >= MAX_INSTANCES) break;

      this.dummy.position.set(c.cx, c.cy, c.cz);
      // For 2D cells (hz ≈ 0), use a very thin z extent so they're still pickable
      const scaleZ = c.hz > 0.0001 ? c.hz * CELL_GAP : 0.001;
      this.dummy.scale.set(c.hx * CELL_GAP, c.hy * CELL_GAP, scaleZ);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);

      const color = this.mapper.forCell(c, colorMode, colormap, simMin, simMax, simFieldIndex, maxLevel);
      this.mesh.setColorAt(count, color);

      filtered.push(c);
      count++;
    }

    this.currentCells = filtered;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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
