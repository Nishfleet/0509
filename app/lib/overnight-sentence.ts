import type { ChangeMark } from "~/lib/change-mark";

/**
 * BL-030 — the Overnight sentence.
 *
 * The Overview does not open with a greeting and a stat row; it opens with
 * what happened while you were asleep, in one line of body text carrying the
 * page's single green mark. v2's failure mode was performing that sentence at
 * 68px; here it is 16px, and the character comes from the diff typography
 * rather than the scale.
 *
 * Everything is derived from records the Overview loader already reads: the
 * market-desk brief's own summary is the honest fallback for every state
 * where nothing was captured (empty, queued, quiet, paused, source-degraded),
 * and the specific sentence is only built when there IS a captured change to
 * name.
 */
export interface OvernightSentence {
  /** Text before the green mark. */
  lead: string;
  /** The one green mark, or null when no stored before/after exists. */
  mark: ChangeMark | null;
  /** Text after the green mark. */
  tail: string;
}

export function buildOvernightSentence(input: {
  /** `buildMarketDeskBrief(...).title` — the state headline. */
  briefTitle: string;
  /** `buildMarketDeskBrief(...).summary` — already honest per state. */
  briefSummary: string;
  /** CONFIRMED changes in the recent feed — provisional signals never count here. */
  changeCount: number;
  /** Title of the newest change, when there is one. */
  headline: string | null;
  /** Stored before/after for the newest change that has one. */
  mark: ChangeMark | null;
  /** Competitors that were checked and did not move. */
  quietCompetitors: number;
}): OvernightSentence {
  if (input.changeCount <= 0 || !input.headline) {
    // No captured change to name, so the brief's own state headline leads and
    // its summary follows. Both are already honest for empty, queued, quiet,
    // paused and source-degraded workspaces.
    const title = input.briefTitle.trim().replace(/[.]+$/, "");
    return {
      lead: title ? `${title}. ${input.briefSummary}` : input.briefSummary,
      mark: null,
      tail: "",
    };
  }

  const others = input.changeCount - 1;
  const parts: string[] = [];
  if (others > 0) {
    parts.push(
      ` ${others} other ${others === 1 ? "change is" : "changes are"} on file.`,
    );
  }
  if (input.quietCompetitors > 0) {
    parts.push(
      ` Nothing moved on your other ${input.quietCompetitors} ${
        input.quietCompetitors === 1 ? "competitor" : "competitors"
      }.`,
    );
  }

  if (!input.mark) {
    return { lead: `${input.headline}.${parts.join("")}`, mark: null, tail: "" };
  }

  return {
    lead: `${input.headline} — `,
    mark: input.mark,
    tail: `.${parts.join("")}`,
  };
}
