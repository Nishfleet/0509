/**
 * Public /status health counters — aggregate, non-tenant monitoring facts.
 *
 * These are the only monitoring numbers surfaced on the public buyer-facing
 * status page: how many watchlist runs happened, how many failed, and the
 * last digest-sent timestamp. No per-account or per-competitor data is
 * ever read here. Every query is a cheap aggregate or a single MAX/LIMIT 1
 * scan over an indexed column.
 */

import { queryOne as one } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { monitoringCoverageDays } from "~/lib/monitoring-coverage";
import {
  listScheduledObservationHealth,
  readStatusUptime,
  type StatusUptimeReading,
} from "~/lib/scheduled-observation-health.server";

export const DIGEST_STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Honest digest-pipeline state for /status.
 *
 * `recent`: a digest was sent within the staleness threshold. The
 * Cloudflare Email channel records a delivery as `sent` at provider-accept
 * time (`created_at`); see the note on `lastDigestSentAt` below.
 *
 * `stalled`: no digest has been sent for more than the 7-day threshold while
 * watchlist monitoring is otherwise healthy. This is the contradiction the
 * trust surface must never render silently — monitoring alive but the brief
 * pipeline silent.
 *
 * `unknown`: either we have no digest record at all and monitoring is also
 * silent, or this is the pre-send bootstrap. Not a contradiction, so the page
 * shows honest prose instead of a fabricated stall.
 */
export type DigestHealthState = "recent" | "stalled" | "unknown";

export function digestHealthState(counters: {
  runsInLast24h: number;
  failedRunsInLast24h: number;
  lastDigestSentAt: string | null;
}): DigestHealthState {
  // "Monitoring healthy" = at least one run succeeded in the last 24h. A
  // digest stall is only a contradiction (the thing the detector exists to
  // surface) when monitoring is genuinely succeeding — if every run is
  // failing the whole pipeline is down, not just digests.
  const monitoringHealthy =
    counters.runsInLast24h - counters.failedRunsInLast24h > 0;
  if (!counters.lastDigestSentAt) {
    // Without a send record, a stall claim would need healthy monitoring to
    // support it (the product has been sending since before this page existed).
    return monitoringHealthy ? "stalled" : "unknown";
  }
  const ageMs = Date.now() - new Date(counters.lastDigestSentAt).getTime();
  if (ageMs <= DIGEST_STALENESS_THRESHOLD_MS) {
    return "recent";
  }
  return monitoringHealthy ? "stalled" : "unknown";
}

export interface PublicStatusCounters {
  /** ISO timestamp of the most recently started watchlist run, any status. */
  lastWatchlistRunAt: string | null;
  /** Number of watchlist runs started in the last 24 hours. */
  runsInLast24h: number;
  /** Number of watchlist runs in the last 24 hours whose status is `failed`. */
  failedRunsInLast24h: number;
  /** ISO timestamp of the most recently sent digest, or null. */
  lastDigestSentAt: string | null;
  /**
   * Derived contradiction state (see {@link digestHealthState}): `recent` when
   * a digest was sent recently, `stalled` when digests are silent while
   * monitoring is healthy, `unknown` otherwise.
   */
  digestHealth: DigestHealthState;
  /**
   * Earliest scheduled-observation baseline (`scheduled_observation_health_state`):
   * the date the service's monitoring schedules were first activated and have
   * been continuously configured since. Real coverage data, not a fabricated
   * uptime percentage; null when the table is unreadable or empty.
   */
  scheduledMonitoringSince: string | null;
}

/**
 * Read the aggregate monitoring counters for /status. Returns null when the
 * database is not configured so the route can degrade to static prose. A
 * live D1 read error propagates so the route's loader can catch it and
 * degrade explicitly (requirement: a stale number is never rendered without
 * its timestamp).
 */
export async function getPublicStatusCounters(
  env: AppEnv,
): Promise<PublicStatusCounters | null> {
  if (!env.DB) {
    return null;
  }

  const dayAgoIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const [lastRunRow, countsRow, digestRow, baselineRow] = await Promise.all([
    one<{ last_started_at: string | null }>(
      env,
      `SELECT MAX(started_at) AS last_started_at FROM watchlist_run`,
    ),
    one<{ total: number; failed: number }>(
      env,
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM watchlist_run
        WHERE started_at >= ?
      `,
      dayAgoIso,
    ),
    one<{ last_digest_sent_at: string | null }>(
      env,
      `
        SELECT MAX(created_at) AS last_digest_sent_at
        FROM digest_delivery
        WHERE status = 'sent'
      `,
    ),
    one<{ active_since: string | null }>(
      env,
      `
        SELECT MIN(baseline_at) AS active_since
        FROM scheduled_observation_health_state
      `,
    ),
  ]);

  const counters = {
    lastWatchlistRunAt: lastRunRow?.last_started_at ?? null,
    runsInLast24h: Number(countsRow?.total ?? 0),
    failedRunsInLast24h: Number(countsRow?.failed ?? 0),
    lastDigestSentAt: digestRow?.last_digest_sent_at ?? null,
  };

  // The `lastDigestSentAt` timestamp MUST never be read from `delivered_at`:
  // the Cloudflare Email channel records a digest as `sent` at provider-accept
  // time and has no delivery-confirmation webhook, so `delivered_at` is NULL
  // for email digests (issue #1780). `MAX(delivered_at)` therefore freezes at
  // the last confirmed delivery — a stale date that contradicts the healthy
  // watchlist counters right beside it on the same page. Reading `created_at`
  // across `status = 'sent'` returns the true last-sent timestamp. If email
  // confirmation is ever wired, switch this back to `MAX(delivered_at)`.
  return {
    ...counters,
    scheduledMonitoringSince: baselineRow?.active_since ?? null,
    digestHealth: digestHealthState(counters),
  };
}

/**
 * The public coverage figure for the marketing footer (issue #2972): whole
 * days of continuous scheduled-monitoring coverage derived from the earliest
 * recorded baseline — the same honest figure /status publishes, never a
 * fabricated uptime percentage. One bounded MIN() read; returns null when
 * the DB is not configured, and a live read error propagates so the route's
 * loader can degrade to the link-only footer explicitly.
 */
export async function getMonitoringCoverageDays(
  env: AppEnv,
): Promise<number | null> {
  if (!env.DB) {
    return null;
  }
  const baselineRow = await one<{ active_since: string | null }>(
    env,
    `
      SELECT MIN(baseline_at) AS active_since
      FROM scheduled_observation_health_state
    `,
  );
  return monitoringCoverageDays(
    baselineRow?.active_since ?? null,
    new Date().toISOString(),
  );
}

// ---------------------------------------------------------------------------
// Measured surface rows for /status.
//
// Every row is a live read of a table or probe the service already writes.
// No row may claim a state without a source; a probe that cannot run reads as
// "degraded" (or "down" for a failed D1 probe) with a one-line reason. The
// banned status-page confession phrasing ("not measured", "unavailable",
// ...) is enforced by tests/public-tree-phrase-ban.test.ts.
// ---------------------------------------------------------------------------

export type SurfaceState = "operational" | "degraded" | "down";

export type SurfaceId =
  | "public-search"
  | "sign-in"
  | "billing"
  | "email"
  | "monitoring"
  | "uptime";

export interface SurfaceMeasurement {
  id: SurfaceId;
  label: string;
  state: SurfaceState;
  /** One-line reason, present exactly when state is degraded or down. */
  reason: string | null;
  /** Measured fact lines. Each is a full clause with its numbers. */
  facts: string[];
  /** ISO time this surface's probe last ran. */
  checkedAt: string;
  /** Where the numbers come from; rendered as the row's source caption. */
  source: string;
}

export interface PublicStatusSurfaces {
  asOf: string;
  surfaces: SurfaceMeasurement[];
  /** Detailed monitoring counters for the "Monitoring health" block. */
  monitoring: PublicStatusCounters | null;
}

const SEARCH_CACHE_REFRESH_MAX_AGE_MS = 26 * 60 * 60 * 1000; // nightly publisher deadline
const UPTIME_SAMPLE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // hourly rail must not lag

function degraded(
  base: Omit<SurfaceMeasurement, "state" | "reason">,
  reason: string,
): SurfaceMeasurement {
  return { ...base, state: "degraded", reason };
}

function operational(
  base: Omit<SurfaceMeasurement, "state" | "reason">,
): SurfaceMeasurement {
  return { ...base, state: "operational", reason: null };
}

function down(
  base: Omit<SurfaceMeasurement, "state" | "reason">,
  reason: string,
): SurfaceMeasurement {
  return { ...base, state: "down", reason };
}

/**
 * Measure every core surface with one pass of read-only queries. Never
 * throws: each probe is individually guarded, and a failed D1 probe reads as
 * "down" on the storage-backed rows instead of an error page. The page the
 * loader renders always stays up.
 */
export async function getPublicStatusSurfaces(
  env: AppEnv,
): Promise<PublicStatusSurfaces> {
  const asOf = new Date().toISOString();
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  if (!env.DB) {
    const base = (id: SurfaceId, label: string, source: string) => ({
      id,
      label,
      checkedAt: asOf,
      facts: [] as string[],
      source,
    });
    return {
      asOf,
      monitoring: null,
      surfaces: [
        degraded(base("public-search", "Public search", "edge probe"),
          "the page is being served without the application database binding"),
        degraded(base("sign-in", "Sign-in", "edge probe"),
          "the page is being served without the application database binding"),
        degraded(base("billing", "Billing", "edge probe"),
          "the page is being served without the application database binding"),
        degraded(base("email", "Email delivery", "edge probe"),
          "the page is being served without the application database binding"),
        degraded(base("monitoring", "Scheduled monitoring", "edge probe"),
          "the page is being served without the application database binding"),
        degraded(base("uptime", "Uptime", "edge probe"),
          "the page is being served without the application database binding"),
      ],
    };
  }

  // Shared D1 liveness: one SELECT 1. When this fails, every storage-backed
  // row reports down with the same reason instead of pretending health.
  let d1Ok = true;
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    d1Ok = false;
  }
  const d1Reason = "the database probe failed";
  const base = (id: SurfaceId, label: string, source: string) => ({
    id,
    label,
    checkedAt: asOf,
    facts: [] as string[],
    source,
  });

  const [
    countersResult,
    searchResult,
    signInResult,
    billingResult,
    emailResult,
    uptimeResult,
  ] = await Promise.allSettled([
    getPublicStatusCountersWithWatchlists(env, dayAgoIso),
    measurePublicSearch(env, dayAgoIso),
    measureSignIn(env, dayAgoIso),
    measureBilling(env, dayAgoIso),
    measureEmailDelivery(env, dayAgoIso),
    measureUptime(env),
  ]);

  const surfaces: SurfaceMeasurement[] = [];

  // Public search.
  if (!d1Ok) {
    surfaces.push(down(base("public-search", "Public search", "edge and D1 probes, discovery_cache_entry, rate_limit_events"), d1Reason));
  } else if (searchResult.status === "fulfilled") {
    const row = searchResult.value;
    const m = base("public-search", "Public search", "edge and D1 probes, discovery_cache_entry, rate_limit_events");
    const facts: string[] = [
      `${row.cachedSets.toLocaleString()} cached public result sets`,
    ];
    if (row.freshestFetchAt) {
      facts.push(`freshest provider fetch ${ageClause(row.freshestFetchAt, asOf)}`);
    }
    if (row.searchesServed10m !== null) {
      facts.push(`${row.searchesServed10m.toLocaleString()} searches served in the last 10 minutes`);
    }
    m.facts = facts;
    if (row.cachedSets === 0) {
      surfaces.push(degraded(m, "no cached search result set has been recorded yet"));
    } else if (
      row.freshestFetchAt &&
      Date.parse(asOf) - Date.parse(row.freshestFetchAt) > SEARCH_CACHE_REFRESH_MAX_AGE_MS
    ) {
      surfaces.push(degraded(m, "the nightly result refresh is overdue"));
    } else {
      surfaces.push(operational(m));
    }
  } else {
    surfaces.push(degraded(base("public-search", "Public search", "edge and D1 probes, discovery_cache_entry, rate_limit_events"), "the search storage probe failed"));
  }

  // Sign-in (one-time email link dispatch).
  if (!d1Ok) {
    surfaces.push(down(base("sign-in", "Sign-in", "edge and D1 probes, better_auth_magic_link_ticket"), d1Reason));
  } else if (signInResult.status === "fulfilled") {
    const row = signInResult.value;
    const m = base("sign-in", "Sign-in", "better_auth_magic_link_ticket dispatch records, edge and D1 probes");
    m.facts = [
      `${row.tickets24h.toLocaleString()} sign-in links dispatched in the last 24 hours`,
      row.lastTicketEverAt ? `last dispatch ${ageClause(row.lastTicketEverAt, asOf)}` : null,
      "email links share the delivery channel measured on the Email row",
    ].filter((v): v is string => v !== null);
    if (row.lastTicketEverAt === null) {
      surfaces.push(degraded(m, "no sign-in link dispatch has been recorded yet"));
    } else {
      surfaces.push(operational(m));
    }
  } else {
    surfaces.push(degraded(base("sign-in", "Sign-in", "better_auth_magic_link_ticket dispatch records, edge and D1 probes"), "the sign-in dispatch probe failed"));
  }

  // Billing (Dodo webhook ledger + billing canary run records).
  if (!d1Ok) {
    surfaces.push(down(base("billing", "Billing", "dodo_webhook_event ledger, edge and D1 probes"), d1Reason));
  } else if (billingResult.status === "fulfilled") {
    const row = billingResult.value;
    const m = base("billing", "Billing", "dodo_webhook_event ledger (Dodo payment events and billing self-check lock records), edge and D1 probes");
    m.facts = [
      `${row.events24h.toLocaleString()} Dodo payment webhooks processed in the last 24 hours`,
      row.lastEventAt ? `last payment event ${ageClause(row.lastEventAt, asOf)}` : null,
      row.lastCanaryRunAt ? `billing self-check last ran ${ageClause(row.lastCanaryRunAt, asOf)}` : null,
    ].filter((v): v is string => v !== null);
    if (row.failed24h > 0) {
      surfaces.push(degraded(m, `${row.failed24h.toLocaleString()} payment webhook events failed processing in the last 24 hours`));
    } else {
      surfaces.push(operational(m));
    }
  } else {
    surfaces.push(degraded(base("billing", "Billing", "dodo_webhook_event ledger, edge and D1 probes"), "the billing ledger probe failed"));
  }

  // Email delivery (digests, alerts, account mail, suppression).
  if (!d1Ok) {
    surfaces.push(down(base("email", "Email delivery", "digest_delivery, delivery_attempt, email_suppression"), d1Reason));
  } else if (emailResult.status === "fulfilled") {
    const row = emailResult.value;
    const m = base("email", "Email delivery", "digest_delivery and delivery_attempt send records, email_suppression ledger, edge and D1 probes");
    const facts: string[] = [
      row.lastDigestSentAt ? `last digest sent ${ageClause(row.lastDigestSentAt, asOf)}` : null,
      row.lastEmailAcceptedAt
        ? `last email accepted by the provider ${ageClause(row.lastEmailAcceptedAt, asOf)}; ${row.sent24h.toLocaleString()} accepted in the last 24 hours`
        : null,
      `${row.suppressed.toLocaleString()} addresses held by the bounce and complaint suppression ledger out of ${row.recipients.toLocaleString()} known recipient addresses`,
    ].filter((v): v is string => v !== null);
    m.facts = facts;
    if (row.failed24h > 0) {
      surfaces.push(degraded(m, `${row.failed24h.toLocaleString()} email sends failed in the last 24 hours`));
    } else if (row.lastEmailAcceptedAt === null && row.suppressed === 0) {
      surfaces.push(degraded(m, "no email send has been recorded yet"));
    } else {
      surfaces.push(operational(m));
    }
  } else {
    surfaces.push(degraded(base("email", "Email delivery", "digest_delivery, delivery_attempt, email_suppression"), "the email send-record probe failed"));
  }

  // Scheduled monitoring (crons + runs).
  if (!d1Ok) {
    surfaces.push(down(base("monitoring", "Scheduled monitoring", "release_scheduled_observation, watchlist_run, scheduled_observation_health_state"), d1Reason));
  } else if (countersResult.status === "fulfilled") {
    const { counters, activeWatchlists } = countersResult.value;
    const m = base("monitoring", "Scheduled monitoring", "watchlist_run counters, release_scheduled_observation freshness, scheduled_observation_health_state baseline, edge and D1 probes");
    const facts: string[] = [
      `${counters.runsInLast24h.toLocaleString()} watchlist runs in the last 24 hours, ${counters.failedRunsInLast24h.toLocaleString()} failed`,
      counters.lastWatchlistRunAt ? `last run started ${ageClause(counters.lastWatchlistRunAt, asOf)}` : null,
      `${activeWatchlists.toLocaleString()} active watchlists scheduled`,
      counters.scheduledMonitoringSince ? `continuous coverage since ${counters.scheduledMonitoringSince}` : null,
    ].filter((v): v is string => v !== null);
    m.facts = facts;
    let scheduleHealth: Awaited<ReturnType<typeof listScheduledObservationHealth>> | null = null;
    try {
      scheduleHealth = await listScheduledObservationHealth(env, { now: new Date(asOf) });
    } catch {
      scheduleHealth = null;
    }
    const overdue = scheduleHealth?.filter((entry) => entry.overdue || entry.futureEvidence) ?? [];
    if (overdue.length > 0) {
      surfaces.push(degraded(m, `the ${overdue[0].cron} schedule is overdue`));
    } else if (counters.runsInLast24h === 0 && activeWatchlists > 0) {
      surfaces.push(degraded(m, `${activeWatchlists.toLocaleString()} active watchlists recorded no runs in the last 24 hours`));
    } else if (
      counters.failedRunsInLast24h > 0 &&
      counters.failedRunsInLast24h >= counters.runsInLast24h
    ) {
      surfaces.push(down(m, `every watchlist run in the last 24 hours failed`));
    } else if (counters.failedRunsInLast24h > 0) {
      surfaces.push(degraded(m, `${counters.failedRunsInLast24h.toLocaleString()} watchlist runs failed in the last 24 hours`));
    } else {
      surfaces.push(operational(m));
    }
  } else {
    surfaces.push(degraded(base("monitoring", "Scheduled monitoring", "watchlist_run counters, release_scheduled_observation freshness"), "the monitoring counter probe failed"));
  }

  // Uptime (from the status_health_sample rail written by every cron).
  if (!d1Ok) {
    surfaces.push(down(base("uptime", "Uptime", "status_health_sample written by every scheduled run"), d1Reason));
  } else if (uptimeResult.status === "fulfilled") {
    const row = uptimeResult.value;
    const m = base("uptime", "Uptime", "status_health_sample rows written by every scheduled cron run", );
    const pct = row.samples24h > 0 ? Math.round((row.okSamples24h / row.samples24h) * 100) : null;
    m.checkedAt = row.lastSampleAt ?? asOf;
    m.facts = [
      pct === null ? null : `${pct}% of ${row.samples24h.toLocaleString()} scheduled checks passed in the last 24 hours`,
      row.lastSampleAt ? `last sample ${ageClause(row.lastSampleAt, asOf)}` : null,
    ].filter((v): v is string => v !== null);
    if (row.samples24h === 0) {
      surfaces.push(degraded(m, "samples record on each scheduled run; the first one is pending"));
    } else if (row.lastSampleAt && Date.parse(asOf) - Date.parse(row.lastSampleAt) > UPTIME_SAMPLE_MAX_AGE_MS) {
      surfaces.push(degraded(m, "the health sample rail has not recorded a fresh sample"));
    } else if (row.okSamples24h === 0) {
      surfaces.push(down(m, "no scheduled check passed in the last 24 hours"));
    } else if (pct !== null && pct < 100) {
      surfaces.push(degraded(m, `${(row.samples24h - row.okSamples24h).toLocaleString()} scheduled check(s) failed in the last 24 hours`));
    } else {
      surfaces.push(operational(m));
    }
  } else {
    surfaces.push(degraded(base("uptime", "Uptime", "status_health_sample written by every scheduled run"), "the uptime sample probe failed"));
  }

  return {
    asOf,
    surfaces,
    monitoring: countersResult.status === "fulfilled" ? countersResult.value.counters : null,
  };
}

function ageClause(iso: string, asOf: string): string {
  const ms = Math.max(0, Date.parse(asOf) - Date.parse(iso));
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute ago";
  if (minutes < 60) return `${minutes.toLocaleString()} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours.toLocaleString()} h ago`;
  const days = Math.floor(hours / 24);
  return `${days.toLocaleString()} days ago`;
}

async function getPublicStatusCountersWithWatchlists(
  env: AppEnv,
  dayAgoIso: string,
): Promise<{ counters: PublicStatusCounters; activeWatchlists: number }> {
  const counters = await getPublicStatusCounters(env);
  const activeRow = await one<{ active: number }>(
    env,
    `SELECT COUNT(*) AS active FROM watchlist WHERE is_active = 1`,
  );
  return {
    counters: counters ?? {
      lastWatchlistRunAt: null,
      runsInLast24h: 0,
      failedRunsInLast24h: 0,
      lastDigestSentAt: null,
      digestHealth: "unknown",
      scheduledMonitoringSince: null,
    },
    activeWatchlists: Number(activeRow?.active ?? 0),
  };
}

interface SearchMeasurement {
  cachedSets: number;
  freshestFetchAt: string | null;
  searchesServed10m: number | null;
}

async function measurePublicSearch(env: AppEnv, dayAgoIso: string): Promise<SearchMeasurement> {
  const [cacheRow, servedRow] = await Promise.all([
    one<{ sets: number; freshest: string | null }>(
      env,
      `
        SELECT COUNT(*) AS sets, MAX(fetched_at) AS freshest
        FROM discovery_cache_entry
        WHERE route_context = 'public_search'
      `,
    ),
    one<{ served: number }>(
      env,
      `
        SELECT COUNT(*) AS served
        FROM rate_limit_events
        WHERE scope IN ('public-search-ip', 'public-search-anon-browser')
          AND created_at >= ?
      `,
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ),
  ]);
  void dayAgoIso;
  return {
    cachedSets: Number(cacheRow?.sets ?? 0),
    freshestFetchAt: cacheRow?.freshest ?? null,
    searchesServed10m: servedRow ? Number(servedRow.served) : null,
  };
}

interface SignInMeasurement {
  tickets24h: number;
  lastTicketEverAt: string | null;
}

async function measureSignIn(env: AppEnv, dayAgoIso: string): Promise<SignInMeasurement> {
  const [recentRow, everRow] = await Promise.all([
    one<{ tickets: number }>(
      env,
      `
        SELECT COUNT(*) AS tickets
        FROM better_auth_magic_link_ticket
        WHERE created_at >= ?
      `,
      dayAgoIso,
    ),
    one<{ last_ticket: string | null }>(
      env,
      `SELECT MAX(created_at) AS last_ticket FROM better_auth_magic_link_ticket`,
    ),
  ]);
  return {
    tickets24h: Number(recentRow?.tickets ?? 0),
    lastTicketEverAt: everRow?.last_ticket ?? null,
  };
}

interface BillingMeasurement {
  events24h: number;
  failed24h: number;
  lastEventAt: string | null;
  lastCanaryRunAt: string | null;
}

async function measureBilling(env: AppEnv, dayAgoIso: string): Promise<BillingMeasurement> {
  const [recentRow, canaryRow] = await Promise.all([
    one<{ events: number; failed: number; last_event: string | null }>(
      env,
      `
        SELECT
          COUNT(*) AS events,
          SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
          MAX(received_at) AS last_event
        FROM dodo_webhook_event
        WHERE event_type LIKE 'payment%'
          AND received_at >= ?
      `,
      dayAgoIso,
    ),
    one<{ last_canary: string | null }>(
      env,
      `
        SELECT MAX(received_at) AS last_canary
        FROM dodo_webhook_event
        WHERE event_type = 'billing.canary.lock'
      `,
    ),
  ]);
  return {
    events24h: Number(recentRow?.events ?? 0),
    failed24h: Number(recentRow?.failed ?? 0),
    lastEventAt: recentRow?.last_event ?? null,
    lastCanaryRunAt: canaryRow?.last_canary ?? null,
  };
}

interface EmailMeasurement {
  lastDigestSentAt: string | null;
  lastEmailAcceptedAt: string | null;
  sent24h: number;
  failed24h: number;
  suppressed: number;
  recipients: number;
}

async function measureEmailDelivery(env: AppEnv, dayAgoIso: string): Promise<EmailMeasurement> {
  const [digestRow, attemptRow, suppressionRow, recipientRow] = await Promise.all([
    one<{ last_digest: string | null }>(
      env,
      `
        SELECT MAX(created_at) AS last_digest
        FROM digest_delivery
        WHERE status = 'sent'
      `,
    ),
    one<{ last_sent: string | null; sent: number; failed: number }>(
      env,
      `
        SELECT
          MAX(created_at) AS last_sent,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM delivery_attempt
        WHERE channel = 'email'
          AND created_at >= ?
      `,
      dayAgoIso,
    ),
    one<{ suppressed: number }>(
      env,
      `SELECT COUNT(*) AS suppressed FROM email_suppression`,
    ),
    one<{ recipients: number }>(
      env,
      `
        SELECT COUNT(DISTINCT target_value) AS recipients
        FROM delivery_target
        WHERE channel = 'email'
      `,
    ),
  ]);
  return {
    lastDigestSentAt: digestRow?.last_digest ?? null,
    lastEmailAcceptedAt: attemptRow?.last_sent ?? null,
    sent24h: Number(attemptRow?.sent ?? 0),
    failed24h: Number(attemptRow?.failed ?? 0),
    suppressed: Number(suppressionRow?.suppressed ?? 0),
    recipients: Number(recipientRow?.recipients ?? 0),
  };
}

async function measureUptime(env: AppEnv): Promise<StatusUptimeReading> {
  return readStatusUptime(env);
}
