import { captureException } from "@sentry/cloudflare";

export function reportNightlyResults(results: readonly PromiseSettledResult<unknown>[]): void {
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const errors = failed.map((result) =>
    result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
  );
  for (const error of errors) captureException(error);
  if (errors.length === 0) return;
  throw new AggregateError(errors, `nightly jobs failed: ${String(errors.length)}`);
}
