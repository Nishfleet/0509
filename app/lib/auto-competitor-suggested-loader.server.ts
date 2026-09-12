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
import {
  getCompetitorSuggestionCaps,
  type CompetitorSuggestionCaps,
} from "~/lib/plan-entitlements";
import type { PlanFamily } from "~/lib/plan-entitlements";
import {
  buildCandidateId,
  type AutoCompetitorEvidenceSource,
} from "~/lib/auto-competitor-seed.server";

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
  /**
   * Onboarding slice 2 (#3175): the one line the customer reads explaining why
   * this advertiser is a competitor, and the typed evidence source it came
   * from. Both are produced by the seed from real probe facts; the loader only
   * carries them. Required (not optional) so a future seed change that drops
   * them is a compile error here rather than a silently why-less row.
   */
  why: string;
  source: AutoCompetitorEvidenceSource | "adjacent_brand_fallback";
  type: "candidate";
}

export interface SuggestedCompetitorsPanelData {
  domain: string;
  rows: SuggestedCompetitorRow[];
  /**
   * Onboarding slice 2 (#3175): the plan's suggestion caps, carried to the
   * panel so it can render the frozen-snapshot state (Free) and the
   * "N of M tracked" line without re-deriving the entitlement client-side.
   */
  caps: CompetitorSuggestionCaps;
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
 * The id builder, re-exported so the panel and the accept path keep their
 * existing import. Defined in the seed module (see the import above) because the
 * dismissal store keys on it too: exactly ONE definition, or the two copies
 * could drift and silently un-dismiss a removed suggestion.
 */
export { buildCandidateId };

const SUGGESTED_COMPETITOR_LIMIT = 8;

function shapeRowsForPanel(
  candidates: ReadonlyArray<{
    advertiser: string;
    advertiserPageId: string | null;
    registrableDomain: string | null;
    overlapScore: number;
    provenance: string;
    why: string;
    source: AutoCompetitorEvidenceSource;
    countries: string[];
  }>,
  limit: number,
): SuggestedCompetitorRow[] {
  // Sort by overlapScore desc, then by advertiser asc for stable order.
  const sorted = [...candidates].sort((left, right) => {
    if (right.overlapScore !== left.overlapScore) {
      return right.overlapScore - left.overlapScore;
    }
    return left.advertiser.localeCompare(right.advertiser);
  });
  return sorted.slice(0, Math.max(0, limit)).map((candidate) => {
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
      why: candidate.why,
      source: candidate.source,
      type: "candidate" as const,
    };
  });
}

/**
 * Onboarding slice 2 (#3175): the zero-evidence fallback.
 *
 * When the customer's brand produces NO suggestion candidates at all (no ads on
 * record, and the landing-page fallback found nothing usable), the panel must
 * not simply be empty — the issue requires the #2411 adjacent-brand fallback
 * instead. This function produces exactly that: the same-category tracked
 * brands the `no_ads` state already offers, via the SAME picker
 * (`pickSignupFirstBriefBrandSuggestions`) and the SAME indexable-links source
 * the onboard view uses. No second adjacency engine, no second brand list.
 *
 * The rows carry `source: "adjacent_brand_fallback"` and a `why` that says
 * plainly that this is a neighbouring brand rather than evidence of the
 * customer's own ads — the honesty contract matters more here than anywhere,
 * because this is the one path whose suggestion is NOT backed by the customer's
 * own evidence. Returns `[]` on any failure so the caller's honest empty state
 * still applies.
 */
async function loadAdjacentBrandFallbackRows(
  env: AppEnv,
  selfDomain: string,
): Promise<SuggestedCompetitorRow[]> {
  try {
    const { loadIndexableAdsInternalLinks } = await import(
      "~/lib/ads-internal-links.server"
    );
    const { pickSignupFirstBriefBrandSuggestions } = await import("~/lib/first-brief");
    const links = await loadIndexableAdsInternalLinks(env);
    const picked = pickSignupFirstBriefBrandSuggestions(
      links.map((link) => ({ name: link.name, domain: link.domain, path: link.path })),
      selfDomain,
    );
    return picked.map((brand) => ({
      candidateId: buildCandidateId({
        advertiser: brand.name,
        registrableDomain: brand.domain,
        advertiserPageId: null,
      }),
      advertiser: brand.name,
      pageId: null,
      landingPageUrl: `https://${brand.domain}`,
      targetCountry: null,
      overlapScore: 0,
      provenance:
        "Adjacent brand from the public /brands hub — offered because we found " +
        "no ad or page evidence for your own brand yet. Not derived from your ads.",
      why: "Tracks the same buyer category as you — a neighbour, not evidence from your ads.",
      source: "adjacent_brand_fallback",
      type: "candidate" as const,
    }));
  } catch {
    return [];
  }
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
  // Onboarding slice 2 (#3175) reverses the old paid-only gate. Free used to
  // get `null` (no panel at all), which threw away the one moment the evidence
  // is most persuasive. Free now sees the discovered set as a FROZEN SNAPSHOT:
  // every row rendered read-only, no add button. The evidence is real and
  // visible; acting on it is what the paid plan buys. The caps carry that
  // distinction (`frozen: true`, `tracked: 0`) rather than the loader
  // withholding the data.
  const caps = getCompetitorSuggestionCaps(plan);
  const limit = Math.min(caps.visible, SUGGESTED_COMPETITOR_LIMIT);

  const selfDomain = await resolveWorkspaceSelfDomain(env, userId);
  if (!selfDomain) {
    return { domain: "", rows: [], caps };
  }

  let raw: ReadonlyArray<{
    advertiser: string;
    advertiserPageId: string | null;
    registrableDomain: string | null;
    overlapScore: number;
    provenance: string;
    why: string;
    source: AutoCompetitorEvidenceSource;
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
    return { domain: selfDomain.domain, rows: [], caps };
  }

  const rows = shapeRowsForPanel(raw, limit);
  if (rows.length === 0) {
    // Zero evidence about the customer's own brand: fall back to the #2411
    // adjacent brands rather than showing nothing. Capped by the same plan
    // limit so the snapshot ceiling still holds.
    const fallback = await loadAdjacentBrandFallbackRows(env, selfDomain.domain);
    return { domain: selfDomain.domain, rows: fallback.slice(0, limit), caps };
  }
  return { domain: selfDomain.domain, rows, caps };
}

