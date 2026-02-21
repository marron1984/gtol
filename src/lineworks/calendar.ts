import axios, { AxiosInstance } from 'axios';
import { CalendarEvent } from '../types';
import { getLineworksAccessToken } from './auth';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

const BASE_URL = 'https://www.worksapis.com/v1.0';

const clientCache = new Map<string, AxiosInstance>();

async function getClient(refreshToken?: string): Promise<AxiosInstance> {
  const cacheKey = refreshToken ?? '__default__';
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Use interceptor to always set fresh token before each request
  client.interceptors.request.use(async (config) => {
    const token = await getLineworksAccessToken(refreshToken);
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  clientCache.set(cacheKey, client);
  return client;
}

// ---------------------------------------------------------------------------
// LINE WORKS Calendar API response types
// ---------------------------------------------------------------------------

interface LWEvent {
  eventId: string;
  eventType?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  status?: string;
}

interface LWEventList {
  events: LWEvent[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function toCalendarEvent(lw: LWEvent): CalendarEvent {
  const isAllDay = !lw.start.dateTime;
  return {
    id: lw.eventId,
    summary: lw.summary ?? '',
    description: lw.description ?? '',
    location: lw.location ?? '',
    startTime: (isAllDay ? lw.start.date : lw.start.dateTime) ?? '',
    endTime: (isAllDay ? lw.end.date : lw.end.dateTime) ?? '',
    isAllDay,
    isCancelled: lw.status === 'cancelled',
  };
}

function toLineworksEventBody(event: CalendarEvent): Record<string, unknown> {
  const start = event.isAllDay
    ? { date: event.startTime }
    : { dateTime: event.startTime };
  const end = event.isAllDay
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

/**
 * List events modified since `fromDateTime` (ISO 8601).
 * Uses the users/{userId}/calendar/events endpoint.
 */
export async function listRecentEvents(
  calendarId: string,
  userId: string,
  fromDateTime: string,
  refreshToken?: string
): Promise<CalendarEvent[]> {
  const client = await getClient(refreshToken);
  const events: CalendarEvent[] = [];
  let cursor: string | undefined;

  do {
    const res = await withRetry(
      () =>
        client.get<LWEventList>(`/users/${userId}/calendar/events`, {
          params: {
            calendarId,
            fromDateTime,
            count: 100,
            cursor,
          },
        }),
      'lineworks_list_events'
    );

    for (const item of res.data.events ?? []) {
      events.push(toCalendarEvent(item));
    }
    cursor = res.data.nextCursor;
  } while (cursor);

  return events;
}

/** Get a single event by ID. */
export async function getEvent(
  calendarId: string,
  userId: string,
  eventId: string,
  refreshToken?: string
): Promise<CalendarEvent | null> {
  const client = await getClient(refreshToken);
  try {
    const res = await withRetry(
      () => client.get<LWEvent>(`/users/${userId}/calendar/events/${eventId}`, {
        params: { calendarId },
      }),
      'lineworks_get_event'
    );
    return toCalendarEvent(res.data);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
}

/** Create a new event and return the created CalendarEvent. */
export async function createEvent(
  calendarId: string,
  userId: string,
  event: CalendarEvent,
  refreshToken?: string
): Promise<CalendarEvent> {
  const client = await getClient(refreshToken);
  const body = toLineworksEventBody(event);
  try {
    const res = await withRetry(
      () =>
        client.post<LWEvent>(
          `/users/${userId}/calendar/events`,
          body,
          { params: { calendarId } }
        ),
      'lineworks_create_event'
    );

    logger.info('lineworks_event_created', {
      eventId: res.data.eventId,
      source: 'lineworks',
    });

    return toCalendarEvent(res.data);
  } catch (err) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; config?: { url?: string } };
    logger.error('lineworks_create_event_detail', err, {
      details: {
        url: `/users/${userId}/calendar/events`,
        calendarId,
        requestBody: body,
        responseStatus: axiosErr.response?.status,
        responseBody: axiosErr.response?.data,
      },
    });
    throw err;
  }
}

/** Update an existing event. */
export async function updateEvent(
  calendarId: string,
  userId: string,
  eventId: string,
  event: CalendarEvent,
  refreshToken?: string
): Promise<CalendarEvent> {
  const client = await getClient(refreshToken);
  const res = await withRetry(
    () =>
      client.put<LWEvent>(
        `/users/${userId}/calendar/events/${eventId}`,
        toLineworksEventBody(event),
        { params: { calendarId } }
      ),
    'lineworks_update_event'
  );

  logger.info('lineworks_event_updated', {
    eventId: res.data.eventId,
    source: 'lineworks',
  });

  return toCalendarEvent(res.data);
}

/** Delete an event. */
export async function deleteEvent(
  calendarId: string,
  userId: string,
  eventId: string,
  refreshToken?: string
): Promise<void> {
  const client = await getClient(refreshToken);
  await withRetry(
    () =>
      client.delete(`/users/${userId}/calendar/events/${eventId}`, {
        params: { calendarId },
      }),
    'lineworks_delete_event'
  );

  logger.info('lineworks_event_deleted', { eventId, source: 'lineworks' });
}
