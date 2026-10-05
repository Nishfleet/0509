import { captureException } from "@sentry/cloudflare";

export function reportNightlyResults(results: readonly PromiseSettledResult<unknown>[]): void {
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  for (const result of failed) captureException(result.reason);
  if (failed.length === 0) return;
  throw new AggregateError(
    failed.map((result) => result.reason),
    `nightly jobs failed: ${String(failed.length)}`,
  );
}
