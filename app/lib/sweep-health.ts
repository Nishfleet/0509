export function sweepFailure(counts: { failed: number; attempted: number }): string | null {
  if (counts.failed === 0 || counts.failed * 2 < counts.attempted) return null;
  return `${String(counts.failed)} of ${String(counts.attempted)} failed`;
}
