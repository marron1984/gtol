import { shouldSyncFromGoogle, shouldSyncFromLineworks } from '../sync/dedup';
import { CalendarEvent, EventMapping } from '../types';
import { computeEventHash } from '../sync/mapper';

// Mock Firestore
jest.mock('../db/firestore', () => ({
  getMappingByGoogleId: jest.fn(),
  getMappingByLineworksId: jest.fn(),
}));

const { getMappingByGoogleId, getMappingByLineworksId } = jest.requireMock('../db/firestore');

const baseEvent: CalendarEvent = {
  id: 'g-100',
  summary: 'Meeting',
  description: 'Notes',
  location: 'Room B',
  startTime: '2026-02-20T09:00:00+09:00',
  endTime: '2026-02-20T10:00:00+09:00',
  isAllDay: false,
  isCancelled: false,
};

function makeMapping(overrides: Partial<EventMapping> = {}): EventMapping {
  return {
    googleEventId: 'g-100',
    lineworksEventId: 'lw-200',
    userId: 'user1',
    lastSyncHash: computeEventHash(baseEvent),
    lastSyncSource: 'google',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('shouldSyncFromGoogle', () => {
  afterEach(() => jest.resetAllMocks());

  it('syncs new events (no mapping)', async () => {
    getMappingByGoogleId.mockResolvedValue(null);
    const result = await shouldSyncFromGoogle(baseEvent, 'user1');
    expect(result.sync).toBe(true);
    expect(result.mapping).toBeNull();
  });

  it('skips echo from lineworks (same hash, lastSyncSource=lineworks)', async () => {
    getMappingByGoogleId.mockResolvedValue(makeMapping({ lastSyncSource: 'lineworks' }));
    const result = await shouldSyncFromGoogle(baseEvent, 'user1');
    expect(result.sync).toBe(false);
  });

  it('syncs when content changed after lineworks sync', async () => {
    getMappingByGoogleId.mockResolvedValue(makeMapping({ lastSyncSource: 'lineworks' }));
    const modified = { ...baseEvent, summary: 'Updated Meeting' };
    const result = await shouldSyncFromGoogle(modified, 'user1');
    expect(result.sync).toBe(true);
  });

  it('skips when hash unchanged (lastSyncSource=google)', async () => {
    getMappingByGoogleId.mockResolvedValue(makeMapping({ lastSyncSource: 'google' }));
    const result = await shouldSyncFromGoogle(baseEvent, 'user1');
    expect(result.sync).toBe(false);
  });

  it('syncs when hash changed (lastSyncSource=google)', async () => {
    getMappingByGoogleId.mockResolvedValue(makeMapping({ lastSyncSource: 'google' }));
    const modified = { ...baseEvent, location: 'Room C' };
    const result = await shouldSyncFromGoogle(modified, 'user1');
    expect(result.sync).toBe(true);
  });
});

describe('shouldSyncFromLineworks', () => {
  const lwEvent: CalendarEvent = { ...baseEvent, id: 'lw-200' };

  afterEach(() => jest.resetAllMocks());

  it('syncs new events (no mapping)', async () => {
    getMappingByLineworksId.mockResolvedValue(null);
    const result = await shouldSyncFromLineworks(lwEvent, 'user1');
    expect(result.sync).toBe(true);
    expect(result.mapping).toBeNull();
  });

  it('skips echo from google (same hash, lastSyncSource=google)', async () => {
    const mapping = makeMapping({ lastSyncSource: 'google' });
    // Use the hash of lwEvent (same content as baseEvent, so same hash)
    getMappingByLineworksId.mockResolvedValue(mapping);
    const result = await shouldSyncFromLineworks(lwEvent, 'user1');
    expect(result.sync).toBe(false);
  });

  it('syncs when content changed after google sync', async () => {
    getMappingByLineworksId.mockResolvedValue(makeMapping({ lastSyncSource: 'google' }));
    const modified = { ...lwEvent, summary: 'Updated' };
    const result = await shouldSyncFromLineworks(modified, 'user1');
    expect(result.sync).toBe(true);
  });
});
