import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPlanEntitlements } from "~/lib/plan-entitlements";
import { pickSignupFirstBriefBrandSuggestions } from "~/lib/first-brief";
import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";
import { mockReactRouter } from "../helpers/mock-react-router";

/**
 * Issue #1487 — same-session first brief regression.
 *
 * Locks the full activation contract in one test: a clean signup (test auth
 * bypass) → activation scan completes for a seeded competitor → the
 * `/app/onboard?step=first-brief` loader renders a real brief with ≥1
 * evidence-linked item → the "Your first brief" email is dispatched on the
 * digest path within the same session (not the weekly cron).
 *
 * The data + delivery layers are mocked so the test runs in the `node`
 * vitest project; the real-D1 path is covered by
 * `tests/integration/signup-first-brief.integration.test.ts`. This test
 * asserts the end-to-end *contract* (render + email) holds, which is the
 * regression gate for the activation gap the issue targets.
 */

const EVIDENCE_URL = "https://www.facebook.com/ads/library/?id=ad-1";
const LANDING = "https://glowkart.example/sale";
const OWNER_ADDRESS = "owner@example.com";

function watchlist(): WatchlistRecord {
  return {
    id: "watch-1",
    userId: "user-1",
    name: "Glowkart",
    targetType: "advertiser",
    trackingRole: "competitor",
    targetId: LANDING,
    targetFingerprint: "fingerprint-1",
    targetLabel: "Glowkart",
    targetCountry: "all",
    isActive: true,
    lastScannedAt: "2026-08-26T10:05:00.000Z",
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:05:00.000Z",
  };
}

function event(): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "ad_new",
    status: "confirmed",
    importanceScore: 40,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: "proof-1",
    title: "Baseline captured: 1 active ad",
    summary: "We recorded 1 active ad for Glowkart as your starting point.",
    metadata: { kind: "baseline", adsSeen: 1, sourceUrl: EVIDENCE_URL, adId: "ad-1" },
    confirmedAt: "2026-08-26T10:05:01.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-08-26T10:05:01.000Z",
    createdAt: "2026-08-26T10:05:00.000Z",
  };
}

function filedDigest() {
  return {
    id: "digest-1",
    userId: "user-1",
    periodStart: "2026-08-26T10:00:00.000Z",
    periodEnd: "2026-09-02T10:00:00.000Z",
    createdAt: "2026-08-26T10:05:02.000Z",
    summary: { kind: "first_brief" },
    items: [
      {
        id: "item-1",
        digestRunId: "digest-1",
        watchlistId: "watch-1",
        watchlistName: "Glowkart",
        eventType: "ad_new",
        title: "Baseline captured: 1 active ad",
        summary: "We recorded 1 active ad for Glowkart as your starting point.",
        createdAt: "2026-08-26T10:05:02.000Z",
        metadata: { eventId: "event-1", sourceUrl: EVIDENCE_URL, adId: "ad-1", kind: "baseline" },
      },
    ],
    delivery: null,
  };
}

function verifiedOwner() {
  return { email: OWNER_ADDRESS, name: "Owner", emailVerified: true };
}

function mockDataServer(
  deliverWeeklyDigest: ReturnType<typeof vi.fn>,
  activationAttempt: { status: string } | null = null,
) {
  const createDigestRun = vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true });
  // No existing digest on the first reads (loader + findExistingFirstBrief),
  // then the filed digest after ensureFirstBriefForWorkspace runs — so the
  // loader's shouldEnsureFirstBrief gate triggers filing + email dispatch.
  const listDigests = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValue([filedDigest()]);
  const ads = [{ metaAdId: "ad-1", landingPageUrl: LANDING, adSnapshotUrl: EVIDENCE_URL }];
  // Issue #2407: the ready state reads the `activation-result:*` attempt row
  // before it claims the email was sent. The mock returns the row only for
  // the exact key the sender claims under, so a drifted key reads as "not
  // sent" and fails the assertions below.
  const getDeliveryAttemptByIdempotencyKey = vi
    .fn()
    .mockImplementation(async (_env: unknown, key: string) =>
      key === "activation-result:user-1:watch-1" ? activationAttempt : null,
    );
  vi.doMock("~/lib/data.server", () => ({
    listWatchlists: vi.fn().mockResolvedValue([watchlist()]),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
    getUserDeliveryProfile: vi.fn().mockResolvedValue(verifiedOwner()),
    listWatchEventsForRun: vi.fn().mockResolvedValue([event()]),
    listObservationsForRun: vi.fn().mockResolvedValue([{ ad_id: "ad-1", landing_page_url: LANDING }]),
    createDigestRun,
    getDigest: vi.fn().mockResolvedValue(filedDigest()),
    listDigests,
    listAdsByIds: vi.fn().mockResolvedValue(ads),
    getDeliveryAttemptByIdempotencyKey,
  }));
  vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
  vi.doMock("~/lib/cron-failure-alert.server", () => ({
    reportScheduledTaskFailure: vi.fn(),
  }));
  return { createDigestRun, listDigests, getDeliveryAttemptByIdempotencyKey };
}

function mockNoAdsFirstBrief() {
  const createDigestRun = vi.fn().mockResolvedValue({
    digestRunId: "digest-1",
    created: true,
  });
  // No existing digest and an empty event set — the activation scan completed
  // but found no evidence-linked items.
  const listDigests = vi.fn().mockResolvedValue([]);
  vi.doMock("~/lib/data.server", () => ({
    listWatchlists: vi.fn().mockResolvedValue([watchlist()]),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
    getUserDeliveryProfile: vi.fn().mockResolvedValue(verifiedOwner()),
    listWatchEventsForRun: vi.fn().mockResolvedValue([]),
    listObservationsForRun: vi.fn().mockResolvedValue([]),
    createDigestRun,
    getDigest: vi.fn().mockResolvedValue(null),
    listDigests,
    listAdsByIds: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest: vi.fn() }));
  vi.doMock("~/lib/cron-failure-alert.server", () => ({
    reportScheduledTaskFailure: vi.fn(),
  }));
  vi.doMock("~/lib/ads-internal-links.server", () => ({
    loadIndexableAdsInternalLinks: vi.fn().mockResolvedValue([
      // Same buyer category as Glowkart's `glowkart.example` fallback bucket
      // is "More brands", so these are the deterministic alphabetical fallback
      // — the property the issue's "already-tracked brands with live data"
      // needs is that they come from the indexable /brands set at all.
      //
      // `glowkart.example` is deliberately present: it is the user's own
      // scanned competitor, so a regression in the exclusion is caught by the
      // test rather than silently passing against an absent domain.
      { domain: "glowkart.example", path: "/ads/glowkart.example", name: "Glowkart" },
      { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
      { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas" },
      { domain: "nykaa.com", path: "/ads/nykaa.com", name: "Nykaa" },
      { domain: "hubspot.com", path: "/ads/hubspot.com", name: "HubSpot" },
    ]),
  }));
  return { createDigestRun, listDigests };
}

function mockFailingFirstBrief() {
  const createDigestRun = vi.fn().mockRejectedValue(new Error("digest creation failed"));
  const listDigests = vi.fn().mockResolvedValue([]);
  const ads = [{ metaAdId: "ad-1", landingPageUrl: LANDING, adSnapshotUrl: EVIDENCE_URL }];
  vi.doMock("~/lib/data.server", () => ({
    listWatchlists: vi.fn().mockResolvedValue([watchlist()]),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
    getUserDeliveryProfile: vi.fn().mockResolvedValue(verifiedOwner()),
    listWatchEventsForRun: vi.fn().mockResolvedValue([event()]),
    listObservationsForRun: vi.fn().mockResolvedValue([{ ad_id: "ad-1", landing_page_url: LANDING }]),
    createDigestRun,
    getDigest: vi.fn().mockResolvedValue(null),
    listDigests,
    listAdsByIds: vi.fn().mockResolvedValue(ads),
  }));
  vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest: vi.fn() }));
  vi.doMock("~/lib/cron-failure-alert.server", () => ({
    reportScheduledTaskFailure: vi.fn(),
  }));
  return { createDigestRun, listDigests };
}

function mockAuth() {
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue({
      user: { id: "user-1", email: OWNER_ADDRESS, name: "Owner" },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    }),
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session: {
        user: { id: "user-1", email: OWNER_ADDRESS, name: "Owner" },
        expires: new Date(Date.now() + 3600_000).toISOString(),
      },
      workspaceUserId: "user-1",
      isMember: false,
      ownerName: "Owner",
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: (context: unknown) =>
      (context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env ??
      ({} as Record<string, unknown>),
  }));
}

beforeEach(() => {
  vi.resetModules();
  // The view uses react-router's <Link>, which needs a router context.
  // Stub it to a plain anchor so renderToStaticMarkup works without a
  // provider. Mocked before any route/component import so the resolved
  // module graph picks up the stub.
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/cron-failure-alert.server");
  vi.doUnmock("~/lib/ads-internal-links.server");
  vi.doUnmock("react-router");
});

describe("same-session first brief (issue #1487)", () => {
  it("renders an on-screen brief with ≥1 evidence item and dispatches the email in the same session", async () => {
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      details: [{ status: "sent" }],
    });
    const { getDeliveryAttemptByIdempotencyKey } = mockDataServer(
      deliverWeeklyDigest,
      { status: "sent" },
    );
    mockAuth();

    const { loader } = await import("~/routes/app.onboard");
    const data = (await loader({
      context: { cloudflare: { env: { SIGNUP_FIRST_BRIEF_ENABLED: "1" } } },
      params: {},
      request: new Request("http://localhost/app/onboard?step=first-brief"),
    } as never)) as Awaited<ReturnType<typeof loader>>;

    // (a) on-screen brief renders with ≥1 evidence-linked item.
    expect(data).toMatchObject({ step: "first-brief", status: "ready" });
    if (!(typeof data === "object" && data !== null && "status" in data && data.status === "ready")) {
      throw new Error("expected ready brief");
    }
    expect(data.brief.evidenceUrl).toBe(EVIDENCE_URL);
    expect(data.brief.watchlistName).toBe("Glowkart");
    expect(data.brief.whatChanged).toContain("baseline");

    // Render the component to assert the evidence link is on screen.
    // react-router's <Link> is stubbed to a plain anchor in beforeEach.
    const { SignupFirstBriefView } = await import("~/components/signup-first-brief-view");
    const markup = renderToStaticMarkup(<SignupFirstBriefView data={data} />);
    expect(markup).toContain(EVIDENCE_URL);
    expect(markup).toContain("View the screenshot evidence");

    // Issue #2407: the row exists and reached `sent`, so the surface may
    // claim the email — and it must have read the sender's exact key.
    expect(data.activationEmailSent).toBe(true);
    expect(getDeliveryAttemptByIdempotencyKey).toHaveBeenCalledWith(
      expect.anything(),
      "activation-result:user-1:watch-1",
    );
    // react-dom/server escapes apostrophes, so assert on the escape-free
    // substring of each sentence.
    expect(markup).toContain("emailed this brief to you");
    expect(markup).not.toContain("the email is on its way");

    // (b) the "Your first brief" email was dispatched in the same session,
    //     on the digest path with firstBrief: true — not the weekly cron.
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ firstBrief: true, digestRunId: "digest-1" }),
    );
    const call = deliverWeeklyDigest.mock.calls[0]?.[1] as { cadence?: string } | undefined;
    expect(call?.cadence).toBe("weekly");
  });

  it("renders the honest no-ads terminal state when the scan completes with no verified ads", async () => {
    const { createDigestRun } = mockNoAdsFirstBrief();
    mockAuth();

    const { loader } = await import("~/routes/app.onboard");
    const data = (await loader({
      context: { cloudflare: { env: { SIGNUP_FIRST_BRIEF_ENABLED: "1" } } },
      params: {},
      request: new Request("http://localhost/app/onboard?step=first-brief"),
    } as never)) as Awaited<ReturnType<typeof loader>>;

    // The loader returns the no_ads terminal state and the scanned watchlist.
    expect(data).toMatchObject({
      step: "first-brief",
      status: "no_ads",
      watchlistName: "Glowkart",
    });
    if (!(typeof data === "object" && data !== null && "status" in data && data.status === "no_ads")) {
      throw new Error("expected no_ads brief");
    }

    // Render the component to assert the honest copy and next action are
    // visible. react-router's <Link> is stubbed to a plain anchor in beforeEach.
    const { SignupFirstBriefView } = await import("~/components/signup-first-brief-view");
    const markup = renderToStaticMarkup(<SignupFirstBriefView data={data} />);
    expect(markup).toContain("No verified ads yet");
    expect(markup).toContain("Add competitors");
    expect(markup).toContain('href="/app"');

    // No digest was created because the scan produced no evidence-linked items.
    expect(createDigestRun).not.toHaveBeenCalled();
  });

  it("offers adjacent already-tracked brands and a landing-page capture in the no-ads state (issue #2411)", async () => {
    mockNoAdsFirstBrief();
    mockAuth();

    const { loader } = await import("~/routes/app.onboard");
    const data = (await loader({
      context: { cloudflare: { env: { SIGNUP_FIRST_BRIEF_ENABLED: "1" } } },
      params: {},
      request: new Request("http://localhost/app/onboard?step=first-brief"),
    } as never)) as Awaited<ReturnType<typeof loader>>;

    if (!(typeof data === "object" && data !== null && "status" in data && data.status === "no_ads")) {
      throw new Error("expected no_ads brief");
    }

    // (a) the loader resolved 2-3 adjacent brands from the same indexable set
    // the /brands hub serves — never the user's own competitor, never a link
    // the /ads/:domain route would refuse to serve.
    expect(data.suggestedBrands.length).toBeGreaterThanOrEqual(2);
    expect(data.suggestedBrands.length).toBeLessThanOrEqual(3);
    // The mock indexable set below deliberately INCLUDES the user's own
    // competitor domain, so this assertion can actually fail if the exclusion
    // regresses (it used to assert against a domain absent from the fixture).
    for (const brand of data.suggestedBrands) {
      expect(brand.path).toBe(`/ads/${brand.domain}`);
      expect(brand.domain).not.toBe("glowkart.example");
    }
    expect(data.suggestedBrands.map((b) => b.domain)).not.toContain(
      "glowkart.example",
    );

    // (b) the rendered surface links every suggested brand and offers the
    // landing-page capture, so the first session does not dead-end.
    const { SignupFirstBriefView } = await import("~/components/signup-first-brief-view");
    const markup = renderToStaticMarkup(<SignupFirstBriefView data={data} />);
    for (const brand of data.suggestedBrands) {
      expect(markup).toContain(`href="${brand.path}"`);
    }
    // The capture offer must deep link the EXISTING watchlist (by id), never
    // the create-competitor form: free is `watchlists: 1`, so the activation
    // watchlist has already spent the only slot and a second-watchlist offer
    // would land the user this state exists for on a plan limit instead of a
    // capture. A display label in the `website` field is also rejected by the
    // site's own domain validator, which disables the submit button.
    expect(markup).toContain(
      `href="/app/watchlists/${encodeURIComponent("watch-1")}"`,
    );
    expect(markup).not.toContain("competitor=Glowkart");
    // The offer must not quote the Full-Site Watch page budget: it is gated by
    // FULLSITE_WATCH_ENABLED (default off), so a free user may not have it and
    // the sentence would be an unsourced claim. It must also never route the
    // display label into the `website` field, which the site's own domain
    // validator rejects (disabling the submit button).
    expect(markup).not.toContain("page checks");
    expect(markup).toContain("Add a page to capture instead");
  });

  it("keeps waiting when filing the first brief fails, so polling can retry", async () => {
    const { createDigestRun } = mockFailingFirstBrief();
    mockAuth();

    const { loader } = await import("~/routes/app.onboard");
    const data = (await loader({
      context: { cloudflare: { env: { SIGNUP_FIRST_BRIEF_ENABLED: "1" } } },
      params: {},
      request: new Request("http://localhost/app/onboard?step=first-brief"),
    } as never)) as Awaited<ReturnType<typeof loader>>;

    // Filing failed; the loader must not freeze the user on a terminal no_ads
    // screen. The client stays in waiting so the next poll can retry.
    expect(data).toMatchObject({
      step: "first-brief",
      status: "waiting",
      watchlistName: "Glowkart",
    });
    if (!(typeof data === "object" && data !== null && "status" in data && data.status === "waiting")) {
      throw new Error("expected waiting brief");
    }

    // The filing path was attempted and failed.
    expect(createDigestRun).toHaveBeenCalledTimes(1);
  });

  // Issue #2407: the sentence may only render behind a `sent` attempt row.
  it.each([
    ["no delivery attempt row", null],
    ["a pending attempt", { status: "pending" }],
    ["a failed attempt", { status: "failed" }],
  ])(
    "renders the honest email-pending copy with %s",
    async (_label, activationAttempt) => {
      const deliverWeeklyDigest = vi.fn().mockResolvedValue({
        attempts: 1,
        details: [{ status: "sent" }],
      });
      mockDataServer(deliverWeeklyDigest, activationAttempt);
      mockAuth();

      const { loader } = await import("~/routes/app.onboard");
      const data = (await loader({
        context: { cloudflare: { env: { SIGNUP_FIRST_BRIEF_ENABLED: "1" } } },
        params: {},
        request: new Request("http://localhost/app/onboard?step=first-brief"),
      } as never)) as Awaited<ReturnType<typeof loader>>;

      if (!(typeof data === "object" && data !== null && "status" in data && data.status === "ready")) {
        throw new Error("expected ready brief");
      }
      expect(data.activationEmailSent).toBe(false);

      const { SignupFirstBriefView } = await import("~/components/signup-first-brief-view");
      const markup = renderToStaticMarkup(<SignupFirstBriefView data={data} />);
      expect(markup).toContain("the email is on its way");
      expect(markup).not.toContain("emailed this brief to you");
      // The brief itself still renders — only the claim is gated.
      expect(markup).toContain(EVIDENCE_URL);
    },
  );
});
