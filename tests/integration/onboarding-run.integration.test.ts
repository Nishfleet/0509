import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { markCardReady, markCompetitorsReady, startOnboardingRun } from "../../app/lib/data/onboarding_run.server";

let runs = 0;
let userId = "";
let workspaceId = "";

beforeEach(async () => {
  runs += 1;
  userId = `user-onboarding-run-${String(runs)}`;
  workspaceId = `ws-onboarding-run-${String(runs)}`;
  const createdAt = "2026-08-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, "Onboarding Run", `${userId}@example.test`, createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Onboarding Run', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, createdAt),
  ]);
});

describe("stage timings", () => {
  async function readRun(): Promise<{
    card_ready_at: string | null;
    competitors_ready_at: string | null;
  }> {
    const rows = await env.DB.prepare(
      "SELECT card_ready_at, competitors_ready_at FROM onboarding_run WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .all<{ card_ready_at: string | null; competitors_ready_at: string | null }>();
    return rows.results[0];
  }

  async function startRun(): Promise<void> {
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "first.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });
  }

  it("writes card_ready_at once", async () => {
    await startRun();

    await markCardReady(workspaceId, "2026-09-25T06:00:20.000Z");
    await markCardReady(workspaceId, "2026-09-25T06:00:50.000Z");

    await expect(readRun()).resolves.toEqual({
      card_ready_at: "2026-09-25T06:00:20.000Z",
      competitors_ready_at: null,
    });
  });

  it("writes competitors_ready_at once", async () => {
    await startRun();

    await markCompetitorsReady(workspaceId, "2026-09-25T06:00:40.000Z");
    await markCompetitorsReady(workspaceId, "2026-09-25T06:01:30.000Z");

    await expect(readRun()).resolves.toEqual({
      card_ready_at: null,
      competitors_ready_at: "2026-09-25T06:00:40.000Z",
    });
  });
});

describe("startOnboardingRun", () => {
  it("writes the first run only for a workspace", async () => {
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "first.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "second.example",
      startedAt: "2026-09-25T07:00:00.000Z",
    });

    const rows = await env.DB.prepare(
      "SELECT input_raw, started_at, first_signal_at FROM onboarding_run WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .all<{ input_raw: string; started_at: string; first_signal_at: string | null }>();

    expect(rows.results).toEqual([
      {
        input_raw: "first.example",
        started_at: "2026-09-25T06:00:00.000Z",
        first_signal_at: null,
      },
    ]);
  });
});
