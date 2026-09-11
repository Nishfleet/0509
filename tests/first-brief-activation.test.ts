import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

/**
 * Issue #1862 — First brief on-screen within 5 minutes of signup (BET 7).
 *
 * End-to-end activation-flow test (node project, mocked D1/Better Auth):
 *   signup completion → activation scan baseline → first brief filed →
 *   on-screen brief ready → "Your first brief" email dispatched.
 *
 * Asserts the activation funnel events fire in the issue's order
 * (`signup_completed` → `first_brief_generated` → `first_brief_email_sent`)
 * and that the timing guarantees the issue names hold: the on-screen deadline
 * is 5 minutes and the email window is 60 minutes (constants live in
 * `scripts/bet7-activation-verification.mjs`). The `first_brief_viewed` event
 * is fired by the dashboard/onboard loader, covered separately by
 * `tests/integration/signup-first-brief.integration.test.ts`; this test does
 * not claim it.
 *
 * The per-piece behaviour (loader ready state, filing idempotency, unverified
 * email gating) is covered by `tests/integration/signup-first-brief.integration.test.ts`
 * and `tests/first-brief.server.test.ts`; this test ties the activation
 * funnel together and proves the new `signup_completed` and
 * `first_brief_generated` events fire at the right steps, with the same
 * privacy/GPC contract the other activation events carry.
 */

const FUNNEL_OPERATIONS = [
  "funnel_signup_completed",
  "funnel_first_brief_generated",
  "funnel_first_brief_email_sent",
];

function emittedFunnelRecords(logSpy: MockInstance): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((line): line is string => typeof line === "string")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(
      (record): record is Record<string, unknown> =>
        Boolean(record && typeof record === "object") &&
        FUNNEL_OPERATIONS.includes(String((record as { operation?: unknown }).operation)),
    );
}

function funnelOperations(logSpy: MockInstance): string[] {
  return emittedFunnelRecords(logSpy).map(
    (record) => String(record.operation),
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/cron-failure-alert.server");
});

const SIGNUP_REDIRECT = "/app#setup-checklist";
const OWNER_ADDRESS = ["owner", "example.com"].join("@");
const SNAPSHOT = "https://www.facebook.com/ads/library/?id=ad-1";
const LANDING = "https://glowkart.example/sale";

function signupConfirmation() {
  return {
    token: "token-1",
    callbackURL: SIGNUP_REDIRECT,
    newUserCallbackURL: SIGNUP_REDIRECT,
    expiresAt: Date.now() + 60_000,
    mode: "signup" as const,
  };
}

function loginConfirmation() {
  return {
    token: "token-1",
    callbackURL: "/app",
    expiresAt: Date.now() + 60_000,
    mode: "login" as const,
  };
}

/**
 * Mocks the Better Auth surface so `completeBetterAuthMagicLinkSignIn` reaches
 * the post-verification funnel emit without hitting D1 or the auth provider.
 * `succeeds` toggles whether verification yields session cookies.
 * `redirectWithoutSession` models a 302 that did not set a session cookie —
 * the emit must stay silent in that case (the reviewer's session-cookie gate).
 */
function mockBetterAuth(succeeds: boolean, redirectWithoutSession = false) {
  const sessionHeaders = new Headers({
    Location: SIGNUP_REDIRECT,
    "Set-Cookie": "f9_session=ok; Path=/; HttpOnly",
  });
  const redirectHeaders = new Headers({ Location: SIGNUP_REDIRECT });
  vi.doMock("~/lib/better-auth.server", () => ({
    clearBetterAuthMagicLinkConfirmationCookies: () => [] as string[],
    clearBetterAuthMagicLinkStateCookies: () => [] as string[],
    appendHeadersSetCookies: () => {},
    requestHasBetterAuthSessionCookie: () => false,
    verifyBetterAuthMagicLink: vi.fn().mockResolvedValue(
      new Response(null, {
        status: redirectWithoutSession ? 302 : succeeds ? 302 : 400,
        headers: redirectWithoutSession
          ? redirectHeaders
          : succeeds
            ? sessionHeaders
            : new Headers(),
      }),
    ),
    betterAuthResponseHasSessionCookies: () => succeeds && !redirectWithoutSession,
    isBetterAuthMagicLinkFailureRedirect: () => false,
    consumeBetterAuthMagicLinkConfirmationTicket: vi.fn().mockResolvedValue(true),
    appendBetterAuthSetCookieHeaders: () => {},
  }));
}

function watchlist(): WatchlistRecord {
  return {
    id: "watch-1",
    userId: "user-1",
    name: "Glowkart",
    targetType: "advertiser",
    trackingRole: "competitor",
    targetId: "https://glowkart.example",
    targetFingerprint: "fingerprint-1",
    targetLabel: "Glowkart",
    targetCountry: "all",
    isActive: true,
    lastScannedAt: "2026-09-07T10:05:00.000Z",
    createdAt: "2026-09-07T10:00:00.000Z",
    updatedAt: "2026-09-07T10:05:00.000Z",
  };
}

function baselineEvent(): WatchEventRecord {
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
    metadata: { kind: "baseline", sourceUrl: SNAPSHOT, proofCaptureId: "proof-1" },
    confirmedAt: "2026-09-07T10:05:01.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-09-07T10:05:01.000Z",
    createdAt: "2026-09-07T10:05:00.000Z",
  };
}

function filedDigest() {
  return {
    id: "digest-1",
    userId: "user-1",
    periodStart: "2026-09-07T10:00:00.000Z",
    periodEnd: "2026-09-14T10:00:00.000Z",
    createdAt: "2026-09-07T10:05:02.000Z",
    summary: { kind: "first_brief" },
    items: [
      {
        id: "item-1",
        digestRunId: "digest-1",
        watchlistId: "watch-1",
        watchlistName: "Glowkart",
        eventType: "ad_new" as const,
        title: "Baseline captured: 1 active ad",
        summary: "We recorded 1 active ad for Glowkart as your starting point.",
        createdAt: "2026-09-07T10:05:02.000Z",
        metadata: { eventId: "event-1", sourceUrl: SNAPSHOT, proofCaptureId: "proof-1" },
      },
    ],
    delivery: null,
  };
}

function verifiedOwner() {
  return { email: OWNER_ADDRESS, name: "Owner", emailVerified: true };
}

/**
 * Mocks the data + delivery layer so `ensureFirstBriefForWorkspace` files the
 * first brief from a completed activation scan and dispatches the email.
 * Returns the mocks so the test can assert call shapes.
 */
function mockActivationScanBaseline() {
  const createDigestRun = vi.fn().mockResolvedValue({
    digestRunId: "digest-1",
    created: true,
  });
  const getDigest = vi.fn().mockResolvedValue(filedDigest());
  const listDigests = vi.fn().mockResolvedValue([]);
  const listAdsByIds = vi.fn().mockResolvedValue([
    { metaAdId: "ad-1", landingPageUrl: LANDING, adSnapshotUrl: SNAPSHOT },
  ]);
  const deliverWeeklyDigest = vi.fn().mockResolvedValue({
    attempts: 1,
    details: [{ status: "sent" }],
  });

  vi.doMock("~/lib/data.server", () => ({
    listWatchlists: vi.fn().mockResolvedValue([watchlist()]),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
    getUserDeliveryProfile: vi.fn().mockResolvedValue(verifiedOwner()),
    listWatchEventsForRun: vi.fn().mockResolvedValue([baselineEvent()]),
    listObservationsForRun: vi.fn().mockResolvedValue([
      { ad_id: "ad-1", landing_page_url: LANDING },
    ]),
    createDigestRun,
    getDigest,
    listDigests,
    listAdsByIds,
  }));
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWeeklyDigest,
  }));
  vi.doMock("~/lib/cron-failure-alert.server", () => ({
    reportScheduledTaskFailure: vi.fn(),
  }));

  return { deliverWeeklyDigest, createDigestRun };
}

describe("first-brief activation flow (issue #1862)", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("signup completion emits signup_completed", () => {
    it("emits funnel_signup_completed when a signup-mode magic link verifies", async () => {
      mockBetterAuth(true);
      const { completeBetterAuthMagicLinkSignIn } = await import(
        "~/lib/better-auth-magic-link-sign-in.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      // The function always throws a redirect; the funnel event fires first.
      await expect(
        completeBetterAuthMagicLinkSignIn(env, new Request("http://localhost/"), signupConfirmation()),
      ).rejects.toThrow();

      const ops = funnelOperations(logSpy);
      expect(ops).toContain("funnel_signup_completed");
      // Exactly one signup_completed — no duplicate on the success path.
      expect(ops.filter((op) => op === "funnel_signup_completed")).toHaveLength(1);
    });

    it("does NOT emit funnel_signup_completed for a login-mode magic link", async () => {
      mockBetterAuth(true);
      const { completeBetterAuthMagicLinkSignIn } = await import(
        "~/lib/better-auth-magic-link-sign-in.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      await expect(
        completeBetterAuthMagicLinkSignIn(env, new Request("http://localhost/"), loginConfirmation()),
      ).rejects.toThrow();

      expect(funnelOperations(logSpy)).not.toContain("funnel_signup_completed");
    });

    it("does NOT emit signup_completed when verification fails (no session cookies)", async () => {
      mockBetterAuth(false);
      const { completeBetterAuthMagicLinkSignIn } = await import(
        "~/lib/better-auth-magic-link-sign-in.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      // Verification failure redirects to the error page, never reaching the emit.
      await expect(
        completeBetterAuthMagicLinkSignIn(env, new Request("http://localhost/"), signupConfirmation()),
      ).rejects.toThrow();

      expect(funnelOperations(logSpy)).not.toContain("funnel_signup_completed");
    });

    it("does NOT emit signup_completed on a 302 that set no session cookie", async () => {
      // A non-failure redirect that did not establish a session must not
      // count as a completion (the reviewer's session-cookie gate).
      mockBetterAuth(false, true);
      const { completeBetterAuthMagicLinkSignIn } = await import(
        "~/lib/better-auth-magic-link-sign-in.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      await expect(
        completeBetterAuthMagicLinkSignIn(env, new Request("http://localhost/"), signupConfirmation()),
      ).rejects.toThrow();

      expect(funnelOperations(logSpy)).not.toContain("funnel_signup_completed");
    });

    it("emits nothing when FUNNEL_MEASUREMENT_ENABLED is off", async () => {
      mockBetterAuth(true);
      const { completeBetterAuthMagicLinkSignIn } = await import(
        "~/lib/better-auth-magic-link-sign-in.server"
      );
      const env = {} as never;

      await expect(
        completeBetterAuthMagicLinkSignIn(env, new Request("http://localhost/"), signupConfirmation()),
      ).rejects.toThrow();

      expect(funnelOperations(logSpy)).toHaveLength(0);
    });
  });

  describe("first brief generation + email dispatch", () => {
    it("files the first brief, emits first_brief_generated, and sends the email (first_brief_email_sent)", async () => {
      const { deliverWeeklyDigest } = mockActivationScanBaseline();
      const { ensureFirstBriefForWorkspace } = await import(
        "~/lib/first-brief.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      const result = await ensureFirstBriefForWorkspace(env, "user-1");

      // The brief was filed from the activation scan baseline and delivered.
      expect(result.filed).toBe(true);
      expect(result.delivered).toBe(true);
      expect(result.reason).toBe("filed");

      // The email went out on the digest path with the firstBrief flag.
      expect(deliverWeeklyDigest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ firstBrief: true, digestRunId: "digest-1" }),
      );

      const ops = funnelOperations(logSpy);
      expect(ops).toContain("funnel_first_brief_generated");
      expect(ops).toContain("funnel_first_brief_email_sent");
      // Generated fires before the email-sent event in the activation order.
      expect(ops.indexOf("funnel_first_brief_generated")).toBeLessThan(
        ops.indexOf("funnel_first_brief_email_sent"),
      );
    });

    it("does NOT emit first_brief_generated when the brief was already filed (idempotent)", async () => {
      // listDigests returns an existing first-brief digest -> already_filed path.
      vi.doMock("~/lib/data.server", () => ({
        listWatchlists: vi.fn().mockResolvedValue([watchlist()]),
        getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
        getUserDeliveryProfile: vi.fn().mockResolvedValue(verifiedOwner()),
        listWatchEventsForRun: vi.fn().mockResolvedValue([baselineEvent()]),
        listObservationsForRun: vi.fn().mockResolvedValue([
          { ad_id: "ad-1", landing_page_url: LANDING },
        ]),
        createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: false }),
        getDigest: vi.fn().mockResolvedValue(filedDigest()),
        listDigests: vi.fn().mockResolvedValue([filedDigest()]),
        listAdsByIds: vi.fn().mockResolvedValue([
          { metaAdId: "ad-1", landingPageUrl: LANDING, adSnapshotUrl: SNAPSHOT },
        ]),
      }));
      vi.doMock("~/lib/delivery.server", () => ({
        deliverWeeklyDigest: vi.fn().mockResolvedValue({
          attempts: 1,
          details: [{ status: "sent" }],
        }),
      }));
      vi.doMock("~/lib/cron-failure-alert.server", () => ({
        reportScheduledTaskFailure: vi.fn(),
      }));

      const { ensureFirstBriefForWorkspace } = await import(
        "~/lib/first-brief.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      const result = await ensureFirstBriefForWorkspace(env, "user-1");

      // already_filed re-delivers but does not re-emit first_brief_generated.
      expect(result.reason).toBe("already_filed");
      expect(funnelOperations(logSpy)).not.toContain("funnel_first_brief_generated");
    });

    it("does NOT emit first_brief_generated when the scan found no evidence", async () => {
      vi.doMock("~/lib/data.server", () => ({
        listWatchlists: vi.fn().mockResolvedValue([watchlist()]),
        getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
        getUserDeliveryProfile: vi.fn().mockResolvedValue(verifiedOwner()),
        listWatchEventsForRun: vi.fn().mockResolvedValue([
          { ...baselineEvent(), adId: null, proofCaptureId: null, metadata: { kind: "baseline" } },
        ]),
        listObservationsForRun: vi.fn().mockResolvedValue([{ ad_id: null, landing_page_url: null }]),
        createDigestRun: vi.fn(),
        getDigest: vi.fn(),
        listDigests: vi.fn().mockResolvedValue([]),
        listAdsByIds: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock("~/lib/delivery.server", () => ({
        deliverWeeklyDigest: vi.fn(),
      }));
      vi.doMock("~/lib/cron-failure-alert.server", () => ({
        reportScheduledTaskFailure: vi.fn(),
      }));

      const { ensureFirstBriefForWorkspace } = await import(
        "~/lib/first-brief.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;

      const result = await ensureFirstBriefForWorkspace(env, "user-1");

      expect(result.reason).toBe("no_evidence");
      expect(result.filed).toBe(false);
      expect(funnelOperations(logSpy)).not.toContain("funnel_first_brief_generated");
    });
  });

  describe("activation timing guarantees", () => {
    it("holds the on-screen deadline at 5 minutes and the email window at 60 minutes", async () => {
      const {
        ON_SCREEN_DEADLINE_MS,
        DEFAULT_WINDOW_MINUTES,
      } = await import("../scripts/bet7-activation-verification.mjs");
      // The issue's metric: on-screen brief within 5 minutes of signup.
      expect(ON_SCREEN_DEADLINE_MS).toBe(5 * 60 * 1000);
      // The issue's metric: delivered email within 60 minutes.
      expect(DEFAULT_WINDOW_MINUTES).toBe(60);
    });
  });

  describe("full activation funnel event order", () => {
    it("emits signup_completed -> first_brief_generated -> first_brief_email_sent in order", async () => {
      // Step 1: signup completion.
      mockBetterAuth(true);
      const { completeBetterAuthMagicLinkSignIn } = await import(
        "~/lib/better-auth-magic-link-sign-in.server"
      );
      const env = { FUNNEL_MEASUREMENT_ENABLED: "1" } as never;
      await expect(
        completeBetterAuthMagicLinkSignIn(env, new Request("http://localhost/"), signupConfirmation()),
      ).rejects.toThrow();

      // Step 2 + 3: activation scan baseline -> first brief filed + emailed.
      vi.doUnmock("~/lib/better-auth.server");
      mockActivationScanBaseline();
      const { ensureFirstBriefForWorkspace } = await import(
        "~/lib/first-brief.server"
      );
      const filed = await ensureFirstBriefForWorkspace(env, "user-1");
      expect(filed.filed).toBe(true);
      expect(filed.delivered).toBe(true);

      const ops = funnelOperations(logSpy);
      // The activation funnel fires in the issue's order.
      const signupIdx = ops.indexOf("funnel_signup_completed");
      const generatedIdx = ops.indexOf("funnel_first_brief_generated");
      const emailIdx = ops.indexOf("funnel_first_brief_email_sent");
      expect(signupIdx).toBeGreaterThanOrEqual(0);
      expect(generatedIdx).toBeGreaterThan(signupIdx);
      expect(emailIdx).toBeGreaterThan(generatedIdx);
    });
  });
});

/**
 * Issue #2138 — the "activation scan hit a delay" path in the setup-checklist
 * create-watchlist action retries the same safe scan once inline before
 * showing "Try again". A first scan that fails once still delivers the first
 * brief without a click; only a retry that also fails surfaces the message.
 */
describe("activation scan inline retry (issue #2138)", () => {
  const RETRY_ENV = { SIGNUP_FIRST_BRIEF_ENABLED: "1" };

  afterEach(() => {
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/email-verification.server");
    vi.doUnmock("~/lib/monitoring.server");
    vi.doUnmock("~/lib/plan.server");
  });

  async function expectRedirect(callback: () => Promise<unknown>, location: string) {
    try {
      await callback();
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe(location);
      return;
    }
    throw new Error(`Expected redirect to ${location}`);
  }

  function mockCreateWatchlistPath(queueFirstBrief: MockInstance) {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: {
          user: { id: "user-1", email: OWNER_ADDRESS, name: "Owner", onboardedAt: null },
          session: { id: "session-1", userId: "user-1", expiresAt: "2026-09-09T00:00:00.000Z" },
        },
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => RETRY_ENV) }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit: vi.fn().mockResolvedValue({
        status: "created",
        watchlist: watchlist(),
        current: 1,
        limit: 3,
      }),
      upsertWorkspaceBranding: vi.fn().mockResolvedValue({
        brandName: null,
        brandWebsite: null,
      }),
    }));
    vi.doMock("~/lib/email-verification.server", () => ({
      requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
      emailUnverifiedActionResult: () => ({
        ok: false,
        error: "email_unverified",
        message: "Verify your email",
      }),
    }));
    vi.doMock("~/lib/first-watchlist-scan.server", () => ({
      queueFirstWatchlistScan: vi.fn(),
      queueFirstWatchlistScanForSignupFirstBrief: queueFirstBrief,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 3 }),
    }));
    return { completeUserOnboarding };
  }

  function createWatchlistRequest() {
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("website", "https://glowkart.com");
    return new Request("http://localhost/app/onboard", {
      method: "POST",
      body: formData,
    });
  }

  it("retries the activation scan once inline and still reaches the first brief when the retry succeeds", async () => {
    const queueFirstBrief = vi.fn()
      .mockRejectedValueOnce(new Error("dispatch failed"))
      .mockResolvedValueOnce(true);
    const { completeUserOnboarding } = mockCreateWatchlistPath(queueFirstBrief);

    const { handleSetupChecklistAction: action } = await import(
      "~/lib/setup-checklist-action.server"
    );

    // The retried scan succeeded, so the action lands on the same waiting
    // state as a first-attempt success: the first-brief page.
    await expectRedirect(
      () =>
        action({
          context: { cloudflare: { env: RETRY_ENV } },
          request: createWatchlistRequest(),
        } as never),
      "/app/onboard?step=first-brief",
    );

    // Exactly one inline retry — the scan was attempted twice, never more.
    expect(queueFirstBrief).toHaveBeenCalledTimes(2);
    expect(completeUserOnboarding).toHaveBeenCalledWith(RETRY_ENV, "user-1");
  });

  it("returns the delayed message only after the inline retry also fails", async () => {
    const queueFirstBrief = vi.fn().mockRejectedValue(new Error("dispatch failed"));
    const { completeUserOnboarding } = mockCreateWatchlistPath(queueFirstBrief);

    const { handleSetupChecklistAction: action } = await import(
      "~/lib/setup-checklist-action.server"
    );

    const result = await action({
      context: { cloudflare: { env: RETRY_ENV } },
      request: createWatchlistRequest(),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "create-watchlist",
      error: "first_scan_dispatch_delayed",
      message:
        "Competitor saved, but the activation scan hit a delay. Try again to retry the same safe scan.",
    });
    // One retry and no more (must-not: retry more than once).
    expect(queueFirstBrief).toHaveBeenCalledTimes(2);
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("never runs two activation scans for one watchlist concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const queueFirstBrief = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (queueFirstBrief.mock.calls.length === 1) {
          throw new Error("dispatch failed");
        }
        return true;
      } finally {
        inFlight -= 1;
      }
    });
    mockCreateWatchlistPath(queueFirstBrief);

    const { handleSetupChecklistAction: action } = await import(
      "~/lib/setup-checklist-action.server"
    );

    await expectRedirect(
      () =>
        action({
          context: { cloudflare: { env: RETRY_ENV } },
          request: createWatchlistRequest(),
        } as never),
      "/app/onboard?step=first-brief",
    );

    expect(queueFirstBrief).toHaveBeenCalledTimes(2);
    // The retry started only after the first attempt fully settled.
    expect(maxInFlight).toBe(1);
    // Both attempts are the same guarded queue call for the same watchlist,
    // so the existing in-flight check in prepareFirstWatchlistScanRun keeps
    // serializing them against any other scan of that watchlist.
    expect(queueFirstBrief.mock.calls[1]?.[2]).toBe(queueFirstBrief.mock.calls[0]?.[2]);
  });
});
