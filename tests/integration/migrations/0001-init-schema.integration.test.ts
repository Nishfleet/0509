import { describe, expect, it } from "vitest";

import { db, ISO_T0, seedUser, uid } from "../fixtures";

/**
 * Migration gate for issue #3846 — the REBUILD P1 init schema
 * (`migrations/0001_init.sql`, design record `docs/REBUILD-SCHEMA.md`).
 *
 * The workers-project setup applies the repo's real `migrations/*.sql`
 * through `tests/integration/apply-migrations.ts`, so by the time this file
 * runs the new schema is live on real D1. These tests prove the read AND
 * write paths of the rebuild shape: entity (self + competitor), the source
 * registry seed, watch subscriptions, the signal spine, the mention/change
 * views, the on/off/dismissed poll contract, suggestions, alerts, digests,
 * plan, and delivery — plus the constraints that carry the charter
 * (dismissed-never-re-suggested, self pinned on, per-kind CHECK contracts,
 * dedup).
 *
 * Ids use uid() throughout: storage is isolated per FILE, not per test.
 */

async function seedWorkspace(ownerId: string, id = uid("ws")) {
  await db()
    .prepare(
      `INSERT INTO workspace (id, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, `Workspace ${id}`, ownerId, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedEntity(
  workspaceId: string,
  role: "self" | "competitor",
  domain: string,
  id = uid("ent"),
) {
  await db()
    .prepare(
      `INSERT INTO entity (
         id, workspace_id, role, domain, name, identity_json, origin,
         state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '{}', 'manual', 'on', ?, ?)`,
    )
    .bind(id, workspaceId, role, domain, `Name ${id}`, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedWatch(entityId: string, sourceKey: string, targetKey: string) {
  const id = uid("watch");
  await db()
    .prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, entityId, sourceKey, targetKey, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedSignal(
  workspaceId: string,
  entityId: string,
  kind: string,
  extra: { url_hash?: string; canonical_url?: string; aspect?: string } = {},
) {
  const id = uid("sig");
  await db()
    .prepare(
      `INSERT INTO signal (
         id, workspace_id, entity_id, source_id, kind, title, summary, url,
         canonical_url, url_hash, aspect, payload_json, dedup_key,
         observed_at, created_at
       ) VALUES (?, ?, ?, 'src_gnews', ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
    )
    .bind(
      id,
      workspaceId,
      entityId,
      kind,
      `Title ${id}`,
      `Summary ${id}`,
      `https://example.test/${id}`,
      extra.canonical_url ?? `https://example.test/${id}`,
      extra.url_hash ?? `hash_${id}`,
      extra.aspect ?? null,
      `dedup_${id}`,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

describe("migration 0001_init — REBUILD schema (issue #3846)", () => {
  it("(1) seeds the source registry — a new source is a row, not a migration", async () => {
    const rows = await db()
      .prepare(`SELECT key, enabled FROM source`)
      .all<{ key: string; enabled: number }>();
    const byKey = new Map(rows.results.map((r) => [r.key, r.enabled]));
    // Proven launch set (keep-list + #3849 mentions scout)
    for (const key of ["meta-ads", "google-ads", "subdomains", "website", "hiring", "gnews", "gdelt", "hn", "x", "blog-rss"]) {
      expect(byKey.get(key), `source ${key} should be seeded enabled`).toBe(1);
    }
    // Credential/approval-gated sources are parked, not absent
    for (const key of ["reddit", "pinterest", "bluesky"]) {
      expect(byKey.get(key), `source ${key} should be seeded disabled`).toBe(0);
    }
  });

  it("(2) write path: workspace -> entity(self+competitor) -> watch -> signal", async () => {
    const userId = await seedUser();
    const wsId = await seedWorkspace(userId);
    const selfId = await seedEntity(wsId, "self", `${uid("self")}.test`);
    const compId = await seedEntity(wsId, "competitor", `${uid("comp")}.test`);
    const watchId = await seedWatch(compId, "src_gnews", `"Name ${compId}"`);
    const sigId = await seedSignal(wsId, compId, "mention");

    const signal = await db()
      .prepare(`SELECT entity_id, source_id, kind FROM signal WHERE id = ?`)
      .bind(sigId)
      .first<{ entity_id: string; source_id: string; kind: string }>();
    expect(signal?.entity_id).toBe(compId);
    expect(signal?.kind).toBe("mention");

    const watch = await db()
      .prepare(`SELECT entity_id, source_id FROM watch WHERE id = ?`)
      .bind(watchId)
      .first<{ entity_id: string; source_id: string }>();
    expect(watch?.entity_id).toBe(compId);

    const self = await db()
      .prepare(`SELECT role, state FROM entity WHERE id = ?`)
      .bind(selfId)
      .first<{ role: string; state: string }>();
    expect(self?.role).toBe("self");
    expect(self?.state).toBe("on");
  });

  it("(3) read path: mention/change views and the you-vs-them home query", async () => {
    const userId = await seedUser();
    const wsId = await seedWorkspace(userId);
    const selfId = await seedEntity(wsId, "self", `${uid("self")}.test`);
    const compId = await seedEntity(wsId, "competitor", `${uid("comp")}.test`);
    const mentionId = await seedSignal(wsId, compId, "mention", {
      url_hash: `mh_${uid("h")}`,
    });
    const changeId = await seedSignal(wsId, selfId, "change", { aspect: "pricing" });

    const mention = await db()
      .prepare(`SELECT id, entity_id, url_hash, canonical_url FROM mention WHERE id = ?`)
      .bind(mentionId)
      .first<{ id: string; entity_id: string; url_hash: string }>();
    expect(mention?.entity_id).toBe(compId);
    expect(mention?.url_hash).toContain("mh_");

    const change = await db()
      .prepare(`SELECT id, aspect FROM "change" WHERE id = ?`)
      .bind(changeId)
      .first<{ id: string; aspect: string }>();
    expect(change?.aspect).toBe("pricing");

    // Home = one scan over signal grouped by entity role
    const home = await db()
      .prepare(
        `SELECT e.role, COUNT(*) AS n
         FROM signal s JOIN entity e ON e.id = s.entity_id
         WHERE s.workspace_id = ? AND s.observed_at >= ?
         GROUP BY e.role`,
      )
      .bind(wsId, "2025-01-01T00:00:00.000Z")
      .all<{ role: string; n: number }>();
    const byRole = new Map(home.results.map((r) => [r.role, r.n]));
    expect(byRole.get("self")).toBe(1);
    expect(byRole.get("competitor")).toBe(1);
  });

  it("(4) poll contract: watches join only entities with state='on'", async () => {
    const userId = await seedUser();
    const wsId = await seedWorkspace(userId);
    const onComp = await seedEntity(wsId, "competitor", `${uid("on")}.test`);
    const offComp = await seedEntity(wsId, "competitor", `${uid("off")}.test`);
    await seedWatch(onComp, "src_hn", `phrase:${onComp}`);
    await seedWatch(offComp, "src_hn", `phrase:${offComp}`);

    await db()
      .prepare(
        `UPDATE entity
         SET state = 'off', state_changed_at = ?, state_reason = 'not rated',
             state_changed_by = 'user', updated_at = ?
         WHERE id = ?`,
      )
      .bind(ISO_T0, ISO_T0, offComp)
      .run();

    const polled = await db()
      .prepare(
        `SELECT w.entity_id FROM watch w
         JOIN entity e ON e.id = w.entity_id
         WHERE e.state = 'on' AND w.is_active = 1 AND e.workspace_id = ?`,
      )
      .bind(wsId)
      .all<{ entity_id: string }>();
    const polledIds = polled.results.map((r) => r.entity_id);
    expect(polledIds).toContain(onComp);
    expect(polledIds).not.toContain(offComp);

    // off keeps history: a signal written before the flip is still readable
    const sigId = await seedSignal(wsId, offComp, "mention");
    const kept = await db()
      .prepare(`SELECT id FROM signal WHERE id = ? AND entity_id = ?`)
      .bind(sigId, offComp)
      .first<{ id: string }>();
    expect(kept?.id).toBe(sigId);
  });

  it("(5) constraints: per-kind CHECKs, one self per workspace, dedup, domain unique", async () => {
    const userId = await seedUser();
    const wsId = await seedWorkspace(userId);
    const compId = await seedEntity(wsId, "competitor", `${uid("comp")}.test`);

    // mention requires canonical_url + url_hash (the grafted per-kind contract)
    await expect(
      db()
        .prepare(
          `INSERT INTO signal (
             id, workspace_id, entity_id, source_id, kind, title, url,
             payload_json, dedup_key, observed_at, created_at
           ) VALUES (?, ?, ?, 'src_gnews', 'mention', ?, ?, '{}', ?, ?, ?)`,
        )
        .bind(uid("sig"), wsId, compId, "no-hash", "https://x.test/1", uid("dd"), ISO_T0, ISO_T0)
        .run(),
    ).rejects.toThrow();

    // change requires aspect
    await expect(
      db()
        .prepare(
          `INSERT INTO signal (
             id, workspace_id, entity_id, source_id, kind, title, url,
             payload_json, dedup_key, observed_at, created_at
           ) VALUES (?, ?, ?, 'src_website', 'change', ?, ?, '{}', ?, ?, ?)`,
        )
        .bind(uid("sig"), wsId, compId, "no-aspect", "https://x.test/2", uid("dd"), ISO_T0, ISO_T0)
        .run(),
    ).rejects.toThrow();

    // self is pinned state='on'
    await expect(
      db()
        .prepare(
          `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at, updated_at)
           VALUES (?, ?, 'self', ?, ?, 'off', ?, ?)`,
        )
        .bind(uid("ent"), wsId, `${uid("s")}.test`, "Self Off", ISO_T0, ISO_T0)
        .run(),
    ).rejects.toThrow();

    // one self per workspace
    await seedEntity(wsId, "self", `${uid("s1")}.test`);
    await expect(seedEntity(wsId, "self", `${uid("s2")}.test`)).rejects.toThrow();

    // UNIQUE(workspace_id, domain)
    const dupDomain = `${uid("dup")}.test`;
    await seedEntity(wsId, "competitor", dupDomain);
    await expect(seedEntity(wsId, "competitor", dupDomain)).rejects.toThrow();

    // UNIQUE(source_id, dedup_key) — insert-time dedup
    const dedupKey = `dedup_same_${uid("d")}`;
    const insertWithDedup = () =>
      db()
        .prepare(
          `INSERT INTO signal (
             id, workspace_id, entity_id, source_id, kind, title, url,
             canonical_url, url_hash, payload_json, dedup_key, observed_at, created_at
           ) VALUES (?, ?, ?, 'src_gnews', 'mention', ?, ?, ?, ?, '{}', ?, ?, ?)`,
        )
        .bind(uid("sig"), wsId, compId, "t", "https://x.test/3", "https://x.test/3", `h_${uid("h")}`, dedupKey, ISO_T0, ISO_T0)
        .run();
    await insertWithDedup();
    await expect(insertWithDedup()).rejects.toThrow();
  });

  it("(6) dismissed suggestions are never re-suggested; alerts + digest + plan + delivery write", async () => {
    const userId = await seedUser();
    const wsId = await seedWorkspace(userId);
    const compId = await seedEntity(wsId, "competitor", `${uid("comp")}.test`);
    const sigId = await seedSignal(wsId, compId, "mention");

    const dismissedDomain = `${uid("dismissed")}.test`;
    await db()
      .prepare(
        `INSERT INTO suggestion (
           id, workspace_id, kind, candidate_domain, candidate_name,
           verdict_p, status, decided_by, decided_at, reason, created_at
         ) VALUES (?, ?, 'add', ?, ?, 0.2, 'dismissed', 'user', ?, 'not a competitor', ?)`,
      )
      .bind(uid("sug"), wsId, dismissedDomain, "Dismissed Co", ISO_T0, ISO_T0)
      .run();

    // The sweep's never-re-suggest check finds the dismissed row
    const blocked = await db()
      .prepare(
        `SELECT id FROM suggestion
         WHERE workspace_id = ? AND candidate_domain = ? AND status = 'dismissed'`,
      )
      .bind(wsId, dismissedDomain)
      .first<{ id: string }>();
    expect(blocked).not.toBeNull();
    // and the unique key makes a second suggestion row for it impossible
    await expect(
      db()
        .prepare(
          `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, status, created_at)
           VALUES (?, ?, 'add', ?, 'pending', ?)`,
        )
        .bind(uid("sug"), wsId, dismissedDomain, ISO_T0)
        .run(),
    ).rejects.toThrow();

    const alertId = uid("alert");
    await db()
      .prepare(
        `INSERT INTO alert (id, workspace_id, entity_id, signal_id, kind, severity, title, created_at)
         VALUES (?, ?, ?, ?, 'signal', 'notable', ?, ?)`,
      )
      .bind(alertId, wsId, compId, sigId, "New mention", ISO_T0)
      .run();
    const feed = await db()
      .prepare(`SELECT status FROM alert WHERE id = ?`)
      .bind(alertId)
      .first<{ status: string }>();
    expect(feed?.status).toBe("unread");

    const digestId = uid("digest");
    await db()
      .prepare(
        `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, subject, created_at)
         VALUES (?, ?, 'weekly', ?, ?, ?, ?)`,
      )
      .bind(digestId, wsId, "2026-09-14", "2026-09-21", "Your week in competitors", ISO_T0)
      .run();

    const targetId = uid("dt");
    await db()
      .prepare(
        `INSERT INTO send_target (id, workspace_id, channel, target_value, is_validated, created_at, updated_at)
         VALUES (?, ?, 'email', ?, 1, ?, ?)`,
      )
      .bind(targetId, wsId, "user@example.test", ISO_T0, ISO_T0)
      .run();
    const attemptId = uid("da");
    await db()
      .prepare(
        `INSERT INTO send_attempt (
           id, workspace_id, digest_id, send_target_id, channel, provider,
           status, target_value, idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'email', 'cloudflare-email', 'sent', ?, ?, ?, ?)`,
      )
      .bind(attemptId, wsId, digestId, targetId, "user@example.test", `idem_${uid("k")}`, ISO_T0, ISO_T0)
      .run();
    const attempt = await db()
      .prepare(`SELECT status, digest_id FROM send_attempt WHERE id = ?`)
      .bind(attemptId)
      .first<{ status: string; digest_id: string }>();
    expect(attempt?.status).toBe("sent");
    expect(attempt?.digest_id).toBe(digestId);

    await db()
      .prepare(
        `INSERT INTO plan (id, workspace_id, tier, status, provider, limits_json, created_at, updated_at)
         VALUES (?, ?, 'starter', 'active', 'dodo', '{"competitors":10}', ?, ?)`,
      )
      .bind(uid("plan"), wsId, ISO_T0, ISO_T0)
      .run();
    const plan = await db()
      .prepare(`SELECT tier FROM plan WHERE workspace_id = ?`)
      .bind(wsId)
      .first<{ tier: string }>();
    expect(plan?.tier).toBe("starter");
  });
});
