const SKILL_CONCURRENCY = 8;

export async function runSkillTasks<T, U>(
  values: T[],
  worker: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value === undefined) continue;
      results[index] = await worker(value);
    }
  }

  const workers = Array.from({ length: Math.min(SKILL_CONCURRENCY, values.length) }, () =>
    runWorker(),
  );
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    const reason: unknown = failure.reason;
    if (reason instanceof Error) throw reason;
    throw new Error("skill task failed", { cause: reason });
  }
  return results;
}
