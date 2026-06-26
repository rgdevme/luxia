/**
 * Wrap a hook invocation so any thrown error is re-thrown with structured
 * context (label) attached. Preserves the original error as `.cause`.
 *
 * Used at every hook call site in the orchestrator and event dispatchers so a
 * failing hook reports which agent/domain/event it came from.
 */
export async function runHook(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} failed: ${message}`, { cause: err });
  }
}
