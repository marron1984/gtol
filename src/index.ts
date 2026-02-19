import express from 'express';
import { handleGoogleWebhook } from './google/webhook';
import { handleLineworksWebhook } from './lineworks/webhook';
import { runPoll } from './sync/poller';
import { startWatch } from './google/calendar';
import { getUserConfig } from './db/firestore';
import { logger } from './utils/logger';

const app = express();

// Parse JSON bodies (needed for LINE WORKS webhook)
// We also capture the raw body for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString();
    },
  })
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------
app.post('/webhooks/google', handleGoogleWebhook);
app.post('/webhooks/lineworks', handleLineworksWebhook);

// ---------------------------------------------------------------------------
// Polling endpoint (triggered by Cloud Scheduler)
// ---------------------------------------------------------------------------
app.post('/poll', async (req, res) => {
  const userId = req.body?.userId ?? process.env.SYNC_USER_ID;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  try {
    await runPoll(userId);
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('poll_endpoint_failed', error);
    res.status(500).json({ error: 'Poll failed' });
  }
});

// ---------------------------------------------------------------------------
// Admin: register Google Push notification channel
// ---------------------------------------------------------------------------
app.post('/admin/watch/start', async (req, res) => {
  const userId = req.body?.userId ?? process.env.SYNC_USER_ID;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  try {
    const config = await getUserConfig(userId);
    if (!config) {
      res.status(404).json({ error: `No config for user ${userId}` });
      return;
    }

    const port = process.env.PORT ?? '8080';
    const baseUrl = req.body?.baseUrl ?? `https://${req.headers.host}`;
    const webhookUrl = `${baseUrl}/webhooks/google`;

    const result = await startWatch(
      config.googleCalendarId,
      webhookUrl,
      config.googleRefreshToken
    );

    res.json({ status: 'ok', ...result });
  } catch (error) {
    logger.error('admin_watch_start_failed', error);
    res.status(500).json({ error: 'Failed to start watch' });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '8080', 10);

app.listen(PORT, () => {
  logger.info('server_started', { details: { port: PORT } });
});

export default app;
