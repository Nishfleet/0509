import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { readWorkspaceMentionSources } from "../../../app/lib/data/source.server";
import { sourcePillStatus } from "../../../app/components/source-pill";

const WS = "ws-mention-sources";
const WS_OTHER = "ws-mention-sources-other";
const WS_INACTIVE = "ws-mention-sources-inactive";
const USER = "user-mention-sources";
const COMP = "comp-mention-sources";
const COMP_OTHER = "comp-mention-sources-other";
const COMP_INACTIVE = "comp-mention-sources-inactive";
const NOW = "2026-09-25T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const GDELT_SRC = "src_mentions_gdelt";
const HN_SRC = "src_mentions_hn";

async function seedOwner(id: string, workspaceId: string, entityId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(id, `${id}@example.test`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Owner', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(workspaceId, id, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, 'competitor', ?, 'Brand', 'on', ?)`,
  )
    .bind(entityId, workspaceId, `${entityId}.example`, NOW)
    .run();
}

async function seedWatch(id: string, entityId: string, sourceId: string, active: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
     VALUES (?, ?, ?, ?, ?, '{}')`,
  )
    .bind(id, entityId, sourceId, `mentions:${id}`, active)
    .run();
}

async function seedSnapshot(id: string, watchId: string, itemCount: number, canaryCount: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count, canary_count)
     VALUES (?, ?, NULL, ?, ?, 'hash', ?, ?)`,
  )
    .bind(id, watchId, NOW, `snapshot/${watchId}/${id}.json`, itemCount, canaryCount)
    .run();
}

async function clearOwner(id: string, workspaceId: string, entityId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM snapshot WHERE watch_id LIKE ?").bind(`watch-${entityId}%`).run();
  await env.DB.prepare("DELETE FROM watch WHERE entity_id = ?").bind(entityId).run();
  await env.DB.prepare("DELETE FROM entity WHERE id = ?").bind(entityId).run();
  await env.DB.prepare("DELETE FROM workspace WHERE id = ?").bind(workspaceId).run();
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id).run();
}

describe("alerts mentions source pills (#4003 4/6)", () => {
  it("reads one entry per mentions source the workspace watches, degraded state intact", async () => {
    await seedOwner(USER, WS, COMP);
    await seedOwner(`${USER}-other`, WS_OTHER, COMP_OTHER);
    await seedOwner(`${USER}-inactive`, WS_INACTIVE, COMP_INACTIVE);

    await seedWatch(`watch-${COMP}-gdelt`, COMP, GDELT_SRC, 1);
    await seedWatch(`watch-${COMP}-hn`, COMP, HN_SRC, 1);
    await seedWatch(`watch-${COMP_INACTIVE}-gdelt`, COMP_INACTIVE, GDELT_SRC, 0);

    await seedSnapshot(`snap-${COMP}-gdelt`, `watch-${COMP}-gdelt`, 2, 3);
    await env.DB.prepare("UPDATE source SET degraded_reason = 'not answering', last_good_at = ? WHERE id = ?")
      .bind(NOW, HN_SRC)
      .run();

    try {
      const entries = await readWorkspaceMentionSources(WS);

      expect(entries.map((entry) => entry.source.key)).toEqual(["gdelt.doc", "hn.algolia"]);

      const gdelt = entries[0];
      const hn = entries[1];
      if (!gdelt || !hn) throw new Error("both watched mentions sources must be read");

      expect(gdelt.kind).toBe("mentions");
      expect(gdelt.source.platform).toBe("gdelt");
      expect(gdelt.source.is_enabled).toBe(1);
      expect(gdelt.snapshot).toEqual({ fetched_at: NOW, item_count: 2, canary_count: 3 });
      expect(sourcePillStatus(gdelt.source, gdelt.snapshot, NOW_MS)).toEqual({
        state: "live",
        reason: null,
        lastGoodAt: null,
      });

      expect(hn.source.degraded_reason).toBe("not answering");
      expect(hn.source.last_good_at).toBe(NOW);
      expect(hn.snapshot).toBeNull();
      expect(sourcePillStatus(hn.source, hn.snapshot, NOW_MS)).toEqual({
        state: "degraded",
        reason: "not answering",
        lastGoodAt: NOW,
      });

      // Scoping: another workspace watches nothing, and an inactive watch is
      // not a source the page shows. Both must read as no entries.
      expect(await readWorkspaceMentionSources(WS_OTHER)).toEqual([]);
      expect(await readWorkspaceMentionSources(WS_INACTIVE)).toEqual([]);
    } finally {
      await env.DB.prepare("UPDATE source SET degraded_reason = NULL, last_good_at = NULL WHERE id = ?")
        .bind(HN_SRC)
        .run();
      await clearOwner(USER, WS, COMP);
      await clearOwner(`${USER}-other`, WS_OTHER, COMP_OTHER);
      await clearOwner(`${USER}-inactive`, WS_INACTIVE, COMP_INACTIVE);
    }
  });

  it("keeps a canary-zero snapshot readable so the pill can say why", async () => {
    await seedOwner(USER, WS, COMP);
    await seedWatch(`watch-${COMP}-hn`, COMP, HN_SRC, 1);
    // No degraded_reason column: canary_count 0 is the only signal, and it must
    // survive the read so the pill degrades with "not answering" instead of
    // rendering "0 mentions".
    await seedSnapshot(`snap-${COMP}-hn`, `watch-${COMP}-hn`, 0, 0);

    try {
      const entries = await readWorkspaceMentionSources(WS);
      expect(entries).toHaveLength(1);
      const hn = entries[0];
      if (!hn) throw new Error("the watched mentions source must be read");
      expect(hn.snapshot).toEqual({ fetched_at: NOW, item_count: 0, canary_count: 0 });
      expect(sourcePillStatus(hn.source, hn.snapshot, NOW_MS)).toEqual({
        state: "degraded",
        reason: "not answering",
        lastGoodAt: null,
      });
    } finally {
      await clearOwner(USER, WS, COMP);
    }
  });
});
