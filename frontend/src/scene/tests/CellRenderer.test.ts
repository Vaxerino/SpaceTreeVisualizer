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
    const passesFilter = (renderer as any).passesFilter.bind(renderer) as (c: CellRecord, f: FilterSpec) => boolean;

    expect(passesFilter(makeCell({ level: 2 }), makeFilter({ level: 2, levelCumulative: false }))).toBe(true);
    expect(passesFilter(makeCell({ level: 1 }), makeFilter({ level: 2, levelCumulative: false }))).toBe(false);

    renderer.dispose();
  });

  it('applies <= level matching when cumulative is enabled', () => {
    const renderer = new CellRenderer(new THREE.Scene());
    const passesFilter = (renderer as any).passesFilter.bind(renderer) as (c: CellRecord, f: FilterSpec) => boolean;

    expect(passesFilter(makeCell({ level: 1 }), makeFilter({ level: 2, levelCumulative: true }))).toBe(true);
    expect(passesFilter(makeCell({ level: 2 }), makeFilter({ level: 2, levelCumulative: true }))).toBe(true);
    expect(passesFilter(makeCell({ level: 3 }), makeFilter({ level: 2, levelCumulative: true }))).toBe(false);

    renderer.dispose();
  });

  it('respects showLocal/showRemote visibility toggles', () => {
    const renderer = new CellRenderer(new THREE.Scene());
    const passesFilter = (renderer as any).passesFilter.bind(renderer) as (c: CellRecord, f: FilterSpec) => boolean;

    const localCell = makeCell({ flags: CELL_FLAG_IS_LOCAL });
    const remoteCell = makeCell({ flags: 0 });

    expect(passesFilter(localCell, makeFilter({ level: 0, showLocal: false, showRemote: true }))).toBe(false);
    expect(passesFilter(localCell, makeFilter({ level: 0, showLocal: true, showRemote: false }))).toBe(true);

    expect(passesFilter(remoteCell, makeFilter({ level: 0, showLocal: true, showRemote: false }))).toBe(false);
    expect(passesFilter(remoteCell, makeFilter({ level: 0, showLocal: false, showRemote: true }))).toBe(true);

    renderer.dispose();
  });
});
