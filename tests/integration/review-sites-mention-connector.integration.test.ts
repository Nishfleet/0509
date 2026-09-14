import { describe, expect, it, vi } from "vitest";

import trustpilotFixture from "./fixtures/review-sites/trustpilot-review-github-com.2026-09-13.html?raw";
import g2ChallengeFixture from "./fixtures/review-sites/g2-review-challenge.2026-09-13.html?raw";

import { reviewSitesConnector } from "~/lib/presence-connectors/review-sites.server";
import {
  getPresenceConnector,
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  listPresenceItems,
  listSourceTargetsForEntity,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { SourceTargetRecord } from "~/lib/presence-types";

import { appEnv, ISO_T0, db, seedUser, uid } from "./fixtures";

/**
 * Review-sites mention connector — issue #3209 (split of #3171, epic #3171).
 *
 * A tracked brand's Trustpilot business-unit review page — the public page a
 * human reads — publishes the unit's own schema.org/Review JSON-LD. The
 * connector's contract is "the response body's own ld+json": no account, no
 * API key, no credentials; one serialized GET per poll; the published
 * `~20 newest reviews` window re-read per poll and deduped by canonical URL
 * (the Trustpilot-published review uuid on their 301-confirmed
 * /reviews/<uuid> public path) through the (source_target_id, url_hash)
 * UNIQUE constraint. G2/Capterra are documented, not wired (bot-verified
 * public pages, partner/paid APIs) — the challenge fixture proves the
 * fail-closed half: a challenge page is an honestly recorded failure, never
 * a phantom mention.
 *
 * The suite runs on real workerd against the repo's real migrations. The
 * network is hermetic: a mock `fetchImpl` serves the committed 2026-09-13
 * fixture captures at the `presenceSafeFetch` seam, while the request
 * (method, host, path) is still proven.
 *
 * The `source_target.connector_id` CHECK gains 'review_sites' by the
 * 0103 widen migration (expand-only, the 0093/0098/0099/0100 convention) —
 * this suite proves the widened schema accepts the new connector's rows.
 */

/** The committed 2026-09-13 captures, bundled verbatim at build time (`?raw` —
 * the workers project's test files run inside workerd and cannot read the
 * host filesystem; Vite's raw import lands the file's exact bytes as a
 * module, so the fixture the test serves IS the committed fixture). */
const TRUSTPILOT_FIXTURE = trustpilotFixture;
const G2_CHALLENGE_FIXTURE = g2ChallengeFixture;

const BUSINESS_UNIT_URL = "https://www.trustpilot.com/review/github.com";
// The newest published review in the fixture (fixed-date: verbatim from the
// 2026-09-13 capture — asserted, never compared against the wall clock).
const NEWEST_REVIEW = {
  id: "6aa6c4dc065618a6d64c08dc",
  url: "https://www.trustpilot.com/reviews/6aa6c4dc065618a6d64c08dc",
  title: "GitHub account suspended for almost 3…",
  author: "Rohan",
  publishedAt: "2026-09-13T17:44:28.000Z",
};

interface FetchCall {
  url: string;
  headers: Headers;
}

/** Mock fetch that captures every request it receives (linkedin-connector precedent). */
function htmlFetcher(body: string, status = 200) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL) => {
    calls.push({ url: url.toString(), headers: new Headers() });
    return new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Fully cleared env: only the rollout flag is needed — the surface is credentialless. */
function activatedEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...appEnv,
    PRESENCE_REVIEW_SITES_ROLLOUT: "internal",
    ...overrides,
  };
}

/** Seeds user + tracked_entity (self) + a review-sites source_target for the tracked domain. */
async function seedReviewSitesTarget(): Promise<{
  userId: string;
  entityId: string;
  target: SourceTargetRecord;
}> {
  const userId = await seedUser();
  const entityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "GitHub", "https://github.com", ISO_T0, ISO_T0)
    .run();

  const targetId = uid("stgt");
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'review_sites', ?, ?, ?, ?, 'PUBLIC_WEB_BEST_EFFORT', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      "github.com",
      BUSINESS_UNIT_URL,
      "github.com",
      JSON.stringify({ reviewDomain: "github.com", provider: "trustpilot", businessUnitUrl: BUSINESS_UNIT_URL }),
      ISO_T0,
      ISO_T0,
    )
    .run();

  const rows = await listSourceTargetsForEntity(activatedEnv(), userId, entityId);
  const target = rows.find((row) => row.id === targetId);
  if (!target) {
    throw new Error("expected the seeded review_sites source_target row");
  }
  return { userId, entityId, target };
}

describe("review-sites mention connector — registration and docs coverage", () => {
  it("registers review_sites in the presence connector registry", () => {
    const connector = getPresenceConnector("review_sites");
    expect(connector).toBe(reviewSitesConnector);
    expect(connector.id).toBe("review_sites");
    // Any tracked brand's Trustpilot unit — self AND competitor.
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in the coverage table as gated — the /status per-source row", () => {
    expect(
      presenceSourceCoverageForDocs().find((entry) => entry.sourceId === "review_sites")
        ?.productionStatus,
    ).toBe("gated");
  });
});

describe("review-sites mention connector — poll on the real D1", () => {
  it("e2e fixture: the published business-unit JSON-LD yields 20 mentions into the mention table, deduped on re-poll", async () => {
    const { userId, entityId, target } = await seedReviewSitesTarget();
    const env = activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" });

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: htmlFetcher(TRUSTPILOT_FIXTURE).fn,
    });
    expect(poll.ok).toBe(true);
    // The acceptance: the e2e fixture returns >=1 mention — the committed
    // capture publishes exactly 20.
    expect(poll.items.length).toBeGreaterThanOrEqual(1);
    expect(poll.items).toHaveLength(20);

    const first = await upsertPresenceItems(activatedEnv(), { sourceTarget: target, items: poll.items });
    expect(first.inserted).toBe(20);

    const second = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: htmlFetcher(TRUSTPILOT_FIXTURE).fn,
    });
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(20);
    const secondUpsert = await upsertPresenceItems(activatedEnv(), {
      sourceTarget: target,
      items: second.items,
    });
    // Deduped by canonical URL: the same published window, nothing new.
    expect(secondUpsert.inserted).toBe(0);

    const items = await listPresenceItems(activatedEnv(), userId, {
      trackedEntityId: entityId,
      connectorId: "review_sites",
    });
    expect(items.filter((item) => item.sourceTargetId === target.id)).toHaveLength(20);
    expect(items.every((item) => item.connectorId === "review_sites" && item.contentHash)).toBe(true);
  });

  it("maps the published review verbatim: public /reviews/<uuid> permalink, star rating in raw, no fabricated fields", async () => {
    const { userId, entityId, target } = await seedReviewSitesTarget();
    const env = activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" });
    const { fn, calls } = htmlFetcher(TRUSTPILOT_FIXTURE);

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl: fn });
    expect(poll.ok).toBe(true);
    // Rate budget: exactly ONE serialized request per poll — never more.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(BUSINESS_UNIT_URL);

    expect(poll.items).toHaveLength(20);
    const first = poll.items[0]!;
    expect(first.externalId).toBe(NEWEST_REVIEW.id);
    expect(first.canonicalUrl).toBe(NEWEST_REVIEW.url);
    expect(first.title).toBe(NEWEST_REVIEW.title);
    expect(first.author).toBe(NEWEST_REVIEW.author);
    expect(first.publishedAt).toBe(NEWEST_REVIEW.publishedAt);
    expect(first.bodyExcerpt).toContain("My GitHub account was suspended on June 26, 2026");
    expect(first.contentHash).toBeTruthy();
    // The free engagement signal, exactly as published — never enriched.
    expect((first.raw as { ratingValue: number | null }).ratingValue).toBe(1);
    expect((first.raw as { kind: string }).kind).toBe("trustpilot_review");

    // The items land as real presence_item rows through the real upsert
    // path, each keyed by its own published review.
    const upsert = await upsertPresenceItems(activatedEnv(), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(20);
    const stored = await listPresenceItems(activatedEnv(), userId, {
      trackedEntityId: entityId,
      connectorId: "review_sites",
    });
    const ours = stored.filter((item) => item.sourceTargetId === target.id);
    expect(ours).toHaveLength(20);
    const distinctUrls = new Set(ours.map((item) => item.canonicalUrl));
    // 20 published reviews → 20 distinct canonical URLs — no collapse.
    expect(distinctUrls.size).toBe(20);
    expect(ours.find((item) => item.canonicalUrl === NEWEST_REVIEW.url)?.author).toBe(NEWEST_REVIEW.author);
  });

  it("keeps the one-request rate budget on an honestly empty review page, and answers ok with zero fabricated items", async () => {
    const { target } = await seedReviewSitesTarget();
    const env = activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" });
    const noReviews = TRUSTPILOT_FIXTURE.replace(/"@type":"Review",/g, '"@type":"TrustpilotStubElement",');
    const { fn, calls } = htmlFetcher(noReviews);

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl: fn });
    expect(poll.ok).toBe(true);
    expect(poll.items).toEqual([]);
    expect(poll.costUnits).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("fails closed: the DataDome challenge (G2 fixture) records an honest failure, never a phantom mention", async () => {
    const { target } = await seedReviewSitesTarget();
    const env = activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" });

    // A 403 carrying the challenge interstitial — the measured fleet-box
    // posture on these surfaces (2026-09-13/14).
    const challenged403 = htmlFetcher(G2_CHALLENGE_FIXTURE, 403);
    const challengePoll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: challenged403.fn,
    });
    expect(challengePoll.ok).toBe(false);
    expect(challengePoll.errorCode).toBe("review_site_challenge");
    expect(challengePoll.items).toEqual([]);
    expect(challenged403.calls).toHaveLength(1);

    // Some deployments serve the challenge with 200 + JS — same honest
    // answer: no published review data, no fabricated capture.
    const challenged200 = htmlFetcher(G2_CHALLENGE_FIXTURE, 200);
    const challenge200Poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: challenged200.fn,
    });
    expect(challenge200Poll.ok).toBe(false);
    expect(challenge200Poll.errorCode).toBe("review_site_challenge");
    expect(challenge200Poll.items).toEqual([]);
  });

  it("maps 429 to rate_limited and an unparsable body to review_site_parse_failed, never fabricated items", async () => {
    const { target } = await seedReviewSitesTarget();
    const env = activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" });

    const rateLimited = htmlFetcher(TRUSTPILOT_FIXTURE, 429);
    const ratePoll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: rateLimited.fn,
    });
    expect(rateLimited.calls).toHaveLength(1);
    expect(ratePoll.ok).toBe(false);
    expect(ratePoll.errorCode).toBe("rate_limited");
    expect(ratePoll.items).toEqual([]);

    // A 200 that publishes no usable review data and no challenge markers.
    const garbage = htmlFetcher("<!doctype html><html><body><p>hello</p></body></html>", 200);
    const garbagePoll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      fetchImpl: garbage.fn,
    });
    expect(garbagePoll.ok).toBe(false);
    expect(garbagePoll.errorCode).toBe("review_site_parse_failed");
    expect(garbagePoll.items).toEqual([]);
  });

  it("fails closed with zero requests when the kill flag is off or the target carries no review domain", async () => {
    const { userId, entityId, target } = await seedReviewSitesTarget();
    const env = activatedEnv();
    const { fn, calls } = htmlFetcher(TRUSTPILOT_FIXTURE);

    // Kill flag: the rollout default is disabled — the registry reports the
    // connector as not operational before anything is fetched.
    const flagOff = await pollPresenceTarget(
      activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: undefined }),
      target,
      { trackingMode: "self" },
      { fetchImpl: fn },
    );
    expect(flagOff.ok).toBe(false);
    expect(flagOff.errorCode).toBe("connector_not_operational");
    expect(calls).toHaveLength(0);

    // A target whose stored domain no longer resolves: fail closed, no
    // request, honest error.
    const bare = await reviewSitesConnector.poll(
      { env: activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" }), userId, trackingMode: "self", connection: null, fetchImpl: fn },
      { id: target.id, userId, targetKey: "not-a-domain", targetUrl: null, targetHandle: null, metadata: {} },
    );
    expect(bare.ok).toBe(false);
    expect(bare.errorCode).toBe("missing_review_domain");
    expect(calls).toHaveLength(0);
    expect(entityId).toBe(entityId);
  });

  it("validates targets: the tracked brand's own website derives its Trustpilot unit; G2/Capterra answer provider_not_wired_yet", async () => {
    const ctx = {
      env: activatedEnv({ PRESENCE_REVIEW_SITES_ROLLOUT: "ga" }),
      userId: "u1",
      trackingMode: "self" as const,
      connection: null,
    };

    // Zero-config: the brand's own site derives the unit (hostname, www. stripped).
    const derived = await reviewSitesConnector.validateTarget(
      { trackingMode: "self", targetUrl: "https://www.github.com" },
      ctx,
    );
    expect(derived.ok).toBe(true);
    expect(derived.targetKey).toBe("github.com");
    expect(derived.targetUrl).toBe(BUSINESS_UNIT_URL);
    expect(derived.coverageLabel).toBe("PUBLIC_WEB_BEST_EFFORT");

    // An explicit trustpilot.com/review/... target is honored verbatim.
    const explicit = await reviewSitesConnector.validateTarget(
      { trackingMode: "competitor", targetUrl: "https://www.trustpilot.com/review/GitHub.com" },
      ctx,
    );
    expect(explicit.ok).toBe(true);
    expect(explicit.targetKey).toBe("github.com");

    // Known-but-unwired providers answer honestly — no silent pretend.
    const g2 = await reviewSitesConnector.validateTarget(
      { trackingMode: "self", targetUrl: "https://www.g2.com/products/github/reviews" },
      ctx,
    );
    expect(g2.ok).toBe(false);
    expect(g2.errorCode).toBe("provider_not_wired_yet");
    expect(g2.errorMessage).toContain("docs/mentions/PLAN.md");

    // Nothing usable: honest error, no guess.
    const nothing = await reviewSitesConnector.validateTarget({ trackingMode: "self" }, ctx);
    expect(nothing.ok).toBe(false);
    expect(nothing.errorCode).toBe("missing_review_domain");
  });
});
