import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { pollPresenceTarget } from "~/lib/presence-connector-registry.server";
import { buildMentionDigestLines } from "~/lib/mention-digest.server";
import { createTrackedEntity, listPresenceItems, upsertPresenceItems, upsertSourceTarget } from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import {
  buildItunesLookupUrl,
  buildItunesReviewsUrl,
  buildPlayDetailsUrl,
} from "~/lib/presence-connectors/appstore.server";
import type { AppEnv } from "~/lib/env.server";

import { appEnv, db, seedUser } from "./fixtures";

/**
 * App-stores mention slice (Nishfleet/0509#3210, epic #3171, split of #3178).
 *
 * One connector, two lawful public surfaces, keyless: Apple's documented
 * iTunes Search/Lookup API plus its customer-review RSS feed (page=1 only,
 * never deep-paged), and Google Play's public details page
 * (SoftwareApplication ld+json). The suite pins the #3210 acceptance on real
 * workerd against the repo's real migrations — including migration 0104,
 * which widened the source_target connector_id CHECK to accept
 * `connector_id = 'appstore'`: the seeded row below only inserts because the
 * widen is applied, so the write path through the rebuilt table is proven,
 * not assumed.
 *
 * - the e2e fixture returns >=1 mention: the tracked app's public listing AND
 *   its most-recent Apple reviews, dispatched through the REAL
 *   `pollPresenceTarget` path, land as `presence_item` rows (a mention IS a
 *   presence_item row); the Google Play listing lands from its structured
 *   data the same way. Non-RSS connectors own their match story
 *   (buildMentionStampPlan returns null) — the connector polls THE tracked
 *   listing, so the items are the mentions by construction (the hn/gdelt
 *   posture);
 * - deduped by canonical URL: a second identical dispatched poll + upsert
 *   inserts 0 (the UNIQUE (source_target_id, url_hash) key over
 *   `presenceUrlHash(item.canonicalUrl)`); an edited Apple review (new
 *   `updated` -> new publishedAt -> new contentHash, same canonical URL)
 *   becomes a REVISION, never a duplicate row;
 * - the documented rate budget: exactly TWO requests per Apple poll (the
 *   lookup + ONE most-recent reviews page, never past page=1 — the ~20
 *   calls/minute Apple-side guidance cannot be stressed by serialized polls),
 *   exactly ONE per Google Play poll; a listing the lookup no longer answers
 *   costs one request and returns an honest empty poll;
 * - the per-source kill flag: `PRESENCE_APPSTORE_ROLLOUT` (no credentials
 *   exist for these surfaces — the flag is the whole gate) unset stops the
 *   FULL dispatched path before any request — `connector_not_operational`,
 *   zero hops, zero rows;
 * - the /status-graded coverage note: the `presenceSourceCoverageForDocs`
 *   appstore entry states what the public surfaces cover (Apple listings +
 *   most-recent reviews; Play listings) and the honest exclusion (no free
 *   public Google Play review API — batchexecute is private, documented in
 *   docs/mentions/PLAN.md), productionStatus pinned "gated".
 *
 * Hermetic network: a mock `fetchImpl` serves the fixtures at the
 * `presenceSafeFetch` seam with real public hostnames — the only real
 * network touched is the public DNS answer for those hostnames
 * (resolvePublicHttpUrl's DoH lookup), matching the hn/pinterest suites.
 */

const APPLE_APP_ID = "544007664";
const APPLE_COUNTRY = "us";
const APPLE_LISTING_URL = `https://apps.apple.com/${APPLE_COUNTRY}/app/id${APPLE_APP_ID}`;
const APPLE_LOOKUP_URL = buildItunesLookupUrl(APPLE_APP_ID, APPLE_COUNTRY);
const APPLE_REVIEWS_URL = buildItunesReviewsUrl(APPLE_APP_ID, APPLE_COUNTRY);
const APPLE_REVIEW_1_URL = "https://apps.apple.com/us/app/acme-notes/id544007664?review=1015309951";
// The feed `updated` instants are fixture payload — stored verbatim as
// published_at and only ever compared to literal strings, never to the wall
// clock (the digest's `since` filter reads created_at, not these).
// fixed-date: fixture instant, not wall-clock-relative.
const REVIEW_ONE_UPDATED = "2026-09-10T12:00:00-07:00";
// fixed-date: the edited review's later `updated` instant — same fixture role.
const REVIEW_ONE_EDITED_UPDATED = "2026-09-11T09:30:00-07:00";
const PLAY_PACKAGE_ID = "test.acme.notes";
const PLAY_LISTING_URL = "https://play.google.com/store/apps/details?id=test.acme.notes";
const PLAY_DETAILS_URL = buildPlayDetailsUrl(PLAY_PACKAGE_ID);

const APPLE_LOOKUP_BODY = {
  resultCount: 1,
  results: [
    {
      wrapperType: "software",
      kind: "software",
      trackId: 544007664,
      trackName: "Acme Notes",
      description: "The Acme edge, pocket edition — notes that sync offline-first.",
      sellerName: "Acme Engineering Ltd",
      // fixed-date: Apple's documented releaseDate shape — fixture payload.
      releaseDate: "2023-06-15T00:00:00Z",
      averageUserRating: 4.5,
      userRatingCount: 1234,
      primaryGenreName: "Productivity",
      version: "2.3.1",
      bundleId: "test.acme.notes",
    },
  ],
};

const APPLE_REVIEW_RELATED_HREF =
  "https://apps.apple.com/us/app/acme-notes/id544007664#write-a-review";

/** Apple's customer-review feed: one most-recent page, the tracked app's reviews. */
function appleReviewsBody(reviewOneUpdated: string) {
  return {
    feed: {
      entry: [
        {
          author: { name: { label: "Riley328" } },
          updated: { label: reviewOneUpdated },
          id: { label: "1015309951" },
          title: { label: "Acme Notes saved my week" },
          content: { label: "The Acme sync finally works offline. Five stars." },
          link: { attributes: { rel: "related", href: APPLE_REVIEW_RELATED_HREF } },
          "im:rating": { label: "5" },
          "im:version": { label: "2.3.1" },
          "im:voteSum": { label: "12" },
          "im:voteCount": { label: "14" },
        },
        {
          author: { name: { label: "DriveByNight" } },
          // fixed-date: second review's feed instant — fixture payload.
          updated: { label: "2026-09-09T08:00:00-07:00" },
          id: { label: "1015298877" },
          title: { label: "Slow since the redesign" },
          content: { label: "Drains the battery and the widget stopped loading." },
          link: { attributes: { rel: "related", href: APPLE_REVIEW_RELATED_HREF } },
          "im:rating": { label: "2" },
          "im:version": { label: "2.3.0" },
          "im:voteSum": { label: "3" },
          "im:voteCount": { label: "5" },
        },
      ],
    },
  };
}

const PLAY_DETAILS_HTML = `<!doctype html>
<html><head><title>Acme Notes - Apps on Google Play</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Acme Notes","description":"The Acme edge, pocket edition.","author":{"name":"Acme Engineering Ltd"},"aggregateRating":{"ratingValue":"4.4","ratingCount":"8823"},"applicationCategory":"PRODUCTIVITY","contentRating":"Everyone"}</script>
</head><body><div>Acme Notes on Google Play</div></body></html>`;

type Env = AppEnv;

function makeEnv(rollout?: string): Env {
  return { ...appEnv, PRESENCE_APPSTORE_ROLLOUT: rollout } as Env;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The presenceSafeFetch seam: the mock fetchImpl routes by public hostname
 * and never touches the network. Anything unexpected 404s loudly.
 */
function appstoreFetcher(responders: {
  lookup?: () => Response;
  reviews?: () => Response;
  play?: () => Response;
}) {
  return vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = new URL(input.toString());
    const hostPath = `${url.hostname}${url.pathname}`;
    if (url.hostname === "itunes.apple.com" && url.pathname === "/lookup") {
      return responders.lookup ? responders.lookup() : new Response("missing lookup", { status: 404 });
    }
    if (url.hostname === "itunes.apple.com" && url.pathname.includes("/rss/customerreviews/page=1/")) {
      return responders.reviews ? responders.reviews() : new Response("missing reviews", { status: 404 });
    }
    if (url.hostname === "play.google.com" && url.pathname === "/store/apps/details") {
      return responders.play ? responders.play() : new Response("missing play", { status: 404 });
    }
    expect(hostPath).toBe("no unexpected fetch");
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

async function seedAppstoreEntityAndTarget(
  env: Env,
  surface: { store: "apple" | "google"; appId: string; listingUrl: string; countryCode?: string },
) {
  const userId = await seedUser();
  const entity = await createTrackedEntity(env, {
    userId,
    trackingMode: "self",
    label: "Acme",
    canonicalUrl: "https://acme.test",
    notes: "Aliases:\n- Acme Co",
  });
  const target = await upsertSourceTarget(env, {
    userId,
    trackedEntityId: entity.id,
    connectorId: "appstore",
    targetKey: `${surface.store}:${surface.appId}`,
    targetUrl: surface.listingUrl,
    coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
    metadata: {
      store: surface.store,
      appId: surface.appId,
      countryCode: surface.countryCode ?? APPLE_COUNTRY,
      listingUrl: surface.listingUrl,
    },
  });
  return { userId, entityId: entity.id, target };
}

async function countLiveItems(sourceTargetId: string) {
  const row = await db()
    .prepare(
      `SELECT count(*) AS n FROM presence_item
       WHERE source_target_id = ? AND is_tombstone = 0`,
    )
    .bind(sourceTargetId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function readItemRow(sourceTargetId: string, canonicalUrl: string) {
  return await db()
    .prepare(
      `SELECT id, title, author, published_at, content_hash, revision, raw_json FROM presence_item
       WHERE source_target_id = ? AND canonical_url = ? AND is_tombstone = 0`,
    )
    .bind(sourceTargetId, canonicalUrl)
    .first<{
      id: string;
      title: string | null;
      author: string | null;
      published_at: string | null;
      content_hash: string | null;
      revision: number;
      raw_json: string | null;
    }>();
}

describe("App-stores mention connector (#3210) — the public-listing + review surface, dispatched", () => {
  it("captures >=1 mention: the tracked Apple listing and its most-recent reviews through the real dispatched poll", async () => {
    const { userId, entityId, target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_UPDATED)),
    });

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.costUnits).toBe(2);
    // The listing rides FIRST, the reviews after, in the feed's own order.
    expect(poll.items).toHaveLength(3);
    expect(poll.items[0]?.canonicalUrl).toBe(APPLE_LISTING_URL);
    expect(poll.items[1]?.canonicalUrl).toBe(APPLE_REVIEW_1_URL);

    const upsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(3);
    expect(await countLiveItems(target.id)).toBe(3);

    // The mention table's user-visible view carries all three.
    const listed = await listPresenceItems(makeEnv("internal"), userId, { trackedEntityId: entityId });
    expect(listed).toHaveLength(3);

    // The captured rows reach the mention surfaces: the digest's default
    // connector set (PRESENCE_MENTION_CONNECTOR_IDS) includes appstore.
    const digest = await buildMentionDigestLines(makeEnv("internal"), userId, {
      since: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(digest.some((line) => line.includes(APPLE_LISTING_URL))).toBe(true);

    // The listing row: canonical id-form URL, the raw rating fields ride along.
    const listing = await readItemRow(target.id, APPLE_LISTING_URL);
    expect(listing?.title).toBe("Acme Notes");
    expect(listing?.author).toBe("Acme Engineering Ltd");
    // fixed-date: exact string match on the stored fixture instant.
    expect(listing?.published_at).toBe("2023-06-15T00:00:00.000Z");
    const listingRaw = JSON.parse(listing?.raw_json ?? "{}") as Record<string, unknown>;
    expect(listingRaw.kind).toBe("appstore_listing");
    expect(listingRaw.store).toBe("apple");
    expect(listingRaw.rating).toBe(4.5);
    expect(listingRaw.ratingCount).toBe(1234);

    // The review row: canonicalUrl = the feed's rel=related link + the review
    // id param (the fragment is stripped, the id survives); publishedAt is the
    // review's `updated` instant.
    const review = await readItemRow(target.id, APPLE_REVIEW_1_URL);
    expect(review?.title).toBe("Acme Notes saved my week");
    expect(review?.author).toBe("Riley328");
    // fixed-date: exact string match on the stored fixture instant.
    expect(review?.published_at).toBe("2026-09-10T19:00:00.000Z");
    const reviewRaw = JSON.parse(review?.raw_json ?? "{}") as Record<string, unknown>;
    expect(reviewRaw.kind).toBe("appstore_review");
    expect(reviewRaw.rating).toBe(5);
  });

  it("dedups by canonical URL: a second identical dispatched poll + upsert inserts 0 — 3 items, 3 rows, no churn", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_UPDATED)),
    });

    const first = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(first.ok).toBe(true);
    const firstUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: first.items });
    expect(firstUpsert.inserted).toBe(3);

    const second = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(3);
    const secondUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: second.items });
    // Same canonicalUrls -> same presenceUrlHash -> the UNIQUE
    // (source_target_id, url_hash) key; identical content hashes -> not even
    // a revision. One row per canonical URL, exactly the #3205 contract.
    expect(secondUpsert.inserted).toBe(0);
    expect(secondUpsert.updated).toBe(0);
    expect(await countLiveItems(target.id)).toBe(3);
  });

  it("an edited Apple review becomes a REVISION, never a duplicate — same canonical URL, new updated instant", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const firstFetch = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_UPDATED)),
    });
    const editedFetch = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_EDITED_UPDATED)),
    });

    const first = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl: firstFetch });
    expect(first.ok).toBe(true);
    const firstUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: first.items });
    expect(firstUpsert.inserted).toBe(3);

    const second = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl: editedFetch });
    expect(second.ok).toBe(true);
    const secondUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: second.items });
    // The canonicalUrl is UNCHANGED (rel=related + review id) — the edited
    // `updated` instant changes publishedAt -> contentHash -> a revision of
    // the SAME row, not a second row.
    expect(secondUpsert.inserted).toBe(0);
    expect(secondUpsert.updated).toBe(1);
    expect(await countLiveItems(target.id)).toBe(3);

    const edited = await readItemRow(target.id, APPLE_REVIEW_1_URL);
    // fixed-date: exact string match on the stored fixture instant.
    expect(edited?.published_at).toBe("2026-09-11T16:30:00.000Z");
    expect(edited?.revision).toBe(2);
    const revisions = await db()
      .prepare(`SELECT count(*) AS n FROM presence_item_revision WHERE presence_item_id = ?`)
      .bind(edited?.id ?? "")
      .first<{ n: number }>();
    expect(revisions?.n).toBe(1);
  });

  it("keeps the documented rate budget: exactly TWO requests per Apple poll — the lookup plus ONE page=1 most-recent reviews fetch, never past page=1", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_UPDATED)),
    });

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.costUnits).toBe(2);

    const calls = (fetchImpl as Mock).mock.calls;
    expect(calls).toHaveLength(2);
    // Hop 1 — the documented keyless lookup.
    expect(String(calls[0]?.[0])).toBe(APPLE_LOOKUP_URL);
    expect(String(calls[0]?.[0])).toContain("id=544007664");
    expect(String(calls[0]?.[0])).toContain("country=us");
    // Hop 2 — the most-recent customer-review feed, page=1 ONLY.
    expect(String(calls[1]?.[0])).toBe(APPLE_REVIEWS_URL);
    expect(String(calls[1]?.[0])).toContain("page=1");
    expect(String(calls[1]?.[0])).toContain("sortby=mostrecent");
  });

  it("an app the lookup no longer answers is an honest empty poll — ONE request spent, no reviews fetch, zero rows", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      lookup: () => jsonResponse({ resultCount: 0, results: [] }),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_UPDATED)),
    });

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    // ok, honest empty — the second request is not even spent: there is
    // nothing to hash the reviews against.
    expect(poll).toMatchObject({ ok: true, items: [], costUnits: 1 });
    expect((fetchImpl as Mock).mock.calls).toHaveLength(1);

    const upsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(0);
    expect(await countLiveItems(target.id)).toBe(0);
  });

  it("captures the Google Play listing from the public details page's own SoftwareApplication structured data — ONE request, deduped on re-poll", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "google",
      appId: PLAY_PACKAGE_ID,
      listingUrl: PLAY_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      play: () => new Response(PLAY_DETAILS_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    });

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    expect(poll.costUnits).toBe(1);
    expect(poll.items).toHaveLength(1);
    expect(poll.items[0]?.canonicalUrl).toBe(PLAY_LISTING_URL);
    expect(poll.items[0]?.title).toBe("Acme Notes");
    expect(poll.items[0]?.author).toBe("Acme Engineering Ltd");
    // The Play page exposes no first-published instant — null by design, so
    // the contentHash is stable across polls.
    expect(poll.items[0]?.publishedAt).toBeNull();

    const upsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(1);
    const row = await readItemRow(target.id, PLAY_LISTING_URL);
    const rowRaw = JSON.parse(row?.raw_json ?? "{}") as Record<string, unknown>;
    expect(rowRaw.kind).toBe("appstore_listing");
    expect(rowRaw.store).toBe("google");
    expect(rowRaw.rating).toBe(4.4);
    expect(rowRaw.ratingCount).toBe(8823);

    // Exactly ONE fetch — the public details page with hl/gl pinned.
    const calls = (fetchImpl as Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toBe(PLAY_DETAILS_URL);
    expect(String(calls[0]?.[0])).toContain("hl=en");
    expect(String(calls[0]?.[0])).toContain("gl=US");

    // Same page, same structured data, same null publishedAt -> identical
    // contentHash -> the second poll dedups to zero.
    const second = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(second.ok).toBe(true);
    const secondUpsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: second.items });
    expect(secondUpsert.inserted).toBe(0);
    expect(secondUpsert.updated).toBe(0);
    expect(await countLiveItems(target.id)).toBe(1);
  });

  it("capture-validity: entries without a rel=related href or an id are skipped — the listing still stores, the bad rows never land", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv("internal"), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () =>
        jsonResponse({
          feed: {
            entry: [
              // Apple's real feed prepends THE APP as entry[0]: its link is
              // rel=alternate (not related) — it must not land as a review.
              {
                id: { label: "https://itunes.apple.com/us/app/id544007664" },
                title: { label: "Acme Notes" },
                link: { attributes: { rel: "alternate", href: APPLE_LISTING_URL } },
              },
              // A review-shaped entry with no id — no canonicalUrl exists,
              // never fabricate one.
              {
                author: { name: { label: "NoId" } },
                updated: { label: REVIEW_ONE_UPDATED },
                title: { label: "Missing id" },
                link: { attributes: { rel: "related", href: APPLE_REVIEW_RELATED_HREF } },
              },
              // A review-shaped entry whose only link is rel=self — same skip.
              {
                author: { name: { label: "NoRelated" } },
                updated: { label: REVIEW_ONE_UPDATED },
                id: { label: "9999999999" },
                title: { label: "Missing related link" },
                link: { attributes: { rel: "self", href: APPLE_REVIEW_RELATED_HREF } },
              },
              // The one good review — link as an ARRAY (the other real
              // Apple shape) still resolves its rel=related member.
              {
                author: { name: { label: "Riley328" } },
                updated: { label: REVIEW_ONE_UPDATED },
                id: { label: "1015309951" },
                title: { label: "Acme Notes saved my week" },
                link: [
                  { attributes: { rel: "self", href: "https://itunes.apple.com/us/rss/customerreviews/id544007664" } },
                  { attributes: { rel: "related", href: APPLE_REVIEW_RELATED_HREF } },
                ],
              },
            ],
          },
        }),
    });

    const poll = await pollPresenceTarget(makeEnv("internal"), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(true);
    // The listing + exactly ONE review; the three invalid entries skipped.
    expect(poll.items).toHaveLength(2);
    expect(poll.items[0]?.canonicalUrl).toBe(APPLE_LISTING_URL);
    expect(poll.items[1]?.canonicalUrl).toBe(APPLE_REVIEW_1_URL);

    const upsert = await upsertPresenceItems(makeEnv("internal"), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(2);
    expect(await countLiveItems(target.id)).toBe(2);
  });

  it("capture-validity: the PRESENCE_APPSTORE_ROLLOUT kill flag unset stops the dispatched path before any request — gated answer, zero hops, zero rows", async () => {
    const { target } = await seedAppstoreEntityAndTarget(makeEnv(undefined), {
      store: "apple",
      appId: APPLE_APP_ID,
      listingUrl: APPLE_LISTING_URL,
    });
    const fetchImpl = appstoreFetcher({
      lookup: () => jsonResponse(APPLE_LOOKUP_BODY),
      reviews: () => jsonResponse(appleReviewsBody(REVIEW_ONE_UPDATED)),
    });

    const poll = await pollPresenceTarget(makeEnv(undefined), target, { trackingMode: "self" }, { fetchImpl });
    expect(poll.ok).toBe(false);
    expect(poll.errorCode).toBe("connector_not_operational");
    expect(poll.items).toEqual([]);

    expect((fetchImpl as Mock).mock.calls).toHaveLength(0);
    const upsert = await upsertPresenceItems(makeEnv(undefined), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(0);
    expect(await countLiveItems(target.id)).toBe(0);
  });

  it("the /status-graded appstore row states what the public surfaces cover, productionStatus pinned gated", () => {
    const entry = presenceSourceCoverageForDocs().find((row) => row.sourceId === "appstore");
    expect(entry).toBeDefined();
    expect(entry?.productionStatus).toBe("gated");
    expect(entry?.notes).toContain("customer-review RSS feed");
    expect(entry?.notes).toContain("SoftwareApplication structured data");
    expect(entry?.notes).toContain("batchexecute");
    expect(entry?.notes).toContain("PRESENCE_APPSTORE_ROLLOUT");
  });
});
