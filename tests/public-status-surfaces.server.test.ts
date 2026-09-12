import { describe, expect, it, vi } from "vitest";

import { getPublicStatusSurfaces } from "~/lib/public-status-counters.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * State machine for the /status measured rows. Every state must trace to a
 * probe result or a D1 row: no fake green, no confession prose. These tests
 * script a D1 binding; the probe rows exercise the status_probe_samples
 * queries issued by getPublicStatusProbes (latest / 24h stats / p50 / last
 * failure).
 */

type Row = Record<string, unknown>;
type Fixture = Row | Row[] | null;

// Clock-relative fixtures: the library reads the wall clock (asOf = new Date()),
// so every timestamp below must be derived from Date.now() at run time.
// Hardcoded 2026-09-12 fixtures age past the 26-hour search
// freshness window and fail the suite on a clock tick, not on a regression
// (same lesson as the fixture fix merged into public-status-counters.test.ts).
const NOW_MS = Date.now();
const NOW = new Date(NOW_MS).toISOString();
const FRESH = new Date(NOW_MS - 60 * 60 * 1000).toISOString(); // inside every freshness window
const DAY_AGO = new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString();
const MONTH_AGO = new Date(NOW_MS - 30 * 24 * 60 * 60 * 1000).toISOString(); // scheduled-monitoring baseline

/**
 * A scripted D1 binding. `rows` maps a distinctive SQL fragment to the row(s)
 * it returns; anything unmapped returns an empty result set. An array value
 * feeds `.all()` with every element (probe queries return one row per probe).
 */
function makeEnv(rows: Record<string, Fixture>, d1Down = false) {
  const resolveRow = (sql: string): Fixture => {
    for (const [fragment, row] of Object.entries(rows)) {
      if (sql.includes(fragment)) return row;
    }
    return null;
  };
  const prepare = vi.fn((sql: string) => {
    const first = vi.fn(() => {
      if (d1Down && sql === "SELECT 1") {
        throw new Error("d1 down");
      }
      const resolved = resolveRow(sql);
      return Promise.resolve(Array.isArray(resolved) ? (resolved[0] ?? null) : resolved);
    });
    const all = vi.fn(() => {
      if (d1Down) throw new Error("d1 down");
      const resolved = resolveRow(sql);
      const results = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
      return Promise.resolve({ results });
    });
    return {
      first,
      bind: vi.fn(() => ({ first, all })),
      all,
    };
  });
  return { DB: { prepare } } as unknown as AppEnv;
}

// The probe rail, healthy: every probe's latest sample is green, 24h stats
// full-ok, p50 latency present, no recent failure.
const healthyProbeRows = (): Record<string, Fixture> => ({
  // latest-per-probe query (status_probe_samples s2 correlated MAX)
  "s2.probe = status_probe_samples.probe)": [
    { probe: "public_search", ok: 1, latency_ms: 320, detail: "12 ads returned (cache_hit)", checked_at: FRESH },
    { probe: "signin_dispatch", ok: 1, latency_ms: 210, detail: "link minted, send_email accepted (canary identity)", checked_at: FRESH },
    { probe: "billing_dodo", ok: 1, latency_ms: 180, detail: "canary identity stable, catalog resolved, webhook signing ok", checked_at: FRESH },
    { probe: "provider_meta", ok: 1, latency_ms: 3400, detail: "14 ad cards parsed from the ad library surface", checked_at: FRESH },
    { probe: "uptime", ok: 1, latency_ms: 95, detail: "home 200/95ms, health 200/40ms", checked_at: FRESH },
    { probe: "email_delivery", ok: 1, latency_ms: 15000, detail: "canary sent; 2/2 receipts in 75-min window", checked_at: FRESH },
  ],
  // 24h stats
  "AVG(ok) AS ok_rate": [
    { probe: "public_search", n: 288, ok_rate: 1 },
    { probe: "signin_dispatch", n: 48, ok_rate: 1 },
    { probe: "billing_dodo", n: 288, ok_rate: 1 },
    { probe: "provider_meta", n: 24, ok_rate: 1 },
    { probe: "uptime", n: 288, ok_rate: 1 },
    { probe: "email_delivery", n: 48, ok_rate: 1 },
  ],
  // p50 latency over ok samples
  "ROW_NUMBER() OVER": [
    { probe: "public_search", latency_ms: 300 },
    { probe: "uptime", latency_ms: 90 },
    { probe: "email_delivery", latency_ms: 15000 },
  ],
  // last failure per probe: none
  "s2.probe = status_probe_samples.probe AND s2.ok = 0": [],
});

/**
 * The email-delivery canary rail (#3188): two canary sends received back in
 * the 24h window, a healthy suppression window, and last customer alert and
 * digest send timestamps. Key order matters: these fragments must come
 * before healthyRows' broader keys ("GROUP BY reason" before "FROM
 * email_suppression") so the canary queries resolve here first.
 */
const healthyCanaryRows = (): Record<string, Fixture> => ({
  "FROM email_delivery_canary": [
    { token: "tok-1", status: "received", sent_at: FRESH, received_at: FRESH, latency_ms: 21000, error: null, created_at: FRESH },
    { token: "tok-2", status: "received", sent_at: FRESH, received_at: FRESH, latency_ms: 11000, error: null, created_at: FRESH },
  ],
  "GROUP BY reason": [{ reason: "bounce", n: 0 }],
  "LIKE 'instant:%'": { last_sent_at: FRESH },
  "LIKE 'digest:%:customer:email:%'": { last_sent_at: FRESH },
});

const healthyRows = (): Record<string, Fixture> => ({
  ...healthyCanaryRows(),
  "SELECT MAX(started_at)": { last_started_at: FRESH },
  "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed\n        FROM watchlist_run": { total: 31, failed: 0 },
  "FROM digest_delivery": { last_digest_sent_at: FRESH },
  "FROM scheduled_observation_health_state": { active_since: MONTH_AGO },
  "FROM watchlist WHERE is_active": { active: 3 },
  "FROM discovery_cache_entry": { sets: 12, freshest: FRESH },
  "COUNT(*) AS tickets": { tickets: 4 },
  "MAX(created_at) AS last_ticket": { last_ticket: FRESH },
  "event_type LIKE 'payment%'": { events: 2, failed: 0, last_event: FRESH },
  "billing.canary.lock": { last_canary: FRESH },
  "AS last_digest": { last_digest: FRESH },
  "MAX(created_at) AS last_sent": { last_sent: FRESH, sent: 9, failed: 0 },
  "FROM email_suppression": { suppressed: 1 },
  "FROM delivery_target": { recipients: 40 },
  ...healthyProbeRows(),
});

async function surfaceById(env: AppEnv, id: string) {
  const result = await getPublicStatusSurfaces(env);
  return result.surfaces.find((surface) => surface.id === id)!;
}

describe("getPublicStatusSurfaces state machine", () => {
  it("returns all six surfaces operational on healthy data", async () => {
    const result = await getPublicStatusSurfaces(makeEnv(healthyRows()));
    expect(result.surfaces.map((surface) => surface.id)).toEqual([
      "public-search",
      "sign-in",
      "billing",
      "email",
      "monitoring",
      "uptime",
    ]);
    for (const surface of result.surfaces) {
      expect(surface.state).toBe("operational");
      expect(surface.reason).toBeNull();
      expect(surface.facts.length).toBeGreaterThan(0);
    }
    // The detailed monitoring counters ride along for the Monitoring health block.
    expect(result.monitoring?.runsInLast24h).toBe(31);
  });

  it("reports down on every surface when the D1 probe fails", async () => {
    const result = await getPublicStatusSurfaces(makeEnv(healthyRows(), true));
    for (const surface of result.surfaces) {
      expect(surface.state).toBe("down");
      expect(surface.reason).toContain("database probe failed");
    }
  });

  it("lets the live search probe state win while the cache counters are healthy", async () => {
    const search = await surfaceById(makeEnv(healthyRows()), "public-search");
    expect(search.state).toBe("operational");
    expect(search.checkedAt).toBe(FRESH);
    expect(search.facts.some((fact) => fact.includes("100% of 288 live probe checks"))).toBe(true);
    expect(search.facts.some((fact) => fact.includes("12 cached public result sets"))).toBe(true);
    expect(search.facts.some((fact) => fact.includes("ad provider check passed"))).toBe(true);
  });

  it("marks public search degraded when the nightly cache refresh is overdue even though the probe is green", async () => {
    // The counter evidence is a floor: a green live probe does not hide an
    // overdue refresh.
    const stale = new Date(NOW_MS - 27 * 60 * 60 * 1000).toISOString();
    const search = await surfaceById(
      makeEnv({ ...healthyRows(), "FROM discovery_cache_entry": { sets: 12, freshest: stale } }),
      "public-search",
    );
    expect(search.state).toBe("degraded");
    expect(search.reason).toContain("nightly result refresh is overdue");
  });

  it("marks public search degraded when the provider_meta probe fails while search serves", async () => {
    const rows = healthyRows();
    rows["s2.probe = status_probe_samples.probe)"] = (
      rows["s2.probe = status_probe_samples.probe)"] as Row[]
    ).map((row) =>
      row.probe === "provider_meta"
        ? { ...row, ok: 0, detail: "ad library capture failed" }
        : row,
    );
    const search = await surfaceById(makeEnv(rows), "public-search");
    expect(search.state).toBe("degraded");
    expect(search.reason).toContain("ad provider check failed");
    expect(search.facts.some((fact) => fact.includes("ad provider check failed"))).toBe(true);
  });

  it("marks sign-in operational from the dispatch probe even with zero recorded tickets", async () => {
    // The canary probe proves dispatch works; zero customer signups is not a defect.
    const rows = healthyRows();
    rows["MAX(created_at) AS last_ticket"] = { last_ticket: null };
    rows["COUNT(*) AS tickets"] = { tickets: 0 };
    const signIn = await surfaceById(makeEnv(rows), "sign-in");
    expect(signIn.state).toBe("operational");
    expect(signIn.facts.some((fact) => fact.includes("0 sign-in links requested"))).toBe(true);
  });

  it("marks sign-in degraded when the probe rail is empty and no dispatch was ever recorded", async () => {
    const rows = healthyRows();
    rows["MAX(created_at) AS last_ticket"] = { last_ticket: null };
    rows["COUNT(*) AS tickets"] = { tickets: 0 };
    rows["s2.probe = status_probe_samples.probe)"] = [];
    rows["AVG(ok) AS ok_rate"] = [];
    rows["ROW_NUMBER() OVER"] = [];
    const signIn = await surfaceById(makeEnv(rows), "sign-in");
    expect(signIn.state).toBe("degraded");
    expect(signIn.reason).toContain("no sign-in link dispatch has been recorded yet");
    expect(signIn.facts.some((fact) => fact.includes("has not recorded a sample yet"))).toBe(true);
  });

  it("marks billing degraded when payment webhook events failed processing even though the probe is green", async () => {
    const rows = healthyRows();
    rows["event_type LIKE 'payment%'"] = { events: 6, failed: 2, last_event: FRESH };
    const billing = await surfaceById(makeEnv(rows), "billing");
    expect(billing.state).toBe("degraded");
    expect(billing.reason).toContain("2 payment webhook events failed processing");
  });

  it("marks billing down when the billing_dodo probe is red across the window", async () => {
    const rows = healthyRows();
    rows["s2.probe = status_probe_samples.probe)"] = (
      rows["s2.probe = status_probe_samples.probe)"] as Row[]
    ).map((row) =>
      row.probe === "billing_dodo"
        ? { ...row, ok: 0, detail: "canary billing state not stable" }
        : row,
    );
    rows["AVG(ok) AS ok_rate"] = (rows["AVG(ok) AS ok_rate"] as Row[]).map((row) =>
      row.probe === "billing_dodo" ? { ...row, ok_rate: 0 } : row,
    );
    const billing = await surfaceById(makeEnv(rows), "billing");
    expect(billing.state).toBe("down");
    expect(billing.reason).toContain("canary billing state not stable");
  });

  it("marks email delivery degraded when sends failed in the last 24 hours", async () => {
    const rows = healthyRows();
    rows["MAX(created_at) AS last_sent"] = { last_sent: FRESH, sent: 9, failed: 3 };
    const email = await surfaceById(makeEnv(rows), "email");
    expect(email.state).toBe("degraded");
    expect(email.reason).toContain("3 email sends failed");
  });

  it("folds the email-delivery canary into the email row when canary receipts are recorded", async () => {
    const email = await surfaceById(makeEnv(healthyRows()), "email");
    expect(email.state).toBe("operational");
    // checked-ago tracks the newest evidence (the canary receipt).
    expect(email.checkedAt).toBe(FRESH);
    expect(email.facts.some((fact) => fact.includes("2 of 2 live delivery checks received back in the last 24 hours (100% received)"))).toBe(true);
    expect(email.facts.some((fact) => fact.includes("median receipt latency 21 s"))).toBe(true);
    expect(email.facts.some((fact) => fact.includes("last receipt 1 h ago"))).toBe(true);
    // The live email_delivery probe governs the row like every other rail.
    expect(email.facts.some((fact) => fact.includes("100% of 48 live probe checks"))).toBe(true);
    expect(email.facts.some((fact) => fact.includes("canary sent; 2/2 receipts"))).toBe(true);
  });

  it("caps the email row at degraded when a canary delivery failed even though the probe is green", async () => {
    const rows = healthyRows();
    rows["FROM email_delivery_canary"] = [
      { token: "tok-1", status: "received", sent_at: FRESH, received_at: FRESH, latency_ms: 21000, error: null, created_at: FRESH },
      { token: "tok-2", status: "failed", sent_at: FRESH, received_at: null, latency_ms: null, error: "provider rejected the send", created_at: FRESH },
    ];
    const email = await surfaceById(makeEnv(rows), "email");
    expect(email.state).toBe("degraded");
    expect(email.reason).toContain("1 delivery check failed in the last 24 hours");
    expect(email.facts.some((fact) => fact.includes("last delivery check failure: provider rejected the send"))).toBe(true);
  });

  it("keeps the email row on counter evidence when the canary window is empty", async () => {
    // Absent canary data: no fabricated rows, the digest/attempt counters
    // carry the row and the probe-pending fact marks the rail gap.
    const rows = healthyRows();
    rows["FROM email_delivery_canary"] = [];
    rows["s2.probe = status_probe_samples.probe)"] = (
      rows["s2.probe = status_probe_samples.probe)"] as Row[]
    ).filter((row) => row.probe !== "email_delivery");
    rows["AVG(ok) AS ok_rate"] = (rows["AVG(ok) AS ok_rate"] as Row[]).filter(
      (row) => row.probe !== "email_delivery",
    );
    const email = await surfaceById(makeEnv(rows), "email");
    expect(email.state).toBe("operational");
    expect(email.facts.some((fact) => fact.includes("live delivery checks received back"))).toBe(false);
    expect(email.facts.some((fact) => fact.includes("the live email-delivery probe has not recorded a sample yet"))).toBe(true);
  });

  it("marks email delivery down when the email_delivery probe is red across the window", async () => {
    const rows = healthyRows();
    rows["s2.probe = status_probe_samples.probe)"] = (
      rows["s2.probe = status_probe_samples.probe)"] as Row[]
    ).map((row) =>
      row.probe === "email_delivery"
        ? { ...row, ok: 0, detail: "loop degraded: sends with zero receipts" }
        : row,
    );
    rows["AVG(ok) AS ok_rate"] = (rows["AVG(ok) AS ok_rate"] as Row[]).map((row) =>
      row.probe === "email_delivery" ? { ...row, n: 3, ok_rate: 0 } : row,
    );
    const email = await surfaceById(makeEnv(rows), "email");
    expect(email.state).toBe("down");
    expect(email.reason).toContain("loop degraded: sends with zero receipts");
  });

  it("carries the suppression count and recipient base as measured facts", async () => {
    const email = await surfaceById(makeEnv(healthyRows()), "email");
    expect(email.facts.some((fact) => fact.includes("1 addresses held"))).toBe(true);
    expect(email.facts.some((fact) => fact.includes("40 known recipient addresses"))).toBe(true);
  });

  it("marks scheduled monitoring down when every run in the window failed", async () => {
    const rows = healthyRows();
    rows["SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed\n        FROM watchlist_run"] = { total: 5, failed: 5 };
    const monitoring = await surfaceById(makeEnv(rows), "monitoring");
    expect(monitoring.state).toBe("down");
    expect(monitoring.reason).toContain("every watchlist run");
  });

  it("keeps scheduled monitoring operational at zero runs with zero watchlists", async () => {
    const rows = healthyRows();
    rows["SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed\n        FROM watchlist_run"] = { total: 0, failed: 0 };
    rows["SELECT MAX(started_at)"] = { last_started_at: null };
    rows["FROM watchlist WHERE is_active"] = { active: 0 };
    const monitoring = await surfaceById(makeEnv(rows), "monitoring");
    expect(monitoring.state).toBe("operational");
    expect(monitoring.facts.some((fact) => fact.includes("0 active watchlists"))).toBe(true);
  });

  it("reports the measured uptime percentage and median latency from the uptime probe", async () => {
    const uptime = await surfaceById(makeEnv(healthyRows()), "uptime");
    expect(uptime.state).toBe("operational");
    expect(uptime.checkedAt).toBe(FRESH);
    expect(uptime.facts.some((fact) => fact.includes("100% of 288 live probe checks"))).toBe(true);
    expect(uptime.facts.some((fact) => fact.includes("median probe latency 90 ms"))).toBe(true);
    expect(uptime.facts.some((fact) => fact.includes("home 200/95ms"))).toBe(true);
  });

  it("marks uptime degraded on a partial probe failure and names the failure", async () => {
    const rows = healthyRows();
    rows["s2.probe = status_probe_samples.probe)"] = (
      rows["s2.probe = status_probe_samples.probe)"] as Row[]
    ).map((row) =>
      row.probe === "uptime" ? { ...row, ok: 0, detail: "home 503/810ms, health 200/40ms" } : row,
    );
    rows["AVG(ok) AS ok_rate"] = (rows["AVG(ok) AS ok_rate"] as Row[]).map((row) =>
      row.probe === "uptime" ? { ...row, ok_rate: 0.96 } : row,
    );
    const uptime = await surfaceById(makeEnv(rows), "uptime");
    expect(uptime.state).toBe("degraded");
    expect(uptime.reason).toContain("home 503/810ms");
    expect(uptime.facts.some((fact) => fact.includes("96% of 288 live probe checks"))).toBe(true);
  });

  it("marks uptime degraded while the probe rail has no samples yet", async () => {
    const rows = healthyRows();
    rows["s2.probe = status_probe_samples.probe)"] = [];
    rows["AVG(ok) AS ok_rate"] = [];
    rows["ROW_NUMBER() OVER"] = [];
    const uptime = await surfaceById(makeEnv(rows), "uptime");
    expect(uptime.state).toBe("degraded");
    expect(uptime.reason).toContain("uptime probe has not recorded a sample yet");
  });

  it("never emits the confession vocabulary in any surface", async () => {
    const result = await getPublicStatusSurfaces(makeEnv(healthyRows()));
    const serialized = JSON.stringify(result).toLowerCase();
    for (const phrase of ["unavailable", "not measured", "not live-checked", "does not measure", "limited today"]) {
      expect(serialized).not.toContain(phrase);
    }
  });

  it("never emits private account fields", async () => {
    const result = await getPublicStatusSurfaces(makeEnv(healthyRows()));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("recipient_email");
    expect(serialized).not.toContain("@example");
    expect(serialized).not.toContain("watchlist_id");
  });
});
