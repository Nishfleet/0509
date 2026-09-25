import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reviewFields } from "../../../app/lib/identity/field-confidence.server";
import type { Subject } from "../../../app/lib/identity/normalise";

const NAME_ID = "identity_field_confidence.name";
const DESCRIPTION_ID = "identity_field_confidence.description";
const SOCIALS_ID = "identity_field_confidence.socials";

const NOW = "2026-09-24T12:00:00.000Z";

const SUBJECT: Subject = { kind: "domain", registrable: "gymshark.com", url: "https://gymshark.com/" };

const ALL_FIELDS = {
  name: "Gymshark",
  description: "game-changing workout clothes",
  socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
};

const WS_ID = "ws-field-confidence";

let runs = 0;

beforeEach(async () => {
  runs += 1;
  const userId = `u-field-confidence-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jev_verdict"),
    env.DB.prepare('DELETE FROM workspace WHERE id = ?1').bind(WS_ID),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(userId, `Owner-${String(runs)}`, `owner-${String(runs)}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, ?2, ?3, ?4)").bind(
      WS_ID,
      "Owner",
      userId,
      NOW,
    ),
  ]);
});

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

function stubAi(answers: (model: string, input: unknown) => unknown) {
  const run = vi.fn(answers);
  Reflect.set(env, "AI", { run });
  return run;
}

function askedIds(run: ReturnType<typeof stubAi>): string[][] {
  return run.mock.calls.map((call) => Object.keys((call[1] as { questions: Record<string, unknown> }).questions));
}

function runAnswer(p: Record<string, number>) {
  return (_model: string, _input: unknown) =>
    Promise.resolve({
      answers: Object.fromEntries(
        Object.entries(p).map(([id, value]) => [id, { type: "noul", noul: value }] as const),
      ),
    });
}

describe("reviewFields", () => {
  it("asks one Jev request for all valued fields and returns a per-field review", async () => {
    const run = stubAi(
      runAnswer({
        [NAME_ID]: 0.95,
        [DESCRIPTION_ID]: 0.5,
        [SOCIALS_ID]: 0.05,
      }),
    );

    const review = await reviewFields(WS_ID, SUBJECT, ALL_FIELDS, NOW);

    expect(review).toEqual({ name: "fill", description: "check", socials: "empty" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(askedIds(run)[0]?.sort()).toEqual([NAME_ID, DESCRIPTION_ID, SOCIALS_ID].sort());
    const { results } = await env.DB.prepare("SELECT question_id, p, workspace_id FROM jev_verdict").all();
    expect(results).toHaveLength(3);
    const byId = new Map(results.map((row) => [String(row.question_id), Number(row.p)] as const));
    expect(byId.get(NAME_ID)).toBe(0.95);
    expect(byId.get(DESCRIPTION_ID)).toBe(0.5);
    expect(byId.get(SOCIALS_ID)).toBe(0.05);
    expect(results.every((row) => row.workspace_id === WS_ID)).toBe(true);
  });

  it("does not ask about a field with no value", async () => {
    const run = stubAi(runAnswer({ [NAME_ID]: 0.95 }));

    const review = await reviewFields(WS_ID, SUBJECT, { name: "Gymshark", description: null, socials: [] }, NOW);

    expect(review).toEqual({ name: "fill", description: "empty", socials: "empty" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(askedIds(run)[0]).toEqual([NAME_ID]);
  });

  it("returns check for every valued field and logs nothing when Jev cannot be reached", async () => {
    const run = stubAi(() => Promise.reject(new Error("jev down")));

    const review = await reviewFields(WS_ID, SUBJECT, ALL_FIELDS, NOW);

    expect(review).toEqual({ name: "check", description: "check", socials: "check" });
    expect(run).toHaveBeenCalledTimes(1);
    const { results } = await env.DB.prepare("SELECT id FROM jev_verdict").all();
    expect(results).toHaveLength(0);
  });

  it("leaves a field with no value empty when Jev cannot be reached", async () => {
    const run = stubAi(() => Promise.reject(new Error("jev down")));

    const review = await reviewFields(WS_ID, SUBJECT, { name: "Gymshark", description: null, socials: [] }, NOW);

    expect(review).toEqual({ name: "check", description: "empty", socials: "empty" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
