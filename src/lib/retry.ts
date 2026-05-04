const RETRY_DELAY_MS = 150;

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
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
