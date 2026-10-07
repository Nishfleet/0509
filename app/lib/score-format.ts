const SCORE_FORMAT = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2, useGrouping: false });

export function formatScore(value: number): string {
  return SCORE_FORMAT.format(value);
}
