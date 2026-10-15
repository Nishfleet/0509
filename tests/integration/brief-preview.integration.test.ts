import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { previewBrief } from "../../app/lib/brief-preview.server";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const SCHEDULE = { timezone: "UTC", weekday: 1, hour: 8 };
const SEEDED_AT = "2026-10-01T00:00:00.000Z";
const OBSERVED_AT = "2026-10-06T10:00:00.000Z";

const CEILING = 22;
let runs = 0;

async function seed(rivals: number): Promise<string> {
  runs += 1;
  const run = String(runs);
  const workspaceId = `prev-ws-${run}`;
  const userId = `prev-user-${run}`;
  const sourceId = `prev-src-${run}`;
  const statements = [
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Preview', ?2, 1, ?3, ?3)",
    ).bind(userId, `prev-${run}@example.test`, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Preview', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', ?3, 'Self Brand', 'on', ?4)",
    ).bind(`prev-self-${run}`, workspaceId, `self-${run}.example`, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'mentions', ?3, ?4, 'official_api')",
    ).bind(sourceId, `prev-src-key-${run}`, `prev-pf-${run}`, `prev-pl-${run}`),
  ];
  for (let index = 0; index < rivals; index += 1) {
    const entityId = `prev-r${String(index)}-${run}`;
    const signalId = `prev-sig${String(index)}-${run}`;
    statements.push(
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
      ).bind(entityId, workspaceId, `r${String(index)}-${run}.example`, `Rival ${String(index)}`, SEEDED_AT),
      env.DB.prepare(
        "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, ?8, ?9, 0)",
      ).bind(
        signalId,
        workspaceId,
        entityId,
        sourceId,
        `Rival ${String(index)} is in the news`,
        `https://news.example/${run}/${String(index)}`,
        `prev-hash-${run}-${String(index)}`,
        `prev-dedup-${run}-${String(index)}`,
        OBSERVED_AT,
      ),
      env.DB.prepare(
        "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
      ).bind(
        `prev-verdict-${run}-${String(index)}`,
        workspaceId,
        `prev-ih-${run}-${String(index)}`,
        signalId,
        OBSERVED_AT,
      ),
    );
  }
  await env.DB.batch(statements);
  return workspaceId;
}

async function rowCounts(): Promise<number[]> {
  const tables = ["standing", "digest", "jev_verdict", "signal", "signal_delivery", "send_attempt"];
  return Promise.all(
    tables.map(
      async (table) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1,
    ),
  );
}

async function countStatements(fn: () => Promise<unknown>): Promise<number> {
  const db = env.DB as unknown as { prepare: (sql: string) => unknown };
  const original = db.prepare.bind(db);
  let prepared = 0;
  db.prepare = (sql: string) => {
    prepared += 1;
    return original(sql);
  };
  try {
    await fn();
  } finally {
    db.prepare = original;
  }
  return prepared;
}

describe("the brief preview, against real D1", () => {
  it("composes this week so far from the same step as the email and writes nothing", async () => {
    const workspaceId = await seed(3);
    const before = await rowCounts();
    const payload = await previewBrief(workspaceId, SCHEDULE, NOW);
    expect(await rowCounts()).toEqual(before);
    expect(payload.period_start).toBe("2026-10-05T08:00:00.000Z");
    expect(payload.period_end).toBe("2026-10-12T08:00:00.000Z");
    expect(payload.next_brief_at).toBe("2026-10-12T08:00:00.000Z");
    expect(payload.read_this_first).toHaveLength(3);
    expect(payload.brands.map((brand) => brand.rank)).toEqual([1, 2, 3, 4]);
    expect(payload.brands.map((brand) => brand.name).sort()).toEqual(["Rival 0", "Rival 1", "Rival 2", "Self Brand"]);
    expect(payload.is_unjudged).toBe(false);
  });

  it("shows only three items however many changed, and keeps a quiet workspace quiet", async () => {
    const busy = await previewBrief(await seed(6), SCHEDULE, NOW);
    expect(busy.read_this_first).toHaveLength(3);
    const quiet = await previewBrief(await seed(0), SCHEDULE, NOW);
    expect(quiet.read_this_first).toEqual([]);
    expect(quiet.is_quiet_week).toBe(true);
  });

  it("prepares the same number of statements for 2 rivals as for 40, within the ceiling", async () => {
    const smallId = await seed(2);
    const largeId = await seed(40);
    const small = await countStatements(() => previewBrief(smallId, SCHEDULE, NOW));
    const large = await countStatements(() => previewBrief(largeId, SCHEDULE, NOW));
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(CEILING);
  });
});
