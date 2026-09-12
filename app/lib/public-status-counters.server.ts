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
import { listScheduledObservationHealth } from "~/lib/scheduled-observation-health.server";
import {
  getPublicStatusProbes,
  type PublicStatusProbe,
} from "~/lib/status-probes.server";
import {
  getEmailDeliveryStatus,
  type EmailDeliveryStatus,
} from "~/lib/email-delivery-canary.server";

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

/**
 * One probe's reading folded into a surface row. `checkedAt` is the probe's
 * own latest-sample time so the row's "checked N min ago" reflects the probe
 * cadence, not the page load.
 */
interface ProbeReading {
  state: SurfaceState;
  reason: string | null;
  checkedAt: string;
  facts: string[];
}

/**
 * Reduce one probe's samples to a row reading. Returns null while the probe
 * has never recorded a sample (fresh deployment, or the rail's table is not
 * applied yet) so the caller falls back to its D1-counter state rather than
 * publishing a fake red.
 */
function probeReading(probe: PublicStatusProbe | undefined): ProbeReading | null {
  if (!probe?.latest) return null;
  const facts: string[] = [];
  if (probe.samples24h > 0 && probe.okRate24h !== null) {
    facts.push(
      `${Math.round(probe.okRate24h * 100)}% of ${probe.samples24h.toLocaleString()} live probe checks passed in the last 24 hours`,
    );
  }
  if (probe.p50LatencyMs24h !== null) {
    facts.push(`median probe latency ${Math.round(probe.p50LatencyMs24h).toLocaleString()} ms`);
  }
  if (probe.latest.detail) {
    facts.push(`last check: ${probe.latest.detail}`);
  }
  if (probe.latest.ok) {
    const clean = probe.okRate24h === null || probe.okRate24h >= 1;
    return {
      state: clean ? "operational" : "degraded",
      reason: clean
        ? null
        : probe.lastFailureDetail
          ? `a recent probe check failed: ${probe.lastFailureDetail}`
          : "a recent probe check failed",
      checkedAt: probe.latest.checkedAt,
      facts,
    };
  }
  return {
    state: probe.okRate24h === 0 && probe.samples24h >= 3 ? "down" : "degraded",
    reason: probe.latest.detail ?? probe.lastFailureDetail ?? "the latest live probe check failed",
    checkedAt: probe.latest.checkedAt,
    facts,
  };
}

const STATE_RANK: Record<SurfaceState, number> = {
  operational: 0,
  degraded: 1,
  down: 2,
};

/**
 * Fold the email-delivery canary's public status (#3188) into the Email
 * delivery row: the 24h send → receive loop is the strongest delivery
 * evidence the service records, so its counts ride along when the window
 * has activity (`getEmailDeliveryStatus()` returns the empty struct when
 * the rail is fresh or the read fails — that is "absent", and the row then
 * stands on its digest/attempt counters alone). A failed delivery check is
 * measured evidence, so it joins the same counter-floor path the webhook
 * ledger uses: the live probe may tick green between checks while the
 * window still carries the failure. Copy is public-safe: the internal
 * canary vocabulary never reaches the page.
 */
function applyEmailDeliveryStatus(
  m: Omit<SurfaceMeasurement, "state" | "reason">,
  status: EmailDeliveryStatus | null,
  asOf: string,
): { state: SurfaceState; reason: string | null } | null {
  if (!status) return null;
  const canary = status.canary;
  if (canary.sends <= 0 && canary.successRate === null) return null;
  if (canary.sends > 0) {
    const rate = canary.successRate === null
      ? ""
      : ` (${Math.round(canary.successRate * 100)}% received)`;
    m.facts = [
      ...m.facts,
      `${canary.received.toLocaleString()} of ${canary.sends.toLocaleString()} live delivery checks received back in the last 24 hours${rate}`,
    ];
    if (canary.p50LatencyMs !== null) {
      m.facts.push(`median receipt latency ${Math.round(canary.p50LatencyMs / 1000).toLocaleString()} s`);
    }
    if (canary.lastReceivedAt) {
      m.facts.push(`last receipt ${ageClause(canary.lastReceivedAt, asOf)}`);
      if (m.checkedAt === asOf) m.checkedAt = canary.lastReceivedAt;
    }
    if (canary.lastFailure) {
      m.facts.push(`last delivery check failure: ${canary.lastFailure.error}`);
    }
  }
  if (canary.failed > 0) {
    return {
      state: "degraded",
      reason: `${canary.failed.toLocaleString()} ${canary.failed === 1 ? "delivery check" : "delivery checks"} failed in the last 24 hours`,
    };
  }
  return null;
}

/**
 * Apply a probe reading to a row: probe facts append after the counter facts,
 * and the probe's checkedAt wins. With `mode: "worst"` the counter-derived
 * state is a floor — a failed webhook or an overdue refresh stays visible even
 * while the live probe is green — and the counter reason wins ties because it
 * names the more specific failure. Without a reading the counter state stands
 * and a pending fact records the rail gap.
 */
function applyProbeReading(
  m: Omit<SurfaceMeasurement, "state" | "reason">,
  reading: ProbeReading | null,
  counterState: { state: SurfaceState; reason: string | null } | null,
  pendingFact: string,
  mode: "probe" | "worst" = "probe",
): SurfaceMeasurement {
  if (!reading) {
    m.facts = [...m.facts, pendingFact];
    return counterState
      ? { ...m, state: counterState.state, reason: counterState.reason }
      : degraded(m, pendingFact);
  }
  m.checkedAt = reading.checkedAt;
  m.facts = [...m.facts, ...reading.facts];
  if (mode === "worst" && counterState) {
    const worse =
      STATE_RANK[counterState.state] >= STATE_RANK[reading.state]
        ? counterState
        : { state: reading.state, reason: reading.reason };
    return { ...m, state: worse.state, reason: worse.reason };
  }
  return { ...m, state: reading.state, reason: reading.reason };
}

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
    probesResult,
    countersResult,
    searchResult,
    signInResult,
    billingResult,
    emailResult,
    emailStatusResult,
  ] = await Promise.allSettled([
    getPublicStatusProbes(env.DB),
    getPublicStatusCountersWithWatchlists(env, dayAgoIso),
    measurePublicSearch(env),
    measureSignIn(env, dayAgoIso),
    measureBilling(env, dayAgoIso),
    measureEmailDelivery(env, dayAgoIso),
    // The canary loop status (#3188): public-safe counts/timestamps only,
    // never throws (pre-migration schema reads as empty). Present data folds
    // into the Email row below; empty data changes nothing.
    getEmailDeliveryStatus(env),
  ]);
  const emailCanaryStatus: EmailDeliveryStatus | null =
    emailStatusResult.status === "fulfilled" ? emailStatusResult.value : null;

  // The live probe rail (status_probe_samples, written by the 5-minute
  // status-probe cron) governs the state of every surface it measures. While
  // a probe has no sample yet — fresh deployment, or the rail not applied on
  // this deployment — the D1-counter evidence still governs that row, with a
  // pending fact saying the rail has not sampled. A rejected probes read
  // (table absent) lands in the same fallback.
  const probesByName = new Map(
    (probesResult.status === "fulfilled" ? probesResult.value : []).map(
      (probe) => [probe.probe, probe],
    ),
  );

  const surfaces: SurfaceMeasurement[] = [];

  // Public search.
  const searchSource =
    "status_probe_samples public_search and provider_meta probes, discovery_cache_entry, edge and D1 probes";
  if (!d1Ok) {
    surfaces.push(down(base("public-search", "Public search", searchSource), d1Reason));
  } else {
    const m = base("public-search", "Public search", searchSource);
    let counterState: { state: SurfaceState; reason: string | null } | null = null;
    if (searchResult.status === "fulfilled") {
      const row = searchResult.value;
      m.facts = [
        `${row.cachedSets.toLocaleString()} cached public result sets`,
        row.freshestFetchAt ? `freshest provider fetch ${ageClause(row.freshestFetchAt, asOf)}` : null,
      ].filter((v): v is string => v !== null);
      counterState =
        row.cachedSets === 0
          ? { state: "degraded", reason: "no cached search result set has been recorded yet" }
          : row.freshestFetchAt &&
              Date.parse(asOf) - Date.parse(row.freshestFetchAt) > SEARCH_CACHE_REFRESH_MAX_AGE_MS
            ? { state: "degraded", reason: "the nightly result refresh is overdue" }
            : { state: "operational", reason: null };
    } else {
      counterState = { state: "degraded", reason: "the search storage probe failed" };
    }
    let pushed = applyProbeReading(
      m,
      probeReading(probesByName.get("public_search")),
      counterState,
      "the live public-search probe has not recorded a sample yet",
      "worst",
    );
    // The hourly Meta Ad Library probe feeds the search corpus: a red provider
    // check caps the row at degraded even while cached results still serve.
    const provider = probesByName.get("provider_meta");
    if (provider?.latest) {
      pushed.facts = [
        ...pushed.facts,
        `ad provider check ${provider.latest.ok ? "passed" : "failed"}${provider.latest.detail ? `: ${provider.latest.detail}` : ""}`,
      ];
      if (!provider.latest.ok && pushed.state === "operational") {
        pushed = {
          ...pushed,
          state: "degraded",
          reason: "the ad provider check failed; cached results still serve",
        };
      }
    }
    surfaces.push(pushed);
  }

  // Sign-in (one-time email link dispatch).
  const signInSource =
    "status_probe_samples signin_dispatch probe, better_auth_magic_link_ticket dispatch records, edge and D1 probes";
  if (!d1Ok) {
    surfaces.push(down(base("sign-in", "Sign-in", signInSource), d1Reason));
  } else {
    const m = base("sign-in", "Sign-in", signInSource);
    let counterState: { state: SurfaceState; reason: string | null } | null = null;
    if (signInResult.status === "fulfilled") {
      const row = signInResult.value;
      m.facts = [
        `${row.tickets24h.toLocaleString()} sign-in links requested in the last 24 hours`,
        row.lastTicketEverAt ? `last dispatch ${ageClause(row.lastTicketEverAt, asOf)}` : null,
        "email links share the delivery channel measured on the Email row",
      ].filter((v): v is string => v !== null);
      counterState =
        row.lastTicketEverAt === null
          ? { state: "degraded", reason: "no sign-in link dispatch has been recorded yet" }
          : { state: "operational", reason: null };
    } else {
      counterState = { state: "degraded", reason: "the sign-in dispatch counter read failed" };
    }
    surfaces.push(
      applyProbeReading(
        m,
        probeReading(probesByName.get("signin_dispatch")),
        counterState,
        "the live sign-in dispatch probe has not recorded a sample yet",
      ),
    );
  }

  // Billing (Dodo canary probe + webhook ledger).
  const billingSource =
    "status_probe_samples billing_dodo probe, dodo_webhook_event ledger (Dodo payment events and billing self-check lock records), edge and D1 probes";
  if (!d1Ok) {
    surfaces.push(down(base("billing", "Billing", billingSource), d1Reason));
  } else {
    const m = base("billing", "Billing", billingSource);
    let counterState: { state: SurfaceState; reason: string | null } | null = null;
    if (billingResult.status === "fulfilled") {
      const row = billingResult.value;
      m.facts = [
        `${row.events24h.toLocaleString()} Dodo payment webhooks processed in the last 24 hours`,
        row.lastEventAt ? `last payment event ${ageClause(row.lastEventAt, asOf)}` : null,
        row.lastCanaryRunAt ? `billing self-check last ran ${ageClause(row.lastCanaryRunAt, asOf)}` : null,
      ].filter((v): v is string => v !== null);
      counterState =
        row.failed24h > 0
          ? {
              state: "degraded",
              reason: `${row.failed24h.toLocaleString()} payment webhook events failed processing in the last 24 hours`,
            }
          : { state: "operational", reason: null };
    } else {
      counterState = { state: "degraded", reason: "the billing ledger probe failed" };
    }
    surfaces.push(
      applyProbeReading(
        m,
        probeReading(probesByName.get("billing_dodo")),
        counterState,
        "the live billing probe has not recorded a sample yet",
        "worst",
      ),
    );
  }

  // Email delivery (digests, alerts, account mail, suppression): the row's
  // live probe is the same canary loop the email_delivery probe records into
  // status_probe_samples, and the canary module's own 24h counts ride along
  // when the window has activity. Customer-send failures and canary failures
  // are floors: a green internal canary must not hide sending defects.
  const emailSource =
    "status_probe_samples email_delivery probe, delivery verification rows, digest_delivery and delivery_attempt send records, email_suppression ledger, edge and D1 probes";
  if (!d1Ok) {
    surfaces.push(down(base("email", "Email delivery", emailSource), d1Reason));
  } else {
    const m = base("email", "Email delivery", emailSource);
    let counterState: { state: SurfaceState; reason: string | null } | null = null;
    if (emailResult.status === "fulfilled") {
      const row = emailResult.value;
      m.facts = [
        row.lastDigestSentAt ? `last digest sent ${ageClause(row.lastDigestSentAt, asOf)}` : null,
        row.lastEmailAcceptedAt
          ? `last email accepted by the provider ${ageClause(row.lastEmailAcceptedAt, asOf)}; ${row.sent24h.toLocaleString()} accepted in the last 24 hours`
          : null,
        `${row.suppressed.toLocaleString()} addresses held by the bounce and complaint suppression ledger out of ${row.recipients.toLocaleString()} known recipient addresses`,
      ].filter((v): v is string => v !== null);
      counterState =
        row.failed24h > 0
          ? { state: "degraded", reason: `${row.failed24h.toLocaleString()} email sends failed in the last 24 hours` }
          : row.lastEmailAcceptedAt === null && row.suppressed === 0
            ? { state: "degraded", reason: "no email send has been recorded yet" }
            : { state: "operational", reason: null };
    } else {
      counterState = { state: "degraded", reason: "the email send-record probe failed" };
      m.facts.push("the email send-record counter read failed");
    }
    const canaryState = applyEmailDeliveryStatus(m, emailCanaryStatus, asOf);
    if (
      canaryState &&
      counterState &&
      STATE_RANK[canaryState.state] > STATE_RANK[counterState.state]
    ) {
      counterState = canaryState;
    }
    surfaces.push(
      applyProbeReading(
        m,
        probeReading(probesByName.get("email_delivery")),
        counterState,
        "the live email-delivery probe has not recorded a sample yet",
        "worst",
      ),
    );
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

  // Uptime: the 5-minute uptime probe fetches the public homepage and
  // /api/health over the real hostname, so the row reports the site's measured
  // availability, not an internal heartbeat.
  const uptimeSource =
    "status_probe_samples uptime probe (5-minute homepage and /api/health fetches), edge and D1 probes";
  if (!d1Ok) {
    surfaces.push(down(base("uptime", "Uptime", uptimeSource), d1Reason));
  } else {
    const m = base("uptime", "Uptime", uptimeSource);
    surfaces.push(
      applyProbeReading(
        m,
        probeReading(probesByName.get("uptime")),
        null,
        "the live uptime probe has not recorded a sample yet",
      ),
    );
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
}

// Public search truth comes from discovery_cache_entry only. The per-request
// search rate-limit scopes moved to the Cloudflare edge bindings in #2985 and
// stopped writing rate_limit_events rows, so counting that table here would
// render a permanently-false "0 searches served" fact.
async function measurePublicSearch(env: AppEnv): Promise<SearchMeasurement> {
  const cacheRow = await one<{ sets: number; freshest: string | null }>(
    env,
    `
      SELECT COUNT(*) AS sets, MAX(fetched_at) AS freshest
      FROM discovery_cache_entry
      WHERE route_context = 'public_search'
    `,
  );
  return {
    cachedSets: Number(cacheRow?.sets ?? 0),
    freshestFetchAt: cacheRow?.freshest ?? null,
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
