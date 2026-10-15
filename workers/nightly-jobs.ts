import { captureException } from "@sentry/cloudflare";

import { checkStuckWebhooks } from "../app/lib/billing/stuck-webhooks.server";
import { deleteExpiredAuthRows } from "../app/lib/data/auth_expiry.server";
import { deleteExpiredJevFailures } from "../app/lib/data/jev_failure.server";
import { backfillChangeExcerpts } from "../app/lib/site/backfill-excerpts.server";
import { checkSilentRivals } from "../app/lib/site/silent-rivals.server";

export function nightlyDataChecks(db: D1Database, now: Date): Promise<unknown>[] {
  return [
    deleteExpiredAuthRows(db, now),
    deleteExpiredJevFailures(db, now),
    checkStuckWebhooks(db, now),
    checkSilentRivals(now),
    backfillChangeExcerpts(),
  ];
}

export function reportNightlyResults(results: readonly PromiseSettledResult<unknown>[]): void {
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const errors = failed.map((result) =>
    result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
  );
  for (const error of errors) captureException(error);
  if (errors.length === 0) return;
  throw new AggregateError(errors, `nightly jobs failed: ${String(errors.length)}`);
}
