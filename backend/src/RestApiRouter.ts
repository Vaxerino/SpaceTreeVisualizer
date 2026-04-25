import { Router, Request, Response } from 'express';
import type { SpaceTreeStore } from './SpaceTreeStore';
import { serializeRestSnapshot } from './snapshotSerializer';

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
    res.json(serializeRestSnapshot(snapshot));
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
    res.json(serializeRestSnapshot(snapshot));
  });

  return router;
}
