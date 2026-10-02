const DAY_MS = 86_400_000;

export function isTrialing(input: {
  createdAt: string | null | undefined;
  nextBillingDate: string | null | undefined;
  trialDays: number | null | undefined;
}): boolean {
  if (input.trialDays === null || input.trialDays === undefined || input.trialDays <= 0) return false;
  const created = Date.parse(input.createdAt ?? "");
  const next = Date.parse(input.nextBillingDate ?? "");
  if (Number.isNaN(created) || Number.isNaN(next)) return false;
  return next <= created + input.trialDays * DAY_MS;
}
