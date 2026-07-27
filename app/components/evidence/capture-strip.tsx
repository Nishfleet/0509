/**
 * Capture strip — brief §6.2 (R7 base/compare framing, R2 mixed weights).
 *
 * A row of 9px bars, 34px tall, right-aligned to today. The strip is the
 * thing an agency reads at a glance, so it is honest by construction: a day
 * we did not check renders as a LABELLED dashed gap, never as a silent
 * absence and never as a short "nothing changed" bar.
 *
 * Colour is never the only channel (brief §10) — each bar names its state in
 * words via title/aria-label, and the legend is one mono line in product
 * voice underneath.
 */

export type CaptureDayState = "quiet" | "captured" | "waiting" | "unchecked";

export interface CaptureDay {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  state: CaptureDayState;
}

export const CAPTURE_WINDOW_DAYS = 30;

/** A quiet run at least this long is stated as a finding, not left implicit. */
export const CAPTURE_QUIET_RUN_THRESHOLD = 7;

export const CAPTURE_STRIP_LEGEND =
  "Short bar = checked, nothing changed. Tall bar = a change we captured. Green = waiting on you.";

export const CAPTURE_STRIP_GAP_LEGEND = "A dashed slot means we did not check that day.";

const STATE_WORDS: Record<CaptureDayState, string> = {
  quiet: "checked, nothing changed",
  captured: "a change we captured",
  waiting: "a change waiting on you",
  unchecked: "we did not check that day",
};

const DAY_MS = 86_400_000;

function toUtcDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * Expands a sparse list of checked days into the full right-aligned window.
 * Anything the caller did not report becomes an explicit `unchecked` slot.
 */
export function buildCaptureWindow(
  days: readonly CaptureDay[],
  options: { endDate?: string; windowDays?: number } = {},
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

  const window: CaptureDay[] = [];
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = isoDay(new Date(end.getTime() - offset * DAY_MS));
    window.push({ date, state: known.get(date) ?? "unchecked" });
  }
  return window;
}

/**
 * Length of the trailing run of days we checked and found nothing.
 *
 * BL-006 decision (BL-005 left this open as known defect 4): an unchecked day
 * at the LEADING edge is skipped, an unchecked day INSIDE the run terminates
 * it. The two positions mean different things:
 *
 * - the newest slot is unchecked for most of every day, simply because that
 *   day's scan has not run yet. That is "not yet", not a gap, and letting it
 *   terminate the run made the finding blink out and back every morning;
 * - an unchecked day between quiet days is a real hole in the evidence. We
 *   cannot say nothing changed on a day we did not look, so the run stops
 *   there and the sentence only ever counts days we actually checked
 *   (brief §8.1 — never estimate, never interpolate).
 */
export function trailingQuietRun(window: readonly CaptureDay[]): number {
  let run = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const state = window[index].state;
    if (state === "captured" || state === "waiting") break;
    if (state === "quiet") {
      run += 1;
      continue;
    }
    // unchecked
    if (run === 0) continue;
    break;
  }
  return run;
}

export function CaptureStrip({
  days,
  endDate,
  windowDays = CAPTURE_WINDOW_DAYS,
  quietRunLabel,
  className,
}: {
  days: readonly CaptureDay[];
  endDate?: string;
  windowDays?: number;
  /** Overrides the derived "nothing has changed" finding sentence. */
  quietRunLabel?: string;
  className?: string;
}) {
  const window = buildCaptureWindow(days, { endDate, windowDays });
  if (window.length === 0) return null;

  const hasGap = window.some((day) => day.state === "unchecked");
  const quietRun = trailingQuietRun(window);
  const finding =
    quietRunLabel ??
    (quietRun >= CAPTURE_QUIET_RUN_THRESHOLD
      ? `Nothing has changed here in ${quietRun} days. That is a finding, not a gap.`
      : null);

  return (
    <div className={className ? `f9-ed-capture ${className}` : "f9-ed-capture"}>
      <div className="f9-ed-capture-strip" role="img" aria-label={CAPTURE_STRIP_LEGEND}>
        <div className="f9-ed-capture-track">
          {window.map((day) => {
            const label = `${DAY_LABEL.format(new Date(`${day.date}T00:00:00.000Z`))} — ${STATE_WORDS[day.state]}`;
            return (
              <span
                key={day.date}
                className={`f9-ed-capture-bar is-${day.state}`}
                data-capture-state={day.state}
                title={label}
              />
            );
          })}
        </div>
      </div>
      <p className="f9-ed-capture-legend">
        {hasGap ? `${CAPTURE_STRIP_LEGEND} ${CAPTURE_STRIP_GAP_LEGEND}` : CAPTURE_STRIP_LEGEND}
      </p>
      {finding ? <p className="f9-ed-capture-finding">{finding}</p> : null}
    </div>
  );
}
