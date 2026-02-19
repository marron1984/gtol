import { EventMapping } from '../types';
import { computeEventHash } from './mapper';
import { CalendarEvent } from '../types';
import {
  getMappingByGoogleId,
  getMappingByLineworksId,
} from '../db/firestore';
import { logger } from '../utils/logger';

/**
 * Determine whether an event change from Google should be synced to LINE WORKS.
 * Returns `false` (skip) when:
 *   - The event was just synced FROM LINE WORKS (loop prevention)
 *   - The event content hash has not changed since the last sync
 */
export async function shouldSyncFromGoogle(
  event: CalendarEvent,
  userId: string
): Promise<{ sync: boolean; mapping: EventMapping | null }> {
  const mapping = await getMappingByGoogleId(event.id, userId);

  if (!mapping) {
    // No mapping → new event, always sync
    return { sync: true, mapping: null };
  }

  // Loop prevention: if the last sync was triggered from Google, the LINE WORKS
  // side was just updated by us — the incoming change notification from Google
  // is the original trigger, so we DO want to sync. If the last sync was from
  // lineworks, that means LINE WORKS changed → we synced to Google → Google
  // notified us back. In that case, check whether the hash changed to decide.
  if (mapping.lastSyncSource === 'lineworks') {
    const currentHash = computeEventHash(event);
    if (currentHash === mapping.lastSyncHash) {
      logger.skip('dedup_skip_google_echo', {
        eventId: event.id,
        source: 'google',
      });
      return { sync: false, mapping };
    }
  }

  // Content-based dedup: skip if nothing meaningful changed
  const currentHash = computeEventHash(event);
  if (currentHash === mapping.lastSyncHash) {
    logger.skip('dedup_no_change_google', {
      eventId: event.id,
      source: 'google',
    });
    return { sync: false, mapping };
  }

  return { sync: true, mapping };
}

/**
 * Mirror of `shouldSyncFromGoogle` for the reverse direction.
 */
export async function shouldSyncFromLineworks(
  event: CalendarEvent,
  userId: string
): Promise<{ sync: boolean; mapping: EventMapping | null }> {
  const mapping = await getMappingByLineworksId(event.id, userId);

  if (!mapping) {
    return { sync: true, mapping: null };
  }

  if (mapping.lastSyncSource === 'google') {
    const currentHash = computeEventHash(event);
    if (currentHash === mapping.lastSyncHash) {
      logger.skip('dedup_skip_lineworks_echo', {
        eventId: event.id,
        source: 'lineworks',
      });
      return { sync: false, mapping };
    }
  }

  const currentHash = computeEventHash(event);
  if (currentHash === mapping.lastSyncHash) {
    logger.skip('dedup_no_change_lineworks', {
      eventId: event.id,
      source: 'lineworks',
    });
    return { sync: false, mapping };
  }

  return { sync: true, mapping };
}
