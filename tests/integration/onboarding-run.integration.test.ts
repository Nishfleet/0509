import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  markCardReady,
  markCompetitorsReady,
  stampFirstSignals,
  startOnboardingRun,
} from "../../app/lib/data/onboarding_run.server";
import { timeCard } from "../../app/lib/onboarding/card-timing.server";
import type { SiteFields } from "../../app/lib/identity/card-fields";

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

describe("markCompetitorsReady", () => {
  it("keeps the first competitors ready time a workspace gets", async () => {
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "first.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });

    await markCompetitorsReady(workspaceId, "2026-09-25T06:00:50.000Z");
    await markCompetitorsReady(workspaceId, "2026-09-25T06:01:30.000Z");

    const row = await env.DB.prepare(
      "SELECT competitors_ready_at FROM onboarding_run WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ competitors_ready_at: string | null }>();

    expect(row?.competitors_ready_at).toBe("2026-09-25T06:00:50.000Z");
  });
});

describe("markCardReady", () => {
  it("keeps the first card ready time a workspace gets", async () => {
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "first.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });

    await markCardReady(workspaceId, "2026-09-25T06:00:20.000Z");
    await markCardReady(workspaceId, "2026-09-25T06:00:40.000Z");

    const row = await env.DB.prepare(
      "SELECT card_ready_at FROM onboarding_run WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ card_ready_at: string | null }>();

    expect(row?.card_ready_at).toBe("2026-09-25T06:00:20.000Z");
  });

  it("marks the run when timeCard's logo resolves", async () => {
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "first.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });
    const fields: SiteFields = {
      name: "Example",
      description: null,
      socials: [],
      review: { name: "fill", description: "empty", socials: "empty" },
      unfound: false,
    };

    const card = timeCard(workspaceId, {
      site: Promise.resolve(fields),
      logo: Promise.resolve("data:x"),
    });

    await expect(card.logo).resolves.toBe("data:x");
    const row = await env.DB.prepare(
      "SELECT card_ready_at FROM onboarding_run WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ card_ready_at: string | null }>();

    expect(row?.card_ready_at).not.toBeNull();
  });
});

describe("stampFirstSignals", () => {
  async function seedSignal(id: string, observedAt: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at)
       VALUES (?1, ?2, ?3, 'src_site_web', 'change', 'home', ?1, ?4)`,
    )
      .bind(id, workspaceId, `entity-${workspaceId}`, observedAt)
      .run();
  }

  it("sets first_signal_at to the earliest signal at or after started_at, once", async () => {
    const entityId = `entity-${workspaceId}`;
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Rival', 'on', '2026-08-01T00:00:00.000Z')`,
    )
      .bind(entityId, workspaceId, `${entityId}.example`)
      .run();
    await seedSignal(`sig-before-${workspaceId}`, "2026-09-25T05:00:00.000Z");
    await seedSignal(`sig-after-${workspaceId}`, "2026-09-25T06:05:00.000Z");
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "first.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });

    await stampFirstSignals();

    const row = await env.DB.prepare("SELECT first_signal_at FROM onboarding_run WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ first_signal_at: string | null }>();
    expect(row?.first_signal_at).toBe("2026-09-25T06:05:00.000Z");

    await seedSignal(`sig-earlier-${workspaceId}`, "2026-09-25T06:02:00.000Z");
    await stampFirstSignals();

    const again = await env.DB.prepare("SELECT first_signal_at FROM onboarding_run WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ first_signal_at: string | null }>();
    expect(again?.first_signal_at).toBe("2026-09-25T06:05:00.000Z");
  });

  it("keeps first_signal_at null when the workspace has no signal", async () => {
    await startOnboardingRun({
      workspaceId,
      userId,
      inputRaw: "quiet.example",
      startedAt: "2026-09-25T06:00:00.000Z",
    });

    await stampFirstSignals();

    const row = await env.DB.prepare("SELECT first_signal_at FROM onboarding_run WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ first_signal_at: string | null }>();
    expect(row?.first_signal_at).toBeNull();
  });
});
