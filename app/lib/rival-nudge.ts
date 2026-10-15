export const NUDGE_AFTER_DAYS = 3;

export const NUDGE_WITHIN_DAYS = 14;

export const NUDGE_MAX_RIVALS = 2;

export function nudgeLine(rivals: number): string {
  if (rivals === 0)
    return "You are not watching a competitor yet. Add one and your next brief has someone to compare you with.";
  return "You are watching one competitor. Add another and your ranking has more to compare you with.";
}

export function nudgeSubject(rivals: number): string {
  return rivals === 0
    ? "Your brief has no competitor to compare you with yet"
    : "Your brief compares you with one competitor so far";
}
