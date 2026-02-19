import * as googleCal from '../google/calendar';
import * as lwCal from '../lineworks/calendar';
import { syncGoogleToLineworks, syncLineworksToGoogle } from './engine';
import { getUserConfig, getAllMappingsForUser } from '../db/firestore';
import { logger } from '../utils/logger';

/**
 * Perform a full initial sync for a user.
 * Fetches ALL events from the past `daysBack` days on both platforms
 * and syncs them bidirectionally. Should only be called once during
 * first-time setup (or to re-sync after a data loss).
 */
export async function runInitialSync(
  userId: string,
  daysBack: number = 30
): Promise<{ googleToLw: number; lwToGoogle: number }> {
  const config = await getUserConfig(userId);
  if (!config) {
    throw new Error(`No config found for user ${userId}`);
  }

  const existingMappings = await getAllMappingsForUser(userId);
  if (existingMappings.length > 0) {
    logger.info('initial_sync_skip_existing', {
      details: { userId, existingMappings: existingMappings.length },
    });
    throw new Error(
      `User ${userId} already has ${existingMappings.length} event mappings. ` +
      'Use force=true to override.'
    );
  }

  const updatedMin = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  logger.info('initial_sync_start', {
    details: { userId, daysBack, updatedMin },
  });

  // Phase 1: Google → LINE WORKS
  let googleToLw = 0;
  const googleEvents = await googleCal.listRecentEvents(
    config.googleCalendarId,
    updatedMin,
    config.googleRefreshToken
  );

  for (const event of googleEvents) {
    if (event.isCancelled) continue;
    await syncGoogleToLineworks(
      event,
      userId,
      config.googleCalendarId,
      config.lineworksCalendarId,
      userId,
      config.googleRefreshToken,
      config.lineworksRefreshToken
    );
    googleToLw++;
  }

  // Phase 2: LINE WORKS → Google (only events not already synced in Phase 1)
  let lwToGoogle = 0;
  const lwEvents = await lwCal.listRecentEvents(
    config.lineworksCalendarId,
    userId,
    updatedMin,
    config.lineworksRefreshToken
  );

  for (const event of lwEvents) {
    if (event.isCancelled) continue;
    await syncLineworksToGoogle(
      event,
      userId,
      config.googleCalendarId,
      config.lineworksCalendarId,
      config.googleRefreshToken,
      config.lineworksRefreshToken
    );
    lwToGoogle++;
  }

  logger.info('initial_sync_complete', {
    details: { userId, googleToLw, lwToGoogle },
  });

  return { googleToLw, lwToGoogle };
}
