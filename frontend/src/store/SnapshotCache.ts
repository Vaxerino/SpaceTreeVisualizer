import type { StepSnapshot } from '../types';

export const BACKEND = 'http://localhost:7422';
const MAX_CACHED = 50;

/** LRU cache of downloaded snapshots. Fetches from REST API on miss. */
class SnapshotCacheStore {
  private cache: Map<number, StepSnapshot> = new Map();
  private order: number[] = [];

  async get(stepIndex: number): Promise<StepSnapshot | null> {
    if (this.cache.has(stepIndex)) {
      // Move to front of LRU order
      this.order = [stepIndex, ...this.order.filter(k => k !== stepIndex)];
      return this.cache.get(stepIndex)!;
    }

    try {
      const url = stepIndex >= 0
        ? `${BACKEND}/api/snapshots/${stepIndex}`
        : `${BACKEND}/api/snapshots/latest`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const snap: StepSnapshot = await resp.json();
      this.put(snap.stepIndex, snap);
      return snap;
    } catch {
      return null;
    }
  }

  put(stepIndex: number, snap: StepSnapshot): void {
    this.cache.set(stepIndex, snap);
    this.order = [stepIndex, ...this.order.filter(k => k !== stepIndex)];
    if (this.order.length > MAX_CACHED) {
      const oldest = this.order.pop()!;
      this.cache.delete(oldest);
    }
  }
}

export const SnapshotCache = new SnapshotCacheStore();
