import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { advanceHnCursor } from "../../../app/lib/data/watch.server";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T03:00:00.000Z";
const NEWER = "2026-09-23T09:00:00.000Z";
const OLDER = "2026-09-23T07:00:00.000Z";

let runs = 0;

function hit(objectId: string, title: string, createdAt: string) {
  return { objectID: objectId, title, url: `https://blog.example.com/${objectId}`, created_at: createdAt };
}

async function seed(): Promise<{ competitorId: string; brand: string }> {
  runs += 1;
  const suffix = String(runs);
  const workspaceId = `ws-hncur-${suffix}`;
  const competitorId = `${workspaceId}-competitor`;
  const brand = `Cursorwear ${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?1, ?2, 1, ?3, ?3)',
    ).bind(`user-hncur-${suffix}`, `hncur-${suffix}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, `user-hncur-${suffix}`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Gymshark', '{\"description\":\"Gym clothing\"}', ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, `self-hncur-${suffix}.com`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(competitorId, workspaceId, `cursorwear-${suffix}.com`, brand, NOW),
  ]);
  return { competitorId, brand };
}

function stubHn(hits: readonly ReturnType<typeof hit>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ hits })))),
  );
  Reflect.set(env, "AI", {
    run: vi.fn((_model: string, input: { questions: Record<string, unknown> }) => {
      const [questionId] = Object.keys(input.questions);
      return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: 0.96 } } });
    }),
  });
}

async function sweepHn(brand: string) {
  const target = (await planTargets()).find((entry) => entry.pluginKey === "hn.algolia" && entry.query === brand);
  if (target === undefined) throw new Error(`no hn target for ${brand}`);
  await sweepTarget(target, NOW, null);
  return target.watches[0]?.watch_id ?? "";
}

async function readCursor(watchId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT hn_cursor FROM watch WHERE id = ?1")
    .bind(watchId)
    .first<{ hn_cursor: number }>();
  return row?.hn_cursor ?? -1;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("hn.algolia per-watch cursor", () => {
  it("advances the cursor to the newest created_at_i of the fetched hits", async () => {
    const { brand } = await seed();
    stubHn([hit("91000001", `${brand} older`, OLDER), hit("91000002", `${brand} newer`, NEWER)]);
    const watchId = await sweepHn(brand);
    expect(await readCursor(watchId)).toBe(Math.floor(Date.parse(NEWER) / 1000));
  });

  it("never moves the cursor backwards", async () => {
    const { brand } = await seed();
    stubHn([hit("91000011", `${brand} newer`, NEWER)]);
    const watchId = await sweepHn(brand);
    const newest = Math.floor(Date.parse(NEWER) / 1000);
    await advanceHnCursor(watchId, newest - 1000);
    expect(await readCursor(watchId)).toBe(newest);
    stubHn([hit("91000012", `${brand} older`, OLDER)]);
    await sweepHn(brand);
    expect(await readCursor(watchId)).toBe(newest);
  });

  it("skips items published before the watch was created and keeps rows already stored", async () => {
    const { competitorId, brand } = await seed();
    await planTargets();
    await env.DB.prepare("UPDATE watch SET created_at = '2026-09-01T00:00:00.000Z' WHERE entity_id = ?1")
      .bind(competitorId)
      .run();
    stubHn([hit("91000021", `${brand} older`, OLDER)]);
    const watchId = await sweepHn(brand);
    await env.DB.prepare("UPDATE watch SET created_at = '2026-09-23T08:00:00.000Z', hn_cursor = 0 WHERE id = ?1")
      .bind(watchId)
      .run();
    stubHn([
      hit("91000022", `${brand} before the watch`, "2026-09-23T07:30:00.000Z"),
      hit("91000023", `${brand} after`, NEWER),
    ]);
    await sweepHn(brand);
    const rows = await env.DB.prepare(
      "SELECT title FROM signal WHERE entity_id = ?1 AND kind = 'mention' ORDER BY title",
    )
      .bind(competitorId)
      .all<{ title: string }>();
    expect(rows.results.map((row) => row.title)).toEqual([`${brand} after`, `${brand} older`]);
  });
});
