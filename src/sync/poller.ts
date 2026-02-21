import * as googleCal from '../google/calendar';
import * as lwCal from '../lineworks/calendar';
import { syncGoogleToLineworks, syncLineworksToGoogle } from './engine';
import {
  getUserConfig,
  getErrorQueue,
  removeErrorQueueEntry,
  pushErrorQueue,
} from '../db/firestore';
import { logger } from '../utils/logger';
import { notifyAdmin } from '../utils/notify';

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_POLL_EVENTS = 200;
const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE ?? '5', 10);

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Run a full bidirectional poll for the given user.
 * Fetches recent changes from both platforms and syncs them.
 */
export async function runPoll(userId: string): Promise<void> {
  const config = await getUserConfig(userId);
  if (!config) {
    logger.error('poller_no_config', `No config found for user ${userId}`);
    return;
  }

  const updatedMin = new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();

  logger.info('poller_start', {
    details: { userId, updatedMin },
  });

  // ---------------------------------------------------------------------------
  // 1. Google → LINE WORKS
  // ---------------------------------------------------------------------------
  try {
    const allGoogleEvents = await googleCal.listRecentEvents(
      config.googleCalendarId,
      updatedMin,
      config.googleRefreshToken
    );
    const googleEvents = allGoogleEvents.slice(0, MAX_POLL_EVENTS);

    logger.info('poller_google_events_fetched', {
      details: { count: googleEvents.length, total: allGoogleEvents.length },
    });

    for (const chunk of chunks(googleEvents, BATCH_SIZE)) {
      await Promise.allSettled(
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
    }
  } catch (error) {
    logger.error('poller_google_fetch_failed', error);
  }

  // ---------------------------------------------------------------------------
  // 2. LINE WORKS → Google
  // ---------------------------------------------------------------------------
  try {
    const allLwEvents = await lwCal.listRecentEvents(
      config.lineworksCalendarId,
      config.lineworksUserId!,
      updatedMin,
      config.lineworksRefreshToken
    );
    const lwEvents = allLwEvents.slice(0, MAX_POLL_EVENTS);

    logger.info('poller_lineworks_events_fetched', {
      details: { count: lwEvents.length, total: allLwEvents.length },
    });

    for (const chunk of chunks(lwEvents, BATCH_SIZE)) {
      await Promise.allSettled(
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
    }
  } catch (error) {
    logger.error('poller_lineworks_fetch_failed', error);
  }

  // ---------------------------------------------------------------------------
  // 3. Retry error queue
  // ---------------------------------------------------------------------------
  await retryErrorQueue(userId);

  logger.info('poller_complete', { details: { userId } });
}

/**
 * Process items in the error queue: re-fetch the event and try to sync again.
 */
async function retryErrorQueue(userId: string): Promise<void> {
  const entries = await getErrorQueue(userId);
  if (entries.length === 0) return;

  logger.info('poller_error_queue_retry', {
    details: { count: entries.length },
  });

  const config = await getUserConfig(userId);
  if (!config) return;

  for (const entry of entries) {
    try {
      if (entry.source === 'google') {
        if (entry.action === 'delete') {
          // Re-attempt delete via a synthetic cancelled event
          await syncGoogleToLineworks(
            {
              id: entry.eventId,
              summary: '',
              description: '',
              location: '',
              startTime: '',
              endTime: '',
              isAllDay: false,
              isCancelled: true,
            },
            userId,
            config.googleCalendarId,
            config.lineworksCalendarId,
            config.lineworksUserId!,
            config.googleRefreshToken,
            config.lineworksRefreshToken
          );
        } else {
          const event = await googleCal.getEvent(
            config.googleCalendarId,
            entry.eventId,
            config.googleRefreshToken
          );
          if (event) {
            await syncGoogleToLineworks(
              event,
              userId,
              config.googleCalendarId,
              config.lineworksCalendarId,
              config.lineworksUserId!,
              config.googleRefreshToken,
              config.lineworksRefreshToken
            );
          }
        }
      } else {
        if (entry.action === 'delete') {
          await syncLineworksToGoogle(
            {
              id: entry.eventId,
              summary: '',
              description: '',
              location: '',
              startTime: '',
              endTime: '',
              isAllDay: false,
              isCancelled: true,
            },
            userId,
            config.googleCalendarId,
            config.lineworksCalendarId,
            config.googleRefreshToken,
            config.lineworksRefreshToken
          );
        } else {
          const event = await lwCal.getEvent(
            config.lineworksCalendarId,
            config.lineworksUserId!,
            entry.eventId,
            config.lineworksRefreshToken
          );
          if (event) {
            await syncLineworksToGoogle(
              event,
              userId,
              config.googleCalendarId,
              config.lineworksCalendarId,
              config.googleRefreshToken,
              config.lineworksRefreshToken
            );
          }
        }
      }

      // Success — remove from error queue
      await removeErrorQueueEntry(entry.docId);
      logger.info('poller_error_queue_retry_success', {
        eventId: entry.eventId,
        source: entry.source,
      });
    } catch (error) {
      // If retry fails again and max retries exceeded, discard
      if (entry.retryCount >= 3) {
        await removeErrorQueueEntry(entry.docId);
        logger.error('poller_error_queue_max_retries', error, {
          eventId: entry.eventId,
          source: entry.source,
        });
        await notifyAdmin(
          'Sync failed after max retries',
          `Source: ${entry.source}\nEvent: ${entry.eventId}\nAction: ${entry.action}\nError: ${error instanceof Error ? error.message : String(error)}`
        );
      } else {
        // Re-enqueue with incremented count (exclude docId from the new entry)
        await removeErrorQueueEntry(entry.docId);
        const { docId: _, ...entryWithoutDocId } = entry;
        await pushErrorQueue({
          ...entryWithoutDocId,
          retryCount: entry.retryCount + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
