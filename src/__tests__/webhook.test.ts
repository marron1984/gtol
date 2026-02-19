import * as crypto from 'crypto';
import { Request, Response } from 'express';

// Mock external dependencies before importing handlers
jest.mock('../google/calendar');
jest.mock('../lineworks/calendar');
jest.mock('../sync/engine');
jest.mock('../db/firestore');

import { handleGoogleWebhook } from '../google/webhook';
import { handleLineworksWebhook } from '../lineworks/webhook';

const mockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
};

describe('handleGoogleWebhook', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, SYNC_USER_ID: 'testuser' };
  });
  afterEach(() => {
    process.env = origEnv;
    jest.resetAllMocks();
  });

  it('responds 200 immediately', async () => {
    const req = {
      headers: { 'x-goog-channel-id': 'ch-1', 'x-goog-resource-state': 'sync' },
      body: {},
    } as unknown as Request;
    const res = mockRes();

    await handleGoogleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  it('does nothing on "sync" state (initial handshake)', async () => {
    const { syncGoogleToLineworks } = jest.requireMock('../sync/engine');
    const req = {
      headers: { 'x-goog-resource-state': 'sync' },
      body: {},
    } as unknown as Request;
    const res = mockRes();

    await handleGoogleWebhook(req, res);

    expect(syncGoogleToLineworks).not.toHaveBeenCalled();
  });

  it('fetches events and syncs on "exists" state', async () => {
    const googleCal = jest.requireMock('../google/calendar');
    const { syncGoogleToLineworks } = jest.requireMock('../sync/engine');
    const firestore = jest.requireMock('../db/firestore');

    firestore.getUserConfig.mockResolvedValue({
      userId: 'testuser',
      googleCalendarId: 'gcal',
      googleRefreshToken: 'grt',
      lineworksCalendarId: 'lwcal',
      lineworksRefreshToken: 'lwrt',
    });
    googleCal.listRecentEvents.mockResolvedValue([
      { id: 'e1', summary: 'Test', description: '', location: '', startTime: '', endTime: '', isAllDay: false, isCancelled: false },
    ]);
    syncGoogleToLineworks.mockResolvedValue(undefined);

    const req = {
      headers: { 'x-goog-resource-state': 'exists' },
      body: {},
    } as unknown as Request;
    const res = mockRes();

    await handleGoogleWebhook(req, res);

    expect(googleCal.listRecentEvents).toHaveBeenCalled();
    expect(syncGoogleToLineworks).toHaveBeenCalledTimes(1);
  });
});

describe('handleLineworksWebhook', () => {
  const origEnv = process.env;
  const secret = 'test-secret';

  function sign(body: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('base64');
  }

  beforeEach(() => {
    process.env = { ...origEnv, LW_WEBHOOK_SECRET: secret, SYNC_USER_ID: 'testuser' };
  });
  afterEach(() => {
    process.env = origEnv;
    jest.resetAllMocks();
  });

  it('rejects requests with invalid signature', async () => {
    const body = JSON.stringify({ type: 'calendar.event.created' });
    const req = {
      headers: { 'x-works-signature': 'invalid-sig' },
      body: JSON.parse(body),
    } as unknown as Request;
    const res = mockRes();

    await handleLineworksWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts valid signature and processes event', async () => {
    const firestore = jest.requireMock('../db/firestore');
    const lwCal = jest.requireMock('../lineworks/calendar');
    const { syncLineworksToGoogle } = jest.requireMock('../sync/engine');

    firestore.getUserConfig.mockResolvedValue({
      userId: 'testuser',
      googleCalendarId: 'gcal',
      googleRefreshToken: 'grt',
      lineworksCalendarId: 'lwcal',
      lineworksRefreshToken: 'lwrt',
    });
    lwCal.getEvent.mockResolvedValue({
      id: 'lw-e1', summary: 'Test', description: '', location: '',
      startTime: '', endTime: '', isAllDay: false, isCancelled: false,
    });
    syncLineworksToGoogle.mockResolvedValue(undefined);

    const bodyObj = { type: 'calendar.event.created', content: { eventId: 'lw-e1' } };
    const bodyStr = JSON.stringify(bodyObj);
    const sig = sign(bodyStr);

    const req = {
      headers: { 'x-works-signature': sig },
      body: bodyObj,
    } as unknown as Request;
    const res = mockRes();

    await handleLineworksWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(syncLineworksToGoogle).toHaveBeenCalledTimes(1);
  });

  it('handles deleted events with synthetic cancelled event', async () => {
    const firestore = jest.requireMock('../db/firestore');
    const { syncLineworksToGoogle } = jest.requireMock('../sync/engine');

    firestore.getUserConfig.mockResolvedValue({
      userId: 'testuser',
      googleCalendarId: 'gcal',
      googleRefreshToken: 'grt',
      lineworksCalendarId: 'lwcal',
      lineworksRefreshToken: 'lwrt',
    });
    syncLineworksToGoogle.mockResolvedValue(undefined);

    const bodyObj = { type: 'calendar.event.deleted', content: { eventId: 'lw-del' } };
    const bodyStr = JSON.stringify(bodyObj);
    const sig = sign(bodyStr);

    const req = {
      headers: { 'x-works-signature': sig },
      body: bodyObj,
    } as unknown as Request;
    const res = mockRes();

    await handleLineworksWebhook(req, res);

    expect(syncLineworksToGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lw-del', isCancelled: true }),
      'testuser', 'gcal', 'lwcal', 'grt', 'lwrt'
    );
  });

  it('returns 500 when webhook secret is not configured', async () => {
    delete process.env.LW_WEBHOOK_SECRET;
    const req = {
      headers: {},
      body: {},
    } as unknown as Request;
    const res = mockRes();

    await handleLineworksWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
