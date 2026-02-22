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

/** Initial sync progress stored in Firestore for dashboard monitoring. */
export interface SyncStatus {
  userId: string;
  /** 'running' | 'completed' | 'failed' */
  status: 'running' | 'completed' | 'failed';
  phase: 1 | 2;
  /** Cumulative successes for Google → LW */
  googleToLw: number;
  /** Cumulative successes for LW → Google */
  lwToGoogle: number;
  /** Total events to sync in current phase */
  phaseTotal: number;
  /** Failed events in current phase */
  phaseFailed: number;
  /** ISO 8601 – when the sync started */
  startedAt: string;
  /** ISO 8601 – last progress update */
  updatedAt: string;
  /** Error message if status === 'failed' */
  error?: string;
}

/** Per-user configuration stored in Firestore. */
export interface UserConfig {
  userId: string;
  googleCalendarId: string;
  googleRefreshToken: string;
  lineworksCalendarId: string;
  /** LINE WORKS user ID used in API paths (e.g. "syoshida@aaworks"). Falls back to lineworksCalendarId if not set. */
  lineworksUserId?: string;
  lineworksRefreshToken: string;
}
