/** Normalized calendar event used internally by the sync engine. */
export interface CalendarEvent {
  /** Original event ID from the source platform */
  id: string;
  summary: string;
  description: string;
  location: string;
  /** ISO 8601 datetime string, or date string (YYYY-MM-DD) for all-day events */
  startTime: string;
  /** ISO 8601 datetime string, or date string (YYYY-MM-DD) for all-day events */
  endTime: string;
  isAllDay: boolean;
  /** Event has been cancelled / deleted */
  isCancelled: boolean;
}

/** A mapping row stored in Firestore that links events across platforms. */
export interface EventMapping {
  googleEventId: string;
  lineworksEventId: string;
  userId: string;
  /** Hash of the event content at time of last sync, used for change detection */
  lastSyncHash: string;
  /** Which side triggered the most recent sync */
  lastSyncSource: 'google' | 'lineworks';
  updatedAt: string;
}

/** Per-user configuration stored in Firestore. */
export interface UserConfig {
  userId: string;
  googleCalendarId: string;
  googleRefreshToken: string;
  lineworksCalendarId: string;
  lineworksRefreshToken: string;
}
