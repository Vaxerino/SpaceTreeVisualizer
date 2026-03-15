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

describe('CellRenderer.passesFilter', () => {
  it('applies exact level matching when cumulative is disabled', () => {
    const renderer = new CellRenderer(new THREE.Scene());

    const cells = [
      makeCell({ level: 1, rank: 1 }),
      makeCell({ level: 2, rank: 2 }),
      makeCell({ level: 3, rank: 3 }),
    ];

    renderer.updateFromSnapshot({
      cells,
      filter: makeFilter({ level: 2, levelCumulative: false }),
    });

    const visibleCells = renderer.getCells();

    // Only level 2 cells should be visible when cumulative is disabled.
    expect(visibleCells.length).toBe(1);
    expect(visibleCells[0].level).toBe(2);

    renderer.dispose();
  });

  it('applies <= level matching when cumulative is enabled', () => {
    const renderer = new CellRenderer(new THREE.Scene());

    const cells = [
      makeCell({ level: 1, rank: 1 }),
      makeCell({ level: 2, rank: 2 }),
      makeCell({ level: 3, rank: 3 }),
    ];

    renderer.updateFromSnapshot({
      cells,
      filter: makeFilter({ level: 2, levelCumulative: true }),
    });

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
    renderer.updateFromSnapshot({
      cells,
      filter: makeFilter({ level: 0, showLocal: false, showRemote: true }),
    });
    let visibleCells = renderer.getCells();
    expect(visibleCells.length).toBe(1);
    expect(visibleCells[0].flags & CELL_FLAG_IS_LOCAL).toBe(0);

    // Only local cells visible when showLocal is true and showRemote is false.
    renderer.updateFromSnapshot({
      cells,
      filter: makeFilter({ level: 0, showLocal: true, showRemote: false }),
    });
    visibleCells = renderer.getCells();
    expect(visibleCells.length).toBe(1);
    expect(visibleCells[0].flags & CELL_FLAG_IS_LOCAL).toBe(CELL_FLAG_IS_LOCAL);

    renderer.dispose();
  });
});
