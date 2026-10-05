import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readWorkspaceExport } from "../../app/lib/data-export.server";

const NOW = "2026-09-25T00:00:00.000Z";

async function seed(tag: string): Promise<{ workspaceId: string; userId: string }> {
  const userId = `user-${tag}`;
  const workspaceId = `ws-${tag}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, tag, `${tag}@test.dev`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, 'UTC', ?4)",
    ).bind(workspaceId, tag, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(`ent-${tag}`, workspaceId, `${tag}.example`, `Brand ${tag}`, NOW),
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, observed_at)
       VALUES (?1, ?2, ?3, 'src_mentions_gdelt', 'mention', ?4, ?5, ?5, ?6, '{"internal":"secret"}', ?6, ?7)`,
    ).bind(
      `sig-${tag}`,
      workspaceId,
      `ent-${tag}`,
      `Mention of ${tag}`,
      `https://news.example/${tag}`,
      `hash-${tag}`,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, ?5, 0.9, 'internal reason', ?6)",
    ).bind(`jev-${tag}`, workspaceId, `hash-${tag}`, `sig-${tag}`, `ent-${tag}`, NOW),
    env.DB.prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?1, ?2, ?1, ?2, ?2, '203.0.113.8', 'TestBrowser/1', ?3)`,
    ).bind(`sess-${tag}`, NOW, userId),
    env.DB.prepare(
      `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
       VALUES (?1, 'Laptop', 'pubkey', ?2, ?1, 0, 'platform', 1, ?3)`,
    ).bind(`pk-${tag}`, userId, NOW),
    env.DB.prepare(
      `INSERT INTO apikey (id, configId, referenceId, "key", name, start, lastRequest, enabled, createdAt, updatedAt)
       VALUES (?1, 'default', ?2, ?1, 'CLI', '0509', ?3, 1, ?3, ?3)`,
    ).bind(`key-${tag}`, userId, NOW),
    env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, status, decided_by, decided_at, created_at)
       VALUES (?1, ?2, 'add', ?3, 'dismissed', 'user', ?4, ?4)`,
    ).bind(`sug-${tag}`, workspaceId, `${tag}-skip.example`, NOW),
    env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, verdict, note, decided_at)
       VALUES (?1, ?2, ?3, 'public_subject:confirmed', ?4, ?5)`,
    ).bind(`dec-${tag}`, workspaceId, userId, `${tag}.example`, NOW),
  ]);
  return { workspaceId, userId };
}

describe("workspace export", () => {
  it("holds the caller's own brands and signals and nothing of another workspace or the judge", async () => {
    const mine = await seed("mine");
    await seed("theirs");

    const data = await readWorkspaceExport(env.DB, {
      workspaceId: mine.workspaceId,
      userId: mine.userId,
      email: "mine@test.dev",
      now: new Date(NOW),
    });
    const text = JSON.stringify(data);

    expect(data.account.signInEmail).toBe("mine@test.dev");
    expect(data.account.name).toBe("mine");
    expect(data.brands).toHaveLength(1);
    expect(data.signals).toEqual([expect.objectContaining({ brand: "mine.example", title: "Mention of mine" })]);
    expect(data.sessions).toEqual([expect.objectContaining({ ipAddress: "203.0.113.8", userAgent: "TestBrowser/1" })]);
    expect(data.passkeys).toEqual([expect.objectContaining({ name: "Laptop", deviceType: "platform" })]);
    expect(data.agentKeys).toEqual([expect.objectContaining({ name: "CLI", start: "0509" })]);
    expect(data.choices).toEqual([
      expect.objectContaining({ candidate_domain: "mine-skip.example", status: "dismissed" }),
    ]);
    expect(data.decisions).toEqual([expect.objectContaining({ verdict: "public_subject:confirmed" })]);
    expect(data.plan).toEqual(expect.objectContaining({ tier: "scout", billed: false }));
    expect(text).not.toContain("theirs");
    expect(text).not.toContain("internal");
    expect(text).not.toContain("jev");
    expect(text).not.toContain("pubkey");
    expect(text).not.toContain(`key-${"mine"}`);
  });
});
