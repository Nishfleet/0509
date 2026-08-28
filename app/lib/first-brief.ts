import type { DigestRecord, WatchEventType } from "~/lib/types";

export const FIRST_BRIEF_KIND = "first_brief";
export const FIRST_BRIEF_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const EVIDENCE_URL_KEYS = [
  "sourceUrl",
  "proofUrl",
  "landingPageUrl",
  "websiteUrl",
  "websiteProofUrl",
  "canonicalUrl",
  "adSnapshotUrl",
] as const;

export interface FirstBriefAd {
  metaAdId: string;
  landingPageUrl: string | null;
  adSnapshotUrl: string | null;
}

export interface FirstBriefEvent {
  id: string;
  eventType: WatchEventType;
  title: string;
  summary: string;
  proofCaptureId: string | null;
  adId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface FirstBriefDigestItem {
  watchlistId: string;
  watchlistName: string;
  eventType: WatchEventType;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface MarketDeskEvidenceItem {
  label: string;
  title: string;
  detail: string;
  href: string;
}

export function isFirstBriefDigest(
  digest: Pick<DigestRecord, "summary"> | null | undefined,
): boolean {
  return digest?.summary?.kind === FIRST_BRIEF_KIND;
}

export function findFirstBriefDigest<T extends Pick<DigestRecord, "summary" | "createdAt" | "items">>(
  digests: readonly T[] | null | undefined,
): T | null {
  if (!digests?.length) return null;
  const marked = digests.find((digest) => isFirstBriefDigest(digest));
  return marked ?? null;
}

export function firstBriefPeriod(watchlistCreatedAt: string): {
  periodStart: string;
  periodEnd: string;
} {
  const startMs = Date.parse(watchlistCreatedAt);
  const periodStart = Number.isFinite(startMs)
    ? new Date(startMs).toISOString()
    : new Date().toISOString();
  return {
    periodStart,
    periodEnd: new Date(Date.parse(periodStart) + FIRST_BRIEF_PERIOD_MS).toISOString(),
  };
}

export function firstBriefEmailSubject(competitorName: string): string {
  const name = competitorName
    .replace(/[\r\n\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name ? `Your first brief: ${name}` : "Your first brief";
}

export function firstBriefAppHref(input: {
  digestId: string;
  watchlistId: string;
  eventId: string;
}): string {
  return `/app/watchlists?watchlist=${encodeURIComponent(input.watchlistId)}&event=${encodeURIComponent(input.eventId)}`;
}

export function firstBriefDigestHref(digestId: string): string {
  return `/app/digests?digest=${encodeURIComponent(digestId)}&firstrun=1#first-brief-detail`;
}

export function evidenceUrlFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  for (const key of EVIDENCE_URL_KEYS) {
    const url = safeHttpUrl(metadata[key]);
    if (url) return url;
  }
  return null;
}

export function evidenceUrlFromAd(ad: FirstBriefAd | null | undefined): string | null {
  if (!ad) return null;
  return safeHttpUrl(ad.adSnapshotUrl) ?? safeHttpUrl(ad.landingPageUrl);
}

export function resolveEvidenceUrl(input: {
  event: FirstBriefEvent;
  ads: readonly FirstBriefAd[];
}): string | null {
  const fromEvent = evidenceUrlFromMetadata(input.event.metadata);
  if (fromEvent) return fromEvent;
  if (input.event.adId) {
    const matched = input.ads.find((ad) => ad.metaAdId === input.event.adId);
    const fromAd = evidenceUrlFromAd(matched);
    if (fromAd) return fromAd;
  }
  for (const ad of input.ads) {
    const fromAd = evidenceUrlFromAd(ad);
    if (fromAd) return fromAd;
  }
  return null;
}

export function buildFirstBriefDigestItems(input: {
  watchlistId: string;
  watchlistName: string;
  events: readonly FirstBriefEvent[];
  ads: readonly FirstBriefAd[];
}): FirstBriefDigestItem[] {
  const items: FirstBriefDigestItem[] = [];
  for (const event of input.events) {
    const sourceUrl = resolveEvidenceUrl({ event, ads: input.ads });
    if (!sourceUrl) continue;
    items.push({
      watchlistId: input.watchlistId,
      watchlistName: input.watchlistName,
      eventType: event.eventType,
      title: event.title,
      summary: event.summary,
      metadata: {
        ...event.metadata,
        eventId: event.id,
        sourceUrl,
        ...(event.proofCaptureId ? { proofCaptureId: event.proofCaptureId } : {}),
        ...(event.adId ? { adId: event.adId } : {}),
        ...(event.confirmedAt ? { confirmedAt: event.confirmedAt } : {}),
        createdAt: event.createdAt,
        sourceStatus: event.proofCaptureId ? "proof_backed" : "scan_backed",
      },
    });
  }
  return items;
}

export function hasEvidenceLinkedItem(
  items: ReadonlyArray<{ metadata?: Record<string, unknown> | null }>,
): boolean {
  return items.some((item) => evidenceUrlFromMetadata(item.metadata ?? undefined) !== null);
}

export function marketDeskItemsFromFirstBrief(input: {
  digestId: string;
  items: ReadonlyArray<{
    watchlistId: string;
    title: string;
    summary: string;
    eventType: string;
    metadata?: Record<string, unknown> | null;
  }>;
}): MarketDeskEvidenceItem[] {
  const rows: MarketDeskEvidenceItem[] = [];
  for (const item of input.items) {
    const eventId =
      typeof item.metadata?.eventId === "string" ? item.metadata.eventId.trim() : "";
    const sourceUrl = evidenceUrlFromMetadata(item.metadata ?? undefined);
    if (!eventId || !sourceUrl) continue;
    rows.push({
      label: "Evidence",
      title: item.title,
      detail: item.summary,
      href: firstBriefAppHref({
        digestId: input.digestId,
        watchlistId: item.watchlistId,
        eventId,
      }),
    });
    if (rows.length >= 3) break;
  }
  return rows;
}

export function shouldEnsureFirstBrief(input: {
  watchlists: ReadonlyArray<{ isActive: boolean; lastScannedAt: string | null }>;
  digests: ReadonlyArray<Pick<DigestRecord, "summary" | "createdAt" | "items">>;
}): boolean {
  const existing = findFirstBriefDigest(input.digests);
  if (existing && hasEvidenceLinkedItem(existing.items)) {
    return false;
  }
  return input.watchlists.some(
    (watchlist) => watchlist.isActive && Boolean(watchlist.lastScannedAt),
  );
}

/**
 * BET 7 (issue #1276): the deterministic "what changed" sentence for the
 * same-session first brief. No LLM text on this surface — the sentence is
 * derived from the event's field-diff metadata (the same extractor the
 * watch-event evaluator stores) or, for a baseline capture with nothing to
 * diff yet, the fixed baseline line.
 */
export const FIRST_BRIEF_BASELINE_SENTENCE =
  "this is your baseline — we'll alert you when it moves";

const FIRST_BRIEF_FIELD_LABEL: Record<string, string> = {
  landing_page_headline_changed: "Headline",
  landing_page_offer_changed: "Offer",
  landing_page_cta_changed: "Call to action",
  landing_page_form_changed: "Form",
};

export function firstBriefWhatChangedSentence(input: {
  kind?: string | null;
  eventType: string;
  from?: string | null;
  to?: string | null;
  summary?: string | null;
}): string {
  if (input.kind === "baseline") {
    return FIRST_BRIEF_BASELINE_SENTENCE;
  }
  const label = FIRST_BRIEF_FIELD_LABEL[input.eventType];
  const from = trimToSentence(input.from);
  const to = trimToSentence(input.to);
  if (label && from && to) {
    return `${label} changed from “${from}” to “${to}”.`;
  }
  if (label && to) {
    return `${label} changed to “${to}”.`;
  }
  if (input.summary && input.summary.trim()) {
    return input.summary.trim();
  }
  return FIRST_BRIEF_BASELINE_SENTENCE;
}

function trimToSentence(value: string | null | undefined, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Minimal ad shape the inline first-brief payload needs from the ad record. */
export interface SignupFirstBriefAd {
  metaAdId: string;
  previewHeadline?: string | null;
  offer?: string | null;
  cta?: string | null;
  adSnapshotUrl?: string | null;
  landingPageUrl?: string | null;
  evidenceCapturedAt?: string | null;
}

export interface SignupFirstBriefPayload {
  digestId: string;
  eventId: string;
  watchlistId: string;
  watchlistName: string;
  headline: string | null;
  cta: string | null;
  price: string | null;
  evidenceUrl: string | null;
  screenshotDate: string | null;
  whatChanged: string;
}

/**
 * BET 7 (issue #1276): the loader data for `/app/onboard?step=first-brief`.
 * Returned as a plain object (not `Response.json`) so React Router's
 * `useLoaderData<typeof loader>` infers the shape — a `Response` return
 * contributes `never` to the inferred data type.
 */
export type SignupFirstBriefLoaderData =
  | { step: "first-brief"; status: "waiting"; watchlistName: string | null }
  | { step: "first-brief"; status: "ready"; brief: SignupFirstBriefPayload };

/**
 * Assemble the inline first-brief payload from a filed first-brief digest and
 * the ads its items reference. Picks the first evidence-linked item (the same
 * `hasEvidenceLinkedItem` gate the dashboard uses) so the surface always shows
 * one dated, evidence-linked change. Returns null when no item carries an
 * evidence URL — the caller then renders the waiting state.
 */
export function buildSignupFirstBriefPayload(input: {
  digest: Pick<DigestRecord, "id" | "items">;
  ads: readonly SignupFirstBriefAd[];
}): SignupFirstBriefPayload | null {
  const items = input.digest.items ?? [];
  for (const item of items) {
    const evidenceUrl = evidenceUrlFromMetadata(item.metadata ?? undefined);
    if (!evidenceUrl) continue;
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const eventId =
      typeof metadata.eventId === "string" ? metadata.eventId : "";
    if (!eventId) continue;
    const adId =
      typeof metadata.adId === "string" ? metadata.adId : null;
    const ad = adId
      ? input.ads.find((candidate) => candidate.metaAdId === adId) ?? null
      : null;
    const headline = trimToSentence(ad?.previewHeadline ?? null) ?? trimToSentence(item.title);
    const cta = trimToSentence(ad?.cta ?? null);
    const price = trimToSentence(ad?.offer ?? null);
    const screenshotDate =
      trimToSentence(typeof metadata.capturedAt === "string" ? metadata.capturedAt : null) ??
      trimToSentence(ad?.evidenceCapturedAt ?? null);
    const whatChanged = firstBriefWhatChangedSentence({
      kind: typeof metadata.kind === "string" ? metadata.kind : null,
      eventType: item.eventType,
      from: typeof metadata.from === "string" ? metadata.from : null,
      to: typeof metadata.to === "string" ? metadata.to : null,
      summary: item.summary,
    });
    return {
      digestId: input.digest.id,
      eventId,
      watchlistId: item.watchlistId,
      watchlistName: item.watchlistName,
      headline,
      cta,
      price,
      evidenceUrl,
      screenshotDate,
      whatChanged,
    };
  }
  return null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
