import { startWatch, stopWatch } from './calendar';
import { getFirestore } from '../db/firestore';
import { getUserConfig } from '../db/firestore';
import { logger } from '../utils/logger';
import { notifyAdmin } from '../utils/notify';

const WATCH_COLLECTION = 'watch_channels';

interface WatchChannel {
  userId: string;
  channelId: string;
  resourceId: string;
  expiration: string;
  webhookUrl: string;
}

/** Persist the current watch channel info in Firestore. */
async function saveWatchChannel(channel: WatchChannel): Promise<void> {
  await getFirestore()
    .collection(WATCH_COLLECTION)
    .doc(channel.userId)
    .set(channel, { merge: true });
}

/** Retrieve the current watch channel info. */
async function getWatchChannel(userId: string): Promise<WatchChannel | null> {
  const doc = await getFirestore()
    .collection(WATCH_COLLECTION)
    .doc(userId)
    .get();

  if (!doc.exists) return null;
  return doc.data() as WatchChannel;
}

/**
 * Renew the Google Calendar push notification channel for a user.
 * Stops the old channel (if any) and starts a new one.
 * Designed to be called by Cloud Scheduler (e.g. every 5 days).
 */
export async function renewWatch(userId: string, baseUrl: string): Promise<void> {
  const config = await getUserConfig(userId);
  if (!config) {
    logger.error('watch_renew_no_config', `No config for user ${userId}`);
    return;
  }

  const webhookUrl = `${baseUrl}/webhooks/google`;

  // Stop existing channel
  const existing = await getWatchChannel(userId);
  if (existing) {
    try {
      await stopWatch(existing.channelId, existing.resourceId, config.googleRefreshToken);
    } catch (error) {
      // Non-fatal: the channel may have already expired
      logger.error('watch_renew_stop_failed', error, {
        details: { channelId: existing.channelId },
      });
    }
  }

  // Start new channel
  const result = await startWatch(
    config.googleCalendarId,
    webhookUrl,
    config.googleRefreshToken
  );

  await saveWatchChannel({
    userId,
    channelId: result.channelId,
    resourceId: result.resourceId,
    expiration: result.expiration,
    webhookUrl,
  });

  logger.info('watch_renewed', {
    details: {
      userId,
      channelId: result.channelId,
      expiration: result.expiration,
    },
  });
}

/**
 * Check all active watch channels and renew any that expire within 48 hours.
 * Designed to be called by the polling endpoint.
 */
export async function checkAndRenewWatches(baseUrl: string): Promise<void> {
  const snapshot = await getFirestore()
    .collection(WATCH_COLLECTION)
    .get();

  const now = Date.now();
  const renewThreshold = 48 * 60 * 60 * 1000; // 48 hours

  for (const doc of snapshot.docs) {
    const channel = doc.data() as WatchChannel;
    const expiresAt = new Date(channel.expiration).getTime();

    if (expiresAt - now < renewThreshold) {
      logger.info('watch_auto_renew_triggered', {
        details: {
          userId: channel.userId,
          expiresAt: channel.expiration,
        },
      });

      try {
        await renewWatch(channel.userId, baseUrl);
      } catch (error) {
        logger.error('watch_auto_renew_failed', error, {
          details: { userId: channel.userId },
        });
        await notifyAdmin(
          'Watch channel renewal failed',
          `User: ${channel.userId}\nError: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}
