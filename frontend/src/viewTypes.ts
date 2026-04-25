import type {
  SimMeta,
  SnapshotCellDto,
  SnapshotDto,
  SnapshotSummary,
} from '@spacetreevisualizer/contracts';

export type CellRecord = Omit<SnapshotCellDto, 'simData'> & {
  simData?: Float32Array | number[];
};

export type StepSnapshot = Omit<SnapshotDto, 'cells'> & {
  cells: CellRecord[];
};

export type ColorMode = 'level' | 'local' | 'enclave' | 'refinement' | 'sim' | 'treeId';

export type ColormapName =
  | 'turbo'
  | 'viridis'
  | 'plasma'
  | 'magma'
  | 'inferno'
  | 'rdbu'
  | 'grayscale';

export interface FilterSpec {
  level: number;
  levelCumulative: boolean;
  showLocal: boolean;
  showRemote: boolean;
}

export type { SimMeta, SnapshotSummary };
