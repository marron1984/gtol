import { Request, Response } from 'express';
import * as crypto from 'crypto';
import * as lwCal from './calendar';
import { syncLineworksToGoogle } from '../sync/engine';
import { getUserConfig } from '../db/firestore';
import { logger } from '../utils/logger';

/**
 * Verify the HMAC-SHA256 signature of a LINE WORKS webhook request.
 */
function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Handle LINE WORKS Calendar webhook notification.
 *
 * LINE WORKS sends a POST with:
 *   Header: X-Works-Signature (HMAC signature)
 *   Body: JSON payload with event details
 */
export async function handleLineworksWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-works-signature'] as string | undefined;
  const webhookSecret = process.env.LW_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.error('lineworks_webhook_no_secret', 'LW_WEBHOOK_SECRET not configured');
    res.status(500).send('Webhook secret not configured');
    return;
  }

  // Verify signature using the raw body captured by express.json({ verify })
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  if (!signature || !verifySignature(rawBody, signature, webhookSecret)) {
    logger.error('lineworks_webhook_invalid_signature', 'Signature verification failed');
    res.status(401).send('Invalid signature');
    return;
  }

  // Acknowledge immediately
  res.status(200).send('OK');

  logger.info('lineworks_webhook_received', {
    details: { type: req.body?.type },
  });

  try {
    const userId = process.env.SYNC_USER_ID;
    if (!userId) {
      logger.error('lineworks_webhook_no_user', 'SYNC_USER_ID not configured');
      return;
    }

    const config = await getUserConfig(userId);
    if (!config) {
      logger.error('lineworks_webhook_no_config', `No config for user ${userId}`);
      return;
    }

    const body = req.body;
    const eventType = body?.type;

    // LINE WORKS webhook payload includes event details directly
    if (eventType === 'calendar.event.created' ||
        eventType === 'calendar.event.updated' ||
        eventType === 'calendar.event.deleted') {

      const eventId = body?.content?.eventId;
      if (!eventId) {
        logger.skip('lineworks_webhook_no_event_id', {
          details: { type: eventType },
        });
        return;
      }

      if (eventType === 'calendar.event.deleted') {
        // For deleted events, construct a minimal cancelled event
        await syncLineworksToGoogle(
          {
            id: eventId,
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
        // Fetch the full event details from LINE WORKS
        const event = await lwCal.getEvent(
          config.lineworksCalendarId,
          config.lineworksUserId!,
          eventId,
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

      logger.info('lineworks_webhook_processed', {
        details: { type: eventType, eventId },
      });
    }
  } catch (error) {
    logger.error('lineworks_webhook_processing_failed', error);
  }
}
