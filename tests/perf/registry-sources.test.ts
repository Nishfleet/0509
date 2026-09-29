import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { SELECT_REGISTRY_SOURCES } from "../../app/lib/data/source.server";

/**
 * The registry read is one indexed source scan over the denormalized
 * source.latest_* facts (parent #5722): no watch or snapshot rows are
 * touched per call, so rows_read stays under 200 at the parent's finish
 * line.
 */

const USER = "user_regperf";
const WS = "ws_regperf";
const ENTITY = "ent_regperf";
const CREATED_AT = "2026-08-01T00:00:00.000Z";
const SOURCE_COUNT = 30;
const WATCH_COUNT = 130;
const SNAPSHOTS_PER_WATCH = 15;

interface SnapshotSummary {
  fetched_at: string | null;
  item_count: number | null;
  canary_count: number | null;
}

interface RegistryRow {
  key: string;
  plugin_key: string;
  platform: string;
  kind: string;
  is_enabled: number;
  config_json: string;
  degraded_reason: string | null;
  last_good_at: string | null;
  fetched_at: string | null;
  item_count: number | null;
  canary_count: number | null;
}

async function seed(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Registry perf', ?2, 1, ?3, ?3)",
  ).bind(USER, `${USER}@example.test`, CREATED_AT).run();
  await env.DB.prepare(
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Registry perf', ?2, 'UTC', 1, 8, ?3)",
  ).bind(WS, USER, CREATED_AT).run();
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', 'acme.example', 'Acme', ?3)",
  ).bind(ENTITY, WS, CREATED_AT).run();

  const kinds = ["ads", "mentions", "site", "hiring"] as const;
  const statements: D1PreparedStatement[] = [];
  for (let s = 0; s < SOURCE_COUNT; s += 1) {
    const sourceId = `src_regperf_${String(s).padStart(2, "0")}`;
    const kind = kinds[s % kinds.length];
    statements.push(
      env.DB.prepare(
        "INSERT INTO source (id, key, kind, platform, plugin_key, is_enabled, latest_fetched_at, latest_item_count, latest_canary_count) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8)",
      ).bind(
        sourceId,
        `regperf.${sourceId}`,
        kind,
        "gdelt",
        sourceId,
        // Every third source carries denormalized facts; the rest stay NULL
        // like a source that has never been fetched.
        s % 3 === 0 ? `2026-09-${String(10 + (s % 10)).padStart(2, "0")}T00:00:00Z` : null,
        s % 3 === 0 ? s : null,
        s % 3 === 0 ? s % 5 : null,
      ),
    );
  }
  // 130 watches spread over the 30 sources, ~15 snapshots per watch.
  for (let w = 0; w < WATCH_COUNT; w += 1) {
    const sourceIndex = w % SOURCE_COUNT;
    const sourceId = `src_regperf_${String(sourceIndex).padStart(2, "0")}`;
    const watchId = `watch_regperf_${String(w).padStart(3, "0")}`;
    statements.push(
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
      ).bind(watchId, ENTITY, sourceId, `acme-${w}`),
    );
    for (let n = 0; n < SNAPSHOTS_PER_WATCH; n += 1) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count, canary_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        ).bind(
          `snap_regperf_${w}_${n}`,
          watchId,
          `2026-09-${String(10 + (n % 10)).padStart(2, "0")}T0${n % 10}:00:00Z`,
          `hash-${w}-${n}`,
          n,
          n % 2,
        ),
      );
    }
  }
  await env.DB.batch(statements);
}

describe("registry sources read", () => {
  beforeAll(async () => {
    await seed();
  });

  it("plans a single indexed source scan with no watch or snapshot access", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${SELECT_REGISTRY_SOURCES}`).all<{
      detail: string;
    }>();
    const details = (plan.results ?? []).map((row) => row.detail);
    expect(details.some((detail) => detail.includes("idx_source_kind"))).toBe(true);
    for (const detail of details) {
      expect(detail.includes("watch")).toBe(false);
      expect(detail.includes("snapshot")).toBe(false);
      expect(detail.includes("CORRELATED")).toBe(false);
    }
    console.log(
      `registry-sources explain utc=${new Date().toISOString()} ${details.join(" | ")}`,
    );
  });

  it("reads under 200 rows for the whole registry", async () => {
    const result = await env.DB.prepare(SELECT_REGISTRY_SOURCES).all<RegistryRow>();
    const rowsRead = result.meta.rows_read;
    const seeded = result.results.filter((row) => row.key.startsWith("regperf."));
    expect(seeded).toHaveLength(SOURCE_COUNT);
    expect(rowsRead).toBeLessThan(200);
    console.log(
      `registry-sources rows_read=${rowsRead} rows_out=${result.results.length} utc=${new Date().toISOString()}`,
    );
  });

  it("maps the denormalized columns to the same snapshot shape as the subqueries did", async () => {
    const rows = await env.DB.prepare(
      "SELECT key, latest_fetched_at, latest_item_count, latest_canary_count FROM source WHERE key LIKE 'regperf.%'",
    ).all<{ key: string; latest_fetched_at: string | null; latest_item_count: number | null; latest_canary_count: number | null }>();
    const seeded = new Map(rows.results.map((row) => [row.key, row]));

    const registry = await env.DB.prepare(SELECT_REGISTRY_SOURCES).all<RegistryRow>();
    let withFacts = 0;
    let withoutFacts = 0;
    for (const row of registry.results) {
      if (!row.key.startsWith("regperf.")) continue;
      const facts = seeded.get(row.key);
      if (facts === undefined) throw new Error(`seeded source ${row.key} missing`);
      const snapshot: SnapshotSummary | null =
        row.fetched_at === null
          ? null
          : {
              fetched_at: row.fetched_at,
              item_count: row.item_count,
              canary_count: row.canary_count,
            };
      if (facts.latest_fetched_at === null) {
        withoutFacts += 1;
        expect(snapshot).toBeNull();
      } else {
        withFacts += 1;
        expect(snapshot).toEqual({
          fetched_at: facts.latest_fetched_at,
          item_count: facts.latest_item_count,
          canary_count: facts.latest_canary_count,
        });
      }
    }
    expect(withFacts).toBeGreaterThan(0);
    expect(withoutFacts).toBeGreaterThan(0);
  });
});
