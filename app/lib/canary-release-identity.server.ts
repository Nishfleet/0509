import type { AppEnv } from "~/lib/env.server";

export const EXPECTED_WORKER_VERSION_HEADER = "x-0509-expected-worker-version";

const SAFE_VERSION_ID = /^[A-Za-z0-9._-]{1,128}$/u;

/**
 * A missing header preserves ordinary route behavior. Gate-C callers always
 * send it; when present, reject drift before any database or provider work.
 */
export function verifyExpectedCanaryWorkerVersion(request: Request, env: AppEnv) {
  const expected = request.headers.get(EXPECTED_WORKER_VERSION_HEADER);
  if (expected === null) return { requested: false, ok: true } as const;
  const actual = env.CF_VERSION_METADATA?.id?.trim() ?? "";
  const normalizedExpected = expected.trim();
  return {
    requested: true,
    ok:
      SAFE_VERSION_ID.test(normalizedExpected) &&
      SAFE_VERSION_ID.test(actual) &&
      normalizedExpected === actual,
  } as const;
}
