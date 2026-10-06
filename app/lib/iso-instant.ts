export function toIsoInstant(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
