import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// @ts-ignore JavaScript fixture helper is intentionally imported as a runtime module.
import {
  E2E_FIXTURE_EXPECTATIONS,
  assertReleaseState,
  assertFixtureInvariants,
  fixtureInvariantQuery,
  fixtureReleaseStateQuery,
  isolatedReleasePersistPath,
  journey5EventInvariantQuery,
  parseWranglerQueryOutput,
  postflightFixtureExpectations,
  remainingE2ePostflightQueryTimeout,
  releaseStateReadyForAssertion,
  resolveE2ePostflightQueryTimeout,
  resolveE2ePostflightTimeout,
  resolveE2ePersistPath,
} from "../scripts/e2e-local-fixture.mjs";

const journey5EventShapes = [
  [0, "payment.succeeded", "processed"],
  [2, "payment.failed", "processed"],
  [3, "subscription.renewed", "processed"],
  [4, "subscription.plan_changed", "processed"],
  [5, "subscription.plan_changed", "ignored"],
  [6, "subscription.plan_changed", "ignored"],
  [7, "subscription.plan_changed", "processed"],
  [8, "subscription.plan_changed", "processed"],
  [9, "subscription.plan_changed", "processed"],
  [10, "payment.succeeded", "processed"],
  [11, "subscription.cancelled", "processed"],
  [12, "subscription.expired", "processed"],
  [13, "payment.succeeded", "processed"],
  [14, "refund.succeeded", "processed"],
  [15, "refund.failed", "ignored"],
  [16, "refund.succeeded", "processed"],
] as const;

function journey5EventDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE dodo_webhook_event (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL
    );
  `);
  const insert = database.prepare(
    "INSERT INTO dodo_webhook_event (event_id, event_type, outcome) VALUES (?, ?, ?)",
  );
  for (const viewport of ["375x812", "768x900", "1440x900"]) {
    for (const [eventIndex, eventType, outcome] of journey5EventShapes) {
      insert.run(`e2e-j5-event:${viewport}:${eventIndex}`, eventType, outcome);
    }
  }
  return database;
}

const validRow = {
  active_membership_count: 1,
  billing_replay_baseline_count: 12,
  cross_workspace_proof_count: 0,
  foreign_key_violation_count: 0,
  monitoring_recovery_pair_count: 1,
  obsolete_sku_count: 0,
  persona_count: 26,
  support_recovery_case_count: 1,
  unexpected_no_cache_count: 0,
  unlinked_paid_persona_count: 0,
};

const validReleaseRow = {
  activation_duplicate_count: 0,
  activation_duplicate_run_count: 0,
  activation_nonterminal_run_count: 0,
  activation_orphan_run_count: 0,
  activation_owner_mismatch_count: 0,
  activation_run_count: 3,
  activation_target_mismatch_count: 0,
  activation_terminal_mismatch_count: 0,
  activation_watchlist_count: 3,
  j3_delivery_attempt_count: 0,
  j3_delivery_target_count: 0,
  j3_digest_delivery_count: 0,
  j3_replay_count: 0,
  j3_replay_incomplete_count: 0,
  j3_reservation_count: 0,
  j3_run_count: 0,
  j4_agent_share_count: 0,
  j4_agent_share_mismatch_count: 0,
  j4_audit_count: 0,
  j4_audit_mismatch_count: 0,
  j4_pdf_share_count: 0,
  j4_replay_count: 0,
  j4_replay_mismatch_count: 0,
  j4_room_count: 0,
  j4_room_mismatch_count: 0,
  j4_room_resource_count: 0,
  j4_ui_active_share_count: 0,
  j4_ui_revoked_share_count: 0,
  j4_ui_share_count: 0,
  j5_entitlement_mismatch_count: 3,
  j5_event_count: 0,
  j5_event_mismatch_count: 0,
  j5_replay_count: 0,
  j5_replay_mismatch_count: 0,
  j6_support_attempt_count: 0,
  j6_support_attempt_mismatch_count: 0,
  j6_support_failed_event_count: 0,
  j6_support_replay_count: 0,
  j6_support_replay_mismatch_count: 0,
  j6_support_sent_event_count: 0,
  j6_support_ui_case_count: 0,
  j6_support_ui_event_count: 0,
  j6_retention_replay_count: 0,
  j6_retention_replay_mismatch_count: 0,
  j6_retention_fixture_count: 0,
  j6_retention_alert_count: 0,
  j6_retention_alert_mismatch_count: 0,
  j6_team_replay_count: 0,
  j6_team_replay_mismatch_count: 0,
  j6_team_workspace_delta_count: 0,
  j6_auth_persistent_row_count: 0,
  j6_unexpected_replay_count: 0,
  non_demo_cache_count: 0,
  non_demo_fetch_count: 0,
  non_demo_provider_state_count: 0,
  watchlist_ad_count: 0,
  watchlist_ad_observation_count: 0,
  watchlist_candidate_count: 0,
  watchlist_event_count: 0,
  watchlist_landing_snapshot_count: 0,
  watchlist_proof_capture_count: 0,
  watchlist_proof_target_count: 0,
};

describe("isolated local E2E fixture", () => {
  it("permits only a dedicated e2e persistence directory inside the repo", () => {
    expect(resolveE2ePersistPath("/repo", ".wrangler/e2e-state")).toEqual({
      absolutePath: "/repo/.wrangler/e2e-state",
      relativePath: ".wrangler/e2e-state",
    });
    for (const unsafe of [".wrangler/state", "..", "/tmp/e2e-state", ".wrangler/e2e-state/../../dev"]) {
      expect(() => resolveE2ePersistPath("/repo", unsafe)).toThrow(/e2e_persist_path/);
    }
  });

  it("derives an isolated persistence directory from the exact local server identity", () => {
    expect(isolatedReleasePersistPath(`local-${"a".repeat(32)}`)).toBe(
      `.wrangler/e2e-release-${"a".repeat(32)}`,
    );
    expect(() => isolatedReleasePersistPath("local-shared")).toThrow(
      "invalid_local_release_server_identity",
    );
  });

  it("bounds each postflight query as well as the overall polling window", () => {
    expect(resolveE2ePostflightTimeout(undefined)).toBe(15_000);
    expect(resolveE2ePostflightQueryTimeout(undefined)).toBe(10_000);
    expect(resolveE2ePostflightTimeout("60000")).toBe(60_000);
    expect(resolveE2ePostflightQueryTimeout("30000")).toBe(30_000);
    expect(() => resolveE2ePostflightTimeout("60001")).toThrow("invalid_e2e_postflight_timeout");
    expect(() => resolveE2ePostflightQueryTimeout("30001")).toThrow(
      "invalid_e2e_postflight_query_timeout",
    );
    expect(remainingE2ePostflightQueryTimeout(20_000, 10_000, 5_000)).toBe(10_000);
    expect(remainingE2ePostflightQueryTimeout(12_000, 10_000, 5_000)).toBe(7_000);
    expect(() => remainingE2ePostflightQueryTimeout(5_000, 10_000, 5_000)).toThrow(
      "e2e_postflight_deadline_exceeded",
    );
  });

  it("parses one Wrangler result row and fails closed on malformed output", () => {
    expect(parseWranglerQueryOutput(JSON.stringify([{ results: [validRow] }]))).toEqual(validRow);
    expect(() => parseWranglerQueryOutput("not-json")).toThrow("invalid_fixture_invariant_output");
    expect(() => parseWranglerQueryOutput(JSON.stringify([{ results: [] }]))).toThrow(
      "missing_fixture_invariant_row",
    );
  });

  it("requires exact persona/state counts and zero integrity violations", () => {
    expect(assertFixtureInvariants(validRow)).toBe(true);
    expect(() => assertFixtureInvariants({ ...validRow, cross_workspace_proof_count: 1 })).toThrow(
      /cross_workspace_proof_count:1/,
    );
    expect(() => assertFixtureInvariants({ ...validRow, persona_count: 15 })).toThrow(/persona_count:15/);
  });

  it("seeds an expired paid persona so viewer-state audits can sign in as that account", () => {
    const sql = readFileSync("e2e/fixtures/e2e-local.sql", "utf8");
    expect(sql).toContain("('e2e-expired'");
    expect(sql).toMatch(/'e2e-expired', 'starter'[\s\S]*?'subscription\.expired'/);
    expect(E2E_FIXTURE_EXPECTATIONS.personas).toBe(26);
  });

  it("distinguishes pristine seed invariants from Journey 5 terminal lifecycle state", () => {
    expect(postflightFixtureExpectations([4]).billingReplayBaselines).toBe(12);
    expect(postflightFixtureExpectations([5]).billingReplayBaselines).toBe(3);
    expect(postflightFixtureExpectations([1, 2, 3, 4, 5, 6]).billingReplayBaselines).toBe(3);
    expect(() => postflightFixtureExpectations([7])).toThrow("invalid_release_journey_scope");
  });

  it("checks the required ownership, billing, recovery, SKU, and cache invariants", () => {
    const query = fixtureInvariantQuery();
    for (const fragment of [
      "pragma_foreign_key_check",
      "cross_workspace_proof_count",
      "dodo_subscription_id IS NULL",
      "sku_slug <> 'burst_500_v1'",
      "support_notification_failed",
      "watchlist_run failed",
      "no-cache.example",
    ]) {
      expect(query).toContain(fragment);
    }
  });

  it("builds a bounded post-run query for exact activation ownership and provider isolation", () => {
    const query = fixtureReleaseStateQuery("2026-07-15T06:00:00.000Z");
    for (const fragment of [
      "e2e-activation-desktop",
      "activation_nonterminal_run_count",
      "activation_terminal_mismatch_count",
      "target_id <> 'https://nykaa.com'",
      "substr(target_fingerprint, 1, 6) <> 'fnv1a-'",
      "substr(target_fingerprint, 7) GLOB '*[^0-9a-f]*'",
      "route_context IN ('watchlist_scan', 'public_search')",
      "meta_library_browser",
      "watchlist_proof_capture_count",
      "j3_replay_count",
      "e2e-j3-crash-reservation",
      "e2e-digest-j3-provider-denied",
      "e2e-j4-report-share-375x812",
      "e2e-j4-approval-stale-1440x900",
      "atomic_batch_failed",
      "j4_replay_mismatch_count",
      "j4_agent_share_mismatch_count",
      "j4_pdf_share_count",
      "e2e-run-j4-client-room-768x900",
      "e2e-j5-replay:e2e-j5-billing-lifecycle-???x???",
      "j5_entitlement_mismatch_count",
      "j6_support_replay_mismatch_count",
    ]) {
      expect(query).toContain(fragment);
    }
    expect(() => fixtureReleaseStateQuery("' OR 1=1 --")).toThrow("invalid_release_started_at");
  });

  it("waits only for the expected terminal activation delta and rejects any mutation", () => {
    expect(releaseStateReadyForAssertion(validReleaseRow)).toBe(true);
    expect(assertReleaseState(validReleaseRow)).toBe(true);
    expect(releaseStateReadyForAssertion({ ...validReleaseRow, activation_nonterminal_run_count: 1 })).toBe(false);
    expect(() => assertReleaseState({ ...validReleaseRow, non_demo_fetch_count: 1 })).toThrow(
      /non_demo_fetch_count:1/,
    );
    expect(() => assertReleaseState({ ...validReleaseRow, activation_terminal_mismatch_count: 1 })).toThrow(
      /activation_terminal_mismatch_count:1/,
    );
    expect(() => assertReleaseState({ ...validReleaseRow, activation_owner_mismatch_count: undefined })).toThrow(
      /activation_owner_mismatch_count:undefined/,
    );
  });

  it("supports independently runnable Journey 3 postflight proof", () => {
    const journey3Row = {
      ...validReleaseRow,
      activation_owner_mismatch_count: 3,
      activation_run_count: 0,
      activation_watchlist_count: 0,
      j3_replay_count: 21,
    };
    expect(releaseStateReadyForAssertion(journey3Row, [3])).toBe(true);
    expect(assertReleaseState(journey3Row, [3])).toBe(true);
    expect(() => assertReleaseState({ ...journey3Row, j3_run_count: 1 }, [3])).toThrow(
      /j3_run_count:1/,
    );
    expect(() =>
      assertReleaseState({ ...journey3Row, activation_owner_mismatch_count: 0 }, [3]),
    ).toThrow(/activation_owner_mismatch_count:0/);
    expect(releaseStateReadyForAssertion(validReleaseRow, [3])).toBe(false);
    expect(() => assertReleaseState(validReleaseRow, [0])).toThrow("invalid_release_journey_scope");
  });

  it("requires exact Journey 4 replay, audit, share, room, and PDF bounds", () => {
    const query = fixtureReleaseStateQuery("2026-07-15T00:00:00.000Z");
    expect(query).toContain("FROM expected_j4_audit expected\n    LEFT JOIN agent_action_audit audit");
    expect(query).toContain("WHERE EXISTS (SELECT 1 FROM e2e_j4_replay)\n      AND (audit.id IS NULL");
    expect(query).toContain(
      "replace(room.run_id, 'e2e-run-j4-client-room-', 'e2e-run-j4-approval-stale-')",
    );

    const journey4Row = {
      ...validReleaseRow,
      activation_owner_mismatch_count: 3,
      activation_run_count: 0,
      activation_watchlist_count: 0,
      j4_agent_share_count: 3,
      j4_audit_count: 9,
      j4_pdf_share_count: 1,
      j4_replay_count: 12,
      j4_room_count: 3,
      j4_room_resource_count: 6,
      j4_ui_active_share_count: 3,
      j4_ui_revoked_share_count: 3,
      j4_ui_share_count: 6,
    };
    expect(releaseStateReadyForAssertion(journey4Row, [4])).toBe(true);
    expect(assertReleaseState(journey4Row, [4])).toBe(true);
    expect(releaseStateReadyForAssertion({ ...journey4Row, j4_pdf_share_count: 3 }, [4])).toBe(true);
    expect(() => assertReleaseState({ ...journey4Row, j4_pdf_share_count: 0 }, [4])).toThrow(
      /j4_pdf_share_count:0/,
    );
    expect(() => assertReleaseState({ ...journey4Row, j4_ui_share_count: 5 }, [4])).toThrow(
      /j4_ui_share_count:5/,
    );
    expect(() => assertReleaseState({ ...journey4Row, j4_audit_mismatch_count: 1 }, [4])).toThrow(
      /j4_audit_mismatch_count:1/,
    );
  });

  it("requires exact Journey 5 signed lifecycle replay and final entitlements", () => {
    const journey5Row = {
      ...validReleaseRow,
      activation_owner_mismatch_count: 3,
      activation_run_count: 0,
      activation_watchlist_count: 0,
      j5_event_count: 48,
      j5_entitlement_mismatch_count: 0,
      j5_replay_count: 3,
    };
    expect(releaseStateReadyForAssertion(journey5Row, [5])).toBe(true);
    expect(assertReleaseState(journey5Row, [5])).toBe(true);
    expect(() => assertReleaseState({ ...journey5Row, j5_event_count: 47 }, [5])).toThrow(
      /j5_event_count:47/,
    );
    expect(() => assertReleaseState({ ...journey5Row, j5_replay_mismatch_count: 1 }, [5])).toThrow(
      /j5_replay_mismatch_count:1/,
    );
    expect(() => assertReleaseState({ ...journey5Row, j5_entitlement_mismatch_count: 1 }, [5])).toThrow(
      /j5_entitlement_mismatch_count:1/,
    );
    expect(() => assertReleaseState({ ...journey5Row, j5_entitlement_mismatch_count: 3 }, [5])).toThrow(
      /j5_entitlement_mismatch_count:3/,
    );
  });

  it("rejects a substituted Journey 5 webhook even when the prefix count stays exact", () => {
    const database = journey5EventDatabase();
    try {
      expect(database.prepare(journey5EventInvariantQuery()).get()).toEqual({
        j5_event_count: 48,
        j5_event_mismatch_count: 0,
      });

      database.prepare("DELETE FROM dodo_webhook_event WHERE event_id = ?").run(
        "e2e-j5-event:375x812:2",
      );
      database.prepare(
        "INSERT INTO dodo_webhook_event (event_id, event_type, outcome) VALUES (?, ?, ?)",
      ).run("e2e-j5-event:375x812:99", "payment.failed", "ignored");

      const contaminated = database.prepare(journey5EventInvariantQuery()).get() as {
        j5_event_count: number;
        j5_event_mismatch_count: number;
      };
      expect(contaminated).toEqual({ j5_event_count: 48, j5_event_mismatch_count: 2 });
      expect(() =>
        assertReleaseState(
          {
            ...validReleaseRow,
            activation_owner_mismatch_count: 3,
            activation_run_count: 0,
            activation_watchlist_count: 0,
            j5_entitlement_mismatch_count: 0,
            j5_event_count: contaminated.j5_event_count,
            j5_event_mismatch_count: contaminated.j5_event_mismatch_count,
            j5_replay_count: 3,
          },
          [5],
        ),
      ).toThrow(/j5_event_mismatch_count:2/);
    } finally {
      database.close();
    }
  });

  it("requires exact Journey 6 support, retention, auth, and team recovery effects", () => {
    const journey6SupportRow = {
      ...validReleaseRow,
      activation_owner_mismatch_count: 3,
      activation_run_count: 0,
      activation_watchlist_count: 0,
      j6_support_attempt_count: 1,
      j6_support_failed_event_count: 1,
      j6_support_replay_count: 6,
      j6_support_sent_event_count: 1,
      j6_support_ui_case_count: 3,
      j6_support_ui_event_count: 6,
      j6_retention_replay_count: 6,
      j6_retention_alert_count: 1,
      j6_team_replay_count: 3,
    };
    expect(releaseStateReadyForAssertion(journey6SupportRow, [6])).toBe(true);
    expect(assertReleaseState(journey6SupportRow, [6])).toBe(true);
    expect(() => assertReleaseState({ ...journey6SupportRow, j6_support_replay_count: 5 }, [6])).toThrow(
      /j6_support_replay_count:5/,
    );
    expect(() => assertReleaseState({ ...journey6SupportRow, j6_support_attempt_mismatch_count: 1 }, [6])).toThrow(
      /j6_support_attempt_mismatch_count:1/,
    );
    expect(() => assertReleaseState({ ...journey6SupportRow, j6_retention_replay_count: 5 }, [6])).toThrow(
      /j6_retention_replay_count:5/,
    );
    expect(() => assertReleaseState({ ...journey6SupportRow, j6_team_workspace_delta_count: 1 }, [6])).toThrow(
      /j6_team_workspace_delta_count:1/,
    );
  });
});
