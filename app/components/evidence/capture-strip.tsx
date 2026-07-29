/**
 * Capture-window helpers — brief §6.2.
 *
 * `buildCaptureWindow` and `trailingQuietRun` remain as DNA primitives for
 * P1 daily-surface packages even though CaptureStrip itself was deleted
 * during F3 guard hardening (zero app consumers after the P0 rebuild, and no
 * named package in the P1 backlog commits to mounting it).
 */

/**
 * `prewatch` is the only state the caller never supplies: it is the part of
 * the window that predates the watch itself. Those days are not gaps — there
 * was nothing to check yet — so they render as a void, carry no state word,
 * and are excluded from the quiet run (BL-006).
 */
export type CaptureDayState = "quiet" | "captured" | "unchecked" | "prewatch";

export interface CaptureDay {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  state: CaptureDayState;
}

export const CAPTURE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

function toUtcDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Expands a sparse list of checked days into the full right-aligned window.
 * Anything the caller did not report becomes an explicit `unchecked` slot —
 * except days before `startDate`, which predate the watch and become the
 * `prewatch` void. A one-day-old competitor must not be shown 29 slots
 * claiming "we did not check that day" for days it did not yet exist.
 */
export function buildCaptureWindow(
  days: readonly CaptureDay[],
  options: { endDate?: string; windowDays?: number; startDate?: string } = {},
): CaptureDay[] {
  const windowDays = Math.max(1, options.windowDays ?? CAPTURE_WINDOW_DAYS);
  const known = new Map<string, CaptureDayState>();
  for (const day of days) {
    if (toUtcDate(day.date)) known.set(day.date, day.state);
  }

  const explicitEnd = options.endDate ? toUtcDate(options.endDate) : null;
  const latestKnown = [...known.keys()].sort().at(-1);
  const end = explicitEnd ?? (latestKnown ? toUtcDate(latestKnown) : null);
  if (!end) return [];
  // A malformed start date is ignored rather than voiding the whole strip.
  const start = options.startDate ? toUtcDate(options.startDate.slice(0, 10)) : null;
  const startDay = start ? isoDay(start) : null;

  const window: CaptureDay[] = [];
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = isoDay(new Date(end.getTime() - offset * DAY_MS));
    const reported = known.get(date);
    // A reported day always wins: stored evidence outranks a start date.
    const state: CaptureDayState =
      reported ?? (startDay && date < startDay ? "prewatch" : "unchecked");
    window.push({ date, state });
  }
  return window;
}

/** How many unchecked slots at the newest edge count as "not yet" rather than
 *  as a gap. Exactly one: today, before that day's scan has run. */
export const CAPTURE_LEADING_SKIP_LIMIT = 1;

/**
 * Length of the trailing run of days we checked and found nothing.
 *
 * BL-006 decision (BL-005 left this open as known defect 4): exactly ONE
 * unchecked slot at the newest edge is skipped; every other unchecked day
 * terminates the run.
 *
 * - the newest slot is unchecked for most of every day simply because that
 *   day's scan has not run yet. That is "not yet", not a gap, and letting it
 *   terminate the run made the finding blink out and back every morning;
 * - two or more unchecked days at the edge is a paused competitor or a source
 *   outage, and a strip that skipped them would print "nothing has changed"
 *   over a watch that stopped watching. The skip is capped so it can only ever
 *   absorb today;
 * - an unchecked day between quiet days is a real hole in the evidence. We
 *   cannot say nothing changed on a day we did not look, so the run stops
 *   there and the sentence only ever counts days we actually checked
 *   (brief §8.1 — never estimate, never interpolate).
 *
 * `prewatch` days predate the watch and end the run: there is no claim to
 * make about a competitor we had not started watching.
 */
export function trailingQuietRun(window: readonly CaptureDay[]): number {
  let run = 0;
  let skipped = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const state = window[index].state;
    if (state === "quiet") {
      run += 1;
      continue;
    }
    if (state === "unchecked" && run === 0 && skipped < CAPTURE_LEADING_SKIP_LIMIT) {
      skipped += 1;
      continue;
    }
    break;
  }
  return run;
}
