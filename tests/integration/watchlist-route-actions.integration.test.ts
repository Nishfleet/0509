import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Issue #2467 — the resume-watchlist plan-limit check was check-then-act:
 * `requireWorkspacePlanLimit` read the active count, then `setWatchlistActive`
 * ran a plain UPDATE with no count guard. Two concurrent resumes on a
 * 3-watchlist plan (scout) both passed the check and both writes landed,
 * leaving 4 active watchlists running usage-billed scheduled scans.
 *
 * These tests run on real workerd D1. The concurrency case fires the same
 * gate-then-write pair the `resume-watchlist` action runs —
 * `requireWorkspacePlanLimit` followed by `setWatchlistActive` — through
 * `Promise.all`. The workers pool's module mocking is not race-safe for the
 * lazy imports inside `handleWatchlistsAction`, so the route-level contract
 * (rejected write maps to `plan_limit_exceeded`, not "couldn't find") is
 * covered by its own single-call tests.
 */

const RESUME_LIMIT_MESSAGE =
  "You've reached your competitor tracking limit — pause another watchlist first.";

let seededUserId: string;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/data.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockWorkspaceAuth() {
  vi.doMock("~/lib/auth.server", async () => {
    const actual =
      await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
    return {
      ...actual,
      requireWorkspaceSession: async () => ({
        session: {
          user: {
            id: seededUserId,
            email: `${seededUserId}@example.test`,
            name: "Fixture",
          },
          expires: new Date(Date.now() + 3600_000).toISOString(),
        },
        workspaceUserId: seededUserId,
        isMember: false,
        ownerName: "Fixture",
      }),
    };
  });
}

async function seedScoutPlan(userId: string) {
  await db()
    .prepare(
      `INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, 'scout', ?)`,
    )
    .bind(userId, ISO_T0)
    .run();
}

async function seedWatchlistRow(userId: string, isActive: boolean, id = uid("wl")) {
  await db()
    .prepare(
      `INSERT INTO watchlist (
         id, user_id, name, target_type, target_id, target_fingerprint,
         target_label, is_active, paused_reason, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      `Fixture ${id}`,
      `target_${id}`,
      `fp_${id}`,
      `Label ${id}`,
      isActive ? 1 : 0,
      isActive ? null : "user",
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

async function countActive(userId: string) {
  const row = await db()
    .prepare(
      `SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ? AND is_active = 1`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function resumeRequest(watchlistId: string) {
  const body = new FormData();
  body.set("intent", "resume-watchlist");
  body.set("watchlistId", watchlistId);
  return {
    context: { cloudflare: { env: { ...appEnv } } },
    params: {},
    request: new Request("https://0509.io/app/watchlists", {
      method: "POST",
      body,
    }),
  } as never;
}

type ActionResult = {
  ok: boolean;
  error?: string;
  message: string;
};

describe("resume-watchlist plan-limit race (issue #2467)", () => {
  it("two concurrent resumes never exceed the 3-watchlist scout cap", async () => {
    const userId = await seedUser();
    seededUserId = userId;
    await seedScoutPlan(userId);
    // Scout caps at 3: two active already, two paused waiting to resume.
    await seedWatchlistRow(userId, true);
    await seedWatchlistRow(userId, true);
    const pausedA = await seedWatchlistRow(userId, false);
    const pausedB = await seedWatchlistRow(userId, false);
    expect(await countActive(userId)).toBe(2);

    const { requireWorkspacePlanLimit } = await import(
      "~/lib/with-workspace.server"
    );
    const { setWatchlistActive } = await import("~/lib/data.server");

    // The exact pair the resume-watchlist intent runs. Both gates read
    // count=2 < 3 before either write lands — the check-then-act window.
    const resume = async (watchlistId: string): Promise<ActionResult> => {
      const gate = await requireWorkspacePlanLimit(
        appEnv,
        userId,
        "watchlists",
        { limitMessage: RESUME_LIMIT_MESSAGE },
      );
      if (!gate.ok) {
        return gate.result;
      }
      const resumed = await setWatchlistActive(appEnv, userId, watchlistId, true);
      return resumed
        ? { ok: true, message: "Watchlist resumed." }
        : { ok: false, error: "plan_limit_exceeded", message: RESUME_LIMIT_MESSAGE };
    };

    const [resultA, resultB] = await Promise.all([
      resume(pausedA),
      resume(pausedB),
    ]);

    // The invariant: the active count can never overshoot the plan cap.
    // RED today: both plain UPDATEs land and this reads 4.
    expect(await countActive(userId)).toBe(3);

    // Exactly one resume wins; the loser reports the plan limit.
    const winners = [resultA, resultB].filter((result) => result.ok);
    const losers = [resultA, resultB].filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.error).toBe("plan_limit_exceeded");
  });

  it("a single resume at the cap returns the plan-limit result", async () => {
    mockWorkspaceAuth();
    const userId = await seedUser();
    seededUserId = userId;
    await seedScoutPlan(userId);
    await seedWatchlistRow(userId, true);
    await seedWatchlistRow(userId, true);
    await seedWatchlistRow(userId, true);
    const paused = await seedWatchlistRow(userId, false);
    expect(await countActive(userId)).toBe(3);

    const { handleWatchlistsAction } = await import(
      "~/lib/watchlist-route-actions.server"
    );
    const result = (await handleWatchlistsAction(
      resumeRequest(paused),
    )) as ActionResult;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_limit_exceeded");
    expect(await countActive(userId)).toBe(3);
  });

  it("a rejected resume write returns the limit message, not couldn't-find", async () => {
    mockWorkspaceAuth();
    const userId = await seedUser();
    seededUserId = userId;
    await seedScoutPlan(userId);
    const paused = await seedWatchlistRow(userId, false);

    // The write is refused after the gate passes — the concurrent-loser leg
    // of the race, reproduced deterministically.
    vi.doMock("~/lib/data.server", async () => {
      const actual =
        await vi.importActual<typeof import("~/lib/data.server")>("~/lib/data.server");
      return {
        ...actual,
        setWatchlistActive: async () => false,
      };
    });

    const { handleWatchlistsAction } = await import(
      "~/lib/watchlist-route-actions.server"
    );
    const result = (await handleWatchlistsAction(
      resumeRequest(paused),
    )) as ActionResult;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_limit_exceeded");
    expect(result.message).toContain("competitor tracking limit");
    expect(result.message).not.toContain("couldn't find");
  });

  it("setWatchlistActive resume honours the cap inside the UPDATE itself", async () => {
    const userId = await seedUser();
    seededUserId = userId;
    await seedScoutPlan(userId);
    await seedWatchlistRow(userId, true);
    await seedWatchlistRow(userId, true);
    await seedWatchlistRow(userId, true);
    const paused = await seedWatchlistRow(userId, false);

    const { setWatchlistActive } = await import("~/lib/data.server");

    // At the cap the atomic guard rejects the write outright.
    // RED today: the plain UPDATE has no count predicate and returns true.
    expect(await setWatchlistActive(appEnv, userId, paused, true)).toBe(false);
    expect(await countActive(userId)).toBe(3);

    // Freeing a slot lets the same call resume the same watchlist.
    const activeRow = await db()
      .prepare(
        `SELECT id FROM watchlist WHERE user_id = ? AND is_active = 1 LIMIT 1`,
      )
      .bind(userId)
      .first<{ id: string }>();
    expect(await setWatchlistActive(appEnv, userId, activeRow!.id, false)).toBe(
      true,
    );
    expect(await setWatchlistActive(appEnv, userId, paused, true)).toBe(true);
    expect(await countActive(userId)).toBe(3);
  });
});
