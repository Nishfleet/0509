import type {
  CompetitorSiteChangeField,
  CompetitorSiteChangeKind,
} from "~/lib/competitor-site-content";

/**
 * Per-change criticality for watchlist alerts. Deterministic first pass.
 *
 * Website-page events (#1387) feed this helper so every website_page_*
 * alert carries a score. Broader watchlist UI / digest / cohort work
 * stays on #1259 — this module is the shared scorer, not a second one.
 */

export type CriticalityBand = "cosmetic" | "routine" | "material" | "critical";

export interface ChangeCriticality {
  score: number;
  band: CriticalityBand;
  reasons: string[];
}

export interface ChangeCriticalityInput {
  kind?: CompetitorSiteChangeKind | "ad-copy" | "asset";
  field?: CompetitorSiteChangeField | string | null;
  before?: string | null;
  after?: string | null;
  assetHashChanged?: boolean;
}

export interface WebsitePageCriticalityFact {
  kind: CompetitorSiteChangeKind;
  field: CompetitorSiteChangeField;
  before: string | null;
  after: string | null;
}

/** #1259 price-token heuristic. */
export const PRICE_TOKEN_PATTERN = /price|₹|rs\.?\s*\d|inr/i;

const COSMETIC_DIFF_RATIO = 0.15;

const SCORE_COSMETIC = 15;
const SCORE_ROUTINE = 40;
const SCORE_MATERIAL = 70;
const SCORE_CRITICAL = 90;

function bandForScore(score: number): CriticalityBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "material";
  if (score >= 25) return "routine";
  return "cosmetic";
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/\s+/).filter(Boolean));
}

/**
 * Token Jaccard distance: 0 identical, 1 disjoint. Cheap enough for the
 * 500-char before/after facts the website-page evaluator already bounds.
 */
export function textDiffRatio(before: string, after: string): number {
  if (before === after) return 0;
  if (!before || !after) return 1;
  const left = tokenSet(before);
  const right = tokenSet(after);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}

function raise(
  current: { score: number; reasons: string[] },
  nextScore: number,
  reason: string,
): void {
  current.reasons.push(reason);
  if (nextScore > current.score) {
    current.score = nextScore;
  }
}

export function scoreChangeCriticality(
  input: ChangeCriticalityInput,
): ChangeCriticality {
  const current = { score: 0, reasons: [] as string[] };
  const before = input.before ?? "";
  const after = input.after ?? "";
  const blob = `${before} ${after}`;

  if (input.kind === "page-added") {
    raise(current, SCORE_CRITICAL, "new-landing-page");
  }
  if (input.kind === "page-removed") {
    raise(current, SCORE_MATERIAL, "page-removed");
  }
  if (input.field === "cta") {
    raise(current, SCORE_MATERIAL, "cta-string-change");
  }
  if (input.field === "offerPrice" || PRICE_TOKEN_PATTERN.test(blob)) {
    raise(current, SCORE_MATERIAL, "price-token");
  }
  if (input.assetHashChanged) {
    raise(current, SCORE_MATERIAL, "asset-hash-change");
  }

  const ratio = textDiffRatio(before, after);
  if (ratio > 0 && ratio < COSMETIC_DIFF_RATIO) {
    raise(current, SCORE_COSMETIC, "low-text-diff-ratio");
  } else if (ratio >= COSMETIC_DIFF_RATIO && current.score === 0) {
    raise(current, SCORE_ROUTINE, "text-diff");
  }

  return {
    score: Math.max(0, Math.min(100, current.score)),
    band: bandForScore(current.score),
    reasons: current.reasons,
  };
}

export function scoreWebsitePageChange(
  fact: WebsitePageCriticalityFact,
): ChangeCriticality {
  return scoreChangeCriticality({
    kind: fact.kind,
    field: fact.field,
    before: fact.before,
    after: fact.after,
  });
}
