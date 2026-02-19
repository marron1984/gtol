import { withRetry } from '../utils/retry';

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, 'test', { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, 'test', { maxRetries: 2, baseDelayMs: 1 })
    ).rejects.toThrow('always fails');

    // 1 initial + 2 retries = 3 attempts
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff delays', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await withRetry(fn, 'test', { maxRetries: 3, baseDelayMs: 10 });
    const elapsed = Date.now() - start;

    // baseDelayMs=10: first retry 10ms, second 20ms → at least ~30ms
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
