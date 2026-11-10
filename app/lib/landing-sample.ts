const LANDING_SAMPLE_MAX_AGE_DAYS = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LandingSample {
  readonly weekStartAt: string;
  readonly html: string;
}

export function isStaleLandingSample(weekStartAt: string, now: number): boolean {
  const startedAt = Date.parse(weekStartAt);
  if (Number.isNaN(startedAt)) return true;
  return now - startedAt > LANDING_SAMPLE_MAX_AGE_DAYS * DAY_MS;
}
