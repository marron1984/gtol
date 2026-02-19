import { google, calendar_v3 } from 'googleapis';
import { CalendarEvent } from '../types';
import { getGoogleOAuth2Client } from './auth';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

function getCalendarClient(refreshToken?: string): calendar_v3.Calendar {
  const auth = getGoogleOAuth2Client(refreshToken);
  return google.calendar({ version: 'v3', auth });
}

/** Convert a Google Calendar event to the internal CalendarEvent format. */
function toCalendarEvent(ge: calendar_v3.Schema$Event): CalendarEvent {
  const isAllDay = !ge.start?.dateTime;
  return {
    id: ge.id ?? '',
    summary: ge.summary ?? '',
    description: ge.description ?? '',
    location: ge.location ?? '',
    startTime: (isAllDay ? ge.start?.date : ge.start?.dateTime) ?? '',
    endTime: (isAllDay ? ge.end?.date : ge.end?.dateTime) ?? '',
    isAllDay,
    isCancelled: ge.status === 'cancelled',
  };
}

/** Convert internal CalendarEvent to a Google Calendar event resource. */
function toGoogleEventResource(event: CalendarEvent): calendar_v3.Schema$Event {
  const start: calendar_v3.Schema$EventDateTime = event.isAllDay
    ? { date: event.startTime }
    : { dateTime: event.startTime };
  const end: calendar_v3.Schema$EventDateTime = event.isAllDay
    ? { date: event.endTime }
    : { dateTime: event.endTime };

  return {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start,
    end,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List events modified since `updatedMin` (ISO 8601). */
export async function listRecentEvents(
  calendarId: string,
  updatedMin: string,
  refreshToken?: string
): Promise<CalendarEvent[]> {
  const cal = getCalendarClient(refreshToken);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const res = await withRetry(
      () =>
        cal.events.list({
          calendarId,
          updatedMin,
          showDeleted: true,
          singleEvents: true,
          orderBy: 'updated',
          maxResults: 250,
          pageToken,
        }),
      'google_list_events'
    );

    for (const item of res.data.items ?? []) {
      events.push(toCalendarEvent(item));
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return events;
}

/** Get a single event by ID. */
export async function getEvent(
  calendarId: string,
  eventId: string,
  refreshToken?: string
): Promise<CalendarEvent | null> {
  const cal = getCalendarClient(refreshToken);
  try {
    const res = await withRetry(
      () => cal.events.get({ calendarId, eventId }),
      'google_get_event'
    );
    return toCalendarEvent(res.data);
  } catch (err: unknown) {
    const status = (err as { code?: number }).code;
    if (status === 404 || status === 410) return null;
    throw err;
  }
}

/** Create a new event and return the created CalendarEvent. */
export async function createEvent(
  calendarId: string,
  event: CalendarEvent,
  refreshToken?: string
): Promise<CalendarEvent> {
  const cal = getCalendarClient(refreshToken);
  const res = await withRetry(
    () =>
      cal.events.insert({
        calendarId,
        requestBody: toGoogleEventResource(event),
      }),
    'google_create_event'
  );

  logger.info('google_event_created', {
    eventId: res.data.id ?? undefined,
    source: 'google',
  });

  return toCalendarEvent(res.data);
}

/** Update an existing event. */
export async function updateEvent(
  calendarId: string,
  eventId: string,
  event: CalendarEvent,
  refreshToken?: string
): Promise<CalendarEvent> {
  const cal = getCalendarClient(refreshToken);
  const res = await withRetry(
    () =>
      cal.events.update({
        calendarId,
        eventId,
        requestBody: toGoogleEventResource(event),
      }),
    'google_update_event'
  );

  logger.info('google_event_updated', {
    eventId: res.data.id ?? undefined,
    source: 'google',
  });

  return toCalendarEvent(res.data);
}

/** Delete (cancel) an event. */
export async function deleteEvent(
  calendarId: string,
  eventId: string,
  refreshToken?: string
): Promise<void> {
  const cal = getCalendarClient(refreshToken);
  await withRetry(
    () => cal.events.delete({ calendarId, eventId }),
    'google_delete_event'
  );

  logger.info('google_event_deleted', { eventId, source: 'google' });
}

// ---------------------------------------------------------------------------
// Watch (Push notification) channel management
// ---------------------------------------------------------------------------

/**
 * Start a watch channel for the given calendar.
 * Returns the channel ID and resource ID needed to stop the channel later.
 * The channel expires after `ttlMs` (default: 7 days minus 1 hour as safety margin).
 */
export async function startWatch(
  calendarId: string,
  webhookUrl: string,
  refreshToken?: string,
  ttlMs: number = 6 * 24 * 60 * 60 * 1000 // ~6 days
): Promise<{ channelId: string; resourceId: string; expiration: string }> {
  const cal = getCalendarClient(refreshToken);
  const channelId = `cal-sync-${Date.now()}`;
  const expiration = Date.now() + ttlMs;

  const res = await withRetry(
    () =>
      cal.events.watch({
        calendarId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: webhookUrl,
          expiration: String(expiration),
        },
      }),
    'google_start_watch'
  );

  logger.info('google_watch_started', {
    details: {
      channelId,
      resourceId: res.data.resourceId,
      expiration: new Date(expiration).toISOString(),
    },
  });

  return {
    channelId,
    resourceId: res.data.resourceId ?? '',
    expiration: new Date(expiration).toISOString(),
  };
}

/** Stop an existing watch channel. */
export async function stopWatch(
  channelId: string,
  resourceId: string,
  refreshToken?: string
): Promise<void> {
  const cal = getCalendarClient(refreshToken);
  await withRetry(
    () =>
      cal.channels.stop({
        requestBody: { id: channelId, resourceId },
      }),
    'google_stop_watch'
  );

  logger.info('google_watch_stopped', {
    details: { channelId, resourceId },
  });
}
