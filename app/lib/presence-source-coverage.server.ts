import type { AppEnv } from "~/lib/env.server";
import {
  connectorHasCustomerPollPath,
  evaluateConnectorAccessGate,
} from "~/lib/presence-access-gates.server";
import {
  X_PAID_PENDING_REASON_CODE,
  xPaidAccessApproved,
} from "~/lib/presence-connectors/x.server";
import { getSourceAdapter } from "~/lib/sources/registry.server";
import { SOURCE_IDS } from "~/lib/sources/types";
import type {
  PresenceConnectorId,
  PresenceCoverageLabel,
  PresencePollCursorRecord,
  PresenceSourceCoverageEntry,
  PresenceSourceCoverageStatus,
  PresenceSourceId,
  PresenceTrackingMode,
  SourceTargetRecord,
} from "~/lib/presence-types";

const SOURCE_LABELS: Record<PresenceSourceId, string> = {
  website: "Website / open web",
  x: "X",
  reddit: "Reddit",
  linkedin: "LinkedIn",
  rss: "RSS / Atom / JSON Feed",
  bluesky: "Bluesky",
  gdelt: "GDELT mainstream news",
  threads: "Threads",
  hn: "Hacker News",
  pinterest: "Pinterest",
  review_sites: "Review sites",
  youtube: "YouTube",
  amazon: "Amazon marketplace",
  context_dev: "Context.dev (open-web provider)",
  // Five new competitor-monitoring sources added by the seam (#2218). Their
  // adapters are stubs (`implemented: false`) until the source tickets
  // (#2181/#2189/#2193/#2194/#2198/#2199) land; coverage reports "coming soon"
  // until then. `linkedin` already existed as a presence connector; the
  // linkedin-ads adapter reuses that id and is also a stub here.
  google: "Google Search",
  google_ads: "Google Ads (Transparency Center)",
  tiktok: "TikTok Ads (Commercial Content Library, EU-shown)",
  subdomains: "New web addresses",
  hiring: "Hiring",
};

const CONNECTOR_FOR_SOURCE: Partial<Record<PresenceSourceId, PresenceConnectorId>> = {
  website: "website",
  x: "x",
  reddit: "reddit",
  linkedin: "linkedin",
  rss: "rss",
  bluesky: "bluesky",
  gdelt: "gdelt",
  threads: "threads",
  hn: "hn",
  pinterest: "pinterest",
  review_sites: "review_sites",
};

const SOCIAL_SOURCE_IDS = new Set<PresenceSourceId>(["x", "reddit", "linkedin", "bluesky", "threads", "pinterest"]);

export interface PresenceSourcePlanGates {
  modeAllowed: boolean;
  websiteSourcesAllowed: boolean;
  socialConnectAllowed: boolean;
}

function isKnownSourceId(value: string): value is PresenceSourceId {
  return value in SOURCE_LABELS;
}

function baseEntry(
  sourceId: PresenceSourceId,
  status: PresenceSourceCoverageStatus,
  options: {
    coverageLabel?: PresenceCoverageLabel | null;
    reasonCode?: string | null;
    reasonMessage?: string | null;
    actionNeeded?: string | null;
  } = {},
): PresenceSourceCoverageEntry {
  return {
    sourceId,
    label: SOURCE_LABELS[sourceId],
    status,
    coverageLabel: options.coverageLabel ?? null,
    reasonCode: options.reasonCode ?? null,
    reasonMessage: options.reasonMessage ?? null,
    actionNeeded: options.actionNeeded ?? null,
    connectorId: CONNECTOR_FOR_SOURCE[sourceId] ?? null,
  };
}

function statusFromConnectorGate(
  sourceId: PresenceSourceId,
  gate: Awaited<ReturnType<typeof evaluateConnectorAccessGate>>,
  trackingMode: PresenceTrackingMode,
): PresenceSourceCoverageEntry {
  if (gate.allowed) {
    const coverageLabel: PresenceCoverageLabel =
      sourceId === "website"
        ? "PUBLIC_WEB_BEST_EFFORT"
        : sourceId === "rss"
          ? "VERIFIED_PUBLIC_FEED"
          : sourceId === "gdelt"
            ? "OFFICIAL_PUBLIC_API"
            : sourceId === "threads"
            ? "OFFICIAL_PUBLIC_API"
            : sourceId === "hn"
            ? "OFFICIAL_PUBLIC_API"
            : sourceId === "pinterest"
            ? "VERIFIED_PUBLIC_FEED"
            : sourceId === "review_sites"
            ? "PUBLIC_WEB_BEST_EFFORT"
            : sourceId === "linkedin" && trackingMode === "competitor"
            ? "LIMITED_COVERAGE"
            : sourceId === "x" || sourceId === "reddit"
              ? trackingMode === "self"
                ? "CONNECTED_ACCOUNT"
                : "OFFICIAL_PUBLIC_API"
              : "CONNECTED_ACCOUNT";

    return baseEntry(sourceId, "available", {
      coverageLabel,
      reasonCode: gate.reasonCode,
      reasonMessage: gate.reasonMessage,
      actionNeeded: "Add a source target",
    });
  }

  if (gate.reasonCode === "competitor_limited") {
    return baseEntry(sourceId, "limited", {
      coverageLabel: "LIMITED_COVERAGE",
      reasonCode: gate.reasonCode,
      reasonMessage: gate.reasonMessage,
      actionNeeded: "Self-brand tracking only for this source",
    });
  }

  if (gate.rolloutState === "disabled") {
    return baseEntry(sourceId, "unavailable", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: gate.reasonCode,
      reasonMessage: gate.reasonMessage,
      actionNeeded: null,
    });
  }

  return baseEntry(sourceId, "gated", {
    coverageLabel: "UNAVAILABLE",
    reasonCode: gate.reasonCode,
    reasonMessage: gate.reasonMessage,
    actionNeeded: gate.reasonMessage,
  });
}

async function evaluateConnectorSourceCoverage(
  env: AppEnv,
  sourceId: PresenceSourceId,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<PresenceSourceCoverageEntry> {
  const connectorId = CONNECTOR_FOR_SOURCE[sourceId];
  if (!connectorId) {
    return baseEntry(sourceId, "unavailable", {
      reasonCode: "unknown_source",
      reasonMessage: `${sourceId} is not a configured connector.`,
    });
  }

  const gate = await evaluateConnectorAccessGate(env, connectorId, trackingMode, workspaceUserId);
  // MONEY flag (#3255): X mention search is pay-per-use — even with rollout and
  // credentials configured, coverage stays gated/pending until the spend
  // decision lands (X_PAID_ACCESS=approved). Never implied live.
  if (sourceId === "x" && gate.allowed && !xPaidAccessApproved(env)) {
    return baseEntry(sourceId, "gated", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: X_PAID_PENDING_REASON_CODE,
      reasonMessage:
        "X mention search is a paid, metered source — activation is pending a spend decision.",
      actionNeeded: "Pending spend decision",
    });
  }
  if (gate.allowed && SOCIAL_SOURCE_IDS.has(sourceId) && !connectorHasCustomerPollPath(connectorId)) {
    return baseEntry(sourceId, "unavailable", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "poll_not_implemented",
      reasonMessage: `${SOURCE_LABELS[sourceId]} polling is not active for customer-facing coverage yet.`,
      actionNeeded: null,
    });
  }
  return statusFromConnectorGate(sourceId, gate, trackingMode);
}

function evaluatePlannedSourceCoverage(
  env: AppEnv,
  sourceId: PresenceSourceId,
): PresenceSourceCoverageEntry {
  if (sourceId === "youtube") {
    return baseEntry(sourceId, "planned", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "api_not_configured",
      reasonMessage: "YouTube tracking requires official API credentials, quota approval, and a rollout decision.",
      actionNeeded: "Not available yet — requires API key and product approval",
    });
  }

  if (sourceId === "amazon") {
    return baseEntry(sourceId, "manual_only", {
      coverageLabel: "LIMITED_COVERAGE",
      reasonCode: "manual_proof_required",
      reasonMessage: "Automated Amazon marketplace monitoring is not launched. Manual proof capture or approved affiliate API use only.",
      actionNeeded: "Add manual proof or request approval for affiliate/product API access",
    });
  }

  if (sourceId === "context_dev") {
    return baseEntry(sourceId, "planned", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "provider_not_configured",
      reasonMessage: "Context.dev is an optional backend open-web provider. It is not required for website tracking and is not active until configured and approved.",
      actionNeeded: null,
    });
  }

  // Seam (#2218): the five new competitor-monitoring sources. Coverage is
  // "configured" only when the adapter exports implemented: true AND
  // requiresEnv(env) is true. Stubs (implemented: false) report
  // "coming_soon" — never "configured". The source tickets flip implemented
  // to true and wire requiresEnv; this branch then resolves to "configured".
  const adapter = (SOURCE_IDS as readonly string[]).includes(sourceId)
    ? getSourceAdapter(sourceId as (typeof SOURCE_IDS)[number])
    : undefined;
  if (adapter) {
    if (adapter.implemented && adapter.requiresEnv(env)) {
      return baseEntry(sourceId, "configured", {
        coverageLabel: "OFFICIAL_PUBLIC_API",
        reasonCode: null,
        reasonMessage: null,
        actionNeeded: null,
      });
    }
    return baseEntry(sourceId, "coming_soon", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "not_implemented",
      reasonMessage: `${SOURCE_LABELS[sourceId]} is wired in as a stub and not live yet.`,
      actionNeeded: "Coming soon",
    });
  }

  return baseEntry(sourceId, "unavailable", {
    reasonCode: "unknown_source",
    reasonMessage: `${sourceId} is not supported.`,
  });
}

function policyAllowsConnectedTargets(status: PresenceSourceCoverageStatus): boolean {
  return status === "active" || status === "available" || status === "connected";
}

function strongestCoverageLabel(targets: SourceTargetRecord[]): PresenceCoverageLabel {
  const labels = new Set(targets.map((target) => target.coverageLabel));
  if (labels.has("CONNECTED_ACCOUNT")) return "CONNECTED_ACCOUNT";
  if (labels.has("OFFICIAL_PUBLIC_API")) return "OFFICIAL_PUBLIC_API";
  if (labels.has("VERIFIED_PUBLIC_FEED")) return "VERIFIED_PUBLIC_FEED";
  if (labels.has("PUBLIC_WEB_BEST_EFFORT")) return "PUBLIC_WEB_BEST_EFFORT";
  if (labels.has("LIMITED_COVERAGE")) return "LIMITED_COVERAGE";
  return "UNAVAILABLE";
}

export async function evaluatePresenceSourceCoverage(
  env: AppEnv,
  sourceId: PresenceSourceId,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<PresenceSourceCoverageEntry> {
  if (!isKnownSourceId(sourceId)) {
    return baseEntry("website", "unavailable", {
      reasonCode: "unknown_source",
      reasonMessage: `Unknown source: ${sourceId}`,
    });
  }

  if (CONNECTOR_FOR_SOURCE[sourceId]) {
    return evaluateConnectorSourceCoverage(env, sourceId, trackingMode, workspaceUserId);
  }

  return evaluatePlannedSourceCoverage(env, sourceId);
}

export async function listPresenceSourceCoverage(
  env: AppEnv,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<PresenceSourceCoverageEntry[]> {
  return Promise.all(
    (Object.keys(SOURCE_LABELS) as PresenceSourceId[]).map((sourceId) =>
      evaluatePresenceSourceCoverage(env, sourceId, trackingMode, workspaceUserId),
    ),
  );
}

export function applyPresenceSourcePlanGates(
  entries: PresenceSourceCoverageEntry[],
  gates: PresenceSourcePlanGates,
): PresenceSourceCoverageEntry[] {
  return entries.map((entry) => {
    if (!gates.modeAllowed) {
      return {
        ...entry,
        status: "unavailable",
        coverageLabel: "UNAVAILABLE",
        reasonCode: "mode_not_in_plan",
        reasonMessage: "This entity mode is not included in the current plan.",
        actionNeeded: "Upgrade plan to enable this entity type",
      };
    }

    if (entry.sourceId === "website" && !gates.websiteSourcesAllowed) {
      return {
        ...entry,
        status: "unavailable",
        coverageLabel: "UNAVAILABLE",
        reasonCode: "website_sources_not_in_plan",
        reasonMessage: "Website presence sources are not included in the current plan.",
        actionNeeded: "Upgrade plan to enable website sources",
      };
    }

    if (
      SOCIAL_SOURCE_IDS.has(entry.sourceId) &&
      !gates.socialConnectAllowed &&
      (entry.status === "active" || entry.status === "available" || entry.status === "connected")
    ) {
      return {
        ...entry,
        status: "gated",
        coverageLabel: "UNAVAILABLE",
        reasonCode: "social_connect_not_in_plan",
        reasonMessage: "Social presence connections are not included in the current plan.",
        actionNeeded: "Upgrade plan to enable social source connections",
      };
    }

    return entry;
  });
}

export function applyEntitySourceTargetCoverage(
  policyEntry: PresenceSourceCoverageEntry,
  target: SourceTargetRecord | null | undefined,
  cursor: PresencePollCursorRecord | null | undefined,
): PresenceSourceCoverageEntry {
  return applyEntitySourceTargetsCoverage(
    policyEntry,
    target ? [target] : [],
    target ? [{ sourceTargetId: target.id, cursor: cursor ?? null }] : [],
  );
}

export function applyEntitySourceTargetsCoverage(
  policyEntry: PresenceSourceCoverageEntry,
  targets: SourceTargetRecord[],
  cursors: Array<{ sourceTargetId: string; cursor: PresencePollCursorRecord | null | undefined }>,
): PresenceSourceCoverageEntry {
  const activeTargets = targets.filter((target) => target.isActive);
  if (activeTargets.length === 0) {
    return policyEntry;
  }

  if (!policyAllowsConnectedTargets(policyEntry.status)) {
    return policyEntry;
  }

  const cursorByTarget = new Map(cursors.map((entry) => [entry.sourceTargetId, entry.cursor ?? null]));
  const degradedTarget = activeTargets
    .map((target) => ({ target, cursor: cursorByTarget.get(target.id) ?? null }))
    .find((entry) => entry.cursor?.lastErrorCode);

  if (degradedTarget?.cursor?.lastErrorCode && !degradedTarget.cursor.lastSuccessAt) {
    return {
      ...policyEntry,
      status: "degraded",
      coverageLabel: degradedTarget.target.coverageLabel,
      reasonCode: degradedTarget.cursor.lastErrorCode,
      reasonMessage: degradedTarget.cursor.lastErrorMessage ?? "Last poll failed for this source.",
      actionNeeded: "Check source or retry poll",
    };
  }

  if (degradedTarget?.cursor?.lastErrorCode && degradedTarget.cursor.lastSuccessAt) {
    return {
      ...policyEntry,
      status: "degraded",
      coverageLabel: degradedTarget.target.coverageLabel,
      reasonCode: degradedTarget.cursor.lastErrorCode,
      reasonMessage: degradedTarget.cursor.lastErrorMessage ?? "Latest poll hit a limitation.",
      actionNeeded: "Review source limitation",
    };
  }

  const unpolledCount = activeTargets.filter((target) => !cursorByTarget.get(target.id)?.lastPolledAt).length;

  return {
    ...policyEntry,
    status: "connected",
    coverageLabel: strongestCoverageLabel(activeTargets),
    reasonCode: null,
    reasonMessage: null,
    actionNeeded:
      unpolledCount > 0
        ? `Run first check for ${unpolledCount} source target${unpolledCount === 1 ? "" : "s"}`
        : null,
  };
}

export function presenceSourceCoverageForDocs(): Array<{
  sourceId: PresenceSourceId;
  label: string;
  productionStatus: string;
  notes: string;
}> {
  return [
    {
      sourceId: "website",
      label: SOURCE_LABELS.website,
      productionStatus: "active",
      notes: "GA for entitled workspaces. Safe fetch, robots handling, bounded responses.",
    },
    {
      sourceId: "x",
      label: SOURCE_LABELS.x,
      productionStatus: "gated",
      notes:
        "X connector wired in with mention search (recent-search query targets). Gated behind PRESENCE_X_ROLLOUT + X_API_BEARER_TOKEN + X_PAID_ACCESS — paid pay-per-use reads are metered per entity per day and stay pending until the spend decision lands. No free read tier: recent search is pay-per-use only since Feb 2026 (collector research: docs/mentions/PLAN.md §8), so the flag stays off until the MONEY decision.",
    },
    {
      sourceId: "reddit",
      label: SOURCE_LABELS.reddit,
      productionStatus: "gated",
      notes:
        "Reddit Data API mention connector wired in (OAuth2 client-credentials, $0 free tier): covers the new posts of tracked subreddit targets — engagement (score/comment count) rides the item; NOT covered: comments, PMs, historicals, non-post votes. The documented 1,000-reads-per-10-minute budget (100 QPM averaged over 10 minutes, Data API Wiki) is enforced in-connector via presence_poll_cursor and shared by the one fleet OAuth client. Gated behind PRESENCE_REDDIT_ROLLOUT + REDDIT_CLIENT_ID/SECRET + REDDIT_COMMERCIAL_ACCESS=approved — off by default; activation is a separate rollout decision.",
    },
    {
      sourceId: "linkedin",
      label: SOURCE_LABELS.linkedin,
      productionStatus: "gated",
      notes:
        "LinkedIn Posts API connector wired in (own-organization posts of a CONNECTED account via /rest/posts, $0, stored OAuth grant; the member must administer the tracked organization). Gated behind PRESENCE_LINKEDIN_ROLLOUT — off by default; activation is a separate rollout decision. Self-tracking only: there is no public keyword search of others' posts, so Competitor coverage stays LIMITED_COVERAGE (the only allowed exclusion). Competitor-ads coverage also rides this source id (issue #3196): the public LinkedIn Ad Library — the tracked brand's currently published promoted-post cards (promoted text, advertiser, public detail link; no spend, reach or audience metrics), matched by the account-owner name exactly as the public Ad Library search serves it, the newest results page only (up to 25 ads), no ad-format distinction. Region: the United States (the public search's verified geo=US posture); no other regions are captured. Freshness: the regular monitoring cadence (the weekly label is the seam's scheduling hint). Killed via LINKEDIN_ADS_SOURCE_DISABLED=1 (kill flag; 0/unset = on) — scheduled runs and the public /ads section follow it. Capture attempts and failures feed the /status capture-failure rate when the #2181 DECODO_BUDGET KV binding is wired; without it the /status line states the flag posture only.",
    },
    {
      sourceId: "rss",
      label: SOURCE_LABELS.rss,
      productionStatus: "gated",
      notes:
        "RSS/Atom/JSON Feed connector wired in — the publication-feed mention backbone. Covers the publication feeds the sources themselves syndicate — publisher RSS, Substack, Medium, YouTube channel feeds (named feeds you register; those platforms have no free global keyword search). Covers exactly the tracked feeds the entity registers: publisher RSS, Substack /feed, Medium /feed/... (named profiles, publications and tags — there is no global free search), and Google News /rss/search query feeds built from the tracked match phrase; public surfaces cited in docs/mentions/PLAN.md §2/§8. In-connector rate budget: one bounded fetch per feed per poll, at most 25 items each, polls serialized upstream. Gated behind PRESENCE_RSS_ROLLOUT — off by default; activation is a separate rollout decision.",

    },
    {
      sourceId: "bluesky",
      label: SOURCE_LABELS.bluesky,
      productionStatus: "gated",
      notes:
        "Bluesky mention connector wired in (app.bsky.feed.searchPosts, $0). Covers the public posts the Bluesky AppView post search returns for the tracked match phrase (near-real-time, sort=latest) — no engagement counts or follow-graph, and the AppView index's completeness is Bluesky's, not ours. In-connector rate budget: 1 authenticated session + at most 2 result pages of 100 posts per poll, polls serialized upstream. Gated behind PRESENCE_BLUESKY_ROLLOUT — off by default; activation is a separate rollout decision.",
    },
    {
      sourceId: "gdelt",
      label: SOURCE_LABELS.gdelt,
      productionStatus: "gated",
      notes: "GDELT DOC 2.1 mainstream-news connector wired in (free, no key, ~65 languages, rolling 3-month window). Gated behind PRESENCE_GDELT_ROLLOUT — off by default; activation is a separate rollout decision.",
    },
    {
      sourceId: "threads",
      label: SOURCE_LABELS.threads,
      productionStatus: "gated",
      notes: "Threads keyword-search connector wired in (Meta keyword_search; 2,200 queries per user per 24h enforced in-connector via presence_poll_cursor — tumbling-window approximation of Meta's per-query rolling count, overshoot surfaces as Meta's 429). Gated behind PRESENCE_THREADS_ROLLOUT + THREADS_ACCESS_TOKEN and Meta app review — off by default; activation is a separate rollout decision.",
    },
    {
      sourceId: "hn",
      label: SOURCE_LABELS.hn,
      productionStatus: "gated",
      notes: "Hacker News mention connector wired in (Algolia HN Search API — free, no key, no auth; the ~10,000-requests/hour/IP courtesy figure is honored with one serialized search_by_date request per poll: page 0 only, time-window slicing via the prior poll's watermark instead of deep paging past the ~1,000-result ceiling). Gated behind PRESENCE_HN_ROLLOUT — off by default; activation is a separate rollout decision. Coverage: only public HN stories and comments whose stored text/URL/title matches the tracked phrase become mentions — the connector pins the Algolia query to tags=(story,comment) — while ranking metadata (points, comment counts, the story's external URL) rides raw_json, never the mention.",
    },
    {
      sourceId: "pinterest",
      label: SOURCE_LABELS.pinterest,
      productionStatus: "gated",
      notes:
        "Pinterest mention connector wired in (profile feed — https://www.pinterest.com/<handle>/feed.rss, public RSS 2.0, no key, no auth). Covers the tracked profile's own most recent pins (~25), for the tracked brand or person, self AND Competitor. Does NOT cover keyword-wide search across all of Pinterest, boards not on the tracked profile, repin/comment activity, or engagement counts — Pinterest exposes those only through its approval-gated, OAuth-per-user API v5, which stays parked (see the plan). The feed is an undocumented public surface, verified live 2026-09-13 — the same posture as Google News RSS: it works and can change without notice. In-connector rate budget: ONE serialized request per poll — the feed itself is the bounded window, no paging, no second fetch. Gated behind PRESENCE_PINTEREST_ROLLOUT — off by default; activation is a separate rollout decision.",
    },
    {
      sourceId: "review_sites",
      label: SOURCE_LABELS.review_sites,
      productionStatus: "gated",
      notes:
        "Review-sites mention connector wired in (issue #3209), first provider Trustpilot: the tracked brand's public business-unit review page (trustpilot.com/review/<domain> — the page a human reads) and the schema.org/Review JSON-LD it itself publishes — no account, no API key, no vendor. Covers exactly the published page window: the ~20 newest reviews (measured 2026-09-13, fixture) with star ratings in raw_json; each mention's canonical URL is the public /reviews/<uuid> permalink (path 301-confirmed 2026-09-14), so re-polls dedupe by canonical URL and captured reviews stay. What it does NOT cover, stated: G2/Capterra public pages are bot-verified (G2 = DataDome, Capterra = Cloudflare — measured 2026-09-13/14, challenge fixture ships with the issue) and their documented APIs are partner/paid — not captured; a g2/capterra target answers provider_not_wired_yet. In-connector rate budget: one serialized GET of the review page per target per poll; a challenge page or an unparsable body records an honest failure (review_site_challenge / review_site_parse_failed) — never a fabricated mention. Gated behind PRESENCE_REVIEW_SITES_ROLLOUT — off by default; activation is a separate rollout decision. Collector research (searched + rejected, dated): docs/mentions/PLAN.md §8.",
    },
    {
      sourceId: "youtube",
      label: SOURCE_LABELS.youtube,
      productionStatus: "planned",
      notes: "Requires official API key, quota, and product approval before any active claim.",
    },
    {
      sourceId: "amazon",
      label: SOURCE_LABELS.amazon,
      productionStatus: "manual_only",
      notes: "No automated generic marketplace scraping. Manual proof or approved affiliate API only.",
    },
    {
      sourceId: "context_dev",
      label: SOURCE_LABELS.context_dev,
      productionStatus: "planned",
      notes: "Optional backend open-web provider. Not a platform-policy bypass.",
    },
    {
      sourceId: "google",
      label: SOURCE_LABELS.google,
      productionStatus: "coming_soon",
      notes: "Google Search source wired in as a stub (seam #2218). Live adapter lands in #2181.",
    },
    {
      sourceId: "google_ads",
      label: SOURCE_LABELS.google_ads,
      productionStatus: "active",
      notes:
        "Live (issue #3197; #2189): Google's public Ads Transparency Center, the no-credential SearchCreatives RPC — no official-API key that bars commercial use. Covers creatives currently published for the tracked domain; image and text formats (video is not separately distinguishable in this capture); no spend, reach or audience metrics. Region: whatever the public Transparency Center serves without sign-in — no country filter is pinned, so there is no per-country breakdown. Freshness: re-read on the regular monitoring cadence (the cadence label is a hint; the seam runs it on every scheduled check). Killed via GOOGLE_ADS_SOURCE_DISABLED=1 (kill flag; 0/unset = on). Capture attempts and failures feed the /status capture-failure rate when the #2181 DECODO_BUDGET KV binding is wired; without it the /status line states the flag posture only.",
    },
    {
      sourceId: "tiktok",
      label: SOURCE_LABELS.tiktok,
      productionStatus: "active",
      notes:
        "TikTok Commercial Content Library wired in and live behind its flag (#2194; Nish decision 2026-09-12): EU-shown ads only — the public library publishes what reached the EU, no spend or impressions; the newest 12 ads per tracked brand, refreshed weekly with one 90-second capture attempt (a failed capture skips silently to the next week and never becomes an event). Shares the 800-requests/month Decodo render budget; requires DECODO_SCRAPER_AUTH.",
    },
    {
      sourceId: "subdomains",
      label: SOURCE_LABELS.subdomains,
      productionStatus: "coming_soon",
      notes: "New web addresses (subdomains via crt.sh) source wired in as a stub (seam #2218). Live adapter lands in #2198.",
    },
    {
      sourceId: "hiring",
      label: SOURCE_LABELS.hiring,
      productionStatus: "coming_soon",
      notes: "Hiring (job boards) source wired in as a stub (seam #2218). Live adapter lands in #2199.",
    },
  ];
}
