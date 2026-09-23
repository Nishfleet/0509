// Tripwire for the per-channel `signal_delivery` key (parent: 0509#4063).
//
// `signal_delivery` is UNIQUE on `(signal_id, channel_id)`. The contract
// (`docs/REBUILD-DELIVERY.md` rule 3, `docs/engines/delivery.md` §1) wants the
// recipient in the key, and v1 Settings offers one address. Today the pair
// and the triple coincide, so nothing is wrong. The first time a workspace
// holds two `send_target` rows for one channel, the second recipient's send
// is suppressed by a constraint that was meant to prevent a duplicate, not a
// delivery. That is silent under-delivery — worse than a duplicate.
//
// When this test has to change, widen the key first.
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const TRIPWIRE =
  "SELECT workspace_id, channel_id, COUNT(*) AS targets FROM send_target GROUP BY workspace_id, channel_id HAVING COUNT(*) > 1";

const violations = async () =>
  ((await env.DB.prepare(TRIPWIRE).all<{ workspace_id: string; channel_id: string; targets: number }>()).results ?? []);

describe("recipient tripwire (0509#4063)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM digest");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-trip', 'Trip', 'trip@0509.io', 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES ('ws-trip', 'Trip wire', 'user-trip', 'UTC', 1, 8, '2026-09-22T00:00:00Z')`,
    ).run();
    await env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-trip', 'email', 1, '{}')`).run();
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('target-1', 'ws-trip', 'chan-trip', 'one@0509.io', 1, '2026-09-22T00:00:01Z')`,
    ).run();
  });

  it("passes with one send_target per workspace and channel", async () => {
    expect(await violations()).toEqual([]);
  });

  it.fails("fails when a workspace holds two send_target rows for one channel", async () => {
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('target-2', 'ws-trip', 'chan-trip', 'two@0509.io', 1, '2026-09-22T00:00:01Z')`,
    ).run();
    expect(await violations()).toEqual([]);
  });
});
