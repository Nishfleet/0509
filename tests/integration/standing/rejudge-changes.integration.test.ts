import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { rejudgeUnjudgedChanges } from "../../../app/lib/site/judge.server";
import { countUnjudgedInputs } from "../../../app/lib/standing-score.server";
import { freezeWeek } from "../../../workers/standing/freeze";

const WEEK_START = "2026-09-28T02:30:00.000Z";
const WEEK_END = "2026-10-05T02:30:00.000Z";
const DURING = "2026-10-01T12:00:00.000Z";
const CREATED = "2026-09-20T00:00:00.000Z";

let runs = 0;

function answeringJev() {
  return {
    async run(_model: string, request: { questions: Record<string, { type: string }> }) {
      const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
      for (const [id, question] of Object.entries(request.questions)) {
        answers[id] = question.type === "noul" ? { type: "noul", noul: 0.95 } : { type: "choice", choice: "copy" };
      }
      return { answers };
    },
  };
}

async function seedWorkspace(): Promise<{ workspaceId: string; rivalId: string; selfId: string }> {
  runs += 1;
  const workspaceId = `ws-rejudge-change-${String(runs)}`;
  const userId = `user-rejudge-change-${String(runs)}`;
  const selfId = `${workspaceId}-self`;
  const rivalId = `${workspaceId}-rival`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, "Rejudge", `${userId}@example.test`, CREATED),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Rejudge', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, CREATED),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', 'own.example', 'Own', 'on', ?3)",
    ).bind(selfId, workspaceId, CREATED),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'rival.example', 'Rival', 'on', ?3)",
    ).bind(rivalId, workspaceId, CREATED),
  ]);
  return { workspaceId, rivalId, selfId };
}

async function seedStanding(workspaceId: string, entities: readonly string[]) {
  await env.DB.batch(
    entities.map((entityId) =>
      env.DB.prepare(
        "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, computed_at) VALUES (?1, ?2, ?3, ?4, 1, ?4)",
      ).bind(`stand-${entityId}`, workspaceId, entityId, WEEK_START),
    ),
  );
}

async function seedChange(workspaceId: string, entityId: string, slug: string) {
  await env.DB.prepare(
    "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at) VALUES (?1, ?2, ?3, 'src_site_web', 'change', 'home', ?4, '{}', ?1, ?5)",
  )
    .bind(`${workspaceId}-${slug}`, workspaceId, entityId, `https://rival.example/${slug}`, DURING)
    .run();
  return `${workspaceId}-${slug}`;
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("rejudging unjudged change signals (0509#7065)", () => {
  it("does not freeze while a change has no verdict, then freezes after Jev recovers", async () => {
    const { workspaceId, rivalId, selfId } = await seedWorkspace();
    await seedStanding(workspaceId, [selfId, rivalId]);
    await seedChange(workspaceId, rivalId, "deferred");
    const window = { workspaceId, weekStartAt: WEEK_START, weekEndAt: WEEK_END };

    expect(await freezeWeek(env.DB, window)).toEqual([]);
    expect(
      await countUnjudgedInputs(env.DB, {
        workspaceId,
        windowStartAt: WEEK_START,
        windowEndAt: WEEK_END,
      }),
    ).toBe(1);

    Reflect.set(env, "AI", answeringJev());
    expect(
      await rejudgeUnjudgedChanges({
        workspaceId,
        windowStartAt: WEEK_START,
        windowEndAt: WEEK_END,
      }),
    ).toBe(1);

    const ranked = await freezeWeek(env.DB, window);
    expect(ranked.map((row) => row.entity_id).sort()).toEqual([rivalId, selfId].sort());
    expect(ranked.every((row) => row.rank >= 1)).toBe(true);
  });

  it("counts a self-breakage verdict as judged so freeze can run", async () => {
    const { workspaceId, rivalId, selfId } = await seedWorkspace();
    await seedStanding(workspaceId, [selfId, rivalId]);
    const signalId = await seedChange(workspaceId, selfId, "breakage");
    await env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'own_site_breakage', ?3, ?4, 0.7, ?5)",
    )
      .bind(`${signalId}-jev`, workspaceId, `${signalId}-hash`, signalId, DURING)
      .run();

    expect(
      await countUnjudgedInputs(env.DB, {
        workspaceId,
        windowStartAt: WEEK_START,
        windowEndAt: WEEK_END,
      }),
    ).toBe(0);
    expect(await freezeWeek(env.DB, windowFor(workspaceId))).toHaveLength(2);
  });
});

function windowFor(workspaceId: string) {
  return { workspaceId, weekStartAt: WEEK_START, weekEndAt: WEEK_END };
}
