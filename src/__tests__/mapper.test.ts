import { computeEventHash, mapEvent } from '../sync/mapper';
import { CalendarEvent } from '../types';

const baseEvent: CalendarEvent = {
  id: 'g-123',
  summary: 'Team Meeting',
  description: 'Weekly standup',
  location: 'Room A',
  startTime: '2026-02-20T10:00:00+09:00',
  endTime: '2026-02-20T11:00:00+09:00',
  isAllDay: false,
  isCancelled: false,
};

describe('computeEventHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = computeEventHash(baseEvent);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic', () => {
    expect(computeEventHash(baseEvent)).toBe(computeEventHash(baseEvent));
  });

  it('changes when a syncable field changes', () => {
    const original = computeEventHash(baseEvent);
    const modified = computeEventHash({ ...baseEvent, summary: 'Changed' });
    expect(modified).not.toBe(original);
  });

  it('ignores id, isCancelled', () => {
    const a = computeEventHash(baseEvent);
    const b = computeEventHash({ ...baseEvent, id: 'other-id', isCancelled: true });
    expect(a).toBe(b);
  });

  it('differentiates all-day vs timed events with same times', () => {
    const allDay = computeEventHash({ ...baseEvent, isAllDay: true });
    const timed = computeEventHash({ ...baseEvent, isAllDay: false });
    expect(allDay).not.toBe(timed);
  });
});

describe('mapEvent', () => {
  it('strips the id', () => {
    const mapped = mapEvent(baseEvent);
    expect(mapped.id).toBe('');
  });

  it('preserves all other fields', () => {
    const mapped = mapEvent(baseEvent);
    expect(mapped.summary).toBe(baseEvent.summary);
    expect(mapped.description).toBe(baseEvent.description);
    expect(mapped.location).toBe(baseEvent.location);
    expect(mapped.startTime).toBe(baseEvent.startTime);
    expect(mapped.endTime).toBe(baseEvent.endTime);
    expect(mapped.isAllDay).toBe(baseEvent.isAllDay);
    expect(mapped.isCancelled).toBe(baseEvent.isCancelled);
  });

  it('does not mutate the source event', () => {
    const original = { ...baseEvent };
    mapEvent(baseEvent);
    expect(baseEvent).toEqual(original);
  });
});
