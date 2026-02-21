import * as googleCal from '../google/calendar';
import * as lwCal from '../lineworks/calendar';
import { syncGoogleToLineworks, syncLineworksToGoogle } from './engine';
import {
  getUserConfig,
  getMappingsByGoogleIds,
  getMappingsByLineworksIds,
} from '../db/firestore';
import { logger } from '../utils/logger';

const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE ?? '5', 10);
const MAX_INITIAL_SYNC_EVENTS = 200;

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
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

  const timeMin = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date().toISOString();

  logger.info('initial_sync_start', {
    details: { userId, daysBack, timeMin, timeMax, batchSize: BATCH_SIZE, maxEvents: MAX_INITIAL_SYNC_EVENTS },
  });

  // Phase 1: Google → LINE WORKS
  let googleToLw = 0;
  logger.info('initial_sync_phase1_fetch', { details: { userId, timeMin, timeMax } });
  const allGoogleEvents = await googleCal.listEventsByTimeRange(
    config.googleCalendarId,
    timeMin,
    config.googleRefreshToken,
    timeMax
  );
  const activeGoogleEvents = allGoogleEvents.filter((e) => !e.isCancelled).slice(0, MAX_INITIAL_SYNC_EVENTS);
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
    googleToLw += succeeded;

    logger.info('initial_sync_phase1_progress', {
      details: {
        userId,
        googleToLw,
        remaining: eventsToSyncToLw.length - googleToLw,
        total: eventsToSyncToLw.length,
      },
    });
  }

  // Phase 2: LINE WORKS → Google (only events not already synced in Phase 1)
  let lwToGoogle = 0;
  logger.info('initial_sync_phase2_fetch', { details: { userId, timeMin } });
  const allLwEvents = await lwCal.listRecentEvents(
    config.lineworksCalendarId,
    config.lineworksUserId!,
    timeMin,
    config.lineworksRefreshToken
  );
  const activeLwEvents = allLwEvents.filter((e) => !e.isCancelled).slice(0, MAX_INITIAL_SYNC_EVENTS);
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
    lwToGoogle += succeeded;

    logger.info('initial_sync_phase2_progress', {
      details: {
        userId,
        lwToGoogle,
        remaining: eventsToSyncToGoogle.length - lwToGoogle,
        total: eventsToSyncToGoogle.length,
      },
    });
  }

  logger.info('initial_sync_complete', {
    details: { userId, googleToLw, lwToGoogle },
  });

  return { googleToLw, lwToGoogle };
}
