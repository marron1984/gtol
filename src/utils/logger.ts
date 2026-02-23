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

function pushToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
}

/** Return the most recent log entries (newest first). */
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
    console.log(formatLog(entry));
  },
};
