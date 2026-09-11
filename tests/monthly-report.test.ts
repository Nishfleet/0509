import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMonthlyReportEmail,
  monthlyReportResourceId,
  utcMonthKey,
} from "~/lib/delivery.server";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("monthly report idempotency key", () => {
  it("keys the UTC month, not the local month", () => {
    // 2026-09-30T23:30Z is October in IST but still September in UTC.
    expect(utcMonthKey(new Date("2026-09-30T23:30:00.000Z"))).toBe("2026-09");
    expect(utcMonthKey(new Date("2026-09-01T00:00:00.000Z"))).toBe("2026-09");
    expect(utcMonthKey(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12");
    expect(utcMonthKey(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01");
  });

  it("namespaces the report resource id by month", () => {
    expect(monthlyReportResourceId("2026-09")).toBe("report-monthly:2026-09");
    // Distinct months must never collide, or the second month is skipped.
    expect(monthlyReportResourceId("2026-09")).not.toBe(
      monthlyReportResourceId("2026-10"),
    );
  });
});

describe("buildMonthlyReportEmail", () => {
  const base = {
    name: "Owner",
    monthLabel: "September 2026",
    reportTitle: "Nykaa watch",
    changeCount: 7,
    shareUrl: "https://0509.io/share/tok123",
  };

  it("carries the report link and the month, not internal labels", () => {
    const model = buildMonthlyReportEmail(base);
    expect(model.subject).toContain("September 2026");
    expect(model.subject).toContain("7 changes");
    expect(model.html).toContain("https://0509.io/share/tok123");
    expect(model.html).toContain("September 2026");
    expect(model.text).toContain("https://0509.io/share/tok123");
    // Customer-information-architecture rule: no internal implementation
    // labels as customer proof.
    expect(model.html).not.toContain("digest_run");
    expect(model.html).not.toContain("watchlist_id");
  });

  it("singularises a one-change month", () => {
    const model = buildMonthlyReportEmail({ ...base, changeCount: 1 });
    expect(model.subject).toContain("1 change");
    expect(model.subject).not.toContain("1 changes");
  });

  it("escapes a user-supplied name, never emitting raw markup", () => {
    const model = buildMonthlyReportEmail({
      ...base,
      name: '<img src=x onerror=alert(1)>',
    });
    expect(model.html).not.toContain("<img src=x");
    // Escaped entities are inert: the tag delimiters never survive as markup.
    expect(model.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

/**
 * The acceptance bullet is "a monthly report exists with zero clicks", gated on
 * "build only when no report row exists for the current UTC month". These are
 * the real gates: population, idempotency, and the send path.
 */
/**
 * The acceptance bullet is "reuse report-builder.server.ts + the report
 * snapshot". The suite above mocks both, so this block exercises the REAL
 * builder and the REAL approval snapshot together: a filed report must be a
 * payload the share view actually accepts (`isApprovedReportSnapshot`).
 */
describe("monthly report snapshot reuse (real builder, not mocked)", () => {
  it("produces a payload the share view accepts as an approved snapshot", async () => {
    const { buildWatchlistReport } = await import("~/lib/report-builder.server");
    const { createApprovedReportSnapshot, isApprovedReportSnapshot } = await import(
      "~/lib/report-approval"
    );

    const watchlist = {
      id: "watch-1",
      name: "Nykaa watch",
      targetType: "competitor",
      targetLabel: "Nykaa",
      isActive: true,
      createdAt: "2026-09-01T00:00:00.000Z",
    } as never;
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      eventType: "new_ad",
      title: "New ad detected",
      summary: "A new ad entered Nykaa watch.",
      adId: "meta-1",
      metadata: {},
      // A linked succeeded proof capture is what classifies the event as
      // client-report eligible, and therefore what makes the report approvable.
      proofCaptureId: "proof-1",
      status: "confirmed",
      suppressedAt: null,
      invalidatedAt: null,
      createdAt: "2026-09-10T00:00:00.000Z",
    } as never;
    // A succeeded proof capture is what makes a row "Verified evidence" and so
    // what makes the report approvable for sharing.
    const proof = {
      id: "proof-1",
      status: "succeeded",
      attemptedAt: "2026-09-10T00:00:01.000Z",
      succeededAt: "2026-09-10T00:00:02.000Z",
      failureCode: null,
      extractedFields: { canonicalUrl: "https://nykaa.example.com/offer" },
      captureMetadata: { captureMethod: "browser_render" },
    } as never;

    const report = buildWatchlistReport({
      watchlist,
      events: [event],
      adsById: new Map(),
      proofCapturesByEventId: new Map([["event-1", proof]]),
      generatedAt: "2026-10-05T00:00:00.000Z",
    });
    // The same re-keying the manual share action performs.
    const snapshot = createApprovedReportSnapshot({
      ...(JSON.parse(JSON.stringify(report)) as typeof report),
      reportId: "shared-report",
      resourceId: "shared",
    });

    expect(report.rows.length).toBeGreaterThan(0);
    expect(snapshot).not.toBeNull();
    // The real approval check, not a mock: the filed payload is shareable.
    expect(isApprovedReportSnapshot(snapshot)).toBe(true);
  });
});

describe("sendMonthlyReports", () => {
  const scheduledTime = Date.parse("2026-10-05T05:00:00.000Z");
  const MONTH = "2026-10";

  function mockDelivery(overrides: {
    sendCloudflareEmail?: ReturnType<typeof vi.fn>;
    existingShare?: boolean;
    filesReport?: boolean;
    createShareLink?: ReturnType<typeof vi.fn>;
    /**
     * Live-plan re-check. Registered exactly once per test: stacking a second
     * `vi.doMock("~/lib/plan.server")` on top of this one raced the first
     * registration under merge-queue load (2026-09-11 10:34Z/10:47Z/10:50Z)
     * and a Free workspace was filed as paid (#2928).
     */
    getUserPlan?: ReturnType<typeof vi.fn>;
  } = {}) {
    const sendCloudflareEmail = overrides.sendCloudflareEmail ?? vi.fn().mockResolvedValue({
      provider: "cloudflare",
      status: "sent",
      webhookStatus: "provider_unknown",
      providerMessageId: "msg-1",
      providerStatusLastSeenAt: "2026-10-05T05:00:02.000Z",
      errorMessage: null,
      deliveredAt: null,
    });
    const claimInstantDeliveryAttempt = vi.fn().mockResolvedValue({
      attemptId: "attempt-1",
      claimUpdatedAt: "2026-10-05T05:00:00.000Z",
    });
    const createShareLink =
      overrides.createShareLink ??
      vi.fn().mockResolvedValue({
        id: "share-1",
        token: "tok123",
        expiresAt: null,
      });

    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified: vi.fn().mockResolvedValue(true),
    }));
    // delivery.server.ts imports the delivery-attempt claim path from here,
    // not from ~/lib/data.server, so the claim mock must land on this module.
    vi.doMock("~/lib/data/delivery-records-attempts.server", () => ({
      claimInstantDeliveryAttempt,
      markInstantDeliveryDispatchStarted: vi
        .fn()
        .mockResolvedValue("2026-10-05T05:00:01.000Z"),
    }));
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe/token"),
    }));
    vi.doMock("~/lib/delivery-email-core.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/delivery-email-core.server")>()),
      EMAIL_PROVIDER: "cloudflare",
      appBaseUrl: () => "https://0509.io",
      providerAcceptedAt: () => "2026-10-05T05:00:02.000Z",
      sendCloudflareEmail,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: overrides.getUserPlan ?? vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/report-builder.server", () => ({
      buildWatchlistReport: vi.fn().mockReturnValue({
        kind: "report",
        reportId: "watchlist:w1",
        resourceType: "watchlist",
        resourceId: "w1",
        title: "Nykaa watch",
        subtitle: "competitor · Nykaa",
        summary: "1 verified-evidence watch event.",
        generatedAt: "2026-10-05T05:00:00.000Z",
        stats: [],
        rows: [{ id: "row-1" }],
      }),
    }));
    vi.doMock("~/lib/report-approval", () => ({
      createApprovedReportSnapshot: vi.fn().mockReturnValue({
        reportId: "shared-report",
        resourceId: "shared",
        rows: [{ id: "row-1" }],
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimInstantDeliveryAttempt,
      markInstantDeliveryDispatchStarted: vi
        .fn()
        .mockResolvedValue("2026-10-05T05:00:01.000Z"),
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        email: "owner@example.com",
        name: "Owner",
      }),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({ emailEnabled: true }),
      createShareLink,
      getShareLinkById: vi.fn().mockResolvedValue(
        overrides.existingShare
          ? { resourceType: "report", resourceId: monthlyReportResourceId(MONTH), token: "existing-token" }
          : null,
      ),
      listWatchlists: vi.fn().mockResolvedValue([
        { id: "w1", name: "Nykaa watch", isActive: true },
      ]),
      listWatchEvents: vi
        .fn()
        .mockResolvedValue(
          overrides.filesReport === false ? [] : [{ id: "e1", adId: "ad-1" }],
        ),
      listAdsByIds: vi.fn().mockResolvedValue([{ metaAdId: "ad-1" }]),
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
      // resolveDigestEmailTargets reads the targets table; the real
      // verification/opt-out gate is exercised by the recap suite.
      listDeliveryTargets: vi.fn().mockResolvedValue([
        {
          id: "target-1",
          userId: "user-1",
          channel: "email",
          targetValue: "owner@example.com",
          validationStatus: "validated",
          isValidated: true,
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          optInSource: "account_email",
          metadata: {},
        },
      ]),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: vi.fn().mockResolvedValue(null),
      upsertDeliveryTarget: vi.fn().mockResolvedValue(null),
    }));

    return {
      sendCloudflareEmail,
      claimInstantDeliveryAttempt,
      createShareLink,
    };
  }

  it("files one monthly report for a paid workspace and emails the share link", async () => {
    const { sendCloudflareEmail, claimInstantDeliveryAttempt, createShareLink } =
      mockDelivery();

    // Paid population, excluding Free in the same query.
    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-1", email: "owner@example.com", name: "Owner", plan: "starter" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
      ensureDb: vi.fn().mockReturnValue(null),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result).toMatchObject({ attempted: 1, filed: 1, duplicates: 0, failed: 0 });
    expect(createShareLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        resourceType: "report",
        resourceId: monthlyReportResourceId(MONTH),
        isSnapshot: true,
      }),
    );
    expect(claimInstantDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `monthly_report:user-1:${MONTH}`,
        templateName: "monthly_report",
      }),
    );
    expect(sendCloudflareEmail).toHaveBeenCalledTimes(1);
    expect(sendCloudflareEmail.mock.calls[0]?.[1]).toMatchObject({
      to: "owner@example.com",
      unsubscribeUrl: "https://0509.io/unsubscribe/token",
    });
    expect(String(sendCloudflareEmail.mock.calls[0]?.[1]?.text)).toContain(
      "https://0509.io/share/tok123",
    );
  });

  it("skips the whole month when a report share already exists (weekly cron fires 4-5x)", async () => {
    const { sendCloudflareEmail, createShareLink } = mockDelivery({ existingShare: true });

    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-1", email: "owner@example.com", name: "Owner", plan: "starter" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 1 }),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result).toMatchObject({ attempted: 1, filed: 0, duplicates: 1 });
    expect(sendCloudflareEmail).not.toHaveBeenCalled();
    // The gate runs before any build or share mint.
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("treats a Free workspace as nothing to do, and reports it as skipped", async () => {
    const { sendCloudflareEmail } = mockDelivery({
      getUserPlan: vi.fn().mockResolvedValue("free"),
    });

    vi.doMock("~/lib/data/d1.server", () => ({
      // The list query already excludes Free; this asserts the live-plan
      // re-check also refuses it if the catalog drifts.
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-1", email: "free@example.com", name: "Free", plan: "free" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result).toMatchObject({ attempted: 1, filed: 0, skipped: 1, failed: 0 });
    expect(sendCloudflareEmail).not.toHaveBeenCalled();
  });

  it("files nothing when the workspace has no eligible evidence", async () => {
    const { sendCloudflareEmail, claimInstantDeliveryAttempt } = mockDelivery({
      filesReport: false,
    });

    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-1", email: "owner@example.com", name: "Owner", plan: "starter" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
      ensureDb: vi.fn().mockReturnValue(null),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result).toMatchObject({ attempted: 1, filed: 0, skipped: 1, failed: 0 });
    expect(claimInstantDeliveryAttempt).not.toHaveBeenCalled();
    expect(sendCloudflareEmail).not.toHaveBeenCalled();
  });

  it("re-mints a fresh link when the month's deterministic row is dead", async () => {
    // createShareLink with an explicit id rejects a revoked/expired row as
    // share_link_inactive. The deterministic id must not make the month
    // permanently unfileable, so the job mints under a fresh id instead.
    const deadRowMint = vi
      .fn()
      .mockRejectedValueOnce(new Error("share_link_inactive"))
      .mockResolvedValueOnce({ id: "share-2", token: "tok-fresh", expiresAt: null });
    const { sendCloudflareEmail } = mockDelivery({
      createShareLink: deadRowMint,
    });

    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-1", email: "owner@example.com", name: "Owner", plan: "starter" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
      ensureDb: vi.fn().mockReturnValue(null),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result).toMatchObject({ filed: 1, failed: 0 });
    // First attempt pinned to the deterministic id; the recovery attempt is
    // unpinned so the dead row cannot block the month forever.
    expect(deadRowMint).toHaveBeenCalledTimes(2);
    expect(deadRowMint.mock.calls[0]?.[2]).toMatchObject({
      id: `${monthlyReportResourceId(MONTH)}:user-1`,
    });
    expect(deadRowMint.mock.calls[1]?.[2]).not.toHaveProperty("id");
    expect(sendCloudflareEmail).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the live plan read throws, rather than mailing a possibly-Free workspace", async () => {
    const { sendCloudflareEmail } = mockDelivery({
      getUserPlan: vi.fn().mockRejectedValue(new Error("d1 transient")),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        // A cancelled-but-still-'starter' row: the list query keeps it, so the
        // live re-read is the only thing that can exclude it.
        { user_id: "user-1", email: "owner@example.com", name: "Owner", plan: "starter" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    // Not filed, and counted as a failure so the operator sees it.
    expect(result).toMatchObject({ attempted: 1, filed: 0, skipped: 0, failed: 1 });
    expect(sendCloudflareEmail).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("excludes a workspace whose live plan has lapsed to free", async () => {
    const { sendCloudflareEmail } = mockDelivery({
      getUserPlan: vi.fn().mockResolvedValue("free"),
    });

    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-1", email: "owner@example.com", name: "Owner", plan: "starter" },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result).toMatchObject({ attempted: 1, filed: 0, skipped: 1, failed: 0 });
    expect(sendCloudflareEmail).not.toHaveBeenCalled();
  });

  it("does no work without a database binding", async () => {
    mockDelivery();
    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({} as never, { scheduledTime });
    expect(result).toMatchObject({ attempted: 0, filed: 0, failed: 0 });
  });

  it("counts one bad workspace as failed without stopping the run", async () => {
    const { sendCloudflareEmail } = mockDelivery();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        { user_id: "user-bad", email: "bad@example.com", name: null, plan: "starter" },
        { user_id: "user-good", email: "good@example.com", name: null, plan: "starter" },
      ]),
      queryOne: vi.fn().mockImplementation(async (_env: unknown, sql: string) => {
        // First workspace's gate read throws; the second must still be filed.
        if (sql.includes("share_link")) {
          throw new Error("d1 transient");
        }
        return { count: 0 };
      }),
    }));

    const { sendMonthlyReports } = await import("~/lib/delivery.server");
    const result = await sendMonthlyReports({ DB: {} } as never, { scheduledTime });

    expect(result.failed).toBe(2);
    expect(consoleError).toHaveBeenCalled();
    void sendCloudflareEmail;
  });
});
