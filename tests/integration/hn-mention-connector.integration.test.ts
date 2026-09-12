import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import migrationSql from "../../migrations/0098_widen_source_target_connector_hn.sql?raw";

import { hnConnector } from "~/lib/presence-connectors/hn.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import { ISO_T0, uid } from "./fixtures";

/**
 * Hacker News mention connector (Algolia HN Search API) — issue #3253.
 *
 * Runs on real workerd against the repo's real migrations (the workers
 * project applies the full chain including 0098's CHECK widening for 'hn'
 * in setup). Network shapes are faked with a mocked `fetchImpl` — the
 * Algolia host is fixed public HTTPS and never user-supplied, so SSRF is
 * not a factor; the connector's contract (canonicalUrl, contentHash,
 * publishedAt, author, ranking fields in raw, empty sets, serialized
 * single-page polls, time-window slicing instead of deep paging) is what
 * these tests pin.
 *
 * Migration 0098 is additionally re-run idempotently here (0093 test
 * pattern) to assert both the WRITE path ('hn' accepted by the CHECK after
 * the rebuild — the setup-time chain already ran it, so a re-run proves
 * idempotency) and the READ + data-preservation path (child rows survive).
 */

const HN_SEARCH_PATH = "/api/v1/search_by_date";

const STORY_HIT = {
  objectID: "40000001",
  created_at: "2026-01-05T12:00:00Z",
  title: "TinyStudio.io raises seed round",
  story_title: "TinyStudio.io raises seed round",
  story_text: "We announced our raise today.",
  author: "hnuser1",
  points: 42,
  num_comments: 18,
  story_id: 40000000,
};

const COMMENT_HIT = {
  objectID: "40000002",
  created_at: "2026-01-06T08:30:00Z",
  story_title: "TinyStudio.io raises seed round",
  comment_text: "Edited a typo: <b>looks great</b> so far.",
  author: "hnuser2",
  story_id: 40000000,
};

function algoliaBody(...hits: unknown[]) {
  return JSON.stringify({ hits, page: 0, nbPages: 5, hitsPerPage: 50 });
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout = "internal",
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: (rollout ? { PRESENCE_HN_ROLLOUT: rollout } : {}) as AppEnv,
    userId: "user-hn-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

function hnFetcher(routes: Array<{ match: (url: URL) => boolean; status?: number; body?: string }>) {
  let callCount = 0;
  let lastUrl: URL | null = null;
  const impl = vi.fn(async (input: string | URL) => {
    callCount += 1;
    lastUrl = new URL(input.toString());
    const route = routes.find((r) => r.match(lastUrl!));
    if (!route) {
      return new Response("not found", { status: 404 });
    }
    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls: () => callCount, lastUrl: () => lastUrl as URL | null };
}

async function seedUserAndEntity() {
  const userId = uid("user");
  const entityId = uid("entity");
  await db.batch([
    db
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(userId, `Fixture ${userId}`, `${userId}@example.test`, ISO_T0, ISO_T0),
    db
      .prepare(
        `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, canonical_url, notes, is_active, created_at, updated_at)
         VALUES (?, ?, 'self', 'Brand self', 'https://brand.test', NULL, 1, ?, ?)`,
      )
      .bind(entityId, userId, ISO_T0, ISO_T0),
  ]);
  return { userId, entityId };
}

const db = env.DB;

describe("hn mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("hn");
    expect(connector).toBe(hnConnector);
    expect(connector.id).toBe("hn");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const hn = docs.find((entry) => entry.sourceId === "hn");
    expect(hn).toBeDefined();
    expect(hn?.productionStatus).toBe("gated");
  });
});

describe("hn mention connector — validateTarget", () => {
  it("accepts a match phrase and returns OFFICIAL_PUBLIC_API without touching the network", async () => {
    const { impl, calls } = hnFetcher([]);
    const result = await hnConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: "tinystudio.io   launch" },
      makeCtx(impl),
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe("tinystudio.io launch");
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.metadata?.query).toBe("tinystudio.io launch");
    expect(calls()).toBe(0);
  });

  it("rejects a missing phrase", async () => {
    const result = await hnConnector.validateTarget(
      { trackingMode: "self", targetUrl: "" },
      makeCtx(hnFetcher([]).impl),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_phrase");
  });
});

describe("hn mention connector — poll", () => {
  it("emits items with public news.ycombinator.com canonicalUrls, hashes, authors, publishedAt and ranking fields in raw", async () => {
    const { impl } = hnFetcher([
      { match: () => true, body: algoliaBody(STORY_HIT, COMMENT_HIT) },
    ]);
    const result = await hnConnector.poll(
      makeCtx(impl),
      { targetUrl: null, targetHandle: "tinystudio.io", metadata: { query: "tinystudio.io" } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.cursor?.lastCreatedAt).toBeGreaterThan(0);

    const story = result.items[0];
    expect(story?.canonicalUrl).toBe(`https://news.ycombinator.com/item?id=${STORY_HIT.objectID}`);
    expect(story?.contentHash).toBeTruthy();
    expect(story?.author).toBe("hnuser1");
    expect(story?.publishedAt).toBe("2026-01-05T12:00:00.000Z");
    expect(story?.title).toBe("TinyStudio.io raises seed round");
    expect(story?.raw?.points).toBe(42);
    expect(story?.raw?.numComments).toBe(18);

    const comment = result.items[1];
    expect(comment?.canonicalUrl).toBe(`https://news.ycombinator.com/item?id=${COMMENT_HIT.objectID}`);
    expect(comment?.contentHash).toBeTruthy();
    expect(comment?.raw?.kind).toBe("hn_comment");
    expect(comment?.bodyExcerpt).not.toBeNull();
  });

  it("returns ok with an empty item set for an empty Algolia result", async () => {
    const { impl } = hnFetcher([{ match: () => true, body: algoliaBody() }]);
    const result = await hnConnector.poll(
      makeCtx(impl),
      { targetUrl: null, metadata: { query: "brand-o-matic-xyz" } },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("respects the ~1000-result pagination cap — one serialized page, no deep paging", async () => {
    const { impl, calls } = hnFetcher([
      { match: () => true, body: algoliaBody(STORY_HIT) },
    ]);
    const result = await hnConnector.poll(
      makeCtx(impl),
      { targetUrl: null, metadata: { query: "tinystudio.io" } },
    );
    expect(result.ok).toBe(true);
    // nbPages=5 in the fixture body; deep paging is a regression.
    expect(calls()).toBe(1);
  });

  it("slices by time window via numericFilters instead of paging", async () => {
    const { impl, calls, lastUrl } = hnFetcher([
      { match: () => true, body: algoliaBody(COMMENT_HIT) },
    ]);
    const lastCreatedAt = Date.parse("2026-01-05T12:00:00Z") / 1000;
    await hnConnector.poll(
      makeCtx(impl),
      { targetUrl: null, metadata: { query: "tinystudio.io" } },
      { lastCreatedAt },
    );
    expect(calls()).toBe(1);
    const url = lastUrl();
    // The fetcher captured `lastUrl` on the (proven) single call; the type
    // is `URL | null` because the harness can be re-entered.
    expect(url).not.toBeNull();
    expect(url!.pathname).toBe(HN_SEARCH_PATH);
    expect(url!.searchParams.get("numericFilters")).toBe(`created_at_i>${Math.floor(lastCreatedAt)}`);
    expect(url!.searchParams.get("page")).toBe("0");
    // Parenthesized OR form — Algolia's bare comma is AND, and a hit is
    // either a story OR a comment, so the conjunctive form matches nothing
    // (live-verified against the real API during review).
    expect(url!.searchParams.get("tags")).toBe("(story,comment)");
  });

  it("emits the cursor window in unix SECONDS and never claims a complete snapshot", async () => {
    const { impl } = hnFetcher([{ match: () => true, body: algoliaBody(STORY_HIT) }]);
    const result = await hnConnector.poll(
      makeCtx(impl),
      { targetUrl: null, metadata: { query: "tinystudio.io" } },
    );
    expect(result.ok).toBe(true);
    // 2026-01-05T12:00:00Z in unix seconds (created_at_i units), not ms.
    expect(result.cursor?.lastCreatedAt).toBe(1767614400);
    // A bounded page (or window slice) of a date-ordered search is NOT a
    // complete snapshot — true here would mass-tombstone older mentions.
    expect(result.cursor?.completeSnapshot).toBe(false);
  });

  it("reports hn_unavailable on a non-2xx response and hn_parse_failed on garbage", async () => {
    const httpError = await hnConnector.poll(
      makeCtx(hnFetcher([{ match: () => true, status: 503 }]).impl),
      { targetUrl: null, metadata: { query: "acme" } },
    );
    expect(httpError.ok).toBe(false);
    expect(httpError.errorCode).toBe("hn_unavailable");

    const garbage = await hnConnector.poll(
      makeCtx(hnFetcher([{ match: () => true, body: "<html>gateway error</html>" }]).impl),
      { targetUrl: null, metadata: { query: "acme" } },
    );
    expect(garbage.ok).toBe(false);
    expect(garbage.errorCode).toBe("hn_parse_failed");
  });

  it("reports missing_phrase for a target without a query", async () => {
    const result = await hnConnector.poll(
      makeCtx(hnFetcher([]).impl),
      { targetUrl: null, metadata: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_phrase");
    expect(result.items).toEqual([]);
  });
});

describe("hn mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_HN_ROLLOUT is unset", async () => {
    const result = await hnConnector.healthCheck({
      env: {} as AppEnv,
      userId: "user-hn-1",
      trackingMode: "competitor",
      connection: null,
      fetchImpl: hnFetcher([]).impl,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("reports pending while the rollout env is disabled and healthy when enabled", async () => {
    expect((await hnConnector.healthCheck(makeCtx(hnFetcher([]).impl, "disabled"))).status).toBe("pending");
    expect((await hnConnector.healthCheck(makeCtx(hnFetcher([]).impl, "internal"))).status).toBe("healthy");
  });
});

describe("hn mention connector — real D1 substrate", () => {
  it("seeds a minimal D1 against the real migrations and re-runs migration 0098 idempotently", async () => {
    const { userId, entityId } = await seedUserAndEntity();

    // WRITE path: migration 0098 widened the CHECK, so a real 'hn' row lands.
    const targetId = uid("st");
    await db
      .prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, target_url, metadata_json, coverage_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'hn', 'tinystudio.io', NULL, '{}', 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
      )
      .bind(targetId, entityId, userId, ISO_T0, ISO_T0)
      .run();

    // Child rows for the rebuild's preservation assertion (0093 test pattern):
    // a broken snapshot/restore line would otherwise pass silently.
    const itemId = uid("pi");
    const revId = uid("pir");
    await db.batch([
      db
        .prepare(
          `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
           VALUES (?, ?, ?, ?, 'hn', 'https://news.ycombinator.com/item?id=40000001', 'h1', 't', 'ch1', 1, ?, ?)`,
        )
        .bind(itemId, targetId, entityId, userId, ISO_T0, ISO_T0),
      db
        .prepare(`INSERT INTO presence_poll_cursor (source_target_id, updated_at) VALUES (?, ?)`)
        .bind(targetId, ISO_T0),
      db
        .prepare(
          `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
           VALUES (?, ?, 1, 'ch1', 't', ?, ?)`,
        )
        .bind(revId, itemId, ISO_T0, ISO_T0),
    ]);

    // READ path: the row is genuinely durable with connector_id = 'hn'.
    const row = await db
      .prepare(`SELECT connector_id, metadata_json FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string }>();
    expect(row?.connector_id).toBe("hn");

    // Idempotency re-run of the real migration statements proves the rebuild
    // and data preservation of the rebuild (child rows survive).
    const stmts = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(stmts.map((sql) => db.prepare(sql)));
    const after = await db
      .prepare(`SELECT count(*) AS c FROM source_target WHERE id = ? AND connector_id = 'hn'`)
      .bind(targetId)
      .first<{ c: number }>();
    expect(after?.c).toBe(1);

    // READ + preservation: every cascaded child row set was restored.
    expect(
      (await db.prepare(`SELECT count(*) AS c FROM presence_item WHERE id = ?`).bind(itemId).first<{ c: number }>())?.c,
    ).toBe(1);
    expect(
      (
        await db
          .prepare(`SELECT count(*) AS c FROM presence_poll_cursor WHERE source_target_id = ?`)
          .bind(targetId)
          .first<{ c: number }>()
      )?.c,
    ).toBe(1);
    expect(
      (
        await db
          .prepare(`SELECT count(*) AS c FROM presence_item_revision WHERE id = ?`)
          .bind(revId)
          .first<{ c: number }>()
      )?.c,
    ).toBe(1);

    // The connector polls the same seeded target end-to-end (fixture fetch).
    const poll = await hnConnector.poll(
      makeCtx(hnFetcher([{ match: () => true, body: algoliaBody(STORY_HIT) }]).impl),
      { targetUrl: null, targetHandle: "tinystudio.io", metadata: { query: "tinystudio.io" } },
    );
    expect(poll.ok).toBe(true);
    expect(poll.items.length).toBeGreaterThan(0);
  });
});

describe("hn migration id naming guard", () => {
  it("references HN-specific context", () => {
    expect(migrationSql).toContain("'hn'");
    expect(migrationSql).not.toContain("DROP COLUMN");
    expect(migrationSql).not.toContain("RENAME COLUMN");
  });
});
