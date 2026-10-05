export async function tryWhile<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (err: unknown, nextAttempt: number) => boolean,
): Promise<T> {
  const baseDelayMs = 100;
  const maxDelayMs = 3000;
  let attempt = 1;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt += 1;
      if (!isRetryable(err, attempt)) {
        throw err;
      }
      const delay = jitterBackoff(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function jitterBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const attemptUpperBoundMs = Math.min(2 ** attempt * baseDelayMs, maxDelayMs);
  return Math.floor(Math.random() * attemptUpperBoundMs);
}

export function shouldRetryD1(err: unknown, nextAttempt: number): boolean {
  const errMsg = String(err);
  const isRetryableError =
    errMsg.includes("Network connection lost") ||
    errMsg.includes("storage caused object to be reset") ||
    errMsg.includes("reset because its code was updated");
  if (nextAttempt <= 5 && isRetryableError) {
    return true;
  }
  return false;
}
