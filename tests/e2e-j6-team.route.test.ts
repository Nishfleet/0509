import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveJ6TeamReplayAction,
  resolveJ6TeamReplayClaim,
  resolveJ6TeamReplayCompletion,
  resolveJ6TeamReplayMapping,
  resolveJ6TeamReplayStateRequest,
  runJ6TeamReplay,
} from "~/lib/e2e-j6-team-replay.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn(async (_env: unknown, userId: string) => userId === "e2e-agency" ? "agency" : "free"),
}));

const viewports = ["375x812", "768x900", "1440x900"] as const;
const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.close();
});

function stateRequest(
  idempotencyKey: string,
  runId: string,
  options: { url?: string; method?: string; cookie?: string; marker?: string } = {},
) {
  return new Request(
    options.url ?? `http://127.0.0.1:43127/api/e2e/team/state?idempotencyKey=${idempotencyKey}&runId=${runId}`,
    {
      method: options.method ?? "GET",
      headers: {
        cookie: options.cookie ?? "f9_e2e_fixture=e2e-agency",
        "x-0509-e2e-test-mode": options.marker ?? "1",
      },
    },
  );
}

function workspaceFixture() {
  const harness = createSqliteD1();
  fixtures.push(harness);
  applyMigration(harness.sqlite, "migrations/0000_auth.sql");
  harness.sqlite.exec(`
    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      dodo_status TEXT,
      dodo_next_billing_at TEXT
    );
  `);
  applyMigration(harness.sqlite, "migrations/0027_workspace_members.sql");
  harness.sqlite.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('e2e-agency', 'E2E Agency', 'e2e-agency@example.invalid', 1, datetime('now'), datetime('now')),
      ('e2e-removed-member', 'E2E Removed Member', 'e2e-removed-member@example.invalid', 1, datetime('now'), datetime('now')),
      ('e2e-active-member', 'E2E Active Member', 'e2e-active-member@example.invalid', 1, datetime('now'), datetime('now'));
    INSERT INTO user_plan (user_id, plan) VALUES ('e2e-agency', 'agency'), ('e2e-removed-member', 'free');
    INSERT INTO workspace_member (id, owner_user_id, member_user_id, invited_email, status, created_at, accepted_at)
      VALUES ('e2e-member-active', 'e2e-agency', 'e2e-active-member', 'e2e-active-member@example.invalid', 'active', datetime('now', '-2 day'), datetime('now', '-1 day'));
    INSERT INTO workspace_member (id, owner_user_id, member_user_id, invited_email, status, created_at, accepted_at, revoked_at)
      VALUES ('e2e-member-revoked', 'e2e-agency', 'e2e-removed-member', 'e2e-removed-member@example.invalid', 'revoked', datetime('now', '-2 day'), datetime('now', '-1 day'), datetime('now'));
  `);
  return harness;
}

describe("Journey 6 team replay contract", () => {
  it.each(viewports)("allows only the exact owner mapping (%s)", (viewport) => {
    const key = `e2e-j6-team-invite-${viewport}`;
    const runId = `e2e-run-j6-team-invite-${viewport}`;
    expect(resolveJ6TeamReplayAction(key, "e2e-agency", runId)).toBe("invite_concurrency_recovery");
    expect(resolveJ6TeamReplayMapping(key, "e2e-agency", runId)).toMatchObject({ userId: "e2e-agency", viewport });
    expect(resolveJ6TeamReplayAction(key, "e2e-starter", runId)).toBeNull();
    expect(resolveJ6TeamReplayAction(key, "e2e-agency", `${runId}-other`)).toBeNull();
    expect(resolveJ6TeamReplayAction(`e2e-j6-team-invite-other-${viewport}`, "e2e-agency", runId)).toBeNull();
  });

  it("fails closed for non-loopback, wrong method, marker, cookie, or query shape", () => {
    const key = "e2e-j6-team-invite-375x812";
    const runId = "e2e-run-j6-team-invite-375x812";
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId))).toMatchObject({ idempotencyKey: key, runId });
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { method: "POST" }))).toBeNull();
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { marker: "0" }))).toBeNull();
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { cookie: "f9_e2e_fixture=e2e-starter" }))).toBeNull();
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { cookie: "f9_e2e_fixture=e2e-agency; f9_e2e_fixture=e2e-agency" }))).toBeNull();
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { url: `https://0509.io/api/e2e/team/state?idempotencyKey=${key}&runId=${runId}` }))).toBeNull();
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { url: `http://localhost:43127/api/e2e/team/state?idempotencyKey=${key}&runId=${runId}` }))).toBeNull();
    expect(resolveJ6TeamReplayStateRequest(stateRequest(key, runId, { url: `http://127.0.0.1:43127/api/e2e/team/state?idempotencyKey=${key}&runId=${runId}&extra=1` }))).toBeNull();
  });

  it("runs the real SQLite invite race, token rotation, revoke conflicts, and cleanup", async () => {
    const harness = workspaceFixture();
    const result = await runJ6TeamReplay({ DB: harness.db } as never, {
      userId: "e2e-agency",
      runId: "e2e-run-j6-team-invite-375x812",
      viewport: "375x812",
    });
    expect(result).toMatchObject({
      scenario: "j6",
      action: "team_invite_concurrency_recovery",
      concurrency: { attempted: 2, successes: 1, failures: 1, exactlyOneSuccess: true },
      rotation: { created: true, resent: true, staleTokenRejected: true, currentTokenAccepted: true, tokenHashCleared: true },
      revoke: { acceptedMemberRevoked: true, staleRevoke: false, staleResend: false, acceptAfterRevoke: false },
      provider: { called: false, reason: "e2e_network_denied" },
      cleanup: { rawTokensExposed: false, rawHashesExposed: false, rawProviderIdsExposed: false, piiExposed: false },
    });
    expect(harness.sqlite.prepare("SELECT id, status, member_user_id FROM workspace_member ORDER BY id").all()).toEqual([
      { id: "e2e-member-active", status: "active", member_user_id: "e2e-active-member" },
      { id: "e2e-member-revoked", status: "revoked", member_user_id: "e2e-removed-member" },
    ]);
  });

  it("fences replay ownership and completion by processing token and run", () => {
    const row = { status: "started" as const, processing_token: "owner", run_id: "run-1" };
    expect(resolveJ6TeamReplayClaim(row, "owner", "run-1")).toBe("claimed");
    expect(resolveJ6TeamReplayClaim(row, "foreign", "run-1")).toBe("in_progress");
    expect(resolveJ6TeamReplayClaim(row, "owner", "run-2")).toBe("invalid");
    const input = { changes: 1, currentStatus: "started", currentToken: "owner", currentRunId: "run-1", processingToken: "owner", runId: "run-1" };
    expect(resolveJ6TeamReplayCompletion(input)).toBe(true);
    expect(resolveJ6TeamReplayCompletion({ ...input, changes: 0 })).toBe(false);
    expect(resolveJ6TeamReplayCompletion({ ...input, currentToken: "foreign" })).toBe(false);
  });
});
