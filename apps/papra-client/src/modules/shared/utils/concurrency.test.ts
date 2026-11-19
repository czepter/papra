import { describe, expect, test } from 'vitest';
import { createConcurrencyLimiter } from './concurrency';

describe('createConcurrencyLimiter', () => {
  test('never runs more tasks at once than the limit and runs queued tasks in order', async () => {
    const limiter = createConcurrencyLimiter({ maxConcurrency: 2 });
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];

    const task = (id: number) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      order.push(id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return id;
    };

    const results = await Promise.all([1, 2, 3, 4, 5].map(async (id) => limiter.run(task(id))));

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxRunning).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  test('a failing task releases its slot', async () => {
    const limiter = createConcurrencyLimiter({ maxConcurrency: 1 });

    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await limiter.run(async () => 'ok')).toBe('ok');
  });
});
