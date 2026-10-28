export type RunHealth = { state: "ok" } | { state: "degraded" | "failed"; reason: string };

export const RUN_OK: RunHealth = { state: "ok" };

const NAMED_LIMIT = 10;

function named(missed: readonly string[]): string {
  if (missed.length === 0) return "";
  const shown = missed.slice(0, NAMED_LIMIT).join(", ");
  const more = missed.length > NAMED_LIMIT ? ` and ${String(missed.length - NAMED_LIMIT)} more` : "";
  return `: ${shown}${more}`;
}

export function sweepHealth(counts: { failed: number; attempted: number; missed: readonly string[] }): RunHealth {
  if (counts.failed === 0) return RUN_OK;
  const reason = `${String(counts.failed)} of ${String(counts.attempted)} failed${named(counts.missed)}`;
  return { state: counts.failed * 2 >= counts.attempted ? "failed" : "degraded", reason };
}
