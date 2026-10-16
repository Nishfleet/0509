import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkSilentRivals } from "../../../app/lib/site/silent-rivals.server";

let warn: ReturnType<typeof vi.spyOn>;
const NOW = new Date("2026-10-14T03:00:00Z");
const LONG_AGO = "2026-09-01T00:00:00Z";
const RECENT = "2026-10-13T00:00:00Z";

async function seedRival(input: { id: string; discoveredAt: string; paid: boolean; reason: string | null }) {
  const { id, discoveredAt, paid, reason } = input;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'U', ?1, 1, ?2, ?2)`,
    ).bind(`u-${id}`, LONG_AGO),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?1, 'W', ?2, 'UTC', 1, 8, ?3)`,
    ).bind(`ws-${id}`, `u-${id}`, LONG_AGO),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES (?1, ?2, 'competitor', ?3, '{}', 'manual', 'on', ?4)`,
    ).bind(`e-${id}`, `ws-${id}`, `${id}.example`, LONG_AGO),
    env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at, last_failure_reason)
       VALUES (?1, ?2, ?3, 'home', ?4, ?5)`,
    ).bind(`p-${id}`, `e-${id}`, `https://${id}.example/`, discoveredAt, reason),
    env.DB.prepare(`INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, 'src_site_web', ?3)`).bind(
      `w-${id}`,
      `e-${id}`,
      `https://${id}.example/`,
    ),
    ...(paid
      ? [
          env.DB.prepare(
            `INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?1, ?2, 'starter', 'active', ?3)`,
          ).bind(`pl-${id}`, `ws-${id}`, LONG_AGO),
        ]
      : []),
  ]);
}

beforeEach(async () => {
  for (const table of ["snapshot", "watch", "page", "entity", "plan", "workspace", '"user"']) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("checkSilentRivals", () => {
  it("raises when a paid rival has had no snapshot for a week, naming the stored reason", async () => {
    await seedRival({ id: "blocked", discoveredAt: LONG_AGO, paid: true, reason: "deferred: no browser budget" });

    await expect(checkSilentRivals(NOW)).rejects.toThrow("paid competitors with no snapshot for 7 days");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"deferred: no browser budget":1'));
  });

  it("explains a silent rival with no stored failure from the watch state", async () => {
    await seedRival({ id: "unwatched", discoveredAt: LONG_AGO, paid: true, reason: null });
    await env.DB.prepare("UPDATE watch SET is_active = 0 WHERE id = 'w-unwatched'").run();
    await seedRival({ id: "swept", discoveredAt: LONG_AGO, paid: true, reason: null });

    await expect(checkSilentRivals(NOW)).rejects.toThrow("paid competitors with no snapshot for 7 days");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"no active site watch on the page":1'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"swept without a recorded result":1'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("none recorded"));
  });

  it("ignores free workspaces, brand-new rivals and rivals that have a recent snapshot", async () => {
    await seedRival({ id: "free", discoveredAt: LONG_AGO, paid: false, reason: null });
    await seedRival({ id: "new", discoveredAt: RECENT, paid: true, reason: null });
    await seedRival({ id: "fine", discoveredAt: LONG_AGO, paid: true, reason: null });
    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES ('s-fine', 'w-fine', 'p-fine', ?1, 'h')`,
    )
      .bind("2026-10-13T21:00:00Z")
      .run();

    await expect(checkSilentRivals(NOW)).resolves.toBeUndefined();
  });
  it("still raises when only a feed snapshot is recent, because the site itself is unread", async () => {
    await seedRival({ id: "feedonly", discoveredAt: LONG_AGO, paid: true, reason: "blocked" });
    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES ('s-feed', 'w-feedonly', NULL, ?1, 'h')`,
    )
      .bind("2026-10-13T21:00:00Z")
      .run();

    await expect(checkSilentRivals(NOW)).rejects.toThrow("paid competitors with no snapshot for 7 days");
  });
});
