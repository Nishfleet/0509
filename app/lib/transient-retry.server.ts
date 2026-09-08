/**
 * Bounded transient-retry for money-path reads (issue #2001).
 *
 * The money path (the /search selected-result step and the /ads/:domain
 * cohort) intermittently answered 5xx (and, on /ads, a spurious
 * cache-miss 301) under cold-instance / burst conditions: a single
 * transient D1/KV read hiccup inside an awaited loader step propagated
 * as a hard failure for that request. The cause is not deterministically
 * reproducible, so per the issue's acceptance this ships the bounded
 * fallback: one extra attempt with a short backoff, applied only to
 * read-shaped steps whose failure is transient (platform/storage errors),
 * never to route-level decisions (a 404 stays a 404).
 */

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 150;

/** Upper bound on the sleep between attempts — keeps loader p95 sane. */
const MAX_BACKOFF_MS = 500;

export interface TransientRetryOptions {
  maxAttempts?: number;
  backoffMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
}

/**
 * Heuristic: does this thrown value look like a transient platform/storage
 * failure (D1, KV, DO, network) rather than an application-level rejection
 * (a thrown Response, a 4xx-shaped Error)? Only transient-looking failures
 * are retried; everything else rethrows on the first attempt untouched.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Response) return false;
  if (error instanceof Error) {
    const name = error.name ?? "";
    if (name === "AbortError" || name === "TimeoutError") return false;
    const transientNames = ["D1Error", "D1__ERROR", "NetworkError"];
    if (transientNames.includes(name)) return true;
    const message = error.message ?? "";
    // Deliberately NOT matching bare `TypeError` by name: an application bug
    // surfacing as TypeError would silently retry. Match the network-shape
    // messages it carries instead ("Failed to fetch", connection reset).
    return /d1|kv|do storage|internal error|failed to fetch|econnreset|connection reset|network|temporarily|storage/i.test(
      message,
    );
  }
  // Non-Error throwables (strings, objects) from platform internals are
  // treated as transient: the retry is bounded anyway.
  return true;
}

/**
 * Run `fn` with up to `maxAttempts` total attempts. Retries only when the
 * thrown value looks transient (isTransientError); the last attempt's error
 * is rethrown unchanged so the caller's existing error UX owns the response.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: TransientRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const backoffMs = Math.min(
    Math.max(0, options.backoffMs ?? DEFAULT_BACKOFF_MS),
    MAX_BACKOFF_MS,
  );
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientError(error)) {
        throw error;
      }
      await sleepImpl(backoffMs);
    }
  }
  throw lastError;
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
