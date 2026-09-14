import { describe, expect, it, vi } from "vitest";

import {
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  reconcilePresenceItemsAfterPoll,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { presenceUrlHash } from "~/lib/presence-hash";
import {
  evaluatePresenceSourceCoverage,
} from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  SourceTargetRecord,
} from "~/lib/presence-types";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * Hacker News mention ACTIVATION (Nishfleet/0509#3207) — the capture, dedup,
 * kill-flag and rate-budget proofs, end to end through the real data layer on
 * real workerd + the repo's real migrations (0100's `connector_id = 'hn'`
 * CHECK widen is applied by the shared test setup).
 *
 * Split from `hn-mention-connector.integration.test.ts` (issue #2376's
 * file-size ratchet): that file pins the connector's network-shape contracts;
 * this file pins the #3207 acceptance through the poll orchestration. The
 * fixture helpers mirror that file's private fixtures — the established
 * per-file pattern of the mention-connector suites (bluesky, gdelt, threads).
 *
 * Scope notes for the #3207 acceptance: the capture-validity gate is proven
 * on the full pipeline in tests/capture-validity-pipeline.test.ts (this
 * describe exercises the kill-flag gate at the poll boundary; nothing here
 * bypasses the validity pipeline); the issue's "e2e fixture" proof here is
 * the integration fixture (>=1 mention), with the public-surface proof
 * pinned in tests/status.route.test.ts (the /status markup).
 */

const PHRASE = "Acme Robotics";
// fixed-date: 2026-09-10T06:00:00Z as epoch seconds — the comment ran later, so this is the watermark.
const COMMENT_CREATED_AT_I = 1789020000;

const STORY_OBJECT_ID = "42632691";
const COMMENT_OBJECT_ID = "42632700";

const SEARCH_PAGE = JSON.stringify({
  hits: [
    {
      // fixed-date: fixture mirrors a captured Algolia search_by_date story hit; the connector only parses the instant, it is never compared against a live clock
      objectID: STORY_OBJECT_ID,
      created_at: "2026-09-10T05:42:03Z", // fixed-date: the captured fixture instant, parsed only, never compared to the wall clock
      created_at_i: 1789018923,
      title: "Acme Robotics ships its first assembly plant",
      story_text: null,
      comment_text: null,
      story_id: null,
      url: "https://acmerobotics.example/press-release",
      author: "pg",
      points: 42,
      num_comments: 7,
    },
    {
      // fixed-date: fixture mirrors a captured Algolia search_by_date comment hit — a comment hit ranks 0/0 and references its story
      objectID: COMMENT_OBJECT_ID,
      created_at: "2026-09-10T06:00:00Z", // fixed-date: the captured fixture instant, parsed only, never compared to the wall clock
      created_at_i: COMMENT_CREATED_AT_I,
      title: null,
      story_text: null,
      comment_text: "We use Acme Robotics arms on our line — the precision is unreal.",
      story_title: "Acme Robotics ships its first assembly plant",
      story_id: 42632691,
      url: null,
      author: "pg",
      points: null,
      num_comments: 0,
    },
  ],
  nbHits: 2,
  page: 0,
  nbPages: 1,
  hitsPerPage: 50,
  exhaustiveNbHits: true,
});

function makeEnv(rollout: string | undefined): AppEnv {
  return {
    ...appEnv,
    PRESENCE_HN_ROLLOUT: rollout,
  } as AppEnv;
}

/** Fixture fetcher for the Algolia HN Search API shape. */
function algoliaFetcher(
  handler: (url: URL) => { body: string; status?: number } | Response,
) {
  return vi.fn(async (input: string | URL) => {
    const response = handler(new URL(input.toString()));
    if (response instanceof Response) return response;
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function seedUser(id = uid("user")) {
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedHnTarget(
  options: { userId?: string; phrase?: string; connectorId?: string } = {},
) {
  const userId = options.userId ?? (await seedUser());
  const entityId = uid("entity");
  const targetId = uid("target");
  const phrase = options.phrase ?? PHRASE;
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, NULL, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Acme self", ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      options.connectorId ?? "hn",
      phrase.toLowerCase(),
      phrase,
      JSON.stringify({ matchPhrase: phrase }),
      ISO_T0,
      ISO_T0,
    )
    .run();
  return { userId, entityId, targetId, phrase };
}

async function readCursorJson(targetId: string): Promise<Record<string, unknown>> {
  const row = await db()
    .prepare(`SELECT cursor_json FROM presence_poll_cursor WHERE source_target_id = ?`)
    .bind(targetId)
    .first<{ cursor_json: string }>();
  return row ? (JSON.parse(row.cursor_json) as Record<string, unknown>) : {};
}

describe("hn mention source activation — capture, dedup by canonical URL, kill flag, rate budget (#3207)", () => {
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

  function mockCalls(fetchImpl: typeof fetch) {
    return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
  }

  it("captures a tracked brand's hn mentions end-to-end: registry poll -> presence_item, deduped by canonical URL", async () => {
    const seeded = await seedHnTarget();
    const env = makeEnv("internal");

    // The target rides the REAL data layer (a mapped SourceTargetRecord) —
    // the shape the poll orchestrator actually sees, not a hand-built stub.
    const rows = await listSourceTargetsForEntity(env, seeded.userId, seeded.entityId);
    const target = rows.find((row) => row.connectorId === "hn");
    expect(target).toBeDefined();
    const hnTarget = target as SourceTargetRecord;

    const fetchImpl = algoliaFetcher(() => ({ body: SEARCH_PAGE }));

    // FIRST capture: tracked brand -> the public search surface -> the
    // mention substrate. The rollout gate (PRESENCE_HN_ROLLOUT=internal) is
    // the only credential: hn needs no key and no secret. The fixture
    // answers with one story + one comment naming the brand.
    const poll = await pollPresenceTarget(env, hnTarget, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items.length).toBeGreaterThanOrEqual(1); // acceptance: fixture returns >=1 mention

    // Rate budget THROUGH the orchestration: one poll = exactly ONE courtesy
    // request. No parallel fan-out, no retries, no second fetch.
    expect(mockCalls(fetchImpl)).toHaveLength(1);

    const upsert = await upsertPresenceItems(env, { sourceTarget: hnTarget, items: poll.items });
    expect(upsert.inserted).toBeGreaterThanOrEqual(1);
    expect(await countLivePresenceItems(hnTarget.id)).toBe(poll.items.length);

    // The stored dedup key IS the canonical-URL hash: url_hash =
    // presenceUrlHash(canonicalUrl), unique per (source_target_id, url_hash)
    // — the epic's "deduped by canonical URL", enforced by the substrate.
    const stored = await listPresenceItems(env, seeded.userId, {
      trackedEntityId: seeded.entityId,
      connectorId: "hn",
    });
    const mine = stored.filter((item) => item.sourceTargetId === hnTarget.id);
    expect(mine).toHaveLength(poll.items.length);
    for (const item of mine) {
      expect(item.urlHash).toBe(await presenceUrlHash(item.canonicalUrl));
      expect(item.canonicalUrl).toMatch(/^https:\/\/news\.ycombinator\.com\/item\?id=/);
      expect(item.contentHash).toBeTruthy();
    }

    // Production (pollPresenceSourceTarget) persists the first poll's cursor
    // and passes the stored record back as options.cursor.record — mirror
    // that here so the SECOND poll happens the way it really happens:
    // windowed by the stored watermark (numericFilters=created_at_i>W) while
    // the page answers with the same hits again, so the app-level upsert
    // skips because the stored (source_target_id, url_hash) row's
    // content_hash is unchanged (presence-data.server.ts) — one canonical
    // mention. The 0055 UNIQUE (source_target_id, url_hash) index is the
    // concurrent-write backstop, not what this happy-path poll exercises.
    await upsertPollCursor(env, hnTarget.id, {
      cursor: poll.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    const storedCursor = await readCursorJson(hnTarget.id);
    expect(storedCursor.lastItemCreatedAtI).toBe(COMMENT_CREATED_AT_I);
    const pollAgain = await pollPresenceTarget(env, hnTarget, { trackingMode: "self" }, {
      fetchImpl,
      cursor: { record: storedCursor },
    });
    expect(pollAgain.ok).toBe(true);
    // The second hop carries the documented watermark: the prior poll's
    // newest created_at_i folded into numericFilters — the 1,000-result
    // ceiling is never approached, and the window never re-reads this page.
    const secondUrl = new URL(String(mockCalls(fetchImpl)[1]?.[0])); // presenceSafeFetch passes the url: string
    expect(secondUrl.searchParams.get("numericFilters")).toBe(`created_at_i>${COMMENT_CREATED_AT_I}`);
    const upsertAgain = await upsertPresenceItems(env, { sourceTarget: hnTarget, items: pollAgain.items });
    expect(upsertAgain.inserted).toBe(0);
    expect(await countLivePresenceItems(hnTarget.id)).toBe(poll.items.length);

    // And the courtesy budget stays serialized: exactly one request per
    // poll — two polls, two requests, never more.
    expect(mockCalls(fetchImpl)).toHaveLength(2);

    // search_by_date is a bounded, date-ordered WINDOW, not a complete
    // snapshot: the connector declares no completeSnapshot, so reconcile
    // must never tombstone — absence from a result page is not a deletion.
    const reconcile = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget: hnTarget,
      observedUrlHashes: mine.map((item) => item.urlHash),
      completeSnapshot: false,
    });
    expect(reconcile.tombstoned).toBe(0);
  });

  it("captures nothing and fabricates nothing while the kill flag (PRESENCE_HN_ROLLOUT) is off — and /status stays honest", async () => {
    const seeded = await seedHnTarget();
    const disabled = makeEnv(undefined);

    const rows = await listSourceTargetsForEntity(disabled, seeded.userId, seeded.entityId);
    const target = rows.find((row) => row.connectorId === "hn");
    expect(target).toBeDefined();
    const hnTarget = target as SourceTargetRecord;

    const fetchImpl = algoliaFetcher(() => ({ body: SEARCH_PAGE }));
    const poll = await pollPresenceTarget(disabled, hnTarget, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.items).toEqual([]); // the capture-validity gate: no items, never fabricated
    expect(mockCalls(fetchImpl)).toHaveLength(0); // no courtesy spend while gated
    expect(await countLivePresenceItems(hnTarget.id)).toBe(0);

    // A disabled source can never render as "no data": the coverage stays
    // UNAVAILABLE (connector_disabled) — the mention-panel /status honesty
    // the epic's activation contract pins (same clause as #1378's phases).
    const coverage = await evaluatePresenceSourceCoverage(disabled, "hn", "self");
    expect(coverage.coverageLabel).toBe("UNAVAILABLE");
    expect(coverage.reasonCode).toBe("connector_disabled");
  });
});
