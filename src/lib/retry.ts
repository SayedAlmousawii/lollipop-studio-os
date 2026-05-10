const RETRY_DELAY_MS = 150;

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
  shouldRetry?: (err: unknown) => boolean
): Promise<T> {
  if (!Number.isFinite(attempts) || !Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`withRetry: attempts must be a finite positive integer, got ${attempts}`);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (shouldRetry && !shouldRetry(err)) throw err;
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt)
        );
      }
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label}: ${message}`);
}
