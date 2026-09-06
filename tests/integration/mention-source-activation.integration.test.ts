import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import { buildMentionQuery } from "~/lib/mention-query.server";
import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  reconcilePresenceItemsAfterPoll,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { evaluatePresenceSourceCoverage } from "~/lib/presence-source-coverage.server";
import { loadMentionPanel } from "~/lib/mention-panel-loader.server";
import type {
  PresenceConnectorId,
  SourceTargetRecord,
} from "~/lib/presence-types";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Reddit + X mention-source activation — Phase 3 / Phase 5 of the
 * mention-monitoring epic (Nishfleet/0509#1378).
 *
 * Proves the mention path (reddit + x) works end-to-end against the real D1
 * through the existing connectors: seed a user + tracked_entity + source_target
 * rows (the `source_target.connector_id` CHECK in migration 0055 already allows
 * 'x' and 'reddit'), run a real poll through `pollPresenceTarget` with the
 * connectors' deterministic mocks on, upsert into `presence_item`, and prove
 * urlHash/contentHash dedup (a second identical poll+upsert does not multiply
 * rows) plus tombstone reconcile. Then, on a disabled env, assert the pure
 * `buildMentionQuery` still returns its shape, `evaluatePresenceSourceCoverage`
 * returns UNAVAILABLE so a disabled connector can never render as "no data",
 * and `loadMentionPanel` returns an honest `empty-no-sources` — never a
 * fabricated mention summary.
 */

interface SeededTarget {
  xTarget: SourceTargetRecord;
  redditTarget: SourceTargetRecord;
  trackedEntityId: string;
  userId: string;
}

/** Activated env: rollouts internal, creds present, reddit commercial approved, mocks on. */
function activatedEnv(): AppEnv {
  return {
    ...appEnv,
    PRESENCE_X_ROLLOUT: "internal",
    PRESENCE_REDDIT_ROLLOUT: "internal",
    X_API_BEARER_TOKEN: "x-token",
    REDDIT_CLIENT_ID: "r",
    REDDIT_CLIENT_SECRET: "s",
    REDDIT_COMMERCIAL_ACCESS: "approved",
    PRESENCE_X_MOCK: "1",
    PRESENCE_REDDIT_MOCK: "1",
  };
}

/** Disabled env: rollouts explicitly disabled, no creds, no mocks. */
function disabledEnv(): AppEnv {
  return {
    ...appEnv,
    PRESENCE_X_ROLLOUT: "disabled",
    PRESENCE_REDDIT_ROLLOUT: "disabled",
  };
}

async function seedMentionSetup(): Promise<SeededTarget> {
  const userId = await seedUser();
  const trackedEntityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', 'MamaEarth', 'https://mamaearth.in', NULL, 1, ?, ?)`,
    )
    .bind(trackedEntityId, userId, ISO_T0, ISO_T0)
    .run();

  // `source_target.connector_id` (migration 0055 CHECK) allows both 'x' and 'reddit'.
  const targets = [
    { connector: "x" as PresenceConnectorId, key: "mamaearth_x" },
    { connector: "reddit" as PresenceConnectorId, key: "mamaearth_reddit" },
  ];
  for (const t of targets) {
    await db()
      .prepare(
        `INSERT INTO source_target (
           id, tracked_entity_id, user_id, connector_id, target_key,
           metadata_json, coverage_label, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '{}', 'UNAVAILABLE', 1, ?, ?)`,
      )
      .bind(uid("stgt"), trackedEntityId, userId, t.connector, t.key, ISO_T0, ISO_T0)
      .run();
  }

  // Refetch through the data layer so we operate on the real mapped records.
  const rows = await listSourceTargetsForEntity(
    activatedEnv(),
    userId,
    trackedEntityId,
  );
  const byConnector = new Map<PresenceConnectorId, SourceTargetRecord>(
    rows.map((row) => [row.connectorId, row]),
  );
  const xTarget = byConnector.get("x");
  const redditTarget = byConnector.get("reddit");
  if (!xTarget || !redditTarget) {
    throw new Error("expected x and reddit source_target rows to be seeded");
  }
  return { xTarget, redditTarget, trackedEntityId, userId };
}

async function countLivePresenceItems(sourceTargetId: string): Promise<number> {
  const row = await db()
    .prepare(
      `SELECT count(*) AS n FROM presence_item
       WHERE source_target_id = ? AND is_tombstone = 0`,
    )
    .bind(sourceTargetId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The full poll -> upsert -> dedup -> reconcile flow for one connector. */
async function exerciseSource(
  env: AppEnv,
  target: SourceTargetRecord,
  trackingMode: "self" | "competitor",
): Promise<{ urlHash: string }> {
  const poll = await pollPresenceTarget(env, target, { trackingMode });
  expect(poll.ok).toBe(true);
  expect(poll.items).toHaveLength(1);

  const upsert = await upsertPresenceItems(env, { sourceTarget: target, items: poll.items });
  expect(upsert.inserted).toBeGreaterThanOrEqual(1);

  // Exactly one live presence_item row for this source_target.
  expect(await countLivePresenceItems(target.id)).toBe(1);
  const items = await listPresenceItems(env, target.userId, {
    trackedEntityId: target.trackedEntityId,
    connectorId: target.connectorId,
  });
  const only = items.find((item) => item.sourceTargetId === target.id);
  expect(only).toBeDefined();
  expect(only?.urlHash).toBeTruthy();
  expect(only?.contentHash).toBeTruthy();

  // A second identical poll + upsert must NOT multiply rows (urlHash dedup).
  const pollAgain = await pollPresenceTarget(env, target, { trackingMode });
  expect(pollAgain.ok).toBe(true);
  await upsertPresenceItems(env, { sourceTarget: target, items: pollAgain.items });
  expect(await countLivePresenceItems(target.id)).toBe(1);

  // Reconcile with the observed hash as the complete snapshot: nothing to tombstone.
  const urlHash = only?.urlHash as string;
  const reconcile = await reconcilePresenceItemsAfterPoll(env, {
    sourceTarget: target,
    observedUrlHashes: [urlHash],
    completeSnapshot: true,
  });
  expect(reconcile.tombstoned).toBe(0);

  return { urlHash };
}

describe("mention source activation — pure buildMentionQuery", () => {
  it("builds a reddit mention query with candidates and non-empty probes, independent of env", () => {
    const query = buildMentionQuery(
      { label: "MamaEarth", canonicalUrl: "https://mamaearth.in" },
      "reddit",
    );
    expect(query.source).toBe("reddit");
    if (query.source !== "reddit") {
      throw new Error("expected reddit mention query");
    }
    expect(query.query.subredditCandidates.length).toBeGreaterThanOrEqual(1);
    expect(query.provenance.subredditCandidates.length).toBe(query.query.subredditCandidates.length);
    for (const entry of query.provenance.subredditCandidates) {
      expect(entry.candidate).toBeTruthy();
      expect(entry.probe.length).toBeGreaterThan(0);
    }
  });

  it("builds an x mention query naming the label and the canonical domain with a non-empty probe", () => {
    const query = buildMentionQuery(
      { label: "MamaEarth", canonicalUrl: "https://mamaearth.in" },
      "x",
    );
    expect(query.source).toBe("x");
    if (query.source !== "x") {
      throw new Error("expected x mention query");
    }
    expect(query.query.q).toContain("MamaEarth");
    expect(query.query.q.toLowerCase()).toContain("mamaearth.in");
    expect(query.provenance.query.q).toBe(query.query.q);
    expect(query.provenance.query.probe.length).toBeGreaterThan(0);
  });

  it("still returns the shape even when the rollout is disabled (pure — no env)", () => {
    const query = buildMentionQuery(
      { label: "X", canonicalUrl: "https://x.example" },
      "reddit",
    );
    expect(query.source).toBe("reddit");
    expect(query.query.subredditCandidates.length).toBeGreaterThan(0);
    expect(query.provenance.subredditCandidates.length).toBe(query.query.subredditCandidates.length);
  });
});

describe("mention source activation — real poll + upsert + dedup + reconcile (workerd/D1)", () => {
  it("activates the x source end-to-end on the activated env", async () => {
    const { xTarget } = await seedMentionSetup();
    await exerciseSource(activatedEnv(), xTarget, "self");
  });

  it("activates the reddit source end-to-end on the activated env", async () => {
    const { redditTarget } = await seedMentionSetup();
    await exerciseSource(activatedEnv(), redditTarget, "self");
  });
});

describe("mention source activation — disabled / honest-empty", () => {
  it("reports UNAVAILABLE coverage for disabled x and reddit connectors", async () => {
    const disabled = disabledEnv();
    const x = await evaluatePresenceSourceCoverage(disabled, "x", "self");
    expect(x.coverageLabel).toBe("UNAVAILABLE");
    expect(x.reasonCode).toBe("connector_disabled");

    const reddit = await evaluatePresenceSourceCoverage(disabled, "reddit", "self");
    expect(reddit.coverageLabel).toBe("UNAVAILABLE");
    expect(reddit.reasonCode).toBe("connector_disabled");
  });

  it("loadMentionPanel returns empty-no-sources on the disabled env — honest empty, never fabricated", async () => {
    const { trackedEntityId, userId } = await seedMentionSetup();
    const result = await loadMentionPanel({
      env: disabledEnv(),
      workspaceUserId: userId,
      trackedEntityId,
      trackingMode: "self",
      planFamily: "agency",
    });
    expect(result.state).toBe("empty-no-sources");
    expect(result.items).toEqual([]);
    expect(result.enabledConnectorIds).toEqual([]);
  });
});
