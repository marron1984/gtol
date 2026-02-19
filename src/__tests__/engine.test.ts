import { syncGoogleToLineworks, syncLineworksToGoogle } from '../sync/engine';
import { CalendarEvent } from '../types';
import { computeEventHash } from '../sync/mapper';

// Mock all external dependencies
jest.mock('../sync/dedup');
jest.mock('../google/calendar');
jest.mock('../lineworks/calendar');
jest.mock('../db/firestore');

const dedup = jest.requireMock('../sync/dedup');
const googleCal = jest.requireMock('../google/calendar');
const lwCal = jest.requireMock('../lineworks/calendar');
const firestore = jest.requireMock('../db/firestore');

const baseEvent: CalendarEvent = {
  id: 'g-1',
  summary: 'Meeting',
  description: '',
  location: '',
  startTime: '2026-02-20T10:00:00+09:00',
  endTime: '2026-02-20T11:00:00+09:00',
  isAllDay: false,
  isCancelled: false,
};

describe('syncGoogleToLineworks', () => {
  afterEach(() => jest.resetAllMocks());

  it('creates a new event in LINE WORKS when no mapping exists', async () => {
    dedup.shouldSyncFromGoogle.mockResolvedValue({ sync: true, mapping: null });
    lwCal.createEvent.mockResolvedValue({ ...baseEvent, id: 'lw-new' });
    firestore.upsertMapping.mockResolvedValue(undefined);

    await syncGoogleToLineworks(baseEvent, 'u1', 'gcal', 'lwcal', 'u1');

    expect(lwCal.createEvent).toHaveBeenCalledWith('lwcal', 'u1', expect.objectContaining({ id: '' }), undefined);
    expect(firestore.upsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        googleEventId: 'g-1',
        lineworksEventId: 'lw-new',
        lastSyncSource: 'google',
      })
    );
  });

  it('updates an existing event when mapping exists', async () => {
    const mapping = {
      googleEventId: 'g-1',
      lineworksEventId: 'lw-existing',
      userId: 'u1',
      lastSyncHash: 'oldhash',
      lastSyncSource: 'google',
      updatedAt: '',
    };
    dedup.shouldSyncFromGoogle.mockResolvedValue({ sync: true, mapping });
    lwCal.updateEvent.mockResolvedValue({ ...baseEvent, id: 'lw-existing' });
    firestore.upsertMapping.mockResolvedValue(undefined);

    await syncGoogleToLineworks(baseEvent, 'u1', 'gcal', 'lwcal', 'u1');

    expect(lwCal.updateEvent).toHaveBeenCalledWith('lwcal', 'u1', 'lw-existing', expect.any(Object), undefined);
  });

  it('deletes on the LINE WORKS side when event is cancelled', async () => {
    const mapping = {
      googleEventId: 'g-1',
      lineworksEventId: 'lw-existing',
      userId: 'u1',
      lastSyncHash: 'oldhash',
      lastSyncSource: 'google',
      updatedAt: '',
    };
    dedup.shouldSyncFromGoogle.mockResolvedValue({ sync: true, mapping });
    lwCal.deleteEvent.mockResolvedValue(undefined);
    firestore.deleteMapping.mockResolvedValue(undefined);

    const cancelled = { ...baseEvent, isCancelled: true };
    await syncGoogleToLineworks(cancelled, 'u1', 'gcal', 'lwcal', 'u1');

    expect(lwCal.deleteEvent).toHaveBeenCalledWith('lwcal', 'u1', 'lw-existing', undefined);
    expect(firestore.deleteMapping).toHaveBeenCalledWith('g-1', 'u1');
  });

  it('skips when dedup says no sync needed', async () => {
    dedup.shouldSyncFromGoogle.mockResolvedValue({ sync: false, mapping: null });

    await syncGoogleToLineworks(baseEvent, 'u1', 'gcal', 'lwcal', 'u1');

    expect(lwCal.createEvent).not.toHaveBeenCalled();
    expect(lwCal.updateEvent).not.toHaveBeenCalled();
  });

  it('pushes to error queue on failure', async () => {
    dedup.shouldSyncFromGoogle.mockResolvedValue({ sync: true, mapping: null });
    lwCal.createEvent.mockRejectedValue(new Error('API error'));
    firestore.pushErrorQueue.mockResolvedValue(undefined);

    await syncGoogleToLineworks(baseEvent, 'u1', 'gcal', 'lwcal', 'u1');

    expect(firestore.pushErrorQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'google',
        eventId: 'g-1',
        action: 'create',
        error: 'API error',
      })
    );
  });

  it('skips delete when no mapping exists', async () => {
    dedup.shouldSyncFromGoogle.mockResolvedValue({ sync: true, mapping: null });
    const cancelled = { ...baseEvent, isCancelled: true };

    await syncGoogleToLineworks(cancelled, 'u1', 'gcal', 'lwcal', 'u1');

    expect(lwCal.deleteEvent).not.toHaveBeenCalled();
  });
});

describe('syncLineworksToGoogle', () => {
  const lwEvent: CalendarEvent = { ...baseEvent, id: 'lw-1' };

  afterEach(() => jest.resetAllMocks());

  it('creates a new event in Google when no mapping exists', async () => {
    dedup.shouldSyncFromLineworks.mockResolvedValue({ sync: true, mapping: null });
    googleCal.createEvent.mockResolvedValue({ ...lwEvent, id: 'g-new' });
    firestore.upsertMapping.mockResolvedValue(undefined);

    await syncLineworksToGoogle(lwEvent, 'u1', 'gcal', 'lwcal');

    expect(googleCal.createEvent).toHaveBeenCalledWith('gcal', expect.objectContaining({ id: '' }), undefined);
    expect(firestore.upsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        googleEventId: 'g-new',
        lineworksEventId: 'lw-1',
        lastSyncSource: 'lineworks',
      })
    );
  });

  it('updates an existing Google event when mapping exists', async () => {
    const mapping = {
      googleEventId: 'g-existing',
      lineworksEventId: 'lw-1',
      userId: 'u1',
      lastSyncHash: 'oldhash',
      lastSyncSource: 'lineworks',
      updatedAt: '',
    };
    dedup.shouldSyncFromLineworks.mockResolvedValue({ sync: true, mapping });
    googleCal.updateEvent.mockResolvedValue({ ...lwEvent, id: 'g-existing' });
    firestore.upsertMapping.mockResolvedValue(undefined);

    await syncLineworksToGoogle(lwEvent, 'u1', 'gcal', 'lwcal');

    expect(googleCal.updateEvent).toHaveBeenCalledWith('gcal', 'g-existing', expect.any(Object), undefined);
  });

  it('pushes to error queue on failure', async () => {
    dedup.shouldSyncFromLineworks.mockResolvedValue({ sync: true, mapping: null });
    googleCal.createEvent.mockRejectedValue(new Error('Network error'));
    firestore.pushErrorQueue.mockResolvedValue(undefined);

    await syncLineworksToGoogle(lwEvent, 'u1', 'gcal', 'lwcal');

    expect(firestore.pushErrorQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'lineworks',
        eventId: 'lw-1',
        action: 'create',
        error: 'Network error',
      })
    );
  });
});
