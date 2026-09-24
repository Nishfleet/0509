import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readDiscoveryContext, readRefreshTargets } from "../../../app/lib/data/entity.server";
import { judgeStillCompetitors } from "../../../app/lib/discovery/refresh.server";

const NOW = "2026-09-24T06:00:00.000Z";
const OLD_SIGNAL = "2026-08-01T00:00:00.000Z";
const RECENT_SIGNAL = "2026-09-23T06:00:00.000Z";
const SELF_CREATED = "2026-09-01T00:00:00.000Z";
const MANUAL_CREATED = "2026-09-02T00:00:00.000Z";
const AUTO_CREATED = "2026-09-03T00:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-d2-${String(runs)}`;
  const workspaceId = `ws-d2-${String(runs)}`;
  const autoEntityId = `${workspaceId}-auto`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', '{\"description\":\"Gym clothing\"}', ?3)",
    ).bind(`${workspaceId}-self`, workspaceId, SELF_CREATED),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at) VALUES (?1, ?2, 'competitor', 'manual.example', 'Manual Brand', 'manual', 'on', ?3, 'user', ?4)",
    ).bind(`${workspaceId}-manual`, workspaceId, NOW, MANUAL_CREATED),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at) VALUES (?1, ?2, 'competitor', 'auto.example', 'Auto Brand', 'auto', 'on', ?3, 'jev', ?4)",
    ).bind(autoEntityId, workspaceId, NOW, AUTO_CREATED),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at) VALUES (?1, ?2, 'competitor', 'off.example', 'Off Brand', 'manual', 'off', ?3, 'user', ?4)",
    ).bind(`${workspaceId}-off`, workspaceId, NOW, AUTO_CREATED),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, 'src_site_web', 'change', 'home', ?4, ?5, ?6, 0)",
    ).bind(
      `${workspaceId}-sig-old`,
      workspaceId,
      autoEntityId,
      "https://auto.example/",
      `${workspaceId}-sig-old-key`,
      OLD_SIGNAL,
    ),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, 'src_site_web', 'change', 'home', ?4, ?5, ?6, 0)",
    ).bind(
      `${workspaceId}-sig-recent`,
      workspaceId,
      autoEntityId,
      "https://auto.example/",
      `${workspaceId}-sig-recent-key`,
      RECENT_SIGNAL,
    ),
  ]);
  return workspaceId;
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("readRefreshTargets", () => {
  it("returns the on competitors in created_at order with their origins", async () => {
    const workspaceId = await seedWorkspace();
    const targets = await readRefreshTargets(workspaceId);
    expect(targets.map((t) => [t.domain, t.origin])).toEqual([
      ["manual.example", "manual"],
      ["auto.example", "auto"],
    ]);
  });
});

describe("judgeStillCompetitors", () => {
  it("asks Jev once per target with both questions and the history, returns the verdicts, and does not write", async () => {
    const workspaceId = await seedWorkspace();
    const context = await readDiscoveryContext(workspaceId);
    if (context === null) throw new Error("seed failed");
    const run = vi.fn(async (_model: string, request: { questions: Record<string, { type: string }> }) => {
      const questions = request.questions;
      const answers: Record<string, { type: string; noul?: number; choice?: string }> = {};
      if (questions["still_competitor"] !== undefined) {
        answers["still_competitor"] = { type: "noul", noul: 0.05 };
      }
      if (questions["still_competitor_reason"] !== undefined) {
        answers["still_competitor_reason"] = { type: "choice", choice: "shut_down" };
      }
      return { answers };
    });
    Reflect.set(env, "AI", { run });

    const results = await judgeStillCompetitors(context, await readRefreshTargets(workspaceId), NOW);

    expect(run).toHaveBeenCalledTimes(4);
    const requests = run.mock.calls.map((call) => call[1] as { state: { history_30d: unknown; subject: { domain: string } } });
    const autoState = requests.map((request) => request.state).find((state) => state.subject.domain === "auto.example");
    expect(autoState).toBeDefined();
    if (autoState === undefined) return;
    expect((autoState.history_30d as { observedAt: string }[]).map((signal) => signal.observedAt)).toEqual([RECENT_SIGNAL]);
    const manualState = requests.map((request) => request.state).find((state) => state.subject.domain === "manual.example");
    expect((manualState?.history_30d as unknown[]).length).toBe(0);

    for (const result of results) {
      expect(result.verdict).toMatchObject({ p: 0.05, cached: false });
      expect(result.reason).toMatchObject({ choice: "shut_down", cached: false });
    }

    const written = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict").first<{ n: number }>();
    expect(written?.n).toBe(0);
  });

  it("stops asking after the first Jev refusal and gives every later target null verdicts", async () => {
    const workspaceId = await seedWorkspace();
    const context = await readDiscoveryContext(workspaceId);
    if (context === null) throw new Error("seed failed");
    const run = vi.fn(() => Promise.reject(new Error("Insufficient balance; add money to your gateway")));
    Reflect.set(env, "AI", { run });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await judgeStillCompetitors(context, await readRefreshTargets(workspaceId), NOW);

    errors.mockRestore();
    expect(run).toHaveBeenCalledTimes(2);
    expect(results.map((result) => [result.verdict, result.reason])).toEqual([
      [null, null],
      [null, null],
    ]);
    const written = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict").first<{ n: number }>();
    expect(written?.n).toBe(0);
  });
});
