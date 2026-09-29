import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { readHomeStandingInputs, SELECT_HOME_STANDING } from "../../app/lib/home-standing.server";

/**
 * One indexed Home read over 100 loads of four ON brands and two weekly
 * digests. The digest index is used and p95 stays under 500 ms.
 */

const USER = "user_home_perf";
const WS = "ws_home_perf";
const CREATED_AT = "2026-08-01T00:00:00.000Z";

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

async function seed() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Home', ?2, 1, ?3, ?3)",
    ).bind(USER, `${USER}@example.test`, CREATED_AT),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Home', ?2, 'Europe/London', 1, 8, ?3)",
    ).bind(WS, USER, CREATED_AT),
    ...[
      ["self", "self", "own.example"],
      ["a", "competitor", "a.example"],
      ["b", "competitor", "b.example"],
      ["c", "competitor", "c.example"],
    ].map(([id, role, domain]) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'on', ?6)",
      ).bind(`${WS}_${id}`, WS, role, domain, id, CREATED_AT),
    ),
    ...[
      ["older", "2026-09-14T07:00:00.000Z", 2],
      ["newest", "2026-09-21T07:00:00.000Z", 1],
    ].map(([id, periodEnd, rank]) =>
      env.DB.prepare(
        "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES (?1, ?2, 'weekly', ?3, ?4, 'sent', ?5)",
      ).bind(
        `${WS}_${id}`,
        WS,
        "2026-09-07T07:00:00.000Z",
        periodEnd,
        JSON.stringify({
          workspace_id: WS,
          timezone: "Europe/London",
          period_start: "2026-09-07T07:00:00.000Z",
          period_end: periodEnd,
          headline_rank: rank,
          headline_total: 4,
          why_line: `week ending ${periodEnd}`,
          brands: [],
        }),
      ),
    ),
  ]);
}

describe("home loader", () => {
  beforeAll(async () => {
    await seed();
  });

  it("uses the digest index and does not scan", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${SELECT_HOME_STANDING}`)
      .bind(USER)
      .all<{ detail: string }>();
    const details = (plan.results ?? []).map((row) => row.detail);
    expect(SELECT_HOME_STANDING.includes("signal")).toBe(false);
    expect(details.some((detail) => detail.includes("idx_digest_ws_kind_period"))).toBe(true);
    expect(details.every((detail) => !detail.startsWith("SCAN "))).toBe(true);
    console.log(`home-loader explain utc=${new Date().toISOString()} ${details.join(" | ")}`);
  });

  it(
    "stays under 500 ms at p95 over 100 loads of four ON brands and two rollovers",
    async () => {
      const samples: number[] = [];
      let readOk = true;
      for (let i = 0; i < 100; i++) {
        const started = performance.now();
        const inputs = await readHomeStandingInputs(env.DB, USER);
        samples.push(performance.now() - started);
        readOk =
          readOk &&
          inputs !== null &&
          inputs.entities.length === 4 &&
          inputs.entities.every((entity) => entity.state === "on") &&
          inputs.payload?.headline_rank === 1;
      }
      expect(readOk).toBe(true);
      const p95 = percentile(samples, 95);
      const utc = new Date().toISOString();
      console.log(
        `home-loader p95_ms=${p95.toFixed(3)} n=100 utc=${utc} timings_ms=${samples.map((sample) => sample.toFixed(3)).join(",")}`,
      );
      expect(p95).toBeLessThan(500);
    },
    60_000,
  );
});
