import axios from 'axios';
import { getLineworksAccessToken } from '../lineworks/auth';
import { logger } from './logger';

/**
 * Send a critical error notification to the admin via LINE WORKS Bot message.
 * Falls back to logging if the notification itself fails.
 */
export async function notifyAdmin(subject: string, body: string): Promise<void> {
  const botId = process.env.LW_BOT_ID;
  const channelId = process.env.LW_CHANNEL_ID;

  if (!botId || !channelId) {
    logger.error('notify_admin_no_config', 'LW_BOT_ID or LW_CHANNEL_ID not set');
    return;
  }

  try {
    const accessToken = await getLineworksAccessToken();
    await axios.post(
      `https://www.worksapis.com/v1.0/bots/${botId}/channels/${channelId}/messages`,
      {
        content: {
          type: 'text',
          text: `[cal-sync ALERT]\n${subject}\n\n${body}`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('notify_admin_sent', {
      details: { subject },
    });
  } catch (error) {
    // Notification failure should not crash the system
    logger.error('notify_admin_failed', error, {
      details: { subject },
    });
  }
}
