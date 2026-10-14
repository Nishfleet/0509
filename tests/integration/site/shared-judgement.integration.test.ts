import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeBreakageEvidence } from "../../../app/lib/site/breakage-evidence";
import { askMixed } from "../../../app/lib/jev/client.server";
import { D3_KIND, D3_NOTEWORTHY, judgeChange } from "../../../app/lib/site/judge.server";

const NOW = new Date().toISOString();
const calls = { count: 0 };

function installJev(): void {
  Reflect.set(env, "AI", {
    run(_model: string, request: { questions: Record<string, { type: string }> }) {
      calls.count += 1;
      const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
      for (const [id, question] of Object.entries(request.questions)) {
        answers[id] = question.type === "noul" ? { type: "noul", noul: 0.7 } : { type: "choice", choice: "pricing" };
      }
      return Promise.resolve({ answers });
    },
  });
}

async function seedWorkspace(ws: string, selfEntity: string, rivalEntity: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 1, ?3, ?3)`,
    ).bind(`user-${ws}`, `${ws}@0509.io`, NOW),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?1, ?1, ?2, 'UTC', 1, 8, ?3)`,
    ).bind(ws, `user-${ws}`, NOW),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', ?3, 'Mine', 'on', ?4)`,
    ).bind(selfEntity, ws, `${ws}-mine.example`, NOW),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'shared-rival.example', 'Rival', 'on', ?3)`,
    ).bind(rivalEntity, ws, NOW),
  ]);
}

function judgeFor(ws: string, entity: string, isSelf: boolean, line = "+Plans from $12") {
  return judgeChange({
    workspaceId: ws,
    entityId: entity,
    signalId: null,
    isSelf,
    subject: { name: "Rival", domain: "shared-rival.example" },
    pageUrl: "https://shared-rival.example/",
    pageRole: "home",
    hunks: [{ lines: ["-Plans from $10", line] }],
    evidence: computeBreakageEvidence({ status: 200, beforeText: "Plans from $10.", afterText: "Plans from $12." }),
  });
}

const rowsOf = async (ws: string) =>
  (
    await env.DB.prepare(
      "SELECT workspace_id, entity_id, question_id FROM jev_verdict WHERE workspace_id = ? ORDER BY question_id",
    )
      .bind(ws)
      .all<{ workspace_id: string; entity_id: string; question_id: string }>()
  ).results;

describe("the same public change judged for two workspaces", () => {
  beforeEach(async () => {
    for (const table of ["jev_verdict", "entity", "workspace"]) await env.DB.exec(`DELETE FROM ${table}`);
    await env.DB.exec('DELETE FROM "user"');
    calls.count = 0;
    installJev();
    await seedWorkspace("ws-a", "self-a", "rival-a");
    await seedWorkspace("ws-b", "self-b", "rival-b");
  });

  afterEach(() => {
    Reflect.deleteProperty(env, "AI");
  });

  it("asks the judge once, and gives the second workspace the same answer under its own rows", async () => {
    const first = await judgeFor("ws-a", "rival-a", false);
    const second = await judgeFor("ws-b", "rival-b", false);

    expect(calls.count).toBe(1);
    expect(second.noteworthy).toEqual(first.noteworthy);
    expect(await rowsOf("ws-a")).toEqual([
      { workspace_id: "ws-a", entity_id: "rival-a", question_id: "change_kind" },
      { workspace_id: "ws-a", entity_id: "rival-a", question_id: "noteworthy_change" },
    ]);
    expect(await rowsOf("ws-b")).toEqual([
      { workspace_id: "ws-b", entity_id: "rival-b", question_id: "change_kind" },
      { workspace_id: "ws-b", entity_id: "rival-b", question_id: "noteworthy_change" },
    ]);
  });

  it("never lets one workspace's rows point at the other's brands, signals or ids", async () => {
    await judgeFor("ws-a", "rival-a", false);
    await judgeFor("ws-b", "rival-b", false);

    const all = (
      await env.DB.prepare("SELECT workspace_id, entity_id, signal_id, input_hash FROM jev_verdict").all<{
        workspace_id: string;
        entity_id: string;
        signal_id: string | null;
        input_hash: string;
      }>()
    ).results;
    expect(all).toHaveLength(4);
    for (const row of all) {
      expect(row.entity_id).toBe(row.workspace_id === "ws-a" ? "rival-a" : "rival-b");
    }
    expect(new Set(all.map((row) => row.input_hash)).size).toBe(4);
  });

  it("asks again when the change itself differs", async () => {
    await judgeFor("ws-a", "rival-a", false);
    await judgeFor("ws-b", "rival-b", false, "+Plans from $15");
    expect(calls.count).toBe(2);
  });

  it("asks again when anything else the judge sees differs, such as what a customer said", async () => {
    const questions = { noul: D3_NOTEWORTHY, choice: D3_KIND, shared: true };
    const state = { item: "Plans from $12", history_30d: [] };
    await askMixed("ws-a", questions, state);
    await askMixed("ws-b", questions, { ...state, history_30d: [{ customer_said: "not_useful" }] });
    expect(calls.count).toBe(2);
  });

  it("never shares a verdict about the owner's own site", async () => {
    await judgeFor("ws-a", "self-a", true);
    await judgeFor("ws-b", "self-b", true);
    expect(calls.count).toBeGreaterThanOrEqual(2);
    expect(await rowsOf("ws-b")).not.toEqual([]);
  });

  it("does not reuse a rival verdict for the owner's own site", async () => {
    await judgeFor("ws-a", "rival-a", false);
    const before = calls.count;
    await judgeFor("ws-b", "self-b", true);
    expect(calls.count).toBeGreaterThan(before);
  });
});
