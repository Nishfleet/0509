import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readBacklog, writeBacklog } from "../../../app/lib/data/discovery_backlog.server";

const FIRST = "2026-09-24T06:00:00.000Z";
const LATER = "2026-09-25T06:00:00.000Z";
const PROMOTED_AT = "2026-09-26T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-backlog-${String(runs)}`;
  const workspaceId = `ws-backlog-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, FIRST),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, FIRST),
  ]);
  return workspaceId;
}

function evidence(sourceUrl: string, excerpt: string) {
  return { sourceUrl, excerpt, generator: "news" as const };
}

async function rowFor(workspaceId: string, nameKey: string) {
  return env.DB.prepare(
    "SELECT evidence_count, first_seen_at, updated_at, promoted_at FROM discovery_backlog WHERE workspace_id = ? AND name_key = ?",
  )
    .bind(workspaceId, nameKey)
    .first<{ evidence_count: number; first_seen_at: string; updated_at: string; promoted_at: string | null }>();
}

describe("discovery_backlog", () => {
  it("keeps a candidate that missed the shortlist with its evidence", async () => {
    const workspaceId = await seedWorkspace();
    await writeBacklog(
      workspaceId,
      [
        {
          nameKey: "nike",
          name: "Nike",
          domain: "nike.com",
          evidence: [evidence("https://www.glamour.co.uk", "Gymshark, Nike and more")],
        },
      ],
      [],
      FIRST,
    );

    expect(await readBacklog(workspaceId)).toEqual([
      {
        name: "Nike",
        domain: "nike.com",
        evidence: [evidence("https://www.glamour.co.uk", "Gymshark, Nike and more")],
      },
    ]);
  });

  it("accumulates evidence on one row and keeps first_seen_at", async () => {
    const workspaceId = await seedWorkspace();
    await writeBacklog(
      workspaceId,
      [{ nameKey: "nike", name: "Nike", domain: "nike.com", evidence: [evidence("https://a.example", "one")] }],
      [],
      FIRST,
    );
    await writeBacklog(
      workspaceId,
      [
        {
          nameKey: "nike",
          name: "Nike",
          domain: "nike.com",
          evidence: [evidence("https://a.example", "one"), evidence("https://b.example", "two")],
        },
      ],
      [],
      LATER,
    );

    const row = await rowFor(workspaceId, "nike");
    expect(row?.evidence_count).toBe(2);
    expect(row?.first_seen_at).toBe(FIRST);
    expect(row?.updated_at).toBe(LATER);

    const [candidate] = await readBacklog(workspaceId);
    expect(candidate?.evidence).toHaveLength(2);
  });

  it("records a promotion with its timestamp and never deletes the row", async () => {
    const workspaceId = await seedWorkspace();
    await writeBacklog(
      workspaceId,
      [{ nameKey: "nike", name: "Nike", domain: "nike.com", evidence: [evidence("https://a.example", "one")] }],
      [],
      FIRST,
    );

    await writeBacklog(workspaceId, [], ["nike"], PROMOTED_AT);

    expect(await readBacklog(workspaceId)).toEqual([]);
    const row = await rowFor(workspaceId, "nike");
    expect(row?.promoted_at).toBe(PROMOTED_AT);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM discovery_backlog WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});
