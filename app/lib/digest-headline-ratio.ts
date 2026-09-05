import {
  rerankDigestBrief,
  type DigestRerankItem,
} from "~/lib/digest-rerank";

// BET 1 regression guard (issue #1451). The brief's central promise is that
// its headline items are commercial-field changes (the five landing_page_*
// types) and that creative churn (ad_new / ad_inactive) is collapsed to a
// single counted footnote line — never surfaced as standalone headlines.
// These constants pin the thresholds the always-on canary measures against.
// The issue's acceptance target is ≥60% landing_page_* headline items; the
// regression guard fires when the 7-day rolling ratio drops below 50% so a
// merge that re-leaks churn into headlines (or drops landing_page_* out of
// the headline stream) is caught in the same rolling window it lands.
export const DIGEST_HEADLINE_TARGET_RATIO = 0.6;
export const DIGEST_HEADLINE_GUARD_RATIO = 0.5;
export const DIGEST_HEADLINE_ROLLING_DAYS = 7;

export interface DigestHeadlineMeasurement {
  /** The ISO date (YYYY-MM-DD) this measurement covers. */
  periodStart: string;
  /** Decision-candidate items that reach the brief's headline stream. */
  headlineItemCount: number;
  /** Of those, how many are landing_page_* commercial-field changes. */
  landingPageCount: number;
  /** Creative churn (ad_new / ad_inactive) collapsed out of the stream. */
  adChurnCount: number;
  /** landingPageCount / headlineItemCount (0 when there is nothing to measure). */
  ratio: number;
}

export interface HeadlineRatioSignal {
  /** How many measured days the 7-day rolling window covered. */
  sampledDays: number;
  /** Mean headline ratio across the rolling window. */
  rollingRatio: number;
  /** rollingRatio >= the 60% BET 1 acceptance target. */
  targetMet: boolean;
  /** rollingRatio < 50% — the regression guard fires. */
  guardFired: boolean;
}

/**
 * Measures the headline ratio of a single delivered-brief period by running
 * its decision-candidate items through the real digest-builder rerank. The
 * headline stream is the builder's `headlineItems` + `otherItems` (creative
 * churn does not rank and is returned only as a count). A ratio below 1 is
 * the signal that a regression has pushed non-landing-page items into the
 * headline stream or dropped landing_page_* items out of it.
 */
export function measureDigestHeadline(
  items: readonly DigestRerankItem[],
  periodStart: string,
): DigestHeadlineMeasurement {
  const rerank = rerankDigestBrief(items);
  const headlineItemCount = rerank.headlineItems.length + rerank.otherItems.length;
  const landingPageCount = rerank.headlineItems.length;
  return {
    periodStart,
    headlineItemCount,
    landingPageCount,
    adChurnCount: rerank.adChurnSummary.total,
    ratio: headlineItemCount === 0 ? 0 : landingPageCount / headlineItemCount,
  };
}

/**
 * The 7-day rolling regression-guard signal over a series of daily
 * measurements. Uses the last DIGEST_HEADLINE_ROLLING_DAYS measurements (in
 * arrival order), averages their per-period ratios, and reports whether the
 * guard fires (below the 50% floor). A window with no measurements never
 * fires the guard — there is nothing to regress yet.
 */
export function headlineRatioSignal(
  measurements: readonly DigestHeadlineMeasurement[],
): HeadlineRatioSignal {
  const window = measurements.slice(-DIGEST_HEADLINE_ROLLING_DAYS);
  if (window.length === 0) {
    return {
      sampledDays: 0,
      rollingRatio: 0,
      targetMet: false,
      guardFired: false,
    };
  }
  const rollingRatio = window.reduce((sum, m) => sum + m.ratio, 0) / window.length;
  return {
    sampledDays: window.length,
    rollingRatio,
    targetMet: rollingRatio >= DIGEST_HEADLINE_TARGET_RATIO,
    guardFired: rollingRatio < DIGEST_HEADLINE_GUARD_RATIO,
  };
}
