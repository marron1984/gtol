export interface LogEntry {
  timestamp: string;
  action: string;
  eventId?: string;
  source?: 'google' | 'lineworks';
  status: 'success' | 'failure' | 'skipped';
  error?: string;
  details?: Record<string, unknown>;
}

const MAX_LOG_BUFFER = 200;
const logBuffer: LogEntry[] = [];

// ---------------------------------------------------------------------------
// Firestore persistence (fire-and-forget)
// ---------------------------------------------------------------------------
const SYNC_LOGS_COLLECTION = 'sync_logs';
let firestoreEnabled = true;

function persistToFirestore(entry: LogEntry): void {
  if (!firestoreEnabled) return;
  try {
    // Lazy require to avoid circular dependency (firestore.ts → logger.ts)
    const { getFirestore } = require('../db/firestore') as typeof import('../db/firestore');
    const db = getFirestore();
    db.collection(SYNC_LOGS_COLLECTION)
      .add(entry)
      .catch(() => {
        // Temporarily disable on write failure, re-enable after 60s
        firestoreEnabled = false;
        setTimeout(() => { firestoreEnabled = true; }, 60_000);
      });
  } catch {
    // Ignore errors during Firestore initialization
  }
}

// ---------------------------------------------------------------------------
// In-memory buffer
// ---------------------------------------------------------------------------

function pushToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
}

/** Return the most recent log entries (newest first) from the in-memory buffer. */
export function getRecentLogs(limit = 100): LogEntry[] {
  return logBuffer.slice(-limit).reverse();
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export const logger = {
  info(action: string, details?: Partial<Omit<LogEntry, 'timestamp' | 'action' | 'status'>>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      action,
      status: 'success',
      ...details,
    };
    pushToBuffer(entry);
    persistToFirestore(entry);
    console.log(formatLog(entry));
  },

  error(action: string, error: unknown, details?: Partial<Omit<LogEntry, 'timestamp' | 'action' | 'status' | 'error'>>) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      action,
      status: 'failure',
      error: errorMessage,
      ...details,
    };
    pushToBuffer(entry);
    persistToFirestore(entry);
    console.error(formatLog(entry));
  },

  skip(action: string, details?: Partial<Omit<LogEntry, 'timestamp' | 'action' | 'status'>>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      action,
      status: 'skipped',
      ...details,
    };
    pushToBuffer(entry);
    persistToFirestore(entry);
    console.log(formatLog(entry));
  },
};
