import { logger } from './logger';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Do not retry client errors (4xx) – they are permanent failures
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status !== undefined && status >= 400 && status < 500) {
        const responseData = (error as { response?: { data?: unknown } }).response?.data;
        logger.error(`${label} (non-retryable ${status})`, error, {
          details: { responseBody: responseData },
        });
        throw error;
      }

      if (attempt < opts.maxRetries) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt);
        logger.error(`${label} (attempt ${attempt + 1}/${opts.maxRetries + 1})`, error, {
          details: { retryIn: `${delay}ms` },
        });
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
