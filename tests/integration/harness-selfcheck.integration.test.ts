import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import type { AppEnv } from "~/lib/env.server";
import { seedUser } from "./fixtures";
import { assertCrossWorkspaceBoundary, type OwnedTableProbe } from "./ownership/harness";

const brokenProbe: OwnedTableProbe = {
  table: "watchlist",
  async seed(e, ws) {
    const id = `wl_selfcheck_${crypto.randomUUID().slice(0, 8)}`;
    await e.DB?.prepare(
      `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
       VALUES (?, ?, 'x', 'advertiser', ?, ?, 'L', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).bind(id, ws, `t_${id}`, `f_${id}`).run();
    return id;
  },
  async listIds(e, ws) {
    return ((await e.DB?.prepare(`SELECT id FROM watchlist WHERE user_id = ?`).bind(ws).all<{ id: string }>())?.results ?? []).map(
      (row) => row.id,
    );
  },
  async getGuarded(e, _ws, rowId) {
    // Deliberately unguarded: a raw by-id SELECT ignores the workspace, so the
    // guarded-get assertion fires on the cross attempt while the own-row
    // positive control still passes.
    const row = await e.DB?.prepare(`SELECT id FROM watchlist WHERE id = ?`)
      .bind(rowId)
      .first<{ id: string }>();
    return row ?? null;
  },
  snapshot: () => Promise.resolve(null),
};

describe("harness self-check", () => {
  it("detects a missing owner guard via a failed assertion", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const appEnv: AppEnv = { DB: env.DB };
    // The harness MUST throw here: getGuarded has no workspace guard, so the
    // cross attempt resolves workspace B's row. If this expect() does not
    // fire, the harness is blind and the whole boundary suite is worthless.
    await expect(
      assertCrossWorkspaceBoundary(appEnv, brokenProbe, { workspaceA: a, workspaceB: b }),
    ).rejects.toThrow(/must not resolve workspace B's row/);
  });
});
