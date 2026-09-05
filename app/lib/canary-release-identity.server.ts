import type { AppEnv } from "~/lib/env.server";

export const EXPECTED_WORKER_VERSION_HEADER = "x-0509-expected-worker-version";

const SAFE_VERSION_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const SAFE_MODE = /^[a-z0-9_-]{1,32}$/u;

function normalizeIdentifier(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return SAFE_VERSION_ID.test(normalized) ? normalized : null;
}

function normalizeTimestamp(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return SAFE_TIMESTAMP.test(normalized) && !Number.isNaN(Date.parse(normalized))
    ? normalized
    : null;
}

function normalizeMode(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SAFE_MODE.test(normalized) ? normalized : null;
}

export function readReleaseIdentity(env: AppEnv) {
  return {
    workerVersionId: normalizeIdentifier(env.CF_VERSION_METADATA?.id),
    tag: normalizeIdentifier(env.CF_VERSION_METADATA?.tag),
    timestamp: normalizeTimestamp(env.CF_VERSION_METADATA?.timestamp),
    searchRolloutMode: normalizeMode(env.SEARCH_ROLLOUT_MODE),
  };
}

/**
 * A missing header preserves ordinary route behavior. Gate-C callers always
 * send it; when present, reject drift before any database or provider work.
 */
export function verifyExpectedCanaryWorkerVersion(request: Request, env: AppEnv) {
  const expected = request.headers.get(EXPECTED_WORKER_VERSION_HEADER);
  if (expected === null) return { requested: false, ok: true } as const;
  const actual = readReleaseIdentity(env).workerVersionId ?? "";
  const normalizedExpected = expected.trim();
  return {
    requested: true,
    ok:
      SAFE_VERSION_ID.test(normalizedExpected) &&
      SAFE_VERSION_ID.test(actual) &&
      normalizedExpected === actual,
  } as const;
}
