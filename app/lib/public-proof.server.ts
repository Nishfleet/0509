/**
 * Public proof brief — the REAL evidence trail shown on public surfaces
 * (homepage proof section, /api/proof brief) instead of any sample fixture.
 *
 * ABSOLUTE CONSTRAINT (same as brand-page.server.ts): everything here renders
 * from the existing discovery cache. A public request must NEVER trigger live
 * scraping, Browser Rendering, Meta API calls, or any other paid operation.
 * The only I/O is the bounded D1 read inside `loadBrandPageCacheSnapshot`.
 *
 * Honesty rules, inherited from the brand-page playbook:
 * - demo/sample-sourced cache entries are never returned (a public surface
 *   must not present sample data as a competitor's real ads);
 * - every number, hook, CTA, timestamp, and source link traces to a real
 *   cached creative or the cache entry's own fetchedAt clock;
 * - when no usable real cache exists, loadPublicProofBrief returns null and
 *   callers render an explicit "no live proof yet" state — never a fixture.
 */

import { formatBrandPageCheckedAgo, loadBrandPageCacheSnapshot } from "~/lib/brand-page.server";
import type { AppEnv } from "~/lib/env.server";
import type { AdRecord } from "~/lib/types";

/** The competitor featured on the homepage proof section. */
export const PUBLIC_PROOF_FEATURED_WEBSITE = "nykaa.com";
/** Cap the number of creatives used to build the public proof brief. */
export const PUBLIC_PROOF_MAX_ADS = 12;
/** Cap the source-trail rows rendered on the public surface. */
export const PUBLIC_PROOF_MAX_TRAIL_ITEMS = 3;

export interface PublicProofTrailItem {
  id: string;
  /** What moved / what the creative says, e.g. "Ad hook". */
  signal: string;
  /** The real captured text (hook, offer, CTA). */
  evidence: string;
  /** Where the capture came from, e.g. "Meta Ad Library — Nykaa Beauty". */
  source: string;
  /** Real link a visitor can open to verify the capture themselves. */
  sourceUrl: string | null;
  /** Real capture clock (last seen, else first seen, else cache fetchedAt). */
  capturedAt: string | null;
}

export interface PublicProofBrief {
  competitorName: string;
  website: string;
  adLibraryCountry: string | null;
  /** ISO timestamp of the underlying Ad Library check. */
  fetchedAt: string;
  /** Human freshness stamp, e.g. "about 4 hours ago". */
  checkedAgoLabel: string;
  freshForLiveClaim: boolean;
  adCount: number;
  activeAdCount: number;
  summary: string;
  decision: {
    subject: string;
    whatChanged: string;
    whyItMatters: string;
    priority: string;
    proofStatus: string;
    source: string;
    freshness: string;
    nextAction: string;
  };
  proofTrail: PublicProofTrailItem[];
  insights: {
    topHooks: string[];
    mediaMix: Array<{ channel: string; count: number }>;
    timeline: string[];
  };
  reportRows: string[];
}

export interface PublicProofBriefLoadOptions {
  now?: Date;
}

/**
 * Cache-only read of the featured competitor's real proof. Returns null when
 * no usable real cache exists (unconfigured/demo provider, no D1, cache miss,
 * stale cache, or a D1 hiccup) — callers must render the honest empty state.
 */
export async function loadPublicProofBrief(
  env: AppEnv,
  options: PublicProofBriefLoadOptions = {},
): Promise<PublicProofBrief | null> {
  const now = options.now ?? new Date();
  try {
    const snapshot = await loadBrandPageCacheSnapshot(env, {
      domain: PUBLIC_PROOF_FEATURED_WEBSITE,
      visitorCountry: "all",
      now,
    });
    if (!snapshot) {
      return null;
    }
    return buildPublicProofBrief(snapshot.ads, {
      fetchedAt: snapshot.fetchedAt,
      country: snapshot.country,
      freshForLiveClaim: snapshot.freshForLiveClaim,
      checkedAgoLabel: formatBrandPageCheckedAgo(snapshot.fetchedAt, now),
      website: PUBLIC_PROOF_FEATURED_WEBSITE,
      now,
    });
  } catch (error) {
    // A cache-read hiccup degrades to the honest "no live proof yet" state,
    // never a 500 and never a live-provider fallback.
    console.warn("Public proof brief cache read failed; rendering the honest state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

export function buildPublicProofBrief(
  ads: AdRecord[],
  input: {
    fetchedAt: string;
    country: string;
    freshForLiveClaim: boolean;
    checkedAgoLabel: string;
    website: string;
    now?: Date;
  },
): PublicProofBrief | null {
  const realAds = ads.filter((ad) => ad && ad.source !== "demo").slice(0, PUBLIC_PROOF_MAX_ADS);
  if (realAds.length === 0) {
    return null;
  }

  const now = input.now ?? new Date();
  const competitorName = displayNameForWebsite(input.website);
  const activeAdCount = realAds.filter((ad) => ad.active).length;
  const formats = [...new Set(realAds.map((ad) => ad.format).filter(Boolean))];
  const trail = buildProofTrail(realAds, input.fetchedAt);

  return {
    competitorName,
    website: input.website,
    adLibraryCountry: input.country === "all" ? null : input.country,
    fetchedAt: input.fetchedAt,
    checkedAgoLabel: input.checkedAgoLabel,
    freshForLiveClaim: input.freshForLiveClaim,
    adCount: realAds.length,
    activeAdCount,
    summary: buildSummary(realAds, input),
    decision: buildDecision(realAds, trail, input, now),
    proofTrail: trail,
    insights: buildInsights(realAds, input.fetchedAt, now),
    reportRows: buildReportRows(realAds, input),
  };
}

function buildSummary(ads: AdRecord[], input: { website: string; country: string }): string {
  const countryPhrase =
    input.country === "all" ? "in the Meta Ad Library" : `in the ${input.country} Ad Library`;
  // The separator is part of the template, not the phrase: without it the
  // live homepage brief rendered "…link to nykaa.comin the Meta Ad Library."
  return `${ads.length} public Meta ads link to ${input.website} ${countryPhrase}. Every source below opens the same page any visitor can open.`;
}

function buildDecision(
  ads: AdRecord[],
  trail: PublicProofTrailItem[],
  input: {
    website: string;
    country: string;
    fetchedAt: string;
    freshForLiveClaim: boolean;
    checkedAgoLabel: string;
  },
  now: Date,
) {
  const topHook = firstText(ads.map((ad) => ad.hook || ad.previewHeadline));
  const topCta = firstText(ads.map((ad) => ad.cta));
  const topOffer = firstText(ads.map((ad) => ad.offer));
  const activePhrase = ads.filter((ad) => ad.active).length;
  // "right now" is a live claim — honest only while the capture is young
  // enough for the live-claim window (same discipline as /ads/:domain pages).
  const subject = `${activePhrase} of ${ads.length} cached ads ${
    input.freshForLiveClaim ? "are active right now" : "are active on record"
  }`;
  const whatChangedParts = [
    topHook ? `The most repeated hook is “${topHook}”` : null,
    topCta ? `the CTA “${topCta}”` : null,
    topOffer ? `and the offer “${topOffer}”` : null,
  ].filter(Boolean);
  const whatChanged =
    whatChangedParts.length > 0
      ? whatChangedParts.join(", ") + "."
      : `${ads.length} creatives are on record with captured text.`;
  const whyItMatters = `These creatives are the angle ${displayNameForWebsite(input.website)} ${
    input.freshForLiveClaim ? "is testing" : "has on record"
  } in the Meta Ad Library — review the same pages before your next campaign refresh.`;
  const sourceUrl = trail.find((item) => item.sourceUrl)?.sourceUrl ?? null;
  const countryPhrase =
    input.country === "all" ? "the Meta Ad Library" : `the ${input.country} Ad Library`;
  const freshness =
    input.freshForLiveClaim && input.checkedAgoLabel
      ? `Checked moments ago — captured ${formatCapturedAt(input.fetchedAt, now)}`
      : `Last checked ${input.checkedAgoLabel} — captured ${formatCapturedAt(input.fetchedAt, now)}`;

  return {
    subject,
    whatChanged,
    whyItMatters,
    priority: "Review before the next campaign refresh",
    proofStatus: `Captured from ${countryPhrase} on ${formatCapturedAt(input.fetchedAt, now)}`,
    source: `Meta Ad Library (public archive) — ${countryPhrase}`,
    freshness,
    nextAction: sourceUrl
      ? `Open the same ad in ${countryPhrase}`
      : `Run the public search preview for ${input.website}`,
  };
}

function buildProofTrail(ads: AdRecord[], fetchedAt: string): PublicProofTrailItem[] {
  const seen = new Set<string>();
  const items: PublicProofTrailItem[] = [];
  for (const ad of ads) {
    if (items.length >= PUBLIC_PROOF_MAX_TRAIL_ITEMS) {
      break;
    }
    const signal = trailSignal(ad);
    const evidence = trailEvidence(ad);
    if (!signal || !evidence) {
      continue;
    }
    const id = `${ad.metaAdId}:${signal}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    items.push({
      id,
      signal,
      evidence,
      source: trailSource(ad),
      sourceUrl: trailSourceUrl(ad),
      capturedAt: trailCapturedAt(ad, fetchedAt),
    });
  }
  return items;
}

function trailSignal(ad: AdRecord): string | null {
  if (ad.hook?.trim() || ad.previewHeadline?.trim()) return "Ad hook";
  if (ad.cta?.trim()) return "Ad CTA";
  if (ad.offer?.trim()) return "Ad offer";
  if (ad.creativeText?.trim()) return "Creative text";
  return null;
}

function trailEvidence(ad: AdRecord): string | null {
  const parts = [
    ad.hook?.trim() || ad.previewHeadline?.trim() || null,
    ad.offer?.trim() || null,
    ad.cta?.trim() || null,
  ].filter(Boolean);
  if (parts.length === 0) {
    return ad.creativeText?.trim() || null;
  }
  return parts.slice(0, 2).join(" — ");
}

function trailSource(ad: AdRecord): string {
  const advertiser = ad.advertiser?.trim();
  return advertiser ? `Meta Ad Library — ${advertiser}` : "Meta Ad Library";
}

function trailSourceUrl(ad: AdRecord): string | null {
  return ad.adSnapshotUrl?.trim() || ad.landingPageUrl?.trim() || null;
}

function trailCapturedAt(ad: AdRecord, fetchedAt: string): string | null {
  return ad.lastSeenAt?.trim() || ad.firstSeenAt?.trim() || fetchedAt;
}

/** Fresh window for the proof-brief timeline. Mirrors the proof-strip
 *  `PROOF_CAPTURE_FRESH_DAYS` in marketing.tsx: a creative whose first-seen
 *  date (Meta Ad Library `ad_creation_time`) is older than this is a
 *  long-running ad, not a freshly captured one. */
const PROOF_TIMELINE_FRESH_DAYS = 30;

function captureAgeDays(iso: string, now: Date): number {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00.000Z`)
    : new Date(iso);
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

/** Format a timeline first-seen date with the year ALWAYS shown. A timeline
 *  spans capture dates that can cross UTC years; omitting the year on a
 *  same-year entry ("Jul 16") next to a prior-year sibling ("Sep 4, 2025")
 *  is ambiguous — a reader cannot tell which year "Jul 16" belongs to
 *  (#1286/#1343 live regression on the proof brief). */
function formatTimelineFirstSeen(iso: string, now: Date): string {
  void now;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const parsed = new Date(`${iso}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return "a recent check";
    return parsed.toLocaleString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "a recent check";
  return parsed.toLocaleString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function buildInsights(ads: AdRecord[], fetchedAt: string, now: Date) {
  const topHooks = uniqueTexts(ads.map((ad) => ad.hook || ad.previewHeadline)).slice(0, 3);
  const landingCount = ads.filter((ad) => ad.landingPageUrl?.trim()).length;
  const mediaMix = [
    { channel: "Meta Ad Library", count: ads.length - landingCount },
    { channel: "Landing pages", count: landingCount },
  ].filter((entry) => entry.count > 0);

  const seenDates = new Set<string>();
  const timeline: string[] = [];
  for (const ad of ads) {
    const firstSeen = ad.firstSeenAt?.trim();
    if (!firstSeen) continue;
    const dateKey = firstSeen.slice(0, 10);
    if (seenDates.has(dateKey)) continue;
    seenDates.add(dateKey);
    const label = formatTimelineFirstSeen(firstSeen, now);
    // The per-row first-seen date is the Meta Ad Library ad_creation_time,
    // not the moment we fetched the cache. Framing a year-old first-seen
    // date as "Creative started running <old date>" next to the header's
    // "Captured <today>" reads as an 11-month contradiction (#1286/#1343,
    // which the proof-strip fix left live on the proof-brief timeline).
    // "On record since" keeps the honest first-seen fact while matching the
    // strip's "On record" language so the only capture CLOCK on the page is
    // the header-level fetch date.
    const stale = captureAgeDays(firstSeen, now) > PROOF_TIMELINE_FRESH_DAYS;
    timeline.push(
      stale ? `Creative on record since ${label}` : `Creative started running ${label}`,
    );
    if (timeline.length >= 3) break;
  }
  if (timeline.length === 0) {
    timeline.push(`Capture on record ${formatCapturedAt(fetchedAt, now)}`);
  }
  timeline.push(`Brief generated from ${ads.length} real captures`);

  return { topHooks, mediaMix, timeline };
}

function buildReportRows(ads: AdRecord[], input: { website: string; country: string }): string[] {
  const activePhrase = ads.filter((ad) => ad.active).length;
  const countryPhrase =
    input.country === "all" ? "the Meta Ad Library" : `the ${input.country} Ad Library`;
  return [
    `What is captured: ${activePhrase} of ${ads.length} cached creatives are active`,
    `Source trail: every row links to the same public ${countryPhrase} page`,
    "Next action: review the angle before your next campaign refresh",
  ];
}

function displayNameForWebsite(website: string): string {
  const host = website.replace(/^www\./, "").split(".")[0] ?? "";
  return host ? host.charAt(0).toUpperCase() + host.slice(1) : website;
}

function firstText(values: string[]): string | null {
  return values.find((value) => value?.trim())?.trim() ?? null;
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function formatCapturedAt(iso: string, now: Date): string {
  // Date-only Meta Ad Library captures (YYYY-MM-DD) carry no time of day;
  // rendering them with a clock would fabricate "12:00 AM". Show the date
  // only. timeZone: "UTC" keeps the calendar date stable across runtimes
  // because new Date("YYYY-MM-DD") is UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const parsed = new Date(`${iso}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return "a recent check";
    }
    return parsed.toLocaleString("en", {
      month: "short",
      day: "numeric",
      ...(capturedYearDiffers(parsed, now) ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "a recent check";
  }
  return parsed.toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(capturedYearDiffers(parsed, now) ? { year: "numeric" } : {}),
  });
}

// A capture from a prior (or, defensively, future) UTC year must carry its
// year so it cannot read as a recent same-year date. Same-year dates keep the
// existing compact rendering. See issue #1032.
function capturedYearDiffers(parsed: Date, now: Date): boolean {
  return parsed.getUTCFullYear() !== now.getUTCFullYear();
}
