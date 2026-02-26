import { Router } from 'express';
import { getFirestore, getUserConfig, getAllMappingsForUser, getErrorQueue, getSyncStatus, getSyncLogs, getSyncLogStats } from '../db/firestore';
import { getRecentLogs } from '../utils/logger';

const router = Router();

/** Race a promise against a timeout – returns the promise result or rejects. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const QUERY_TIMEOUT = 10_000; // 10 seconds

/** GET /dashboard/api/status – overall service status */
router.get('/status', async (_req, res) => {
  try {
    const uptime = process.uptime();
    res.json({
      service: 'cal-sync',
      status: 'ok',
      uptime: Math.floor(uptime),
      timestamp: new Date().toISOString(),
      env: {
        syncUserId: process.env.SYNC_USER_ID ?? '(not set)',
        firestoreProject: process.env.FIRESTORE_PROJECT_ID ?? '(not set)',
        port: process.env.PORT ?? '8080',
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/users – list all user configs (tokens masked) */
router.get('/users', async (_req, res) => {
  try {
    const snapshot = await withTimeout(
      getFirestore().collection('user_configs').get(),
      QUERY_TIMEOUT, 'users',
    );
    const users = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        userId: d.userId,
        googleCalendarId: d.googleCalendarId ?? '',
        lineworksCalendarId: d.lineworksCalendarId ?? '',
        hasGoogleToken: !!d.googleRefreshToken,
        hasLineworksToken: !!d.lineworksRefreshToken,
      };
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/mappings/:userId – event mappings for a user */
router.get('/mappings/:userId', async (req, res) => {
  try {
    const mappings = await withTimeout(
      getAllMappingsForUser(req.params.userId),
      QUERY_TIMEOUT, 'mappings',
    );
    res.json({
      count: mappings.length,
      mappings: mappings
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 100),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/errors/:userId – error queue entries */
router.get('/errors/:userId', async (req, res) => {
  try {
    const errors = await withTimeout(
      getErrorQueue(req.params.userId),
      QUERY_TIMEOUT, 'errors',
    );
    res.json({ count: errors.length, errors });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/watch/:userId – watch channel info */
router.get('/watch/:userId', async (req, res) => {
  try {
    const doc = await withTimeout(
      getFirestore().collection('watch_channels').doc(req.params.userId).get(),
      QUERY_TIMEOUT, 'watch',
    );

    if (!doc.exists) {
      res.json({ active: false });
      return;
    }

    const data = doc.data()!;
    const expiration = new Date(data.expiration);
    const now = new Date();
    const hoursLeft = Math.max(0, (expiration.getTime() - now.getTime()) / (1000 * 60 * 60));

    res.json({
      active: hoursLeft > 0,
      channelId: data.channelId,
      expiration: data.expiration,
      hoursLeft: Math.round(hoursLeft * 10) / 10,
      webhookUrl: data.webhookUrl,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/sync-status/:userId – initial sync progress */
router.get('/sync-status/:userId', async (req, res) => {
  try {
    const status = await withTimeout(
      getSyncStatus(req.params.userId),
      QUERY_TIMEOUT, 'sync-status',
    );
    if (!status) {
      res.json({ active: false });
      return;
    }
    const elapsedSec = Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000);
    res.json({ ...status, elapsedSec });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/logs – recent in-memory log entries */
router.get('/logs', async (_req, res) => {
  try {
    const limit = Math.min(parseInt(String(_req.query.limit ?? '100'), 10), 200);
    const logs = getRecentLogs(limit);
    res.json({ count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/persistent-logs – logs from Firestore (persistent) */
router.get('/persistent-logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const status = req.query.status as string | undefined;
    const source = req.query.source as string | undefined;
    const before = req.query.before as string | undefined;

    const result = await withTimeout(
      getSyncLogs({
        limit,
        status: status as 'success' | 'failure' | 'skipped' | undefined,
        source: source as 'google' | 'lineworks' | undefined,
        before,
      }),
      QUERY_TIMEOUT, 'persistent-logs',
    );

    res.json({
      count: result.logs.length,
      logs: result.logs,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** GET /dashboard/api/log-stats – aggregate log statistics from Firestore */
router.get('/log-stats', async (_req, res) => {
  try {
    const stats = await withTimeout(getSyncLogStats(), QUERY_TIMEOUT, 'log-stats');
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
