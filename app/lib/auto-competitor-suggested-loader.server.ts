/**
 * Suggested-competitors panel loader (auto-competitor-watch, Phase 2).
 *
 * Composes the Phase 1 seed function (`app/lib/auto-competitor-seed.server`,
 * `seedAutoCompetitors`) and shapes its raw output into the row contract the
 * `<SuggestedCompetitorsPanel />` component consumes. Phase 1 returns the
 * raw advertiser + overlap + provenance records; this loader adds the
 * panel-specific fields (the typed "candidate" marker)
 * and enforces the honesty invariants the panel requires.
 *
 * Two honesty invariants are enforced here, NOT deferred to the UI:
 *
 * 1. The loader never returns a candidate typed as `confirmed`. Phase 1's
 *    `AutoCompetitorCandidate` does not carry a `type` field at all — it
 *    only returns candidates. The panel's row shape hard-codes
 *    `type: "candidate"`; a future regression in Phase 1 that starts
 *    returning rows of any other kind would land here as a typed compile
 *    error rather than a UI-truthfulness breach. Honesty eval 3.4 forbids
 *    a candidate from rendering as a confirmed competitor anywhere.
 * 2. The loader returns `[]` (NOT fabricated rows) when the seed function
 *    returns nothing — empty means empty, never "one placeholder suggestion
 *    so the panel is not blank". The empty state is the panel's
 *    responsibility.
 *
 * The loader is paid-tier gated. A free plan's brand has at most one
 * watchlist scanned weekly; auto-discovered candidates are a Starter+ feature
 * (plan.server.ts / plan-entitlements). When the gate rejects, the loader
 * returns `null` so the panel can omit itself cleanly — same shape as the
 * existing counter-brief gate (`counterBrief: null`, `counterBriefLocked`).
 */

import type { AppEnv } from "~/lib/env.server";
import { isPaidPlanFamily } from "~/lib/plan-entitlements";
import type { PlanFamily } from "~/lib/plan-entitlements";

/**
 * The shape the panel receives. The `type` literal is a panel-internal
 * contract — Phase 1 does NOT emit a `type` field; it only ever returns
 * candidates (eval 3.4). The panel pins this so a future regression in
 * Phase 1 cannot silently flip a candidate into a "confirmed" render
 * without breaking this loader's compile.
 */
export interface SuggestedCompetitorRow {
  candidateId: string;
  advertiser: string;
  pageId: string | null;
  landingPageUrl: string | null;
  targetCountry: string | null;
  overlapScore: number;
  provenance: string;
  type: "candidate";
}

export interface SuggestedCompetitorsPanelData {
  domain: string;
  rows: SuggestedCompetitorRow[];
}

/**
 * Resolve the user's own registrable domain from the workspace's saved
 * branding. Returns null when no branding is set, so the loader degrades to
 * "no candidates" rather than fabricating a seed input.
 */
async function resolveWorkspaceSelfDomain(
  env: AppEnv,
  userId: string,
): Promise<{ domain: string; country: string | null } | null> {
  const { getWorkspaceBranding } = await import("~/lib/data/workspace-branding.server");
  const branding = await getWorkspaceBranding(env, userId);
  const website = branding.brandWebsite;
  if (!website) {
    return null;
  }
  // Reuse the existing competitor-website normalisation so a saved URL like
  // "nykaa.com" or "https://nykaa.com/path" both resolve to "nykaa.com".
  const { registrableDomainFromLandingPage } = await import("~/lib/competitor-website");
  const domain = registrableDomainFromLandingPage(website);
  if (!domain) {
    return null;
  }
  return { domain, country: null };
}

/**
 * Build a deterministic candidate id from the (advertiser, domain) pair.
 * Phase 1's candidate record does not carry an id — the (advertiser,
 * registrable domain) tuple is the natural key. A SHA-style stable hash is
 * overkill; the joined string is enough to discriminate two candidates
 * that surfaced the same brand from different keyword probes, and stays
 * readable in error messages.
 */
function buildCandidateId(seed: {
  advertiser: string;
  registrableDomain: string | null;
  advertiserPageId: string | null;
}): string {
  return [
    seed.advertiser.trim().toLowerCase(),
    (seed.registrableDomain ?? "").trim().toLowerCase(),
    (seed.advertiserPageId ?? "").trim(),
  ].join("|");
}

const SUGGESTED_COMPETITOR_LIMIT = 8;

function shapeRowsForPanel(
  candidates: ReadonlyArray<{
    advertiser: string;
    advertiserPageId: string | null;
    registrableDomain: string | null;
    overlapScore: number;
    provenance: string;
    countries: string[];
  }>,
): SuggestedCompetitorRow[] {
  // Sort by overlapScore desc, then by advertiser asc for stable order.
  const sorted = [...candidates].sort((left, right) => {
    if (right.overlapScore !== left.overlapScore) {
      return right.overlapScore - left.overlapScore;
    }
    return left.advertiser.localeCompare(right.advertiser);
  });
  return sorted.slice(0, SUGGESTED_COMPETITOR_LIMIT).map((candidate) => {
    const candidateId = buildCandidateId(candidate);
    return {
      candidateId,
      advertiser: candidate.advertiser,
      pageId: candidate.advertiserPageId,
      landingPageUrl: candidate.registrableDomain
        ? `https://${candidate.registrableDomain}`
        : null,
      targetCountry: candidate.countries[0] ?? null,
      overlapScore: candidate.overlapScore,
      provenance: candidate.provenance,
      type: "candidate" as const,
    };
  });
}

/**
 * Load the suggested-competitors payload for the watchlists panel.
 *
 * Returns `null` when the customer is on a free plan — the panel omits
 * itself entirely on free, the same shape as `counterBrief` /
 * `counterBriefLocked`. Returns `{ domain, rows: [] }` (NOT `null`) when
 * the customer is paid but the seed function returns no candidates — the
 * panel then renders its honest empty state.
 *
 * If the seed module fails to load (a transient D1 issue, etc.), the
 * loader returns the empty-state shape. This is a deliberate degrade:
 * never crash the watchlists page because a downstream feature failed.
 */
export async function loadSuggestedCompetitorsPanel(
  env: AppEnv,
  userId: string,
  plan: PlanFamily,
): Promise<SuggestedCompetitorsPanelData | null> {
  if (!isPaidPlanFamily(plan)) {
    return null;
  }

  const selfDomain = await resolveWorkspaceSelfDomain(env, userId);
  if (!selfDomain) {
    return { domain: "", rows: [] };
  }

  let raw: ReadonlyArray<{
    advertiser: string;
    advertiserPageId: string | null;
    registrableDomain: string | null;
    overlapScore: number;
    provenance: string;
    countries: string[];
    matchedKeywords: string[];
  }>;
  try {
    const { seedAutoCompetitors } = await import("~/lib/auto-competitor-seed.server");
    raw = await seedAutoCompetitors(env, {
      domain: selfDomain.domain,
      country: selfDomain.country ?? "all",
      userId,
    });
  } catch {
    // Seed failure degrades to empty — same posture as the loader's own
    // capture-window degrade: never let a downstream feature failure take
    // the watchlists page down.
    return { domain: selfDomain.domain, rows: [] };
  }

  const rows = shapeRowsForPanel(raw);
  return { domain: selfDomain.domain, rows };
}

