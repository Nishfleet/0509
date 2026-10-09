import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { READ_THIS_FIRST } from "../../../app/lib/read-this-first";
import { toSignalRow } from "../../../workers/mentions/map";
import { judgeWeek } from "../../../workers/standing/read-this-first";
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
    ).bind(
      signalTomb,
      workspaceId,
      entA,
      sourceOne,
      titleTomb,
      `https://tomb-${run}.example/post`,
      `d4-t-hash-tomb-${run}`,
      `d4-t-dedup-tomb-${run}`,
      "2026-09-18T10:00:00.000Z",
    ),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
    ).bind(`d4-t-verdict-a-${run}`, workspaceId, `d4-t-ih-a-${run}`, signalA, DECIDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
    ).bind(`d4-t-verdict-b-${run}`, workspaceId, `d4-t-ih-b-${run}`, signalB, DECIDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
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

const MAP_CTX = {
  workspaceId: "ws_map",
  entityId: "ent_map",
  sourceId: "src_map",
  watchId: null,
  snapshotId: null,
  observedAt: "2026-09-18T10:00:00.000Z",
};

describe("judgeWeek", () => {
  it("judges the week's D3/D6-passed items and writes every verdict", async () => {
    const seeded = await seed();
    const run = vi.fn(async (_model: string, request: StubRequest) => {
      const noul = request.state.item.title === seeded.titleA ? 0.8 : 0.6;
      return { answers: { [READ_THIS_FIRST.id]: { type: "noul", noul } } };
    });
    Reflect.set(env, "AI", { run });

    const result = await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(result).toEqual({ picks: [seeded.signalA, seeded.signalB], judged: 2, unjudged: true });
    expect(run).toHaveBeenCalledTimes(2);
    expect(askedTitles(run)).not.toContain(seeded.titleC);
    const written = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jev_verdict WHERE question_id = ?1 AND signal_id IN (?2, ?3)",
    )
      .bind(READ_THIS_FIRST.id, seeded.signalA, seeded.signalB)
      .first<{ n: number }>();
    expect(written?.n).toBe(2);
  });

  it("serves the second identical call from jev_verdict without new run calls", async () => {
    const seeded = await seed();
    const run = vi.fn(async (_model: string, request: StubRequest) => {
      const noul = request.state.item.title === seeded.titleA ? 0.8 : 0.6;
      return { answers: { [READ_THIS_FIRST.id]: { type: "noul", noul } } };
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

    expect(result).toEqual({ picks: [], judged: 0, unjudged: true });
  });

  it("never sends a tombstoned signal even with a 0.95 verdict", async () => {
    const seeded = await seed();
    const run = vi.fn(async () => ({ answers: { [READ_THIS_FIRST.id]: { type: "noul", noul: 0.9 } } }));
    Reflect.set(env, "AI", { run });

    await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(run).toHaveBeenCalledTimes(2);
    expect(askedTitles(run)).not.toContain(seeded.titleTomb);
  });
  it("pairs each question with its signal kind, so a mention with a noteworthy_change verdict is not sent", async () => {
    const seeded = await seed();
    await env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)",
    )
      .bind(
        `d4-t-verdict-c-${seeded.signalC}`,
        seeded.workspaceId,
        `d4-t-ih-c-${seeded.signalC}`,
        seeded.signalC,
        DECIDED_AT,
      )
      .run();
    const run = vi.fn(async () => ({ answers: { [READ_THIS_FIRST.id]: { type: "noul", noul: 0.9 } } }));
    Reflect.set(env, "AI", { run });

    await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(run).toHaveBeenCalledTimes(2);
    expect(askedTitles(run)).not.toContain(seeded.titleC);
  });

  async function addMention(seeded: Seeded, id: string, title: string, publishedAt: string, observedAt: string) {
    const [source, entity] = await Promise.all([
      env.DB.prepare("SELECT source_id FROM signal WHERE id = ?1").bind(seeded.signalA).first<{ source_id: string }>(),
      env.DB.prepare("SELECT entity_id FROM signal WHERE id = ?1").bind(seeded.signalA).first<{ entity_id: string }>(),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, published_at, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, ?8, ?9, ?10, 0)",
      ).bind(
        id,
        seeded.workspaceId,
        entity?.entity_id,
        source?.source_id,
        title,
        `https://${id}.example/post`,
        `hash-${id}`,
        `dedup-${id}`,
        publishedAt,
        observedAt,
      ),
      env.DB.prepare(
        "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
      ).bind(`verdict-${id}`, seeded.workspaceId, `ih-${id}`, id, DECIDED_AT),
    ]);
  }

  it("excludes a story published long before the week even when it was observed inside it", async () => {
    const seeded = await seed();
    await addMention(
      seeded,
      `${seeded.signalA}-old`,
      "Old story",
      "2021-03-04T10:00:00.000Z",
      "2026-09-18T10:00:00.000Z",
    );
    const run = vi.fn(async () => ({ answers: { [READ_THIS_FIRST.id]: { type: "noul", noul: 0.9 } } }));
    Reflect.set(env, "AI", { run });

    await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    expect(askedTitles(run)).not.toContain("Old story");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("compares dates by instant, so offset and second-precision published_at values land in the right week", async () => {
    const seeded = await seed();
    await addMention(
      seeded,
      `${seeded.signalA}-in`,
      "Out of week offset",
      "2026-09-21T23:30:00-05:00",
      "2026-09-30T00:00:00.000Z",
    );
    await addMention(
      seeded,
      `${seeded.signalA}-out`,
      "In week offset",
      "2026-09-21T23:30:00+05:00",
      "2026-09-18T00:00:00.000Z",
    );
    await addMention(
      seeded,
      `${seeded.signalA}-edge`,
      "Edge no millis",
      "2026-09-15T00:00:00Z",
      "2026-09-01T00:00:00.000Z",
    );
    const run = vi.fn(async () => ({ answers: { [READ_THIS_FIRST.id]: { type: "noul", noul: 0.9 } } }));
    Reflect.set(env, "AI", { run });

    await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    const asked = askedTitles(run);
    expect(asked).toContain("In week offset");
    expect(asked).toContain("Edge no millis");
    expect(asked).not.toContain("Out of week offset");
  });
  it("excludes an RFC822 item normalised at ingest from the week, and orders by published date over observed date", async () => {
    const seeded = await seed();
    const rfc822 = await toSignalRow(
      {
        dedupKey: "old",
        url: "https://old.example/post",
        title: "Rfc822 old story",
        publishedAt: "Mon, 04 Mar 2021 10:00:00 GMT",
      },
      { ...MAP_CTX, observedAt: "2026-09-18T10:00:00.000Z" },
    );
    expect(rfc822.published_at).toBe("2021-03-04T10:00:00.000Z");
    await addMention(
      seeded,
      `${seeded.signalA}-rfc`,
      "Rfc822 old story",
      rfc822.published_at ?? "",
      rfc822.observed_at,
    );
    await addMention(
      seeded,
      `${seeded.signalA}-early`,
      "Published early",
      "2026-09-16T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    );
    await addMention(
      seeded,
      `${seeded.signalA}-late`,
      "Published late",
      "2026-09-20T00:00:00.000Z",
      "2026-09-17T00:00:00.000Z",
    );
    const run = vi.fn(async () => ({ answers: { [READ_THIS_FIRST.id]: { type: "noul", noul: 0.9 } } }));
    Reflect.set(env, "AI", { run });

    await judgeWeek(env.DB, inputFor(seeded.workspaceId));

    const asked = askedTitles(run);
    expect(asked).not.toContain("Rfc822 old story");
    expect(asked.indexOf("Published late")).toBeGreaterThanOrEqual(0);
    expect(asked.indexOf("Published late")).toBeLessThan(asked.indexOf("Published early"));
  });
});
