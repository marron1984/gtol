import { Request, Response } from 'express';
import * as googleCal from './calendar';
import { syncGoogleToLineworks } from '../sync/engine';
import { getUserConfig } from '../db/firestore';
import { logger } from '../utils/logger';

/**
 * Handle Google Calendar push notification.
 *
 * Google sends a POST with headers:
 *   X-Goog-Channel-ID, X-Goog-Resource-ID, X-Goog-Resource-State
 *
 * On "sync" state: just acknowledge (initial handshake).
 * On "exists" state: fetch recent changes and sync them.
 */
export async function handleGoogleWebhook(req: Request, res: Response): Promise<void> {
  const channelId = req.headers['x-goog-channel-id'] as string | undefined;
  const resourceState = req.headers['x-goog-resource-state'] as string | undefined;

  logger.info('google_webhook_received', {
    details: { channelId, resourceState },
  });

  // Acknowledge immediately — processing happens async
  res.status(200).send('OK');

  if (resourceState === 'sync') {
    // Initial sync verification — nothing to do
    return;
  }

  if (resourceState !== 'exists') {
    logger.skip('google_webhook_unknown_state', {
      details: { resourceState },
    });
    return;
  }

  try {
    const userId = process.env.SYNC_USER_ID;
    if (!userId) {
      logger.error('google_webhook_no_user', 'SYNC_USER_ID not configured');
      return;
    }

    const config = await getUserConfig(userId);
    if (!config) {
      logger.error('google_webhook_no_config', `No config for user ${userId}`);
      return;
    }

    // Fetch events updated in the last 5 minutes to catch the change
    const updatedMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const events = await googleCal.listRecentEvents(
      config.googleCalendarId,
      updatedMin,
      config.googleRefreshToken
    );

    for (const event of events) {
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

    logger.info('google_webhook_processed', {
      details: { eventsCount: events.length },
    });
  } catch (error) {
    logger.error('google_webhook_processing_failed', error);
  }
}
