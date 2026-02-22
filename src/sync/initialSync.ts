import * as googleCal from '../google/calendar';
import * as lwCal from '../lineworks/calendar';
import { syncGoogleToLineworks, syncLineworksToGoogle } from './engine';
import {
  getUserConfig,
  getMappingsByGoogleIds,
  getMappingsByLineworksIds,
  setSyncStatus,
} from '../db/firestore';
import { logger } from '../utils/logger';
import { SyncStatus } from '../types';

const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE ?? '5', 10);
const MAX_INITIAL_SYNC_EVENTS = 200;

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function elapsedSec(startMs: number): number {
  return Math.round((Date.now() - startMs) / 1000);
}

function estimateEtaSec(startMs: number, done: number, total: number): number | null {
  if (done === 0) return null;
  const elapsed = (Date.now() - startMs) / 1000;
  return Math.round((elapsed / done) * (total - done));
}

/**
 * Perform a full initial sync for a user.
 * Fetches ALL events from the past `daysBack` days on both platforms
 * and syncs them bidirectionally. Supports resume — already-synced events
 * are automatically skipped.
 */
export async function runInitialSync(
  userId: string,
  daysBack: number = 30
): Promise<{ googleToLw: number; lwToGoogle: number }> {
  const config = await getUserConfig(userId);
  if (!config) {
    throw new Error(`No config found for user ${userId}`);
  }

  const syncStartMs = Date.now();
  const timeMin = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date().toISOString();

  const status: SyncStatus = {
    userId,
    status: 'running',
    phase: 1,
    googleToLw: 0,
    lwToGoogle: 0,
    phaseTotal: 0,
    phaseFailed: 0,
    startedAt: new Date(syncStartMs).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  logger.info('initial_sync_start', {
    details: { userId, daysBack, timeMin, timeMax, batchSize: BATCH_SIZE, maxEvents: MAX_INITIAL_SYNC_EVENTS },
  });

  try {
    // Phase 1: Google → LINE WORKS
    let googleToLw = 0;
    let phase1Failed = 0;
    const phase1StartMs = Date.now();

    logger.info('initial_sync_phase1_fetch', { details: { userId, timeMin, timeMax } });
    const allGoogleEvents = await googleCal.listEventsByTimeRange(
      config.googleCalendarId,
      timeMin,
      config.googleRefreshToken,
      timeMax
    );
    const activeGoogleEvents = allGoogleEvents.filter((e) => !e.isCancelled && e.id).slice(0, MAX_INITIAL_SYNC_EVENTS);
    logger.info('initial_sync_phase1_fetched', {
      details: { userId, total: allGoogleEvents.length, active: activeGoogleEvents.length },
    });

    // Batch-fetch existing mappings to skip already-synced events
    const googleEventIds = activeGoogleEvents.map((e) => e.id);
    const existingGoogleMappings = await getMappingsByGoogleIds(googleEventIds, userId);
    const eventsToSyncToLw = activeGoogleEvents.filter((e) => !existingGoogleMappings.has(e.id));

    logger.info('initial_sync_phase1_filtered', {
      details: {
        userId,
        total: activeGoogleEvents.length,
        alreadySynced: existingGoogleMappings.size,
        toSync: eventsToSyncToLw.length,
      },
    });

    status.phase = 1;
    status.phaseTotal = eventsToSyncToLw.length;
    status.phaseFailed = 0;
    status.updatedAt = new Date().toISOString();
    await setSyncStatus(status);

    const phase1Chunks = chunks(eventsToSyncToLw, BATCH_SIZE);
    for (const chunk of phase1Chunks) {
      const results = await Promise.allSettled(
        chunk.map((event) =>
          syncGoogleToLineworks(
            event,
            userId,
            config.googleCalendarId,
            config.lineworksCalendarId,
            config.lineworksUserId!,
            config.googleRefreshToken,
            config.lineworksRefreshToken
          )
        )
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      googleToLw += succeeded;
      phase1Failed += failed;
      const remaining = eventsToSyncToLw.length - googleToLw - phase1Failed;
      const pct = Math.round((googleToLw / eventsToSyncToLw.length) * 100);
      const eta = estimateEtaSec(phase1StartMs, googleToLw + phase1Failed, eventsToSyncToLw.length);

      logger.info('initial_sync_phase1_progress', {
        details: {
          userId,
          googleToLw,
          failed: phase1Failed,
          remaining,
          total: eventsToSyncToLw.length,
          pct,
          elapsedSec: elapsedSec(phase1StartMs),
          etaSec: eta,
        },
      });

      // Update Firestore status
      status.googleToLw = googleToLw;
      status.phaseFailed = phase1Failed;
      status.updatedAt = new Date().toISOString();
      await setSyncStatus(status);
    }

    // Phase 2: LINE WORKS → Google (only events not already synced in Phase 1)
    let lwToGoogle = 0;
    let phase2Failed = 0;
    const phase2StartMs = Date.now();

    logger.info('initial_sync_phase2_fetch', { details: { userId, timeMin } });
    const allLwEvents = await lwCal.listRecentEvents(
      config.lineworksCalendarId,
      config.lineworksUserId!,
      timeMin,
      config.lineworksRefreshToken
    );
    const activeLwEvents = allLwEvents.filter((e) => !e.isCancelled && e.id).slice(0, MAX_INITIAL_SYNC_EVENTS);
    logger.info('initial_sync_phase2_fetched', {
      details: { userId, total: allLwEvents.length, active: activeLwEvents.length },
    });

    // Batch-fetch existing mappings to skip already-synced events
    const lwEventIds = activeLwEvents.map((e) => e.id);
    const existingLwMappings = await getMappingsByLineworksIds(lwEventIds, userId);
    const eventsToSyncToGoogle = activeLwEvents.filter((e) => !existingLwMappings.has(e.id));

    logger.info('initial_sync_phase2_filtered', {
      details: {
        userId,
        total: activeLwEvents.length,
        alreadySynced: existingLwMappings.size,
        toSync: eventsToSyncToGoogle.length,
      },
    });

    status.phase = 2;
    status.phaseTotal = eventsToSyncToGoogle.length;
    status.phaseFailed = 0;
    status.lwToGoogle = 0;
    status.updatedAt = new Date().toISOString();
    await setSyncStatus(status);

    const phase2Chunks = chunks(eventsToSyncToGoogle, BATCH_SIZE);
    for (const chunk of phase2Chunks) {
      const results = await Promise.allSettled(
        chunk.map((event) =>
          syncLineworksToGoogle(
            event,
            userId,
            config.googleCalendarId,
            config.lineworksCalendarId,
            config.googleRefreshToken,
            config.lineworksRefreshToken
          )
        )
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      lwToGoogle += succeeded;
      phase2Failed += failed;
      const remaining = eventsToSyncToGoogle.length - lwToGoogle - phase2Failed;
      const pct = Math.round((lwToGoogle / eventsToSyncToGoogle.length) * 100);
      const eta = estimateEtaSec(phase2StartMs, lwToGoogle + phase2Failed, eventsToSyncToGoogle.length);

      logger.info('initial_sync_phase2_progress', {
        details: {
          userId,
          lwToGoogle,
          failed: phase2Failed,
          remaining,
          total: eventsToSyncToGoogle.length,
          pct,
          elapsedSec: elapsedSec(phase2StartMs),
          etaSec: eta,
        },
      });

      // Update Firestore status
      status.lwToGoogle = lwToGoogle;
      status.phaseFailed = phase2Failed;
      status.updatedAt = new Date().toISOString();
      await setSyncStatus(status);
    }

    logger.info('initial_sync_complete', {
      details: {
        userId,
        googleToLw,
        lwToGoogle,
        phase1Failed,
        phase2Failed,
        totalElapsedSec: elapsedSec(syncStartMs),
      },
    });

    status.status = 'completed';
    status.updatedAt = new Date().toISOString();
    await setSyncStatus(status);

    return { googleToLw, lwToGoogle };
  } catch (err) {
    status.status = 'failed';
    status.error = err instanceof Error ? err.message : String(err);
    status.updatedAt = new Date().toISOString();
    await setSyncStatus(status);
    throw err;
  }
}
