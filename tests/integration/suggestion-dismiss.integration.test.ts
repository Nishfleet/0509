import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readCompetitors, readDiscoveryContext } from "../../app/lib/data/entity.server";
import { dismissSuggestion, readUserDismissed, restoreSuggestion, writeDiscoveryResults } from "../../app/lib/data/suggestion.server";
import type { NoulVerdict } from "../../app/lib/jev/client.server";

/**
 * The suggestion writer's read/restore for user dismissals (0509#4859): a
 * dismissal made through `dismissSuggestion` survives a later confident
 * discovery run, `readUserDismissed` lists only `decided_by='user'` rows in
 * the same workspace, and `restoreSuggestion` flips one back to `pending`
 * without touching Jev rejections or takedowns.
 */

const NOW = "2026-09-24T18:00:00.000Z";

let seededRuns = 0;

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, NOW, NOW)
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, name, ownerUserId, NOW)
    .run();
}

async function seedSelf(workspaceId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at)
     VALUES (?, ?, 'self', ?, ?, '{}', ?)`,
  )
    .bind(`self-${workspaceId}`, workspaceId, domain, domain, NOW)
    .run();
}

async function seedSuggestion(input: {
  id: string;
  workspaceId: string;
  domain: string;
  name: string;
  reason: string;
  p: number;
  status: "pending" | "accepted" | "dismissed" | "auto_on";
  decidedBy: "user" | "jev" | "takedown" | null;
  decidedAt: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO suggestion (
       id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
       verdict_reason, verdict_p, status, decided_by, decided_at, created_at
     ) VALUES (?, ?, NULL, 'add', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.workspaceId,
      input.domain,
      input.name,
      input.reason,
      input.p,
      input.status,
      input.decidedBy,
      input.decidedAt,
      NOW,
    )
    .run();
}

function confidentVerdict(): NoulVerdict {
  return { questionId: "is_competitor", inputHash: `hash-confident-${seededRuns}`, p: 0.97, cached: false };
}

interface SuggestionRow {
  status: string;
  decided_by: string | null;
  decided_at: string | null;
}

async function suggestionRow(id: string): Promise<SuggestionRow | null> {
  return env.DB
    .prepare("SELECT status, decided_by, decided_at FROM suggestion WHERE id = ?")
    .bind(id)
    .first<SuggestionRow>();
}

async function suggestionCountForDomain(workspaceId: string, domain: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM suggestion WHERE workspace_id = ? AND candidate_domain = ?",
  )
    .bind(workspaceId, domain)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function entityCountForDomain(workspaceId: string, domain: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, domain)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("user dismissals survive a later confident run (0509#4859 a)", () => {
  it("a dismissed-by-user row stays dismissed after writeDiscoveryResults tries to auto-on it", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-dismiss-a-${n}`;
    const workspaceId = `ws-dismiss-a-${n}`;
    const domain = `rival-a-${n}.example`;
    const suggestionId = `sug-dismiss-a-${n}`;

    await seedUser(userId, `${userId}@example.com`);
    await seedWorkspace(workspaceId, userId, "Dismiss A");
    await seedSelf(workspaceId, `self-a-${n}.example`);
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      domain,
      name: "Rival A",
      reason: "Same buyers",
      p: 0.5,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
    });

    await dismissSuggestion({ workspaceId, suggestionId, now: NOW });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "dismissed", decided_by: "user" });

    await writeDiscoveryResults(
      workspaceId,
      [{ name: "Rival A", domain, evidence: [], line: "x", verdict: confidentVerdict() }],
      NOW,
    );

    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "dismissed", decided_by: "user" });
    expect(await suggestionCountForDomain(workspaceId, domain)).toBe(1);
    expect(await entityCountForDomain(workspaceId, domain)).toBe(0);

    const context = await readDiscoveryContext(workspaceId);
    expect(context?.dismissedDomains).toContain(domain);
  });
});

describe("readUserDismissed scopes (0509#4859 b)", () => {
  it("returns only the workspace's user-dismissed rows, newest first", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-dismiss-b-${n}`;
    const workspaceId = `ws-dismiss-b-${n}`;
    const otherUserId = `user-dismiss-b-other-${n}`;
    const otherWorkspaceId = `ws-dismiss-b-other-${n}`;
    const domain = `rival-b-${n}.example`;

    await seedUser(userId, `${userId}@example.com`);
    await seedUser(otherUserId, `${otherUserId}@example.com`);
    await seedWorkspace(workspaceId, userId, "Dismiss B");
    await seedWorkspace(otherWorkspaceId, otherUserId, "Dismiss B Other");

    const userDismissedId = `sug-dismiss-b-user-${n}`;
    const jevDismissedId = `sug-dismiss-b-jev-${n}`;
    const takedownDismissedId = `sug-dismiss-b-takedown-${n}`;
    const pendingId = `sug-dismiss-b-pending-${n}`;
    const otherDismissedId = `sug-dismiss-b-other-${n}`;
    const earlierDismissedId = `sug-dismiss-b-earlier-${n}`;

    await seedSuggestion({
      id: userDismissedId,
      workspaceId,
      domain,
      name: "Rival B",
      reason: "Same buyers",
      p: 0.5,
      status: "dismissed",
      decidedBy: "user",
      decidedAt: "2026-09-24T17:30:00.000Z",
    });
    await seedSuggestion({
      id: jevDismissedId,
      workspaceId,
      domain: `rival-b-jev-${n}.example`,
      name: "Rival B Jev",
      reason: "Same buyers",
      p: 0.05,
      status: "dismissed",
      decidedBy: "jev",
      decidedAt: "2026-09-24T16:30:00.000Z",
    });
    await seedSuggestion({
      id: takedownDismissedId,
      workspaceId,
      domain: `rival-b-takedown-${n}.example`,
      name: "Rival B Takedown",
      reason: "Same buyers",
      p: 0.05,
      status: "dismissed",
      decidedBy: "takedown",
      decidedAt: "2026-09-24T15:30:00.000Z",
    });
    await seedSuggestion({
      id: pendingId,
      workspaceId,
      domain: `rival-b-pending-${n}.example`,
      name: "Rival B Pending",
      reason: "Same buyers",
      p: 0.5,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
    });
    await seedSuggestion({
      id: otherDismissedId,
      workspaceId: otherWorkspaceId,
      domain: `rival-b-other-${n}.example`,
      name: "Rival B Other",
      reason: "Same buyers",
      p: 0.5,
      status: "dismissed",
      decidedBy: "user",
      decidedAt: "2026-09-24T18:00:00.000Z",
    });
    await seedSuggestion({
      id: earlierDismissedId,
      workspaceId,
      domain: `rival-b-earlier-${n}.example`,
      name: "Rival B Earlier",
      reason: "Same buyers",
      p: 0.5,
      status: "dismissed",
      decidedBy: "user",
      decidedAt: "2026-09-24T10:00:00.000Z",
    });

    const dismissed = await readUserDismissed(workspaceId);
    expect(dismissed).toEqual([
      {
        suggestionId: userDismissedId,
        name: "Rival B",
        domain,
        dismissedAt: "2026-09-24T17:30:00.000Z",
      },
      {
        suggestionId: earlierDismissedId,
        name: "Rival B Earlier",
        domain: `rival-b-earlier-${n}.example`,
        dismissedAt: "2026-09-24T10:00:00.000Z",
      },
    ]);
  });

  it("falls back to the domain when candidate_name is null", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-dismiss-noname-${n}`;
    const workspaceId = `ws-dismiss-noname-${n}`;
    const domain = `rival-noname-${n}.example`;
    const suggestionId = `sug-dismiss-noname-${n}`;

    await seedUser(userId, `${userId}@example.com`);
    await seedWorkspace(workspaceId, userId, "Dismiss Noname");
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      domain,
      name: "Null name",
      reason: "Same buyers",
      p: 0.5,
      status: "dismissed",
      decidedBy: "user",
      decidedAt: NOW,
    });
    await env.DB.prepare("UPDATE suggestion SET candidate_name = NULL WHERE id = ?").bind(suggestionId).run();

    const dismissed = await readUserDismissed(workspaceId);
    expect(dismissed).toEqual([
      {
        suggestionId,
        name: domain,
        domain,
        dismissedAt: NOW,
      },
    ]);
  });
});

describe("restoreSuggestion (0509#4859 c)", () => {
  it("flips a user-dismissed row back to pending and readCompetitors lists it under maybes", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-restore-${n}`;
    const workspaceId = `ws-restore-${n}`;
    const domain = `rival-restore-${n}.example`;
    const suggestionId = `sug-restore-${n}`;

    await seedUser(userId, `${userId}@example.com`);
    await seedWorkspace(workspaceId, userId, "Restore");
    await seedSelf(workspaceId, `self-restore-${n}.example`);
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      domain,
      name: "Rival Restore",
      reason: "Same buyers",
      p: 0.5,
      status: "dismissed",
      decidedBy: "user",
      decidedAt: NOW,
    });

    await restoreSuggestion({ workspaceId, suggestionId });

    expect(await suggestionRow(suggestionId)).toMatchObject({
      status: "pending",
      decided_by: null,
      decided_at: null,
    });

    const { maybes } = await readCompetitors(workspaceId);
    expect(maybes.map((row) => row.domain)).toEqual([domain]);
  });
});

describe("restoreSuggestion is a no-op outside its scope (0509#4859 d)", () => {
  it("does nothing on a jev-dismissed row", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-restore-jev-${n}`;
    const workspaceId = `ws-restore-jev-${n}`;
    const domain = `rival-restore-jev-${n}.example`;
    const suggestionId = `sug-restore-jev-${n}`;

    await seedUser(userId, `${userId}@example.com`);
    await seedWorkspace(workspaceId, userId, "Restore Jev");
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      domain,
      name: "Rival Jev",
      reason: "Same buyers",
      p: 0.05,
      status: "dismissed",
      decidedBy: "jev",
      decidedAt: NOW,
    });

    await restoreSuggestion({ workspaceId, suggestionId });

    expect(await suggestionRow(suggestionId)).toMatchObject({
      status: "dismissed",
      decided_by: "jev",
      decided_at: NOW,
    });
  });

  it("does nothing on a takedown-dismissed row", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-restore-takedown-${n}`;
    const workspaceId = `ws-restore-takedown-${n}`;
    const domain = `rival-restore-takedown-${n}.example`;
    const suggestionId = `sug-restore-takedown-${n}`;

    await seedUser(userId, `${userId}@example.com`);
    await seedWorkspace(workspaceId, userId, "Restore Takedown");
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      domain,
      name: "Rival Takedown",
      reason: "Same buyers",
      p: 0.05,
      status: "dismissed",
      decidedBy: "takedown",
      decidedAt: NOW,
    });

    await restoreSuggestion({ workspaceId, suggestionId });

    expect(await suggestionRow(suggestionId)).toMatchObject({
      status: "dismissed",
      decided_by: "takedown",
      decided_at: NOW,
    });
  });

  it("does nothing on a row from another workspace", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const ownerUserId = `user-restore-cross-a-${n}`;
    const otherUserId = `user-restore-cross-b-${n}`;
    const workspaceId = `ws-restore-cross-a-${n}`;
    const otherWorkspaceId = `ws-restore-cross-b-${n}`;
    const domain = `rival-restore-cross-${n}.example`;
    const suggestionId = `sug-restore-cross-${n}`;

    await seedUser(ownerUserId, `${ownerUserId}@example.com`);
    await seedUser(otherUserId, `${otherUserId}@example.com`);
    await seedWorkspace(workspaceId, ownerUserId, "Restore Cross A");
    await seedWorkspace(otherWorkspaceId, otherUserId, "Restore Cross B");
    await seedSuggestion({
      id: suggestionId,
      workspaceId: otherWorkspaceId,
      domain,
      name: "Rival Cross",
      reason: "Same buyers",
      p: 0.5,
      status: "dismissed",
      decidedBy: "user",
      decidedAt: NOW,
    });

    await restoreSuggestion({ workspaceId, suggestionId });

    expect(await suggestionRow(suggestionId)).toMatchObject({
      status: "dismissed",
      decided_by: "user",
      decided_at: NOW,
    });
  });
});
