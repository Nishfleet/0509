/**
 * Continuous scheduled-monitoring coverage: whole days between the earliest
 * activation baseline and the as-of instant. A truthful figure derived from
 * real schedule data, not a fabricated uptime percentage.
 *
 * Pure and client-safe on purpose (issue #2972): the /status route renders
 * it during hydration and the marketing footer receives only the resolved
 * number, so this math must live outside the `.server.ts` modules.
 */
export function monitoringCoverageDays(
  sinceIso: string | null,
  asOfIso: string,
): number | null {
  if (!sinceIso) return null;
  const since = new Date(sinceIso).getTime();
  const asOf = new Date(asOfIso).getTime();
  if (!Number.isFinite(since) || !Number.isFinite(asOf) || asOf < since) return null;
  return Math.floor((asOf - since) / (24 * 60 * 60 * 1000));
}
