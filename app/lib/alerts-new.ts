export function newSinceBriefLine(times: readonly string[], briefPeriodEnd: string | undefined): string | null {
  if (briefPeriodEnd === undefined) return null;
  const since = Date.parse(briefPeriodEnd);
  if (Number.isNaN(since)) return null;
  const count = times.filter((at) => Date.parse(at) > since).length;
  if (count === 0) return null;
  return `${String(count)} new since your last brief.`;
}
