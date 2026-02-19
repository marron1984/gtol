import { CalendarEvent } from '../types';
import * as crypto from 'crypto';

/**
 * Compute a deterministic hash of the syncable fields of an event.
 * Used to detect whether an event has actually changed since the last sync.
 */
export function computeEventHash(event: CalendarEvent): string {
  const payload = JSON.stringify({
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    isAllDay: event.isAllDay,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Map a CalendarEvent from one platform representation to the other.
 * Since our CalendarEvent is already a normalised intermediate format,
 * this simply clones the event and strips the source-specific ID.
 */
export function mapEvent(source: CalendarEvent): CalendarEvent {
  return {
    ...source,
    id: '', // will be filled by the target platform on create
  };
}
