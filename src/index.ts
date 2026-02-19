import express from 'express';
import { handleGoogleWebhook } from './google/webhook';
import { handleLineworksWebhook } from './lineworks/webhook';
import { runPoll } from './sync/poller';
import { startWatch } from './google/calendar';
import { renewWatch, checkAndRenewWatches } from './google/watchManager';
import { getUserConfig, setUserConfig } from './db/firestore';
import { runInitialSync } from './sync/initialSync';
import { UserConfig } from './types';
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
// Root / Health check
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({ service: 'cal-sync', status: 'ok', timestamp: new Date().toISOString() });
});

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
// Also checks and renews Google Watch channels that are about to expire.
// ---------------------------------------------------------------------------
app.post('/poll', async (req, res) => {
  const userId = req.body?.userId ?? process.env.SYNC_USER_ID;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  try {
    await runPoll(userId);

    // Auto-renew watch channels expiring within 48h
    const baseUrl = req.body?.baseUrl ?? `https://${req.headers.host}`;
    await checkAndRenewWatches(baseUrl);

    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('poll_endpoint_failed', error);
    res.status(500).json({ error: 'Poll failed' });
  }
});

// ---------------------------------------------------------------------------
// Admin: user config management
// ---------------------------------------------------------------------------
app.get('/admin/config/:userId', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userId);
    if (!config) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    // Mask sensitive tokens in response
    res.json({
      ...config,
      googleRefreshToken: config.googleRefreshToken ? '***' : '',
      lineworksRefreshToken: config.lineworksRefreshToken ? '***' : '',
    });
  } catch (error) {
    logger.error('admin_get_config_failed', error);
    res.status(500).json({ error: 'Failed to get config' });
  }
});

app.post('/admin/config', async (req, res) => {
  const body = req.body as Partial<UserConfig>;
  if (!body.userId || !body.googleCalendarId || !body.googleRefreshToken ||
      !body.lineworksCalendarId || !body.lineworksRefreshToken) {
    res.status(400).json({
      error: 'Required fields: userId, googleCalendarId, googleRefreshToken, lineworksCalendarId, lineworksRefreshToken',
    });
    return;
  }

  try {
    await setUserConfig(body as UserConfig);
    res.json({ status: 'ok', userId: body.userId });
  } catch (error) {
    logger.error('admin_set_config_failed', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Google Watch channel management
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

app.post('/admin/watch/renew', async (req, res) => {
  const userId = req.body?.userId ?? process.env.SYNC_USER_ID;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  try {
    const baseUrl = req.body?.baseUrl ?? `https://${req.headers.host}`;
    await renewWatch(userId, baseUrl);
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('admin_watch_renew_failed', error);
    res.status(500).json({ error: 'Failed to renew watch' });
  }
});

// ---------------------------------------------------------------------------
// Admin: initial full sync (first-time setup)
// ---------------------------------------------------------------------------
app.post('/admin/initial-sync', async (req, res) => {
  const userId = req.body?.userId ?? process.env.SYNC_USER_ID;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  const daysBack = req.body?.daysBack ?? 30;

  try {
    const result = await runInitialSync(userId, daysBack);
    res.json({ status: 'ok', ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('admin_initial_sync_failed', error);
    res.status(500).json({ error: msg });
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
