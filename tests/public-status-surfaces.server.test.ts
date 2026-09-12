import { describe, expect, it, vi } from "vitest";

import { getPublicStatusSurfaces } from "~/lib/public-status-counters.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * State machine for the /status measured rows. Every state must trace to a
 * probe result or a D1 row: no fake green, no confession prose. These tests
 * script a D1 binding; the real migrated-D1 pass lives in
 * tests/integration/status-health-sample.integration.test.ts.
 */

type Row = Record<string, unknown>;

const NOW = "2026-09-12T04:00:00.000Z";
const FRESH = "2026-09-12T03:00:00.000Z";
const DAY_AGO = "2026-09-11T04:00:00.000Z";

/**
 * A scripted D1 binding. `rows` maps a distinctive SQL fragment to the row it
 * returns; anything unmapped returns an empty result set.
 */
function makeEnv(rows: Record<string, Row | null>, d1Down = false) {
  const resolveRow = (sql: string): Row | null => {
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
      return Promise.resolve(resolveRow(sql));
    });
    const all = vi.fn(() => {
      if (d1Down) throw new Error("d1 down");
      const row = resolveRow(sql);
      return Promise.resolve({ results: row ? [row] : [] });
    });
    return {
      first,
      bind: vi.fn(() => ({ first, all })),
      all,
    };
  });
  return { DB: { prepare } } as unknown as AppEnv;
}

const healthyRows = (): Record<string, Row | null> => ({
  "SELECT MAX(started_at)": { last_started_at: FRESH },
  "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed\n        FROM watchlist_run": { total: 31, failed: 0 },
  "FROM digest_delivery": { last_digest_sent_at: FRESH },
  "FROM scheduled_observation_health_state": { active_since: MONTH_AGO },
  "FROM watchlist WHERE is_active": { active: 3 },
  "FROM discovery_cache_entry": { sets: 12, freshest: FRESH },
  "FROM rate_limit_events": { served: 5 },
  "COUNT(*) AS tickets": { tickets: 4 },
  "MAX(created_at) AS last_ticket": { last_ticket: FRESH },
  "event_type LIKE 'payment%'": { events: 2, failed: 0, last_event: FRESH },
  "billing.canary.lock": { last_canary: FRESH },
  "AS last_digest": { last_digest: FRESH },
  "MAX(created_at) AS last_sent": { last_sent: FRESH, sent: 9, failed: 0 },
  "FROM email_suppression": { suppressed: 1 },
  "FROM delivery_target": { recipients: 40 },
  "COUNT(*) AS total": { total: 28, ok: 28 },
  "MAX(checked_at)": { last_sample_at: FRESH },
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

  it("marks public search degraded when the nightly cache refresh is overdue", async () => {
    const stale = "2026-09-10T04:00:00.000Z";
    const search = await surfaceById(
      makeEnv({ ...healthyRows(), "FROM discovery_cache_entry": { sets: 12, freshest: stale } }),
      "public-search",
    );
    expect(search.state).toBe("degraded");
    expect(search.reason).toContain("nightly result refresh is overdue");
  });

  it("marks sign-in degraded when no dispatch has ever been recorded", async () => {
    const rows = healthyRows();
    rows["MAX(created_at) AS last_ticket"] = { last_ticket: null };
    rows["COUNT(*) AS tickets"] = { tickets: 0 };
    const signIn = await surfaceById(makeEnv(rows), "sign-in");
    expect(signIn.state).toBe("degraded");
    expect(signIn.reason).toContain("no sign-in link dispatch has been recorded yet");
  });

  it("marks billing degraded when payment webhook events failed processing", async () => {
    const rows = healthyRows();
    rows["event_type LIKE 'payment%'"] = { events: 6, failed: 2, last_event: FRESH };
    const billing = await surfaceById(makeEnv(rows), "billing");
    expect(billing.state).toBe("degraded");
    expect(billing.reason).toContain("2 payment webhook events failed processing");
  });

  it("marks email delivery degraded when sends failed in the last 24 hours", async () => {
    const rows = healthyRows();
    rows["MAX(created_at) AS last_sent"] = { last_sent: FRESH, sent: 9, failed: 3 };
    const email = await surfaceById(makeEnv(rows), "email");
    expect(email.state).toBe("degraded");
    expect(email.reason).toContain("3 email sends failed");
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

  it("marks uptime degraded on a partial sample failure and names the missed checks", async () => {
    const rows = healthyRows();
    rows["COUNT(*) AS total"] = { total: 28, ok: 27 };
    const uptime = await surfaceById(makeEnv(rows), "uptime");
    expect(uptime.state).toBe("degraded");
    expect(uptime.reason).toContain("1 scheduled check(s) failed");
    expect(uptime.facts.some((fact) => fact.startsWith("96% of 28"))).toBe(true);
  });

  it("marks uptime degraded while the sample rail has no samples yet", async () => {
    const rows = healthyRows();
    rows["COUNT(*) AS total"] = { total: 0, ok: 0 };
    rows["MAX(checked_at)"] = { last_sample_at: null };
    const uptime = await surfaceById(makeEnv(rows), "uptime");
    expect(uptime.state).toBe("degraded");
    expect(uptime.reason).toContain("first one is pending");
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
