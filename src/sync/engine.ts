import { CalendarEvent, EventMapping } from '../types';
import * as googleCal from '../google/calendar';
import * as lwCal from '../lineworks/calendar';
import { upsertMapping, deleteMapping, pushErrorQueue } from '../db/firestore';
import { shouldSyncFromGoogle, shouldSyncFromLineworks } from './dedup';
import { mapEvent, computeEventHash } from './mapper';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Google → LINE WORKS
// ---------------------------------------------------------------------------

/**
 * Sync a single Google Calendar event to LINE WORKS.
 * Handles create, update, and delete.
 */
export async function syncGoogleToLineworks(
  event: CalendarEvent,
  userId: string,
  googleCalendarId: string,
  lwCalendarId: string,
  lwUserId: string,
  googleRefreshToken?: string,
  lwRefreshToken?: string
): Promise<void> {
  let mapping: EventMapping | null = null;

  try {
    const result = await shouldSyncFromGoogle(event, userId);
    if (!result.sync) return;
    mapping = result.mapping;

    if (event.isCancelled) {
      await handleDeleteGoogleToLw(event, mapping, userId, lwCalendarId, lwUserId, lwRefreshToken);
      return;
    }

    if (mapping) {
      // Update existing
      const mapped = mapEvent(event);
      const updated = await lwCal.updateEvent(
        lwCalendarId,
        lwUserId,
        mapping.lineworksEventId,
        mapped,
        lwRefreshToken
      );
      await upsertMapping({
        googleEventId: event.id,
        lineworksEventId: updated.id,
        userId,
        lastSyncHash: computeEventHash(event),
        lastSyncSource: 'google',
        updatedAt: new Date().toISOString(),
      });
      logger.info('sync_google_to_lw_update', {
        eventId: event.id,
        source: 'google',
        details: { lineworksEventId: updated.id },
      });
    } else {
      // Create new
      const mapped = mapEvent(event);
      const created = await lwCal.createEvent(lwCalendarId, lwUserId, mapped, lwRefreshToken);
      await upsertMapping({
        googleEventId: event.id,
        lineworksEventId: created.id,
        userId,
        lastSyncHash: computeEventHash(event),
        lastSyncSource: 'google',
        updatedAt: new Date().toISOString(),
      });
      logger.info('sync_google_to_lw_create', {
        eventId: event.id,
        source: 'google',
        details: { lineworksEventId: created.id },
      });
    }
  } catch (error) {
    logger.error('sync_google_to_lw_failed', error, {
      eventId: event.id,
      source: 'google',
    });
    await pushErrorQueue({
      userId,
      source: 'google',
      eventId: event.id,
      action: event.isCancelled ? 'delete' : mapping ? 'update' : 'create',
      error: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });
  }
}

async function handleDeleteGoogleToLw(
  event: CalendarEvent,
  mapping: EventMapping | null,
  userId: string,
  lwCalendarId: string,
  lwUserId: string,
  lwRefreshToken?: string
): Promise<void> {
  if (!mapping) {
    logger.skip('sync_google_to_lw_delete_no_mapping', {
      eventId: event.id,
      source: 'google',
    });
    return;
  }

  await lwCal.deleteEvent(lwCalendarId, lwUserId, mapping.lineworksEventId, lwRefreshToken);
  await deleteMapping(event.id, userId);
  logger.info('sync_google_to_lw_delete', {
    eventId: event.id,
    source: 'google',
    details: { lineworksEventId: mapping.lineworksEventId },
  });
}

// ---------------------------------------------------------------------------
// LINE WORKS → Google
// ---------------------------------------------------------------------------

/**
 * Sync a single LINE WORKS Calendar event to Google.
 * Handles create, update, and delete.
 */
export async function syncLineworksToGoogle(
  event: CalendarEvent,
  userId: string,
  googleCalendarId: string,
  lwCalendarId: string,
  googleRefreshToken?: string,
  lwRefreshToken?: string
): Promise<void> {
  let mapping: EventMapping | null = null;

  try {
    const result = await shouldSyncFromLineworks(event, userId);
    if (!result.sync) return;
    mapping = result.mapping;

    if (event.isCancelled) {
      await handleDeleteLwToGoogle(event, mapping, userId, googleCalendarId, googleRefreshToken);
      return;
    }

    if (mapping) {
      // Update existing
      const mapped = mapEvent(event);
      const updated = await googleCal.updateEvent(
        googleCalendarId,
        mapping.googleEventId,
        mapped,
        googleRefreshToken
      );
      await upsertMapping({
        googleEventId: updated.id,
        lineworksEventId: event.id,
        userId,
        lastSyncHash: computeEventHash(event),
        lastSyncSource: 'lineworks',
        updatedAt: new Date().toISOString(),
      });
      logger.info('sync_lw_to_google_update', {
        eventId: event.id,
        source: 'lineworks',
        details: { googleEventId: updated.id },
      });
    } else {
      // Create new
      const mapped = mapEvent(event);
      const created = await googleCal.createEvent(googleCalendarId, mapped, googleRefreshToken);
      await upsertMapping({
        googleEventId: created.id,
        lineworksEventId: event.id,
        userId,
        lastSyncHash: computeEventHash(event),
        lastSyncSource: 'lineworks',
        updatedAt: new Date().toISOString(),
      });
      logger.info('sync_lw_to_google_create', {
        eventId: event.id,
        source: 'lineworks',
        details: { googleEventId: created.id },
      });
    }
  } catch (error) {
    logger.error('sync_lw_to_google_failed', error, {
      eventId: event.id,
      source: 'lineworks',
    });
    await pushErrorQueue({
      userId,
      source: 'lineworks',
      eventId: event.id,
      action: event.isCancelled ? 'delete' : mapping ? 'update' : 'create',
      error: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });
  }
}

async function handleDeleteLwToGoogle(
  event: CalendarEvent,
  mapping: EventMapping | null,
  userId: string,
  googleCalendarId: string,
  googleRefreshToken?: string
): Promise<void> {
  if (!mapping) {
    logger.skip('sync_lw_to_google_delete_no_mapping', {
      eventId: event.id,
      source: 'lineworks',
    });
    return;
  }

  await googleCal.deleteEvent(googleCalendarId, mapping.googleEventId, googleRefreshToken);
  await deleteMapping(mapping.googleEventId, userId);
  logger.info('sync_lw_to_google_delete', {
    eventId: event.id,
    source: 'lineworks',
    details: { googleEventId: mapping.googleEventId },
  });
}
