import { APP_LOCALE } from "./locale";
const SCORE_FORMAT = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 2, useGrouping: false });

export function formatScore(value: number): string {
  return SCORE_FORMAT.format(value);
}
