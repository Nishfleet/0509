import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDigestRun } from "~/lib/data/digests.server";
import { createWatchEvent } from "~/lib/data/watch-events.server";
import { listAdsByIds } from "~/lib/data.server";
import { listDigests } from "~/lib/data/digests.server";
import type { SignupFirstBriefLoaderData } from "~/lib/first-brief";

import {
  appEnv,
  db,
  ISO_T0,
  seedAd,
  seedProofCapture,
  seedProofTarget,
  seedRun,
  seedUser,
  seedWatchlist,
  uid,
} from "./fixtures";

/**
 * Issue #1276 — same-session first brief.
 *
 * The `/app/onboard?step=first-brief` loader must:
 *   - return a 200 with `status: "ready"` and the brief payload when a
 *     first-brief digest with an evidence-linked item exists,
 *   - emit the `funnel_first_brief_viewed` event,
 *   - return a 200 with `status: "waiting"` when no evidence-linked brief
 *     exists yet.
 *
 * The test seeds real D1 rows (user, watchlist, run, proof capture, ad, watch
 * event, digest run + items), mocks auth so the loader sees the seeded user,
 * mocks the workflow binding so dispatch never runs, and calls the loader
 * directly. The funnel event is observed via a console.log spy.
 */

const EVIDENCE_URL = "https://www.facebook.com/ads/library/?id=ad-test-1";

async function seedFirstBriefDigest(options: {
  userId: string;
  watchlistId: string;
  watchlistName: string;
  eventId: string;
  adId: string;
}): Promise<string> {
  const periodStart = ISO_T0;
  const periodEnd = new Date(Date.parse(ISO_T0) + 7 * 24 * 60 * 60 * 1000).toISOString();
  const digestRunId = await createDigestRun(appEnv, options.userId, periodStart, periodEnd, {
    kind: "first_brief",
    adsSeen: 1,
  }, {
    returnClaim: true,
    items: [
      {
        watchlistId: options.watchlistId,
        watchlistName: options.watchlistName,
        eventType: "ad_new",
        title: "Baseline captured: 1 active ad",
        summary: "We recorded 1 active ad as your starting point.",
        metadata: {
          eventId: options.eventId,
          adId: options.adId,
          kind: "baseline",
          sourceUrl: EVIDENCE_URL,
          proofCaptureId: "proof-1",
        },
      },
    ],
  });
  return typeof digestRunId === "string" ? digestRunId : digestRunId.digestRunId;
}

async function seedCompleteFirstBrief() {
  const userId = await seedUser(uid("user"));
  const watchlistId = await seedWatchlist(userId, uid("wl"));
  const runId = await seedRun(watchlistId, { startedAt: ISO_T0, status: "succeeded" });
  const proofTargetId = await seedProofTarget(watchlistId, uid("pt"));
  const proofCaptureId = await seedProofCapture(proofTargetId, "{}", uid("pc"));
  const adId = await seedAd(uid("ad"));

  // Link the ad to the watchlist run via a watch event with evidence metadata.
  const eventId = await createWatchEvent(appEnv, {
    watchlistId,
    runId,
    eventType: "ad_new",
    adId,
    baselineFromRunId: null,
    title: "Baseline captured: 1 active ad",
    summary: "We recorded 1 active ad as your starting point.",
    metadata: {
      kind: "baseline",
      sourceUrl: EVIDENCE_URL,
      adId,
      proofCaptureId,
    },
    status: "confirmed",
    importanceScore: 40,
    proofCaptureId,
  });

  // Mark the watchlist as scanned so shouldEnsureFirstBrief is satisfied.
  await db()
    .prepare("UPDATE watchlist SET last_scanned_at = ?, updated_at = ? WHERE id = ?")
    .bind(ISO_T0, ISO_T0, watchlistId)
    .run();

  const digestId = await seedFirstBriefDigest({
    userId,
    watchlistId,
    watchlistName: "Glowkart",
    eventId,
    adId,
  });

  return { userId, watchlistId, runId, eventId, adId, digestId };
}

function loaderContext(envOverrides: Record<string, unknown> = {}) {
  return { cloudflare: { env: { ...appEnv, ...envOverrides } } };
}

async function callOnboardLoader(
  envOverrides: Record<string, unknown> = {},
  url = "http://localhost/app/onboard?step=first-brief",
) {
  const { loader } = await import("~/routes/app.onboard");
  try {
    const data = await loader({
      context: loaderContext(envOverrides),
      params: {},
      request: new Request(url),
    } as never);
    return { kind: "data" as const, data };
  } catch (error) {
    return { kind: "response" as const, response: error as Response };
  }
}

describe("/app/onboard?step=first-brief against real D1 (issue #1276)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let seededUserId: string;

  beforeEach(() => {
    vi.resetModules();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.doMock("~/lib/auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
      return {
        ...actual,
        requireSession: async () => ({
          user: { id: seededUserId, email: `${seededUserId}@example.test`, name: "Fixture" },
          expires: new Date(Date.now() + 3600_000).toISOString(),
        }),
        requireWorkspaceSession: async () => ({
          session: {
            user: { id: seededUserId, email: `${seededUserId}@example.test`, name: "Fixture" },
            expires: new Date(Date.now() + 3600_000).toISOString(),
          },
          workspaceUserId: seededUserId,
          isMember: false,
          ownerName: "Fixture",
        }),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("~/lib/auth.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns 200 with the ready brief payload and emits funnel_first_brief_viewed", async () => {
    const seeded = await seedCompleteFirstBrief();
    seededUserId = seeded.userId;

    const result = await callOnboardLoader({
      SIGNUP_FIRST_BRIEF_ENABLED: "1",
      FUNNEL_MEASUREMENT_ENABLED: "1",
    });

    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data, not redirect");
    const data = result.data as SignupFirstBriefLoaderData;
    expect(data.step).toBe("first-brief");
    expect(data.status).toBe("ready");
    if (data.status !== "ready") throw new Error("expected ready brief");
    expect(data.brief).toBeDefined();
    expect(data.brief.watchlistName).toBe("Glowkart");
    expect(data.brief.evidenceUrl).toBe(EVIDENCE_URL);
    expect(data.brief.whatChanged).toContain("baseline");

    // The funnel event must be emitted exactly once.
    const funnelCalls = (logSpy.mock.calls as unknown[][])
      .map((call) => call[0])
      .filter((line): line is string => typeof line === "string")
      .map((line) => {
        try { return JSON.parse(line) as { operation?: string } | null; } catch { return null; }
      })
      .filter((record) => record?.operation === "funnel_first_brief_viewed");
    expect(funnelCalls).toHaveLength(1);
  });

  it("returns 200 with the waiting status when no first-brief digest exists", async () => {
    const userId = await seedUser(uid("user"));
    await seedWatchlist(userId, uid("wl"));
    seededUserId = userId;

    // No digest, no scan completion — the loader should return waiting.
    const result = await callOnboardLoader({
      SIGNUP_FIRST_BRIEF_ENABLED: "1",
      FUNNEL_MEASUREMENT_ENABLED: "1",
    });

    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data, not redirect");
    const data = result.data as SignupFirstBriefLoaderData;
    expect(data.step).toBe("first-brief");
    expect(data.status).toBe("waiting");
  });

  it("returns the no_ads terminal state when the scan completed but found no evidence", async () => {
    const userId = await seedUser(uid("user"));
    await seedWatchlist(userId, uid("wl"));
    seededUserId = userId;

    // Mark the watchlist as already scanned (activation scan finished) with
    // no first-brief digest and no evidence-linked items — the loader must
    // render the honest terminal state instead of a perpetual wait.
    await db()
      .prepare("UPDATE watchlist SET last_scanned_at = ?, updated_at = ? WHERE user_id = ?")
      .bind(ISO_T0, ISO_T0, userId)
      .run();

    const result = await callOnboardLoader({
      SIGNUP_FIRST_BRIEF_ENABLED: "1",
      FUNNEL_MEASUREMENT_ENABLED: "1",
    });

    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data, not redirect");
    const data = result.data as SignupFirstBriefLoaderData;
    expect(data.step).toBe("first-brief");
    expect(data.status).toBe("no_ads");
  });

  it("redirects to /app when the flag is off (default)", async () => {
    const userId = await seedUser(uid("user"));
    seededUserId = userId;

    const result = await callOnboardLoader({}, "http://localhost/app/onboard?step=first-brief");

    // Flag off → the loader falls through to the default redirect path.
    expect(result.kind).toBe("response");
    if (result.kind !== "response") throw new Error("expected redirect");
    expect(result.response.status).toBe(301);
    expect(result.response.headers.get("Location")).toContain("/app");
  });

  it("buildSignupFirstBriefPayload resolves ad enrichment from real D1", async () => {
    const seeded = await seedCompleteFirstBrief();
    seededUserId = seeded.userId;

    // Verify the ad is retrievable and the payload builder enriches it.
    const ads = await listAdsByIds(appEnv, [seeded.adId]);
    expect(ads).toHaveLength(1);
    expect(ads[0].metaAdId).toBe(seeded.adId);

    const digests = await listDigests(appEnv, seeded.userId);
    expect(digests).toHaveLength(1);
    const { buildSignupFirstBriefPayload, findFirstBriefDigest } = await import(
      "~/lib/first-brief"
    );
    const firstBrief = findFirstBriefDigest(digests);
    expect(firstBrief).not.toBeNull();
    const payload = buildSignupFirstBriefPayload({
      digest: firstBrief!,
      ads: ads as never,
    });
    expect(payload).not.toBeNull();
    expect(payload!.evidenceUrl).toBe(EVIDENCE_URL);
    expect(payload!.whatChanged).toContain("baseline");
  });
});
