import { Router, Request, Response } from 'express';
import type { SpaceTreeStore } from './SpaceTreeStore';
import type { CellRecord, StepSnapshot } from './types';

/**
 * Express router providing REST endpoints for the browser frontend.
 *
 * GET /api/status           — backend health + live step
 * GET /api/snapshots        — list of {stepIndex, timestamp, cellCount}
 * GET /api/snapshots/:step  — full snapshot for a given step
 */
export function createRestRouter(store: SpaceTreeStore): Router {
  const router = Router();

  router.get('/meta', (_req: Request, res: Response) => {
    const meta = store.getSimMeta();
    if (!meta) {
      res.status(404).json({ error: 'no simulation connected yet' });
      return;
    }
    res.json(meta);
  });

  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      connected: true,
      liveStep: store.getLiveStep(),
      totalSteps: store.getSummaries().length,
      paused: store.isPaused(),
      trees: store.getRegisteredTrees(),
    });
  });

  router.get('/snapshots', (_req: Request, res: Response) => {
    res.json(store.getSummaries());
  });

  router.get('/snapshots/latest', (_req: Request, res: Response) => {
    const snapshot = store.getLatestSnapshot();
    if (!snapshot) {
      res.status(404).json({ error: 'no snapshots yet' });
      return;
    }
    res.json(serializeSnapshot(snapshot));
  });

  router.get('/snapshots/:step', (req: Request, res: Response) => {
    const stepIndex = parseInt(req.params['step'] ?? '', 10);
    if (isNaN(stepIndex)) {
      res.status(400).json({ error: 'invalid step index' });
      return;
    }
    const snapshot = store.getSnapshot(stepIndex);
    if (!snapshot) {
      res.status(404).json({ error: `snapshot ${stepIndex} not found` });
      return;
    }
    res.json(serializeSnapshot(snapshot));
  });

  return router;
}

function serializeSnapshot(snapshot: StepSnapshot): Record<string, unknown> {
  return {
    stepIndex: snapshot.stepIndex,
    timestamp: snapshot.timestamp,
    cellCount: snapshot.cellCount,
    treeIds: snapshot.treeIds,
    simFieldIndex: snapshot.simFieldIndex,
    cells: snapshot.cells.map(serializeCell),
    faces: snapshot.faces,
    vertices: snapshot.vertices,
  };
}

function serializeCell(cell: CellRecord): Record<string, unknown> {
  return {
    cx: cell.cx,
    cy: cell.cy,
    cz: cell.cz,
    hx: cell.hx,
    hy: cell.hy,
    hz: cell.hz,
    level: cell.level,
    flags: cell.flags,
    relPosX: cell.relPosX,
    relPosY: cell.relPosY,
    relPosZ: cell.relPosZ,
    rank: cell.rank,
    treeId: cell.treeId,
    simData: cell.simData ? Array.from(cell.simData) : undefined,
    simDataLength: cell.simDataLength,
  };
}
