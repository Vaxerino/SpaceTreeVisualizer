import type { CellRecord, ColorMode, FilterSpec, SnapshotSummary } from '../types';

type Listener = () => void;

/**
 * Simple reactive state store. Components subscribe with onChange() and
 * re-render when state changes via setState().
 */
class AppStateStore {
  currentStep: number = -1;
  isLive: boolean = true;
  isPaused: boolean = false;
  totalSteps: number = 0;
  summaries: SnapshotSummary[] = [];
  registeredTrees: string[] = [];

  colorMode: ColorMode = 'level';
  filter: FilterSpec = { minLevel: 0, maxLevel: 12, showLocal: true, showRemote: true };
  simFieldIndex: number = 0;

  selectedCell: CellRecord | null = null;
  selectedInstanceIndex: number = -1;

  private listeners: Listener[] = [];

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  setState(patch: Partial<AppStateStore>): void {
    Object.assign(this, patch);
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const AppState = new AppStateStore();
