export function createConcurrencyLimiter({ maxConcurrency }: { maxConcurrency: number }) {
  let running = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (running >= maxConcurrency) {
      return;
    }

    queue.shift()?.();
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (running >= maxConcurrency) {
        await new Promise<void>((resolve) => {
          queue.push(resolve);
        });
      }

      running += 1;

      try {
        return await task();
      } finally {
        running -= 1;
        next();
      }
    },
  };
}
