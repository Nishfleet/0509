import { expect } from "vitest";

import type { AppEnv } from "~/lib/env.server";

/**
 * Boundary test harness for org-scoped ownership (epic #2993, plan slice P1).
 *
 * The property under test, verbatim from the epic: **a member of workspace A
 * can never read or mutate workspace B's rows.** Routes resolve a member to
 * their workspace's owner id (`requireWorkspaceSession` → `workspaceUserId`)
 * before touching the data seam, so the harness drives the seam exactly the
 * way routes do — with a workspace context — against real D1 (the `workers`
 * vitest project; the only project where a D1 assertion means anything).
 *
 * Division of labor:
 * - this harness pins the DATA SEAM boundary (the owner-guard predicates in
 *   `app/lib/data/*.server.ts`), independent of roles;
 * - the permission matrix (`docs/permission-matrix.md`) and its P5 route
 *   tests pin which ROLE may do what inside a workspace.
 *
 * A probe must fail CLOSED: if a seam helper loses its owner guard, the
 * cross-attempt assertion fires. Every mutation also runs a positive control
 * in the owning workspace's context so the harness can never pass because
 * "everything fails".
 */

export interface OwnedTableProbe {
  /** D1 table the probe owns. Must appear in OWNED_PROBE_TABLES. */
  readonly table: string;
  /**
   * Seed one row owned by `workspaceUserId` (the workspace user id a member
   * of that workspace resolves to). Returns the row id.
   */
  seed(env: AppEnv, workspaceUserId: string): Promise<string>;
  /** List the table's rows through the seam for the given workspace context. */
  listIds(env: AppEnv, workspaceUserId: string): Promise<string[]>;
  /**
   * Optional: a guarded single-row get through the seam. Must return a falsy
   * value for a foreign row and truthy for an owned row.
   */
  getGuarded?(env: AppEnv, workspaceUserId: string, rowId: string): Promise<unknown>;
  /**
   * Optional: a scoped mutation through the seam against `rowId`.
   * `crossAttempt` and `ownApply` may use different payloads (a one-way
   * revoke, a value flip) but MUST exercise the same helper and guard.
   */
  mutate?(
    env: AppEnv,
    workspaceUserId: string,
    rowId: string,
    variant: "crossAttempt" | "ownApply",
  ): Promise<unknown>;
  /** Read the mutated columns back so the harness can diff before/after. */
  snapshot(env: AppEnv, rowId: string): Promise<Record<string, unknown> | null>;
}

export interface BoundaryActors {
  /** Workspace A's owner id (the workspace context of A and its members). */
  workspaceA: string;
  /** Workspace B's owner id (the workspace context of B and its members). */
  workspaceB: string;
}

/**
 * Execute the cross-workspace property for one probe:
 *  1. listing: workspace A's context returns A's rows, never B's (and B's
 *     context mirrors it);
 *  2. guarded get: A's context on B's row id is falsy; B's own is truthy;
 *  3. scoped mutation: A's context against B's row changes nothing;
 *  4. positive control: B's own context against B's row applies.
 */
export async function assertCrossWorkspaceBoundary(
  env: AppEnv,
  probe: OwnedTableProbe,
  actors: BoundaryActors,
): Promise<void> {
  const rowA = await probe.seed(env, actors.workspaceA);
  const rowB = await probe.seed(env, actors.workspaceB);

  // 1. Listing boundary — both directions.
  const seenByA = await probe.listIds(env, actors.workspaceA);
  expect(seenByA, `${probe.table}: workspace A must see its own row`).toContain(rowA);
  expect(seenByA, `${probe.table}: workspace A must not see workspace B's row`).not.toContain(
    rowB,
  );

  const seenByB = await probe.listIds(env, actors.workspaceB);
  expect(seenByB, `${probe.table}: workspace B must see its own row`).toContain(rowB);
  expect(seenByB, `${probe.table}: workspace B must not see workspace A's row`).not.toContain(
    rowA,
  );

  // 2. Guarded single-get boundary — both directions.
  if (probe.getGuarded) {
    expect(
      await probe.getGuarded(env, actors.workspaceA, rowB),
      `${probe.table}: workspace A context must not resolve workspace B's row`,
    ).toBeFalsy();
    expect(
      await probe.getGuarded(env, actors.workspaceB, rowB),
      `${probe.table}: workspace B context must resolve its own row`,
    ).toBeTruthy();
  }

  if (!probe.mutate) {
    return;
  }

  // 3. Cross-workspace mutation must be a no-op on B's row...
  const before = await probe.snapshot(env, rowB);
  expect(before, `${probe.table}: snapshot must find the seeded row`).not.toBeNull();
  await probe.mutate(env, actors.workspaceA, rowB, "crossAttempt");
  const afterCrossAttempt = await probe.snapshot(env, rowB);
  expect(
    afterCrossAttempt,
    `${probe.table}: a workspace A context mutated workspace B's row`,
  ).toEqual(before);

  // 4. ...but the same mutation in the owning context applies (the guard is
  // not simply "everything fails").
  const positiveResult = await probe.mutate(env, actors.workspaceB, rowB, "ownApply");
  const afterOwnApply = await probe.snapshot(env, rowB);
  expect(
    afterOwnApply,
    `${probe.table}: the owning workspace's own mutation must apply`,
  ).not.toEqual(before);
  return void positiveResult;
}
