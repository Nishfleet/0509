export function competitorCountLine(watching: number, cap: number): string {
  const noun = cap === 1 ? "competitor" : "competitors";
  if (watching >= cap) return `Watching ${String(watching)} of ${String(cap)} ${noun}. Your plan is full.`;
  return `Watching ${String(watching)} of ${String(cap)} ${noun} on your plan.`;
}
