import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { judgeWeek, READ_THIS_FIRST } from "../../../workers/standing/read-this-first";
/**
 * The weekly D4 pass against the real D1 schema the deploy ships.
 *
 * judgeWeek reads only the items that D3 or D6 already passed, packs
 * `{ self, subject, competitor_set, item }`, batches askNoul in chunks of ten,
 * and writes every uncached verdict through insertVerdict. The stub answers by
 * title so we can pin pick order, cache hits and the tombstone filter without
 * touching the real model.
 */

const STARTS_AT = "2026-09-15T00:00:00.000Z";
const CLOSES_AT = "2026-09-22T00:00:00.000Z";
const DECIDED_AT = "2026-09-22T01:00:00.000Z";
const SEEDED_AT = "2026-09-21T00:00:00.000Z";

let seedRuns = 0;

interface Seeded {
  workspaceId: string;
  signalA: string;
  signalB: string;
  signalC: string;
  signalTomb: string;
  titleA: string;
  titleB: string;
  titleC: string;
  titleTomb: string;
}

async function seed(): Promise<Seeded> {
  seedRuns += 1;
  const run = String(seedRuns);
  const workspaceId = `d4-t-ws-${run}`;
  const userId = `d4-t-user-${run}`;
  const sourceOne = `d4-t-src-${run}`;
  const self = `d4-t-ent-self-${run}`;
  const entA = `d4-t-ent-a-${run}`;
  const entB = `d4-t-ent-b-${run}`;
  const entC = `d4-t-ent-c-${run}`;
  const signalA = `d4-t-sig-a-${run}`;
  const signalB = `d4-t-sig-b-${run}`;
  const signalC = `d4-t-sig-c-${run}`;
  const signalTomb = `d4-t-sig-tomb-${run}`;
  const titleA = `A launch ${run}`;
  const titleB = `B price ${run}`;
  const titleC = `C footprint ${run}`;
  const titleTomb = `D blocked ${run}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Read This First Test", `d4-t-${run}@example.test`, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Read This First Test", userId, "UTC", SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', ?3, ?4, 'on', ?5)",
    ).bind(self, workspaceId, `self-${run}.example`, "Self Brand", SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(entA, workspaceId, `a-${run}.example`, titleA, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(entB, workspaceId, `b-${run}.example`, titleB, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(entC, workspaceId, `c-${run}.example`, titleC, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'mentions', ?3, ?4, 'official_api')",
    ).bind(sourceOne, `d4-t-src-mentions-${run}`, `d4-t-pf-${run}`, `d4-t-pl-${run}`),
    ...[
      [signalA, entA, titleA, `https://a-${run}.example/post`, `d4-t-hash-a-${run}`],
      [signalB, entB, titleB, `https://b-${run}.example/post`, `d4-t-hash-b-${run}`],
      [signalC, entC, titleC, `https://c-${run}.example/post`, `d4-t-hash-c-${run}`],
    ].flatMap(([id, entityId, title, url, urlHash]) => [
      env.DB.prepare(
        "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, ?8, ?9, 0)",
      ).bind(id, workspaceId, entityId, sourceOne, title, url, urlHash, `d4-t-dedup-${id}`, `2026-09-18T10:00:00.000Z`),
    ]),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, ?8, ?9, 1)",
    ).bind(signalTomb, workspaceId, entA, sourceOne, titleTomb, `https://tomb-${run}.example/post`, `d4-t-hash-tomb-${run}`, `d4-t-dedup-tomb-${run}`, "2026-09-18T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)",
    ).bind(`d4-t-verdict-a-${run}`, workspaceId, `d4-t-ih-a-${run}`, signalA, DECIDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)",
    ).bind(`d4-t-verdict-b-${run}`, workspaceId, `d4-t-ih-b-${run}`, signalB, DECIDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)",
    ).bind(`d4-t-verdict-tomb-${run}`, workspaceId, `d4-t-ih-tomb-${run}`, signalTomb, DECIDED_AT),
  ]);

  return { workspaceId, signalA, signalB, signalC, signalTomb, titleA, titleB, titleC, titleTomb };
}

interface StubRequest {
  state: { item: { title: string | null } };
}

function askedTitles(run: { mock: { calls: unknown[][] } }): (string | null)[] {
  return run.mock.calls.map((call) => (call[1] as StubRequest).state.item.title);
}

function inputFor(workspaceId: string) {
  return { workspaceId, startsAt: STARTS_AT, closesAt: CLOSES_AT, decidedAt: DECIDED_AT };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("judgeWeek", () => {
  it("judges the week's D3/D6-passed items and writes every verdict", async () => {
    const seeded = await seed();
    const run = vi.fn(async (_model: string, request: StubRequest) => {
      const probability = request.state.item.title === seeded.titleA ? 0.8 : 0.6;
      return { answers: { [READ_THIS_FIRST.id]: { type: "boolean", probability } } };
    });
    Reflect.set(env, "AI", { run });

    const result = await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(result).toEqual({ picks: [seeded.signalA, seeded.signalB], judged: 2 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(askedTitles(run)).not.toContain(seeded.titleC);
    const written = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jev_verdict WHERE question_id = ?1 AND signal_id IN (?2, ?3)",
    ).bind(READ_THIS_FIRST.id, seeded.signalA, seeded.signalB).first<{ n: number }>();
    expect(written?.n).toBe(2);
  });

  it("serves the second identical call from jev_verdict without new run calls", async () => {
    const seeded = await seed();
    const run = vi.fn(async (_model: string, request: StubRequest) => {
      const probability = request.state.item.title === seeded.titleA ? 0.8 : 0.6;
      return { answers: { [READ_THIS_FIRST.id]: { type: "boolean", probability } } };
    });
    Reflect.set(env, "AI", { run });

    const first = await judgeWeek(env.DB, inputFor(seeded.workspaceId));
    expect(run).toHaveBeenCalledTimes(2);

    const second = await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(second).toEqual(first);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("returns nothing when Jev is unavailable", async () => {
    const seeded = await seed();
    const run = vi.fn(() => Promise.reject(new Error("Insufficient balance")));
    Reflect.set(env, "AI", { run });

    const result = await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(result).toEqual({ picks: [], judged: 0 });
  });

  it("never sends a tombstoned signal even with a 0.95 verdict", async () => {
    const seeded = await seed();
    const run = vi.fn(async () => ({ answers: { [READ_THIS_FIRST.id]: { type: "boolean", probability: 0.9 } } }));
    Reflect.set(env, "AI", { run });

    await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(run).toHaveBeenCalledTimes(2);
    expect(askedTitles(run)).not.toContain(seeded.titleTomb);
  });
});
