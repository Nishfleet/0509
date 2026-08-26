import { normalizeBrandPageDomain } from "~/lib/brand-page.server";
import {
  CustomerAgentActionError,
  requireString,
} from "~/lib/customer-agent-actions/request.server";
import { queryAll } from "~/lib/data/d1.server";
import { parseJson } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  canonicalUrlBelongsToDomain,
  diffOfferStates,
  offerStateAsOf,
  parseAsOfDate,
  parseSinceInstant,
  type OfferLedgerEntry,
  type OfferTransition,
} from "~/lib/offer-timeline";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";
import { proofPageTextSrc } from "~/lib/proof-page-text";
import { proofScreenshotSrc } from "~/lib/proof-screenshot";

const CHANGE_HISTORY_EVENT_LIMIT = 100;

interface DomainWatchEventRow {
  id: string;
  watchlist_id: string;
  event_type: string;
  title: string;
  summary: string;
  created_at: string;
  suppressed_at: string | null;
  proof_capture_id: string | null;
  metadata_json: string | null;
  screenshot_artifact_key: string | null;
  html_artifact_key: string | null;
  succeeded_at: string | null;
  attempted_at: string | null;
  target_id: string;
  landing_page_url: string | null;
}

export interface ChangeHistoryEvent {
  id: string;
  watchlistId: string;
  eventType: string;
  title: string;
  summary: string;
  capturedAt: string;
  suppressedAt: string | null;
  evidenceLink: string | null;
  pageTextLink: string | null;
}

export async function getChangeHistoryFromAgent(
  env: AppEnv,
  workspaceUserId: string,
  input: Record<string, unknown>,
  origin: string | null,
) {
  const domain = requireDomain(input);
  const since = requireSince(input);
  const loaded = await loadOfferTimeline(env, { domain, asOf: null });
  const offerChanges = loaded.entries
    .filter((entry) => entry.capturedAt >= since && entry.transition)
    .map((entry) => serializeOfferState(entry, origin));
  const events = (await listDomainWatchEvents(env, workspaceUserId, domain, { since }))
    .filter((event) => !event.suppressedAt)
    .map((event) => serializeWatchEvent(event, origin));

  return {
    domain,
    since,
    offerChanges,
    events,
  };
}

export async function getOfferStateAtFromAgent(
  env: AppEnv,
  input: Record<string, unknown>,
  origin: string | null,
) {
  const domain = requireDomain(input);
  const date = requireAsOf(input, "date");
  const loaded = await loadOfferTimeline(env, { domain, asOf: date });
  return {
    domain,
    date,
    state: loaded.asOfState ? serializeOfferState(loaded.asOfState, origin) : null,
  };
}

export async function diffOfferFromAgent(
  env: AppEnv,
  input: Record<string, unknown>,
  origin: string | null,
) {
  const domain = requireDomain(input);
  const dateA = requireAsOf(input, "dateA");
  const dateB = requireAsOf(input, "dateB");
  const loaded = await loadOfferTimeline(env, { domain, asOf: null });
  const stateA = offerStateAsOf(loaded.entries, dateA);
  const stateB = offerStateAsOf(loaded.entries, dateB);
  const earlier = dateA <= dateB ? stateA : stateB;
  const later = dateA <= dateB ? stateB : stateA;
  const diff: OfferTransition | null = earlier && later
    ? diffOfferStates(earlier, later)
    : null;

  return {
    domain,
    dateA,
    dateB,
    stateA: stateA ? serializeOfferState(stateA, origin) : null,
    stateB: stateB ? serializeOfferState(stateB, origin) : null,
    diff,
  };
}

export async function listSuppressedFromAgent(
  env: AppEnv,
  workspaceUserId: string,
  input: Record<string, unknown>,
  origin: string | null,
) {
  const domain = requireDomain(input);
  const events = (await listDomainWatchEvents(env, workspaceUserId, domain, { suppressedOnly: true }))
    .map((event) => serializeWatchEvent(event, origin));

  return {
    domain,
    events,
  };
}

function requireDomain(input: Record<string, unknown>) {
  const raw = requireString(input, "domain");
  const brand = normalizeBrandPageDomain(raw);
  if (!brand) {
    throw new CustomerAgentActionError("invalid_domain", "Provide a registrable domain such as gymshark.com.");
  }
  return brand.domain;
}

function requireAsOf(input: Record<string, unknown>, field: string) {
  const value = parseAsOfDate(requireString(input, field));
  if (!value) {
    throw new CustomerAgentActionError("invalid_date", `${field} must be a UTC calendar date (YYYY-MM-DD).`);
  }
  return value;
}

function requireSince(input: Record<string, unknown>) {
  const value = parseSinceInstant(requireString(input, "since"));
  if (!value) {
    throw new CustomerAgentActionError(
      "invalid_since",
      "since must be a UTC calendar date (YYYY-MM-DD) or an ISO timestamp.",
    );
  }
  return value;
}

function serializeOfferState(entry: OfferLedgerEntry, origin: string | null) {
  return {
    id: entry.id,
    capturedAt: entry.capturedAt,
    dateLabel: entry.dateLabel,
    canonicalUrl: entry.canonicalUrl,
    headline: entry.headline,
    ctaText: entry.ctaText,
    priceText: entry.priceText,
    formPresent: entry.formPresent,
    evidenceLink: absoluteHref(origin, entry.screenshotHref),
    pageTextLink: absoluteHref(origin, entry.pageTextHref),
    transition: entry.transition,
  };
}

function serializeWatchEvent(event: ChangeHistoryEvent, origin: string | null) {
  return {
    ...event,
    evidenceLink: absoluteHref(origin, event.evidenceLink),
    pageTextLink: absoluteHref(origin, event.pageTextLink),
  };
}

function absoluteHref(origin: string | null, href: string | null) {
  if (!href) {
    return null;
  }
  if (!origin || href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return `${origin.replace(/\/$/, "")}${href}`;
}

async function listDomainWatchEvents(
  env: AppEnv,
  workspaceUserId: string,
  domain: string,
  options: { since?: string; suppressedOnly?: boolean } = {},
): Promise<ChangeHistoryEvent[]> {
  if (!env.DB) {
    return [];
  }

  let rows: DomainWatchEventRow[] = [];
  try {
    rows = await queryAll<DomainWatchEventRow>(
      env,
      `
        SELECT
          watch_event.id,
          watch_event.watchlist_id,
          watch_event.event_type,
          watch_event.title,
          watch_event.summary,
          watch_event.created_at,
          watch_event.suppressed_at,
          watch_event.proof_capture_id,
          watch_event.metadata_json,
          proof_capture.screenshot_artifact_key,
          proof_capture.html_artifact_key,
          proof_capture.succeeded_at,
          proof_capture.attempted_at,
          watchlist.target_id,
          proof_target.landing_page_url
        FROM watch_event
        INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
        LEFT JOIN proof_capture ON proof_capture.id = watch_event.proof_capture_id
        LEFT JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        WHERE watchlist.user_id = ?
          ${options.suppressedOnly ? "AND watch_event.status = 'suppressed'" : ""}
          ${options.since ? "AND watch_event.created_at >= ?" : ""}
        ORDER BY COALESCE(watch_event.suppressed_at, watch_event.created_at) DESC, watch_event.id DESC
        LIMIT ?
      `,
      ...(options.since
        ? [workspaceUserId, options.since, CHANGE_HISTORY_EVENT_LIMIT]
        : [workspaceUserId, CHANGE_HISTORY_EVENT_LIMIT]),
    );
  } catch (error) {
    if (isMissingChangeHistoryTable(error)) {
      return [];
    }
    throw error;
  }

  return rows
    .filter((row) => rowBelongsToDomain(row, domain))
    .map((row) => ({
      id: row.id,
      watchlistId: row.watchlist_id,
      eventType: row.event_type,
      title: row.title,
      summary: row.summary,
      capturedAt: row.succeeded_at ?? row.attempted_at ?? row.created_at,
      suppressedAt: row.suppressed_at,
      evidenceLink: proofScreenshotSrc(row.screenshot_artifact_key),
      pageTextLink: proofPageTextSrc(row.html_artifact_key),
    }));
}

function rowBelongsToDomain(row: DomainWatchEventRow, domain: string) {
  if (row.landing_page_url && canonicalUrlBelongsToDomain(row.landing_page_url, domain)) {
    return true;
  }
  if (valueBelongsToDomain(row.target_id, domain)) {
    return true;
  }
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  return ["canonicalUrl", "landingPageUrl", "url", "pageUrl"].some((field) =>
    valueBelongsToDomain(metadata[field], domain),
  );
}

function valueBelongsToDomain(value: unknown, domain: string) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const trimmed = value.trim();
  if (canonicalUrlBelongsToDomain(trimmed, domain)) {
    return true;
  }
  if (trimmed.includes("://")) {
    return false;
  }
  const asUrl = `https://${trimmed.replace(/^www\./i, "")}`;
  return canonicalUrlBelongsToDomain(asUrl, domain);
}

function isMissingChangeHistoryTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("no such table") && (
    message.includes("watch_event")
    || message.includes("proof_capture")
    || message.includes("proof_target")
    || message.includes("watchlist")
  );
}
