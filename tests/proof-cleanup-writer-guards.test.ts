import { describe, expect, it } from "vitest";

import {
  addDigestItem,
  createDigestRun,
} from "~/lib/data/digests.server";
import { createWatchEvent } from "~/lib/data/watch-events.server";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const NOW = "2026-07-19T00:00:00.000Z";
const CLAIM = JSON.stringify({
  kind: "launch_readiness_real_capture",
  launchCanaryCleanupClaim: { token: "cleanup-1" },
});

function setup() {
  const harness = createSqliteD1();
  for (const migration of [
    "migrations/0000_auth.sql",
    "migrations/0001_app.sql",
    "migrations/0002_monitoring_trust.sql",
    "migrations/0007_proof_first_change_alerts.sql",
  ]) {
    applyMigration(harness.sqlite, migration);
  }
  harness.sqlite.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
  ).run("user-1", "Owner", "owner@example.test", NOW, NOW);
  harness.sqlite.prepare(`
    INSERT INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint,
      target_label, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)
  `).run("watch-1", "user-1", "Watch", "target-1", "fingerprint-1", "Target", NOW, NOW);
  harness.sqlite.prepare(`
    INSERT INTO watchlist_run (
      id, watchlist_id, trigger_type, status, summary_json,
      started_at, finished_at, created_at, updated_at
    ) VALUES (?, ?, 'manual', 'succeeded', '{}', ?, ?, ?, ?)
  `).run("run-1", "watch-1", NOW, NOW, NOW, NOW);
  harness.sqlite.prepare(`
    INSERT INTO proof_target (
      id, watchlist_id, canonical_page_identity, proof_target_identity,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run("target-1", "watch-1", "0509.io/", "proof-target-1", NOW, NOW);
  harness.sqlite.prepare(`
    INSERT INTO proof_capture (
      id, proof_target_id, status, extracted_fields_json,
      capture_metadata_json, render_mode, device_profile, extractor_version,
      attempted_at, succeeded_at, created_at, updated_at
    ) VALUES (?, ?, 'succeeded', '{}', ?, 'mobile', 'mobile_default', ?, ?, ?, ?, ?)
  `).run("proof-1", "target-1", CLAIM, "test-v1", NOW, NOW, NOW, NOW);
  return harness;
}

const digestItem = {
  watchlistId: "watch-1",
  watchlistName: "Watch",
  eventType: "ad_new" as const,
  title: "Proof-backed change",
  summary: "A proof-backed change was found.",
  metadata: { eventId: "event-1", proofCaptureId: "proof-1" },
};

describe("proof cleanup writer guards", () => {
  it("atomically rejects a watch event that references a claimed proof", async () => {
    const harness = setup();
    try {
      const input = {
        watchlistId: "watch-1",
        runId: "run-1",
        eventType: "ad_new" as const,
        adId: null,
        baselineFromRunId: null,
        proofCaptureId: "proof-1",
        title: "Proof-backed change",
        summary: "A proof-backed change was found.",
        metadata: {},
      };
      await expect(createWatchEvent({ DB: harness.db } as never, input))
        .rejects.toThrow("proof_capture_cleanup_claimed");
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get())
        .toEqual({ count: 0 });

      harness.sqlite.prepare("UPDATE proof_capture SET capture_metadata_json = '{}' WHERE id = ?").run("proof-1");
      await expect(createWatchEvent({ DB: harness.db } as never, input)).resolves.toEqual(expect.any(String));
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get())
        .toEqual({ count: 1 });
    } finally {
      harness.close();
    }
  });

  it("rejects an atomic digest claim before creating its run or items", async () => {
    const harness = setup();
    try {
      const create = () => createDigestRun(
        { DB: harness.db } as never,
        "user-1",
        "2026-07-13T00:00:00.000Z",
        "2026-07-20T00:00:00.000Z",
        {},
        { returnClaim: true, items: [digestItem] },
      );
      await expect(create()).rejects.toThrow("proof_capture_cleanup_claimed");
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get())
        .toEqual({ count: 0 });
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get())
        .toEqual({ count: 0 });

      harness.sqlite.prepare("UPDATE proof_capture SET capture_metadata_json = '{}' WHERE id = ?").run("proof-1");
      await expect(create()).resolves.toMatchObject({ created: true });
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get())
        .toEqual({ count: 1 });
    } finally {
      harness.close();
    }
  });

  it("rejects the standalone digest-item writer for a claimed proof", async () => {
    const harness = setup();
    try {
      const digestRunId = await createDigestRun(
        { DB: harness.db } as never,
        "user-1",
        "2026-07-13T00:00:00.000Z",
        "2026-07-20T00:00:00.000Z",
        {},
      );
      await expect(addDigestItem({ DB: harness.db } as never, digestRunId, digestItem))
        .rejects.toThrow("proof_capture_cleanup_claimed");
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get())
        .toEqual({ count: 0 });

      harness.sqlite.prepare("UPDATE proof_capture SET capture_metadata_json = '{}' WHERE id = ?").run("proof-1");
      await expect(addDigestItem({ DB: harness.db } as never, digestRunId, digestItem)).resolves.toBeUndefined();
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get())
        .toEqual({ count: 1 });
    } finally {
      harness.close();
    }
  });
});
