import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { stampFirstSignals, startOnboardingRun } from "../../app/lib/data/onboarding_run.server";

/**
 * The nightly cron stamps `onboarding_run.first_signal_at` with the arrival
 * time of the workspace's first signal at or after its onboarding started, so
 * the promise made at sign-up can be audited against the actual one (#5155).
 * Real local D1 with the real migrations applied.
 */

const STARTED_AT = "2026-09-24T10:00:00.000Z";
const SOURCE = "src_site_web";

let runs = 0;
let WS = "";
let USER = "";
let ENTITY = "";
let OTHER_WS = "";
let OTHER_ENTITY = "";

async function seedSignal(id: string, workspaceId: string, entityId: string, observedAt: string) {
  await env.DB.prepare(
    "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, ?4, 'site_change', ?5, ?6, 0)",
  )
    .bind(id, workspaceId, entityId, SOURCE, id, observedAt)
    .run();
}

async function firstSignalAt(workspaceId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT first_signal_at FROM onboarding_run WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<{ first_signal_at: string | null }>();
  return row?.first_signal_at ?? null;
}

beforeEach(async () => {
  runs += 1;
  WS = `ws_first_signal_${String(runs)}`;
  USER = `user_first_signal_${String(runs)}`;
  ENTITY = `${WS}_self`;
  OTHER_WS = `${WS}_other`;
  OTHER_ENTITY = `${OTHER_WS}_self`;
  const createdAt = "2026-08-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'First Signal', ?2, 1, ?3, ?3)",
    ).bind(USER, `${USER}@example.test`, createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'First Signal', ?2, 'UTC', 1, 8, ?3)",
    ).bind(WS, USER, createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Other Signal', ?2, 'UTC', 1, 8, ?3)",
    ).bind(OTHER_WS, USER, createdAt),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', ?3, 'self', 'on', ?4)",
    ).bind(ENTITY, WS, `self-${String(runs)}.example`, createdAt),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', ?3, 'self', 'on', ?4)",
    ).bind(OTHER_ENTITY, OTHER_WS, `other-${String(runs)}.example`, createdAt),
  ]);
  await startOnboardingRun({ workspaceId: WS, userId: USER, inputRaw: "self.example", startedAt: STARTED_AT });
  await startOnboardingRun({ workspaceId: OTHER_WS, userId: USER, inputRaw: "other.example", startedAt: STARTED_AT });
});

describe("stampFirstSignals", () => {
  it("leaves first_signal_at null when the workspace has no signal", async () => {
    await stampFirstSignals(env.DB);

    expect(await firstSignalAt(WS)).toBeNull();
  });

  it("stamps the earliest signal at or after started_at, ignoring earlier ones", async () => {
    await seedSignal(`${WS}_before`, WS, ENTITY, "2026-09-24T09:00:00.000Z");
    await seedSignal(`${WS}_first`, WS, ENTITY, "2026-09-25T02:05:00.000Z");
    await seedSignal(`${WS}_later`, WS, ENTITY, "2026-09-25T02:10:00.000Z");

    await stampFirstSignals(env.DB);

    expect(await firstSignalAt(WS)).toBe("2026-09-25T02:05:00.000Z");
  });

  it("keeps the stamped arrival when a later sweep sees an earlier signal", async () => {
    await seedSignal(`${WS}_first`, WS, ENTITY, "2026-09-25T02:05:00.000Z");
    await stampFirstSignals(env.DB);

    await seedSignal(`${WS}_earlier`, WS, ENTITY, "2026-09-25T01:00:00.000Z");
    await stampFirstSignals(env.DB);

    expect(await firstSignalAt(WS)).toBe("2026-09-25T02:05:00.000Z");
  });

  it("stamps each workspace from its own signals only", async () => {
    await seedSignal(`${OTHER_WS}_signal`, OTHER_WS, OTHER_ENTITY, "2026-09-25T02:05:00.000Z");

    await stampFirstSignals(env.DB);

    expect(await firstSignalAt(WS)).toBeNull();
    expect(await firstSignalAt(OTHER_WS)).toBe("2026-09-25T02:05:00.000Z");
  });
});
