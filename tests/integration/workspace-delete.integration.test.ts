import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { cancelPendingDigests } from "../../app/lib/data/digest.server";
import { suppressWorkspaceTargets } from "../../app/lib/data/email_suppression.server";
import {
  deleteWorkspace,
  readWorkspaceR2Prefixes,
} from "../../app/lib/data/workspace.server";

const NOW = "2026-09-24T00:00:00Z";

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(id, email, NOW, NOW)
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Owner', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, ownerUserId, NOW)
    .run();
}

async function seedChannel(id: string, key: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, ?, 1, '{}')`,
  )
    .bind(id, key)
    .run();
}

async function seedSource(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
     VALUES (?, 'site.test', 'site', 'test', 'site.test', 'best_effort', 1, '{}')`,
  )
    .bind(id)
    .run();
}

beforeEach(async () => {
  for (const table of [
    "signal_delivery",
    "send_attempt",
    "send_target",
    "channel",
    "digest",
    "alert",
    "standing",
    "signal",
    "snapshot",
    "page",
    "watch",
    "source",
    "suggestion",
    "entity",
    "plan",
    "workspace",
    '"user"',
    "email_suppression",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe("workspace deletion", () => {
  it("has foreign keys on", async () => {
    const row = await env.DB.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>();
    expect(row).toEqual({ foreign_keys: 1 });
  });

  it("stops email and cascades every owned row", async () => {
    await seedUser("user-del", "del@0509.io");
    await seedUser("user-keep", "keep@0509.io");
    await seedWorkspace("ws-del", "user-del");
    await seedWorkspace("ws-keep", "user-keep");
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES ('ent-del', 'ws-del', 'competitor', 'rival.example', 'Rival', 'on', ?)`,
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES ('ent-keep', 'ws-keep', 'competitor', 'kept.example', 'Kept', 'on', ?)`,
    )
      .bind(NOW)
      .run();
    await seedSource("src-del");
    await env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key, cursor, last_polled_at, is_active, config_json)
       VALUES ('watch-del', 'ent-del', 'src-del', 'rival.example', NULL, NULL, 1, '{}')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
       VALUES ('snap-del', 'watch-del', NULL, ?, 'snapshot/site/watch-del/2026-09-24.html', 'h', 1)`,
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary,
                           url, canonical_url, url_hash, author, aspect, evidence_url, engagement_json, payload_json,
                           dedup_key, published_at, observed_at, last_seen_at, is_tombstoned)
       VALUES ('sig-del', 'ws-del', 'ent-del', 'src-del', 'watch-del', 'snap-del', 'change', 'Pricing change', NULL,
               NULL, NULL, NULL, NULL, 'pricing', NULL, '{}', '{}', 'dedup-del', ?, ?, ?, 0)`,
    )
      .bind(NOW, NOW, NOW)
      .run();
    await seedChannel("chan-email", "email");
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('tgt-del', 'ws-del', 'chan-email', 'to@0509.io', 1, ?)`,
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
       VALUES ('dig-del', 'ws-del', 'weekly', '2026-09-15', '2026-09-22', 'pending', 'brief', '{}', NULL)`,
    ).run();

    await suppressWorkspaceTargets("ws-del");
    await cancelPendingDigests(env.DB, "ws-del");

    const digest = await env.DB.prepare("SELECT status FROM digest WHERE id = 'dig-del'").first<{
      status: string;
    }>();
    expect(digest?.status).toBe("cancelled");

    const suppression = await env.DB.prepare(
      "SELECT reason FROM email_suppression WHERE address = 'to@0509.io'",
    ).first<{ reason: string }>();
    expect(suppression).toEqual({ reason: "workspace_deleted" });

    const prefixes = await readWorkspaceR2Prefixes("ws-del");
    expect(prefixes).toEqual(["card/ws-del/", "snapshot/site/watch-del/"]);

    await deleteWorkspace("ws-del");

    for (const [table, where, value] of [
      ["entity", "workspace_id", "ws-del"],
      ["watch", "id", "watch-del"],
      ["snapshot", "id", "snap-del"],
      ["signal", "id", "sig-del"],
      ["send_target", "id", "tgt-del"],
      ["digest", "id", "dig-del"],
    ]) {
      const row = await env.DB.prepare(
        `SELECT count(*) AS n FROM ${table} WHERE ${where} = ?`,
      )
        .bind(value)
        .first<{ n: number }>();
      expect(row, `${table} rows survive the cascade`).toEqual({ n: 0 });
    }

    const kept = await env.DB.prepare(
      "SELECT id FROM entity WHERE workspace_id = 'ws-keep'",
    ).first<{ id: string }>();
    expect(kept).toEqual({ id: "ent-keep" });
  });
});
