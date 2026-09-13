import { describe, expect, it, vi } from "vitest";

import {
  pinterestConnector,
  pinterestProfileFeedUrl,
  sanitizePinterestHandle,
} from "~/lib/presence-connectors/pinterest.server";
import {
  coverageLabelForConnector,
  getPresenceConnector,
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  listSourceTargetsForEntity,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import {
  evaluatePresenceSourceCoverage,
  presenceSourceCoverageForDocs,
} from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  PresenceConnectorContext,
  SourceTargetRecord,
} from "~/lib/presence-types";

import migrationSql from "../../migrations/0101_widen_source_target_connector_pinterest.sql?raw";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Pinterest mention connector (Nishfleet/0509#3201) — the mentions-epic
 * split of #3171 whose public surface is the tracked profile's own feed
 * (`https://www.pinterest.com/<handle>/feed.rss` — undocumented public RSS
 * 2.0, verified live 2026-09-13; no key, no auth).
 *
 * Runs on real workerd against the repo's real migrations, including the
 * CHECK-widening migration for 'pinterest' — the write path (a
 * connector_id = 'pinterest' row in source_target) and the read path are
 * both asserted against the real D1 engine, and the migration file itself
 * is re-applied in place to prove child-row and predecessor preservation
 * (the 0093/0098/0099/0100 rebuild convention).
 *
 * Connector methods are network-shape contracts: a mock `fetchImpl` serves
 * fixture profile-feed XML for `www.pinterest.com` — the only real network
 * touched is the public-IP check inside `presenceSafeFetch`
 * (resolvePublicHttpUrl DNS), matching the hn/gdelt/threads suites.
 *
 * Rate budget: the surface is undocumented (same honesty posture as the
 * PLAN.md's Google News RSS row — verified, community-documented, capable of
 * changing without notice), so there is no published limit to cite. The
 * suite pins the connector's frugality contract instead: ONE serialized
 * request per poll, and the feed itself is the bounded window (25 items —
 * the same cap the shared parser applies) — no paging, no second fetch, no
 * conditional-GET yet.
 *
 * The collection proofs the #3201 termination asks for, on the REAL store:
 * the fixture poll returns >=1 mention; captures are deduped by canonical
 * URL (a second poll with the same pin-URL under a new title UPDATES the
 * row, it never inserts a second one); the capture-validity gate drops
 * items whose pin URL does not survive public-URL normalization; the
 * per-source kill flag (PRESENCE_PINTEREST_ROLLOUT) gates validate, poll
 * and the /status row; and the /status docs row states what the public
 * surface covers — and what it does not.
 */

const HANDLE = "AcmeRobotics";
const PIN_A_URL = "https://www.pinterest.com/pin/8585055536940757/";
const PIN_B_URL = "https://www.pinterest.com/pin/8585055536940756/";
// fixed-date: 2026-08-25T13:52:20Z as the fixture's captured pubDate — the
// connector only parses the instant, it is never compared against a live clock.
const PIN_A_PUBLISHED = "2026-08-25T13:52:20.000Z";
const PIN_B_PUBLISHED = "2026-08-25T13:52:00.000Z";

/** Fixture mirrors the captured Pinterest profile-feed item shape: RSS 2.0
 * <item> with title/link/description/pubDate/guid, descriptions
 * double-escape their HTML (`&lt;a href=...`) — exactly what the live feed
 * serves. Three pins: A and B well-formed, C carries a relative link that
 * must NOT survive public-URL normalization (capture-validity). */
function pinItem(guid: string, link: string, title: string, excerpt: string, pubDate: string): string {
  return [
    "        <item>",
    `            <title>${title}</title>`,
    `            <link>${link}</link>`,
    "            <description>&lt;a href=&quot;https://www.pinterest.com/pin/8585055536940757/&quot;&gt;&lt;img src=&quot;https://i.pinimg.com/236x/13/76/b2/1376b21ced2532edb1ecf0a00ce62df8.jpg&quot;&gt;&lt;/a&gt;" +
      excerpt +
      "</description>",
    `            <pubDate>${pubDate}</pubDate>`,
    `            <guid>${guid}</guid>`,
    "        </item>",
  ].join("\n");
}

const FEED_HEADER = [
  '<?xml version="1.0" encoding="utf-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">',
  "    <channel>",
  `        <title>Acme Robotics</title>`,
  `        <link>https://www.pinterest.com/${HANDLE}/</link>`,
  "        <description>Fixture boards</description>",
  "        <language>en-us</language>",
  "        <lastBuildDate>Tue, 25 Aug 2026 13:59:00 GMT</lastBuildDate>",
].join("\n");

const PINTEREST_FEED = [
  FEED_HEADER,
  pinItem(
    PIN_A_URL,
    PIN_A_URL,
    "Acme Robotics pinned the founder&apos;s fresh cutout collage — fixture A",
    "Fixture pin A: modular arm, sealed motion — the tracked brand&apos;s own work.",
    "Tue, 25 Aug 2026 13:52:20 GMT",
  ),
  pinItem(
    PIN_B_URL,
    PIN_B_URL,
    "Acme Robotics pinned the desertcut series — fixture B",
    "Fixture pin B: rolling dunes, sun-cracked earth, hardy cacti.",
    "Tue, 25 Aug 2026 13:52:00 GMT",
  ),
  pinItem(
    "https://www.pinterest.com/pin/8585055536940755/",
    "fixtures/relative-pin-path",
    "Acme Robotics pinned the relative-link pin — fixture C",
    "Fixture pin C: its link must not survive public-URL normalization.",
    "Tue, 25 Aug 2026 13:51:49 GMT",
  ),
  "    </channel>",
  "</rss>",
].join("\n");

/** Second poll: fixture A returns under a NEW title but the SAME canonical
 * URL (the dedup key), B unchanged, and a NEW pin D — the canonical-URL
 * dedup must UPDATE A, skip B, INSERT D, and never duplicate a row. */
const PIN_D_URL = "https://www.pinterest.com/pin/8585055536940750/";
const PINTEREST_FEED_REVISED = [
  FEED_HEADER,
  pinItem(
    PIN_A_URL,
    PIN_A_URL,
    "Acme Robotics REPINNED the founder&apos;s collage with a new cutout — revised A, same canonical URL",
    "Fixture pin A revised: the same pin, a changed title, the SAME canonical URL.",
    "Tue, 25 Aug 2026 13:52:20 GMT",
  ),
  pinItem(
    PIN_B_URL,
    PIN_B_URL,
    "Acme Robotics pinned the desertcut series — fixture B",
    "Fixture pin B: rolling dunes, sun-cracked earth, hardy cacti.",
    "Tue, 25 Aug 2026 13:52:00 GMT",
  ),
  pinItem(
    PIN_D_URL,
    PIN_D_URL,
    "Acme Robotics pinned the new-arrival cutout — fixture D",
    "Fixture pin D: a genuinely new pin, a genuinely new canonical URL.",
    "Tue, 25 Aug 2026 13:50:53 GMT",
  ),
  "    </channel>",
  "</rss>",
].join("\n");

const PINTEREST_FEED_EMPTY = [
  FEED_HEADER,
  "    </channel>",
  "</rss>",
].join("\n");

function makeEnv(rollout: string | undefined): AppEnv {
  return {
    ...appEnv,
    PRESENCE_PINTEREST_ROLLOUT: rollout,
  } as AppEnv;
}

function makeCtx(
  fetchImpl: typeof fetch,
  rollout: string | undefined,
  trackingMode: "self" | "competitor" = "self",
): PresenceConnectorContext {
  return {
    env: makeEnv(rollout),
    userId: "user-pin-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/** Fixture fetcher for the Pinterest profile-feed shape. */
function pinterestFetcher(
  handler: (url: URL) => { body: string; status?: number },
) {
  return vi.fn(async (input: string | URL) => {
    const response = handler(new URL(input.toString()));
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  }) as unknown as typeof fetch;
}

async function seedPinterestTarget(
  options: { userId?: string; handle?: string } = {},
): Promise<{ userId: string; entityId: string; targetId: string; handle: string }> {
  const handle = options.handle ?? HANDLE;
  const userId = options.userId ?? (await seedUser());
  const entityId = uid("entity");
  const targetId = uid("target");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', 'Acme Robotics', NULL, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table — this
  // insert only succeeds when the 0101 CHECK genuinely accepts 'pinterest'.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'pinterest', ?, ?, ?, ?, 'VERIFIED_PUBLIC_FEED', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      handle.toLowerCase(),
      `https://www.pinterest.com/${handle}/`,
      handle,
      JSON.stringify({ handle }),
      ISO_T0,
      ISO_T0,
    )
    .run();
  return { userId, entityId, targetId, handle };
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

describe("pinterest mention connector — registration, coverage and /status row", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("pinterest");
    expect(connector).toBe(pinterestConnector);
    expect(connector.id).toBe("pinterest");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated and a coverage note that states what the public surface covers — and what it does not", () => {
    const docs = presenceSourceCoverageForDocs();
    const pinterest = docs.find((entry) => entry.sourceId === "pinterest");
    expect(pinterest).toBeDefined();
    expect(pinterest?.productionStatus).toBe("gated");
    expect(pinterest?.label).toBe("Pinterest");
    // The coverage note: what the surface covers (the tracked profile's own
    // recent pins, self AND competitor), what it does NOT (keyword-wide
    // search, other boards, engagement counts — the parked API-v5 row's job),
    // the undocumented-surface posture, the rate budget, and the kill flag.
    expect(pinterest?.notes).toContain("feed.rss");
    expect(pinterest?.notes).toContain("the tracked profile's own most recent pins");
    expect(pinterest?.notes).toContain("keyword-wide search");
    expect(pinterest?.notes).toContain("undocumented public surface");
    expect(pinterest?.notes).toContain("ONE serialized request per poll");
    expect(pinterest?.notes).toContain("PRESENCE_PINTEREST_ROLLOUT");
  });

  it("labels the source VERIFIED_PUBLIC_FEED consistently — validateTarget, the registry, and the gated coverage entry", async () => {
    expect(coverageLabelForConnector("pinterest", "self")).toBe("VERIFIED_PUBLIC_FEED");
    const result = await pinterestConnector.validateTarget(
      { trackingMode: "self", targetHandle: HANDLE },
      makeCtx(pinterestFetcher(() => ({ body: PINTEREST_FEED })), "internal"),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
  });

  it("drives the /status per-source row from the kill flag: unset → unavailable (connector_disabled), internal → available (VERIFIED_PUBLIC_FEED)", async () => {
    const disabled = await evaluatePresenceSourceCoverage(makeEnv(undefined), "pinterest", "self");
    expect(disabled.status).toBe("unavailable");
    expect(disabled.reasonCode).toBe("connector_disabled");
    expect(disabled.coverageLabel).toBe("UNAVAILABLE");

    const active = await evaluatePresenceSourceCoverage(makeEnv("internal"), "pinterest", "self");
    expect(active.status).toBe("available");
    expect(active.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    expect(active.connectorId).toBe("pinterest");

    const competitor = await evaluatePresenceSourceCoverage(makeEnv("internal"), "pinterest", "competitor");
    expect(competitor.status).toBe("available");
  });
});

describe("pinterest mention connector — validateTarget", () => {
  it("accepts a bare handle and emits the profile-URL target shape + metadata — offline, no network hop", async () => {
    const fetchImpl = pinterestFetcher(() => ({ body: "unreachable", status: 500 }));
    const result = await pinterestConnector.validateTarget(
      { trackingMode: "self", targetHandle: HANDLE },
      makeCtx(fetchImpl, "internal"),
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe(HANDLE.toLowerCase());
    expect(result.targetUrl).toBe(`https://www.pinterest.com/${HANDLE}/`);
    expect(result.targetHandle).toBe(HANDLE);
    expect(result.metadata?.handle).toBe(HANDLE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a profile URL and an @-prefixed handle into the SAME target key", async () => {
    for (const input of [
      `https://www.pinterest.com/${HANDLE}/boards/`,
      `https://pinterest.com/${HANDLE}/`,
      `@${HANDLE}`,
    ]) {
      const result = await pinterestConnector.validateTarget(
        { trackingMode: "self", targetHandle: input },
        makeCtx(pinterestFetcher(() => ({ body: PINTEREST_FEED })), "internal"),
      );
      expect(result.ok).toBe(true);
      expect(result.targetKey).toBe(HANDLE.toLowerCase());
    }
  });

  it("rejects a missing, junk, or oversize handle", async () => {
    const missing = await pinterestConnector.validateTarget(
      { trackingMode: "self" },
      makeCtx(pinterestFetcher(() => ({ body: PINTEREST_FEED })), "internal"),
    );
    expect(missing.ok).toBe(false);
    expect(missing.errorCode).toBe("missing_pinterest_handle");

    for (const junk of ["Acme Robotics", `${"a".repeat(65)}`, "https://example.com/acme"]) {
      const result = await pinterestConnector.validateTarget(
        { trackingMode: "self", targetHandle: junk },
        makeCtx(pinterestFetcher(() => ({ body: PINTEREST_FEED })), "internal"),
      );
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("pinterest_handle_invalid");
    }
  });

  it("is gated while PRESENCE_PINTEREST_ROLLOUT is unset", async () => {
    const result = await pinterestConnector.validateTarget(
      { trackingMode: "self", targetHandle: HANDLE },
      makeCtx(pinterestFetcher(() => ({ body: PINTEREST_FEED })), undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(result.errorCode).toBe("connector_disabled");
  });
});

describe("pinterest mention connector — poll", () => {
  it("returns the tracked profile's pins whose canonicalUrl is the public pinterest.com/pin/ URL — >=1 mention, deduped-by-URL identity, clean excerpt, fixed-date publishedAt", async () => {
    const { targetId } = await seedPinterestTarget();
    const fetchImpl = pinterestFetcher((url) => {
      expect(url.hostname).toBe("www.pinterest.com");
      expect(url.pathname).toBe(`/${HANDLE}/feed.rss`);
      return { body: PINTEREST_FEED };
    });
    const result = await pinterestConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-pin-1",
      targetKey: HANDLE.toLowerCase(),
      targetUrl: `https://www.pinterest.com/${HANDLE}/`,
      targetHandle: HANDLE,
      metadata: { handle: HANDLE },
    });

    expect(result.ok).toBe(true);
    // Fixture returns >=1 mention: A and B survive, C (relative link) is
    // dropped by the capture-validity gate — three parsed, two stored.
    expect(result.items).toHaveLength(2);
    expect(result.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    // One serialized request per poll — the whole rate budget.
    expect(result.costUnits).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const pinA = result.items.find((item) => item.canonicalUrl === PIN_A_URL);
    expect(pinA).toBeDefined();
    expect(pinA?.externalId).toBe(PIN_A_URL); // the feed's <guid> doubles as the external id
    expect(pinA?.canonicalUrl).not.toContain("feed.rss");
    expect(pinA?.contentHash).toBeTruthy();
    // fixed-date: mirrors the fixture's captured pubDate through the parser's ISO normalization — no wall-clock read
    expect(pinA?.publishedAt).toBe(PIN_A_PUBLISHED);
    expect(pinA?.author).toBe(null); // the profile feed carries no author element — the tracked profile IS the author
    expect(pinA?.title).toContain("founder's");
    expect(pinA?.bodyExcerpt).toBe(
      "Fixture pin A: modular arm, sealed motion — the tracked brand's own work.",
    );
    expect(pinA?.bodyExcerpt).not.toContain("<a"); // the double-escaped HTML shell is stripped, not stored

    const pinB = result.items.find((item) => item.canonicalUrl === PIN_B_URL);
    expect(pinB).toBeDefined();
    // fixed-date: mirrors the fixture's captured pubDate through the parser's ISO normalization — no wall-clock read
    expect(pinB?.publishedAt).toBe(PIN_B_PUBLISHED);

    // The profile feed IS a bounded, source-authoritative window when it
    // returns items (rss/website posture — search-shaped connectors opt out).
    expect((result.cursor as Record<string, unknown>).completeSnapshot).toBe(true);
    expect((result.cursor as Record<string, unknown>).profileFeedUrl).toBe(
      pinterestProfileFeedUrl(HANDLE),
    );

    // Every request rides the presenceSafeFetch path.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(PRESENCE_USER_AGENT);
  });

  it("keeps the fixture's pubDate consistent with its publishedAt (fixed-date, no wall clock)", () => {
    expect(Date.parse("Tue, 25 Aug 2026 13:52:20 GMT")).toBe(Date.parse(PIN_A_PUBLISHED)); // fixed-date: the 2026-08-25 fixture instant, parsed against Date.parse, never a wall-clock read
  });

  it("drops items whose pin URL does not survive public-URL normalization (capture-validity), not keyed to the profile", () => {
    const segment = sanitizePinterestHandle(`https://www.pinterest.com/${HANDLE}/boards/`);
    expect(segment).toBe(HANDLE);
    // The relative-link fixture item is the capture-validity case: pin C
    // never reaches the returned items (asserted in the happy-path test —
    // three pins parsed, two returned).
  });

  it("returns ok: true, items: [] for an empty feed (honest empty), with completeSnapshot false so reconcile never mass-tombstones on a transiently empty public feed", async () => {
    const { targetId } = await seedPinterestTarget();
    const fetchImpl = pinterestFetcher(() => ({ body: PINTEREST_FEED_EMPTY }));
    const result = await pinterestConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-pin-1",
      targetKey: HANDLE.toLowerCase(),
      targetUrl: `https://www.pinterest.com/${HANDLE}/`,
      targetHandle: HANDLE,
      metadata: { handle: HANDLE },
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    // One rate-budget request was still spent.
    expect(result.costUnits).toBe(1);
    expect((result.cursor as Record<string, unknown>).completeSnapshot).toBe(false);
  });

  it("maps HTTP errors to honest failures, never fabricated items", async () => {
    const { targetId } = await seedPinterestTarget();
    const target = {
      id: targetId,
      userId: "user-pin-1",
      targetKey: HANDLE.toLowerCase(),
      targetUrl: `https://www.pinterest.com/${HANDLE}/`,
      targetHandle: HANDLE,
      metadata: { handle: HANDLE },
    };
    const gone = await pinterestConnector.poll(
      makeCtx(pinterestFetcher(() => ({ body: "<rss/>", status: 404 })), "internal"),
      target,
    );
    expect(gone.ok).toBe(false);
    expect(gone.items).toEqual([]);
    expect(gone.errorCode).toBe("pinterest_feed_error");
    // A failed poll returns no cursor — the orchestrator keeps whatever
    // reconciliation state it had; a failure never silently skips mentions.
    expect(gone.cursor).toBeUndefined();

    const rateLimited = await pinterestConnector.poll(
      makeCtx(pinterestFetcher(() => ({ body: "<rss/>", status: 429 })), "internal"),
      target,
    );
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.errorCode).toBe("rate_limited");
  });

  it("refuses the poll without fetching when the rollout is off (credentials are always true — no key, no auth)", async () => {
    const { targetId } = await seedPinterestTarget();
    const fetchImpl = pinterestFetcher(() => ({ body: PINTEREST_FEED }));
    const gated = await pinterestConnector.poll(makeCtx(fetchImpl, undefined), {
      id: targetId,
      userId: "user-pin-1",
      targetKey: HANDLE.toLowerCase(),
      targetUrl: `https://www.pinterest.com/${HANDLE}/`,
      targetHandle: HANDLE,
      metadata: { handle: HANDLE },
    });
    expect(gated.ok).toBe(false);
    expect(gated.errorCode).toBe("connector_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a target with no handle without fetching", async () => {
    const { targetId } = await seedPinterestTarget();
    const fetchImpl = pinterestFetcher(() => ({ body: PINTEREST_FEED }));
    const result = await pinterestConnector.poll(makeCtx(fetchImpl, "internal"), {
      id: targetId,
      userId: "user-pin-1",
      targetKey: "",
      targetUrl: null,
      targetHandle: null,
      metadata: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_pinterest_handle");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("pinterest mention connector — through the real registry dispatch (the #3386 lesson: the registry hands the WHOLE target to the connector)", () => {
  it("pollPresenceTarget resolves a real connector_id='pinterest' row and reaches this connector's poll with its metadata.handle intact", async () => {
    const { userId, entityId } = await seedPinterestTarget();
    // Refetch through the data layer so we operate on the real mapped record.
    const rows = await listSourceTargetsForEntity(makeEnv("internal"), userId, entityId);
    const target: SourceTargetRecord | undefined = rows.find(
      (row) => row.connectorId === "pinterest",
    );
    expect(target).toBeDefined();
    expect(target?.metadata.handle).toBe(HANDLE);

    const fetchImpl = pinterestFetcher((url) => {
      // Case preserved: the connector polls the handle the customer typed.
      expect(url.pathname).toBe(`/${HANDLE}/feed.rss`);
      return { body: PINTEREST_FEED };
    });
    const poll = await pollPresenceTarget(makeEnv("internal"), target as SourceTargetRecord, {
      trackingMode: "self",
    }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("pinterest mention connector — mention store: canonical-URL dedup on the real D1", () => {
  it("poll → upsert inserts each pin once; a second poll with the SAME pin URL under a NEW title UPDATES the row instead of duplicating it (termination: deduped by canonical URL)", async () => {
    const { userId, entityId, targetId } = await seedPinterestTarget();
    const rows = await listSourceTargetsForEntity(makeEnv("internal"), userId, entityId);
    const target = rows.find((row) => row.connectorId === "pinterest");
    expect(target).toBeDefined();

    const feed = (body: string) =>
      pinterestFetcher((url) => {
        expect(url.pathname).toBe(`/${HANDLE}/feed.rss`);
        return { body };
      });

    // First poll: A and B stored (C's relative link never survived).
    const first = await pollPresenceTarget(makeEnv("internal"), target as SourceTargetRecord, {
      trackingMode: "self",
    }, { fetchImpl: feed(PINTEREST_FEED) });
    expect(first.ok).toBe(true);
    const firstUpsert = await upsertPresenceItems(makeEnv("internal"), {
      sourceTarget: target as SourceTargetRecord,
      items: first.items,
    });
    expect(firstUpsert.inserted).toBe(2);
    expect(firstUpsert.updated).toBe(0);
    expect(await countLivePresenceItems(targetId)).toBe(2);

    // Second poll: A returns with a NEW title under the SAME canonical URL,
    // B unchanged, D genuinely new. Same-URL pins must never multiply rows.
    const second = await pollPresenceTarget(makeEnv("internal"), target as SourceTargetRecord, {
      trackingMode: "self",
    }, { fetchImpl: feed(PINTEREST_FEED_REVISED) });
    expect(second.ok).toBe(true);
    const secondUpsert = await upsertPresenceItems(makeEnv("internal"), {
      sourceTarget: target as SourceTargetRecord,
      items: second.items,
    });
    expect(secondUpsert.inserted).toBe(1); // D only
    expect(secondUpsert.updated).toBe(1); // A — same canonical URL, new content
    expect(await countLivePresenceItems(targetId)).toBe(3); // A, B, D — never 4

    // A's row kept its canonical-URL identity, took the revised title, and
    // recorded the revision instead of duplicating.
    const revised = await db()
      .prepare(
        `SELECT id, title, revision FROM presence_item
         WHERE source_target_id = ? AND canonical_url = ? AND is_tombstone = 0`,
      )
      .bind(targetId, PIN_A_URL)
      .first<{ id: string; title: string; revision: number }>();
    expect(revised?.title).toContain("same canonical URL");
    expect(revised?.revision).toBe(2);
    const revisions = await db()
      .prepare(`SELECT count(*) AS n FROM presence_item_revision WHERE presence_item_id = ?`)
      .bind(revised?.id ?? "")
      .first<{ n: number }>();
    expect(revisions?.n).toBe(1);
  });
});

describe("pinterest mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_PINTEREST_ROLLOUT is unset", async () => {
    const result = await pinterestConnector.healthCheck(
      makeCtx(pinterestFetcher(() => ({ body: PINTEREST_FEED })), undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports healthy when the rollout is on and the public surface answers a one-request probe (the official @pinterest profile feed)", async () => {
    const fetchImpl = pinterestFetcher((url) => {
      expect(url.hostname).toBe("www.pinterest.com");
      expect(url.pathname).toBe("/pinterest/feed.rss");
      return { body: PINTEREST_FEED };
    });
    const result = await pinterestConnector.healthCheck(makeCtx(fetchImpl, "internal"));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports degraded when the public surface fails", async () => {
    const result = await pinterestConnector.healthCheck(
      makeCtx(pinterestFetcher(() => ({ body: "over budget", status: 503 })), "internal"),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.errorCode).toBe("pinterest_unreachable");
  });
});

describe("pinterest mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'pinterest' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including
    // 0101_widen_source_target_connector_pinterest — ran in the test setup,
    // so this write only succeeds when the CHECK genuinely accepts
    // 'pinterest'.
    const { targetId, userId, handle } = await seedPinterestTarget();
    const row = await db()
      .prepare(`SELECT connector_id, target_key, target_handle, metadata_json, user_id FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string; target_key: string; target_handle: string; metadata_json: string; user_id: string }>();
    // READ path: the widened row reads back through the real engine.
    expect(row?.connector_id).toBe("pinterest");
    expect(row?.target_key).toBe(handle.toLowerCase());
    expect(row?.target_handle).toBe(handle);
    expect(JSON.parse(row?.metadata_json ?? "{}")).toEqual({ handle });
    expect(row?.user_id).toBe(userId);
  });

  it("re-applies the 0101 migration cleanly and preserves child rows and every predecessor connector's rows", async () => {
    // Seed a full target + child rows, then re-run the real migration
    // statements in place — the rebuild must copy the pinterest row through
    // and restore every cascaded child row set (0093 rebuild convention).
    const { userId, entityId, targetId } = await seedPinterestTarget();
    const itemId = uid("item");
    const revisionId = uid("rev");
    await db().batch([
      db().prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at)
         VALUES (?, ?, ?, ?, 'pinterest', ?, 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(itemId, targetId, entityId, userId, PIN_A_URL),
      db().prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, cursor_json, updated_at) VALUES (?, '{}', 'u')`,
      ).bind(targetId),
      db().prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at)
         VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(revisionId, itemId),
    ]);

    // Predecessor rows must survive the copy too: 0101's CHECK is a superset
    // of 0100's (which itself carried the 0098-pair/0099/0100 chain), so
    // these writes through the chain-final CHECK — one per non-pinterest
    // value the 0100 CHECK accepted — are the order-proof, and they must
    // predate the re-application to prove the COPY keeps them through the
    // rebuild.
    const predecessorIds: Record<string, string> = {};
    for (const connectorId of ["website", "x", "reddit", "linkedin", "rss", "gdelt", "bluesky", "threads", "hn"]) {
      const predecessorTargetId = uid("target");
      predecessorIds[connectorId] = predecessorTargetId;
      await db().prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 'c', 'u')`,
      ).bind(predecessorTargetId, entityId, userId, connectorId, `${connectorId}-handle`).run();
    }

    const statements = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db().batch(statements.map((sql) => db().prepare(sql)));

    const kept = await db()
      .prepare(`SELECT connector_id FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first<{ connector_id: string }>();
    expect(kept?.connector_id).toBe("pinterest");

    // Every predecessor row (nine connectors) survives the copy — the CHECK
    // union is order-proof whichever of 0100/0101 applied when.
    for (const [connectorId, predecessorTargetId] of Object.entries(predecessorIds)) {
      const healed = await db()
        .prepare(`SELECT connector_id, target_key FROM source_target WHERE id = ?`)
        .bind(predecessorTargetId)
        .first<{ connector_id: string; target_key: string }>();
      expect(healed?.connector_id).toBe(connectorId);
      expect(healed?.target_key).toBe(`${connectorId}-handle`);
    }

    // The pinterest row itself survives the rebuild alongside them. Local
    // storage isolates per test FILE, not per test (see fixtures), so earlier
    // suites' pinterest rows persist — scope the survival count to this
    // target's id.
    const pinterestRows = await db()
      .prepare(`SELECT count(*) AS c FROM source_target WHERE connector_id = 'pinterest' AND id = ?`)
      .bind(targetId)
      .first<{ c: number }>();
    expect(pinterestRows?.c).toBe(1);

    for (const [table, where, arg] of [
      ["presence_item", "id = ?", itemId],
      ["presence_poll_cursor", "source_target_id = ?", targetId],
      ["presence_item_revision", "id = ?", revisionId],
    ] as const) {
      const row = await db()
        .prepare(`SELECT count(*) AS c FROM ${table} WHERE ${where}`)
        .bind(arg)
        .first<{ c: number }>();
      expect(row?.c).toBe(1);
    }
  });
});
