import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readOnboardingCompetitors } from "../../app/lib/data/entity.server";

/**
 * Screen 3's read (0509#4409): ON competitors with their one-line reason, and
 * pending maybes with reason and probability, against the migrated local D1.
 */

let seededRuns = 0;

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, "2026-09-23T12:00:00.000Z", "2026-09-23T12:00:00.000Z")
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, name, ownerUserId, "2026-09-23T12:00:00.000Z")
    .run();
}

async function seedEntity(input: {
  id: string;
  workspaceId: string;
  role: "self" | "competitor";
  domain: string;
  name: string | null;
  state: "on" | "off";
  createdAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.workspaceId,
      input.role,
      input.domain,
      input.name,
      input.state,
      input.createdAt,
    )
    .run();
}

async function seedSuggestion(input: {
  id: string;
  workspaceId: string;
  entityId: string | null;
  kind: "add" | "retire";
  domain: string;
  name: string | null;
  reason: string | null;
  p: number | null;
  status: "auto_on" | "pending" | "accepted" | "dismissed";
  createdAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO suggestion (
       id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
       verdict_reason, verdict_p, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.workspaceId,
      input.entityId,
      input.kind,
      input.domain,
      input.name,
      input.reason,
      input.p,
      input.status,
      input.createdAt,
    )
    .run();
}

describe("readOnboardingCompetitors against migrations/0001_rebuild.sql", () => {
  it("returns the ON competitors and the pending maybes, and nothing else", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-onb-${n}`;
    const workspaceId = `ws-onb-${n}`;
    const otherUserId = `user-onb-other-${n}`;
    const otherWorkspaceId = `ws-onb-other-${n}`;

    await seedUser(userId, `onb-${n}@example.com`);
    await seedUser(otherUserId, `onb-other-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Onboarding");
    await seedWorkspace(otherWorkspaceId, otherUserId, "Other");

    await seedEntity({
      id: `self-${n}`,
      workspaceId,
      role: "self",
      domain: `self-${n}.example`,
      name: "Self",
      state: "on",
      createdAt: "2026-09-23T12:00:00.000Z",
    });
    await seedEntity({
      id: `on-first-${n}`,
      workspaceId,
      role: "competitor",
      domain: `first-${n}.example`,
      name: "First",
      state: "on",
      createdAt: "2026-09-23T12:01:00.000Z",
    });
    await seedEntity({
      id: `on-second-${n}`,
      workspaceId,
      role: "competitor",
      domain: `second-${n}.example`,
      name: "Second",
      state: "on",
      createdAt: "2026-09-23T12:02:00.000Z",
    });
    await seedEntity({
      id: `off-${n}`,
      workspaceId,
      role: "competitor",
      domain: `off-${n}.example`,
      name: "Off",
      state: "off",
      createdAt: "2026-09-23T12:03:00.000Z",
    });
    await seedEntity({
      id: `on-other-${n}`,
      workspaceId: otherWorkspaceId,
      role: "competitor",
      domain: `other-${n}.example`,
      name: "Other On",
      state: "on",
      createdAt: "2026-09-23T12:00:30.000Z",
    });

    await seedSuggestion({
      id: `sug-auto-${n}`,
      workspaceId,
      entityId: `on-first-${n}`,
      kind: "add",
      domain: `first-${n}.example`,
      name: "First",
      reason: "Same buyers, same price band",
      p: 0.95,
      status: "auto_on",
      createdAt: "2026-09-23T12:01:00.000Z",
    });
    await seedSuggestion({
      id: `sug-p06-${n}`,
      workspaceId,
      entityId: null,
      kind: "add",
      domain: `maybe-06-${n}.example`,
      name: "Maybe Six",
      reason: "Overlapping category",
      p: 0.6,
      status: "pending",
      createdAt: "2026-09-23T12:04:00.000Z",
    });
    await seedSuggestion({
      id: `sug-pnull-${n}`,
      workspaceId,
      entityId: null,
      kind: "add",
      domain: `maybe-null-${n}.example`,
      name: null,
      reason: null,
      p: null,
      status: "pending",
      createdAt: "2026-09-23T12:05:00.000Z",
    });
    await seedSuggestion({
      id: `sug-p08-${n}`,
      workspaceId,
      entityId: null,
      kind: "add",
      domain: `maybe-08-${n}.example`,
      name: "Maybe Eight",
      reason: "Same buyers",
      p: 0.8,
      status: "pending",
      createdAt: "2026-09-23T12:06:00.000Z",
    });
    await seedSuggestion({
      id: `sug-dismissed-${n}`,
      workspaceId,
      entityId: null,
      kind: "add",
      domain: `dismissed-${n}.example`,
      name: "Dismissed",
      reason: "Not a peer",
      p: 0.2,
      status: "dismissed",
      createdAt: "2026-09-23T12:07:00.000Z",
    });
    await seedSuggestion({
      id: `sug-other-${n}`,
      workspaceId: otherWorkspaceId,
      entityId: null,
      kind: "add",
      domain: `other-maybe-${n}.example`,
      name: "Other Maybe",
      reason: "Other workspace",
      p: 0.99,
      status: "pending",
      createdAt: "2026-09-23T12:00:00.000Z",
    });

    const result = await readOnboardingCompetitors(workspaceId);

    expect(result.on).toEqual([
      {
        entityId: `on-first-${n}`,
        name: "First",
        domain: `first-${n}.example`,
        reason: "Same buyers, same price band",
      },
      {
        entityId: `on-second-${n}`,
        name: "Second",
        domain: `second-${n}.example`,
        reason: null,
      },
    ]);
    expect(result.maybes).toEqual([
      {
        suggestionId: `sug-p08-${n}`,
        name: "Maybe Eight",
        domain: `maybe-08-${n}.example`,
        reason: "Same buyers",
      },
      {
        suggestionId: `sug-p06-${n}`,
        name: "Maybe Six",
        domain: `maybe-06-${n}.example`,
        reason: "Overlapping category",
      },
      {
        suggestionId: `sug-pnull-${n}`,
        name: `maybe-null-${n}.example`,
        domain: `maybe-null-${n}.example`,
        reason: null,
      },
    ]);
  });

  it("returns empty lists for a workspace with no competitors or maybes", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-empty-${n}`;
    const workspaceId = `ws-empty-${n}`;
    await seedUser(userId, `empty-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Empty");

    expect(await readOnboardingCompetitors(workspaceId)).toEqual({ on: [], maybes: [] });
  });
});
