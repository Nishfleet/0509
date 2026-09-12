import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";

import { seedUser } from "./fixtures";
import { OWNED_TABLE_PROBES } from "./ownership/boundary-probes";
import { assertCrossWorkspaceBoundary } from "./ownership/harness";
import { OWNED_PROBE_TABLES } from "./ownership/ownership-manifest";

/**
 * Org-scoped ownership boundary (epic #2993, plan slice P1).
 *
 * The epic's property, per probe, against the real migration chain on real
 * D1: a member of workspace A can never read or mutate workspace B's rows —
 * through the same data-seam helpers the routes call. Roles are orthogonal
 * and enforced at the route layer (P5, #3078); no role grants cross-workspace
 * access.
 */

const appEnv: AppEnv = { DB: env.DB };

describe("workspace ownership boundary", () => {
  it("harness probes cover every OWNED_PROBE_TABLES entry", () => {
    expect(OWNED_TABLE_PROBES.map((probe) => probe.table).sort()).toEqual(
      [...OWNED_PROBE_TABLES].sort(),
    );
  });

  it.each(OWNED_TABLE_PROBES.map((probe) => [probe.table, probe] as const))(
    "%s: workspace A can never read or mutate workspace B's rows",
    async (_table, probe) => {
      const workspaceA = await seedUser();
      const workspaceB = await seedUser();

      await assertCrossWorkspaceBoundary(appEnv, probe, {
        workspaceA,
        workspaceB,
      });
    },
    30_000,
  );
});
