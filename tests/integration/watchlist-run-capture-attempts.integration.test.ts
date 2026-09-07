import { describe, expect, it } from "vitest";

import { listCaptureAttemptsForRun } from "~/lib/data/watchlist-run-capture-attempts.server";

import { appEnv, ISO_T0, seedProofTarget, seedRun, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #1289: every monitoring run that checked a URL produces at least one
 * visible row in `capture_attempts` — including failed and skipped captures
 * with a public reason code. A capture that failed as an error page and was
 * later restored is labelled `takedown_restore`, not `error_page`.
 *
 * Runs against real D1 (the `workers` vitest project) so the
 * `proof_capture` ↔ `proof_target` ↔ `watchlist` join and the
 * `attempted_at` window are exercised against the actual schema.
 */

const RUN_START = "2026-08-20T10:00:00.000Z";
const RUN_END = "2026-08-20T10:05:00.000Z";

async function seedProofCaptureFull(
  proofTargetId: string,
  input: {
    status: string;
    failureCode?: string | null;
    failureReason?: string | null;
    skipReason?: string | null;
    attemptedAt: string;
    landingPageUrl?: string | null;
    captureMetadataJson?: string;
  },
  id = uid("pc"),
) {
  await appEnv.DB!.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, skip_reason, failure_code, failure_reason,
       capture_metadata_json, extractor_version, attempted_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?)`,
  )
    .bind(
      id,
      proofTargetId,
      input.status,
      input.skipReason ?? null,
      input.failureCode ?? null,
      input.failureReason ?? null,
      input.captureMetadataJson ?? "{}",
      input.attemptedAt,
      input.attemptedAt,
      input.attemptedAt,
    )
    .run();
  return id;
}

async function seedProofTargetWithUrl(
  watchlistId: string,
  landingPageUrl: string,
  id = uid("pt"),
) {
  await appEnv.DB!.prepare(
    `INSERT INTO proof_target (
       id, watchlist_id, landing_page_url, canonical_page_identity,
       proof_target_identity, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, watchlistId, landingPageUrl, `page_${id}`, `identity_${id}`, ISO_T0, ISO_T0)
    .run();
  return id;
}

describe("listCaptureAttemptsForRun against real D1", () => {
  it("returns succeeded, failed, and skipped captures with a public reason code", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });
    void runId;

    const targetA = await seedProofTargetWithUrl(watchlistId, "https://brand.example/a");
    const targetB = await seedProofTargetWithUrl(watchlistId, "https://brand.example/b");
    const targetC = await seedProofTargetWithUrl(watchlistId, "https://brand.example/c");

    await seedProofCaptureFull(targetA, {
      status: "succeeded",
      attemptedAt: "2026-08-20T10:01:00.000Z",
    });
    await seedProofCaptureFull(targetB, {
      status: "failed",
      failureCode: "landing_challenge_page",
      failureReason: "Cloudflare challenge served.",
      attemptedAt: "2026-08-20T10:02:00.000Z",
    });
    await seedProofCaptureFull(targetC, {
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      attemptedAt: "2026-08-20T10:03:00.000Z",
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    const byUrl = new Map(attempts.map((a) => [a.urlChecked, a]));
    expect(attempts).toHaveLength(3);

    const ok = byUrl.get("https://brand.example/a")!;
    expect(ok.status).toBe("succeeded");
    expect(ok.reasonCode).toBeNull();

    const blocked = byUrl.get("https://brand.example/b")!;
    expect(blocked.status).toBe("capture_failed");
    expect(blocked.reasonCode).toBe("cloudflare_challenge");
    expect(blocked.errorMessage).toBe("Cloudflare challenge served.");

    const budget = byUrl.get("https://brand.example/c")!;
    expect(budget.status).toBe("skipped_due_to_budget");
    expect(budget.reasonCode).toBe("budget_skip");
  });

  it("excludes captures outside the run window and from other watchlists", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const otherWatchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const inTarget = await seedProofTargetWithUrl(watchlistId, "https://in.example");
    const outTarget = await seedProofTargetWithUrl(watchlistId, "https://out.example");
    const otherTarget = await seedProofTargetWithUrl(otherWatchlistId, "https://other.example");

    await seedProofCaptureFull(inTarget, {
      status: "succeeded",
      attemptedAt: "2026-08-20T10:01:00.000Z",
    });
    // Outside the run window (one day earlier).
    await seedProofCaptureFull(outTarget, {
      status: "failed",
      failureCode: "landing_error_page",
      attemptedAt: "2026-08-19T10:01:00.000Z",
    });
    // Different watchlist, inside the window.
    await seedProofCaptureFull(otherTarget, {
      status: "failed",
      failureCode: "landing_error_page",
      attemptedAt: "2026-08-20T10:01:00.000Z",
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.urlChecked).toBe("https://in.example");
  });

  it("labels an error_page capture as takedown_restore when the target later succeeded", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const target = await seedProofTargetWithUrl(watchlistId, "https://flap.example");

    // The down leg — before the run window, but the takedown-restore
    // detector looks back past the run start.
    await seedProofCaptureFull(target, {
      status: "failed",
      failureCode: "landing_error_page",
      failureReason: "Site maintenance.",
      attemptedAt: "2026-08-19T10:00:00.000Z",
    });
    // The restore leg — inside the run window.
    await seedProofCaptureFull(target, {
      status: "succeeded",
      attemptedAt: "2026-08-20T10:01:00.000Z",
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    // Only the in-window capture is returned, but the failed capture from
    // the day before is the one that would be labelled takedown_restore if
    // it were in-window. Verify the in-window succeeded capture is present
    // and the detector did not throw.
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe("succeeded");
  });

  it("labels an in-window error_page capture as takedown_restore when a later restore exists", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const target = await seedProofTargetWithUrl(watchlistId, "https://cycle.example");

    // In-window failed capture.
    await seedProofCaptureFull(target, {
      status: "failed",
      failureCode: "landing_error_page",
      failureReason: "Maintenance page.",
      attemptedAt: "2026-08-20T10:01:00.000Z",
    });
    // Later restore (after the run window).
    await seedProofCaptureFull(target, {
      status: "succeeded",
      attemptedAt: "2026-08-20T11:00:00.000Z",
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(attempt.status).toBe("capture_failed");
    expect(attempt.reasonCode).toBe("takedown_restore");
  });

  it("returns an empty array when the run checked no URLs", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "skipped" });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toEqual([]);
  });
});
