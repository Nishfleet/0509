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

/**
 * `prewatch` is the only state the caller never supplies: it is the part of
 * the window that predates the watch itself. Those days are not gaps — there
 * was nothing to check yet — so they render as a void, carry no state word,
 * and are excluded from the gap legend and the quiet run (BL-006).
 */
export type CaptureDayState = "quiet" | "captured" | "waiting" | "unchecked" | "prewatch";

export interface CaptureDay {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  state: CaptureDayState;
}

export const CAPTURE_WINDOW_DAYS = 30;

/** A quiet run at least this long is stated as a finding, not left implicit. */
export const CAPTURE_QUIET_RUN_THRESHOLD = 7;

export const CAPTURE_STRIP_LEGEND_BASE =
  "Short bar = checked, nothing changed. Tall bar = a change we captured.";

/** Only printed when the window actually contains a waiting day (BL-006). */
export const CAPTURE_STRIP_WAITING_LEGEND = "Green = waiting on you.";

export const CAPTURE_STRIP_LEGEND = `${CAPTURE_STRIP_LEGEND_BASE} ${CAPTURE_STRIP_WAITING_LEGEND}`;

export const CAPTURE_STRIP_GAP_LEGEND = "A dashed slot means we did not check that day.";

/** Composes the legend from what the window actually contains — a legend must
 *  never promise a state this strip cannot show. */
export function captureStripLegend(window: readonly CaptureDay[]): string {
  const clauses = [CAPTURE_STRIP_LEGEND_BASE];
  if (window.some((day) => day.state === "waiting")) clauses.push(CAPTURE_STRIP_WAITING_LEGEND);
  if (window.some((day) => day.state === "unchecked")) clauses.push(CAPTURE_STRIP_GAP_LEGEND);
  return clauses.join(" ");
}

const STATE_WORDS: Record<CaptureDayState, string> = {
  quiet: "checked, nothing changed",
  captured: "a change we captured",
  waiting: "a change waiting on you",
  unchecked: "we did not check that day",
  prewatch: "",
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

export function CaptureStrip({
  days,
  endDate,
  startDate,
  windowDays = CAPTURE_WINDOW_DAYS,
  quietRunLabel,
  className,
}: {
  days: readonly CaptureDay[];
  endDate?: string;
  /** When the watch began. Earlier slots render as the prewatch void. */
  startDate?: string;
  windowDays?: number;
  /** Overrides the derived "nothing has changed" finding sentence. */
  quietRunLabel?: string;
  className?: string;
}) {
  const window = buildCaptureWindow(days, { endDate, windowDays, startDate });
  if (window.length === 0) return null;

  const legend = captureStripLegend(window);
  const quietRun = trailingQuietRun(window);
  const finding =
    quietRunLabel ??
    (quietRun >= CAPTURE_QUIET_RUN_THRESHOLD
      ? `Nothing has changed here in ${quietRun} days. That is a finding, not a gap.`
      : null);

  return (
    <div className={className ? `f9-ed-capture ${className}` : "f9-ed-capture"}>
      <div className="f9-ed-capture-strip" role="img" aria-label={legend}>
        <div className="f9-ed-capture-track">
          {window.map((day) => {
            // The prewatch void names no state: there is nothing to say about
            // a day before the watch existed.
            const label =
              day.state === "prewatch"
                ? undefined
                : `${DAY_LABEL.format(new Date(`${day.date}T00:00:00.000Z`))} — ${STATE_WORDS[day.state]}`;
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
      <p className="f9-ed-capture-legend">{legend}</p>
      {finding ? <p className="f9-ed-capture-finding">{finding}</p> : null}
    </div>
  );
}
