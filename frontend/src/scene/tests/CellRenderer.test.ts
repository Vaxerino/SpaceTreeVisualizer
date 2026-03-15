import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CellRecord, FilterSpec } from '../../types';
import { CELL_FLAG_IS_LOCAL } from '../../types';
import { CellRenderer } from '../CellRenderer';

function makeCell(overrides: Partial<CellRecord> = {}): CellRecord {
  return {
    cx: 0,
    cy: 0,
    cz: 0,
    hx: 0.5,
    hy: 0.5,
    hz: 0.5,
    level: 0,
    flags: 0,
    relPosX: 0,
    relPosY: 0,
    relPosZ: 0,
    rank: 0,
    treeId: 0,
    simData: [],
    ...overrides,
  };
}

function makeFilter(overrides: Partial<FilterSpec> = {}): FilterSpec {
  return {
    level: 2,
    levelCumulative: false,
    showLocal: true,
    showRemote: true,
    ...overrides,
  };
}

/** Call updateFromSnapshot with defaults for parameters not under test. */
function renderCells(
  renderer: CellRenderer,
  cells: CellRecord[],
  filter: FilterSpec,
): void {
  renderer.updateFromSnapshot(cells, filter, 'level', 'turbo', 0, 12, null);
}

describe('CellRenderer.passesFilter', () => {
  it('applies exact level matching when cumulative is disabled', () => {
    const renderer = new CellRenderer(new THREE.Scene());

    const cells = [
      makeCell({ level: 1, rank: 1 }),
      makeCell({ level: 2, rank: 2 }),
      makeCell({ level: 3, rank: 3 }),
    ];

    renderCells(renderer, cells, makeFilter({ level: 2, levelCumulative: false }));

    const visibleCells = renderer.getCells();

    // Only level 2 cells should be visible when cumulative is disabled.
    expect(visibleCells.length).toBe(1);
    expect(visibleCells[0]!.level).toBe(2);

    renderer.dispose();
  });

  it('applies <= level matching when cumulative is enabled', () => {
    const renderer = new CellRenderer(new THREE.Scene());

    const cells = [
      makeCell({ level: 1, rank: 1 }),
      makeCell({ level: 2, rank: 2 }),
      makeCell({ level: 3, rank: 3 }),
    ];

    renderCells(renderer, cells, makeFilter({ level: 2, levelCumulative: true }));

    const visibleCells = renderer.getCells();

    // Levels <= 2 should be visible when cumulative is enabled.
    expect(visibleCells.length).toBe(2);
    expect(visibleCells.every((cell) => cell.level <= 2)).toBe(true);

    renderer.dispose();
  });

  it('respects showLocal/showRemote visibility toggles', () => {
    const renderer = new CellRenderer(new THREE.Scene());

    const localCell = makeCell({ flags: CELL_FLAG_IS_LOCAL, rank: 1 });
    const remoteCell = makeCell({ flags: 0, rank: 2 });
    const cells = [localCell, remoteCell];

    // Only remote cells visible when showLocal is false and showRemote is true.
    renderCells(renderer, cells, makeFilter({ level: 0, showLocal: false, showRemote: true }));
    let visibleCells = renderer.getCells();
    expect(visibleCells.length).toBe(1);
    expect(visibleCells[0]!.flags & CELL_FLAG_IS_LOCAL).toBe(0);

    // Only local cells visible when showLocal is true and showRemote is false.
    renderCells(renderer, cells, makeFilter({ level: 0, showLocal: true, showRemote: false }));
    visibleCells = renderer.getCells();
    expect(visibleCells.length).toBe(1);
    expect(visibleCells[0]!.flags & CELL_FLAG_IS_LOCAL).toBe(CELL_FLAG_IS_LOCAL);

    renderer.dispose();
  });

  it('expands into PATCH_SIZE^3 subcell instances per AMR cell in sim mode', () => {
    const renderer = new CellRenderer(new THREE.Scene());
    const PATCH_SIZE = 3;
    const N_UNKNOWNS = 5;
    const N_AUX = 0;
    const N_TOTAL = N_UNKNOWNS + N_AUX;
    const nSubs = PATCH_SIZE ** 3; // 27 subcells per 3D cell

    // Build a diagonal-gradient patch
    const simData: number[] = [];
    const denom = 3 * (PATCH_SIZE - 1);
    for (let iz = 0; iz < PATCH_SIZE; iz++) {
      for (let iy = 0; iy < PATCH_SIZE; iy++) {
        for (let ix = 0; ix < PATCH_SIZE; ix++) {
          const diag = (ix + iy + iz) / denom;
          for (let u = 0; u < N_TOTAL; u++) simData.push(diag + u * 0.01);
        }
      }
    }

    const cells = [
      makeCell({ hz: 0.5, level: 1, flags: CELL_FLAG_IS_LOCAL, simData }),
    ];

    renderer.updateFromSnapshot(
      cells,
      makeFilter({ level: 1 }),
      'sim',
      'turbo',
      0, // fieldIndex = rho
      1,
      { patchSize: PATCH_SIZE, nUnknowns: N_UNKNOWNS, nAux: N_AUX, unknownNames: null },
    );

    // 1 AMR cell × 27 subcells = 27 instances
    expect(renderer.mesh.count).toBe(nSubs);
    // getCellAt maps every subcell back to the parent AMR cell
    for (let i = 0; i < nSubs; i++) {
      expect(renderer.getCellAt(i)).toBe(cells[0]);
    }

    renderer.dispose();
  });
});
