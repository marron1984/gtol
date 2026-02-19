export interface LogEntry {
  timestamp: string;
  action: string;
  eventId?: string;
  source?: 'google' | 'lineworks';
  status: 'success' | 'failure' | 'skipped';
  error?: string;
  details?: Record<string, unknown>;
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
    console.error(formatLog(entry));
  },

  skip(action: string, details?: Partial<Omit<LogEntry, 'timestamp' | 'action' | 'status'>>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      action,
      status: 'skipped',
      ...details,
    };
    console.log(formatLog(entry));
  },
};
