import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createShareLink,
  deactivateWatchlistsBeyondPlanLimit,
  getShareLinkById,
  getShareLink,
  listActiveShareLinks,
  revokeShareLink,
  SHARE_LINK_DEFAULT_TTL_DAYS,
} from "~/lib/data.server";
import { prepareAtomicShareLinkInsert } from "~/lib/data/shares.server";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
} as never;

function createCapturingDb(rows: unknown[] = [], changes = 1) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes } };
              },
              async all<T>() {
                return { results: rows as T[] };
              },
            };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/env.server");
  vi.doUnmock("~/lib/report-approval");
  vi.doUnmock("react-router");
});

describe("share link persistence", () => {
  it("prepares owner-scoped audited inserts for atomic agent shares", () => {
    const mock = createCapturingDb();
    const statement = prepareAtomicShareLinkInsert(mock.db as never, {
      auditId: "audit-1",
      userId: "user-1",
      actionName: "share.create",
      idempotencyKey: "share-1",
      requestFingerprint: "fp-1",
      resourceType: "collection",
      resourceId: "collection-1",
      ownerResourceType: "collection",
      isSnapshot: false,
      shareId: "link-1",
      token: "token-1",
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-10-13T00:00:00.000Z",
    });

    expect(statement).toBeTruthy();
    expect(mock.statements[0]?.sql).toContain("FROM agent_action_audit");
    expect(mock.statements[0]?.sql).toContain("status = 'started'");
    expect(mock.statements[0]?.sql).toContain(
      "json_extract(metadata_json, '$.requestFingerprint') = ?",
    );
    expect(mock.statements[0]?.sql).toContain("FROM collection");
    expect(mock.statements[0]?.bindings).toContain("audit-1");
    expect(mock.statements[0]?.bindings).toContain("fp-1");
  });

  it("stamps new share links with the default 90-day expiry", async () => {
    const mock = createCapturingDb();
    const before = Date.now();

    const share = await createShareLink({ DB: mock.db } as never, session, {
      resourceType: "collection",
      resourceId: "collection-1",
      isSnapshot: false,
    });

    expect(share.expiresAt).toBeTruthy();
    const expiresMs = new Date(share.expiresAt!).getTime() - before;
    const expectedMs = SHARE_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(60 * 1000);

    const insert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO share_link"),
    );
    expect(insert?.sql).toContain("expires_at");
    expect(insert?.bindings).toContain(share.expiresAt);
  });

  it("uses INSERT OR IGNORE plus owner-scoped active readback for deterministic publication ids", async () => {
    const mock = createCapturingDb([
      {
        id: "report-share-id",
        token: "opaque-token",
        user_id: "user-1",
        resource_type: "report",
        resource_id: "collection:collection-1",
        is_snapshot: 1,
        snapshot_payload_json: JSON.stringify({ reviewState: "approved" }),
        created_at: "2026-07-15T00:00:00.000Z",
        expires_at: "2099-07-15T00:00:00.000Z",
        revoked_at: null,
      },
    ]);

    const share = await createShareLink({ DB: mock.db } as never, session, {
      id: "report-share-id",
      resourceType: "report",
      resourceId: "collection:collection-1",
      isSnapshot: true,
      snapshotPayload: { reviewState: "approved" },
    });

    expect(share).toMatchObject({
      id: "report-share-id",
      token: "opaque-token",
    });
    const insert = mock.statements.find((statement) =>
      statement.sql.includes("share_link"),
    );
    expect(insert?.sql).toContain("INSERT OR IGNORE INTO share_link");
    const readback = mock.statements.find(
      (statement) =>
        statement.sql.includes("SELECT *") &&
        statement.sql.includes("user_id = ?"),
    );
    expect(readback?.bindings.slice(0, 2)).toEqual([
      "report-share-id",
      "user-1",
    ]);
  });

  it("fails closed when a deterministic publication id is already revoked or expired", async () => {
    const mock = createCapturingDb([]);

    await expect(
      createShareLink({ DB: mock.db } as never, session, {
        id: "revoked-report-share",
        resourceType: "report",
        resourceId: "collection:collection-1",
        isSnapshot: true,
      }),
    ).rejects.toThrow("share_link_inactive");
    expect(
      mock.statements.some((statement) =>
        statement.sql.includes("INSERT OR IGNORE INTO share_link"),
      ),
    ).toBe(true);
  });

  it("only resolves tokens that are unrevoked and unexpired", async () => {
    const mock = createCapturingDb([]);

    const result = await getShareLink({ DB: mock.db } as never, "token-1");

    expect(result).toBeNull();
    const select = mock.statements.find((statement) =>
      statement.sql.includes("FROM share_link"),
    );
    expect(select?.sql).toContain("revoked_at IS NULL");
    expect(select?.sql).toContain("expires_at IS NULL OR expires_at >");
    expect(select?.bindings[0]).toBe("token-1");
  });

  it("treats legacy NULL expiry as still valid", async () => {
    const mock = createCapturingDb([
      {
        id: "share-1",
        token: "token-1",
        user_id: "user-1",
        resource_type: "watchlist",
        resource_id: "watch-1",
        is_snapshot: 0,
        snapshot_payload_json: null,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: null,
        revoked_at: null,
      },
    ]);

    const result = await getShareLink({ DB: mock.db } as never, "token-1");

    expect(result).toMatchObject({
      id: "share-1",
      expiresAt: null,
      revokedAt: null,
    });
  });

  it("loads an active share link by owner and id for idempotent replay", async () => {
    const mock = createCapturingDb([
      {
        id: "share-1",
        token: "token-1",
        user_id: "user-1",
        resource_type: "collection",
        resource_id: "collection-1",
        is_snapshot: 0,
        snapshot_payload_json: null,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-09-19T00:00:00.000Z",
        revoked_at: null,
      },
    ]);

    const result = await getShareLinkById(
      { DB: mock.db } as never,
      "user-1",
      "share-1",
    );

    expect(result).toMatchObject({
      id: "share-1",
      token: "token-1",
      userId: "user-1",
      resourceType: "collection",
    });
    const select = mock.statements.find((statement) =>
      statement.sql.includes("FROM share_link"),
    );
    expect(select?.sql).toContain("id = ?");
    expect(select?.sql).toContain("user_id = ?");
    expect(select?.sql).toContain("revoked_at IS NULL");
    expect(select?.bindings.slice(0, 2)).toEqual(["share-1", "user-1"]);
  });

  it("revokes only the owner's link and reports whether anything changed", async () => {
    const mock = createCapturingDb([], 1);

    const revoked = await revokeShareLink(
      { DB: mock.db } as never,
      "user-1",
      "share-1",
    );

    expect(revoked).toBe(true);
    const update = mock.statements.find((statement) =>
      statement.sql.includes("UPDATE share_link"),
    );
    expect(update?.sql).toContain("AND user_id = ?");
    expect(update?.sql).toContain("revoked_at IS NULL");
    expect(update?.bindings.slice(1)).toEqual(["share-1", "user-1"]);

    const noChange = createCapturingDb([], 0);
    expect(
      await revokeShareLink({ DB: noChange.db } as never, "user-2", "share-1"),
    ).toBe(false);
  });

  it("lists only the user's active links", async () => {
    const mock = createCapturingDb([]);

    await listActiveShareLinks({ DB: mock.db } as never, "user-1");

    const select = mock.statements.find((statement) =>
      statement.sql.includes("FROM share_link"),
    );
    expect(select?.sql).toContain("WHERE user_id = ?");
    expect(select?.sql).toContain("revoked_at IS NULL");
    expect(select?.bindings[0]).toBe("user-1");
  });
});

describe("/share/:token route", () => {
  it("sanitizes legacy raw digest snapshot payloads before returning loader data", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      resolveWorkspaceBrandIdentity: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getCollection: vi.fn(),
      getDigest: vi.fn(),
      getShareLink: vi.fn().mockResolvedValue({
        id: "share-1",
        token: "token-1",
        userId: "user-1",
        resourceType: "digest",
        resourceId: "digest-internal-1",
        isSnapshot: true,
        snapshotPayload: {
          id: "digest-internal-1",
          userId: "user-1",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-06-08T00:00:00.000Z",
          createdAt: "2026-06-08T01:00:00.000Z",
          delivery: {
            recipientEmail: "owner@example.com",
            externalMessageId: "provider-msg-1",
            errorMessage: "provider payload should not render",
          },
          items: [
            {
              id: "digest-item-internal-1",
              digestRunId: "digest-run-1",
              watchlistId: "watch-1",
              watchlistName: "Competitor",
              eventType: "ad_new",
              title: "New offer spotted",
              summary: "Competitor launched a new offer.",
              createdAt: "2026-06-07T12:00:00.000Z",
              metadata: {
                priorityScore: 91,
                recommendedAction: "Review the landing page",
                sourceStatus: "proof_backed",
                proofCaptureId: "proof-capture-internal-1",
                recipientEmail: "owner@example.com",
                externalMessageId: "provider-msg-1",
                rawProviderPayload: { secret: true },
              },
            },
          ],
        },
        createdAt: "2026-06-08T01:00:00.000Z",
        expiresAt: null,
        revokedAt: null,
      }),
      getWatchlist: vi.fn(),
      listCollectionItems: vi.fn(),
      listWatchEvents: vi.fn(),
    }));

    const { loader } = await import("~/routes/share.$token");
    const result = await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never);
    const payload = (result as unknown as { payload: Record<string, unknown> })
      .payload;
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      kind: "digest_share_snapshot",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      items: [
        expect.objectContaining({
          id: "item-1",
          proofStatus: "verified_proof",
          proofStatusLabel: "Verified evidence",
          sourceTypeLabel: "Saved evidence",
        }),
      ],
    });
    expect(serialized).toContain("Review the landing page");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("provider-msg-1");
    expect(serialized).not.toContain("digest-internal-1");
    expect(serialized).not.toContain("digest-item-internal-1");
    expect(serialized).not.toContain("digest-run-1");
    expect(serialized).not.toContain("watch-1");
    expect(serialized).not.toContain("proof-capture-internal-1");
    expect(serialized).not.toContain("rawProviderPayload");
  });

  it("rejects legacy report snapshots that were never explicitly approved", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      resolveWorkspaceBrandIdentity: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getCollection: vi.fn(),
      getDigest: vi.fn(),
      getShareLink: vi.fn().mockResolvedValue({
        id: "share-1",
        token: "token-1",
        userId: "user-1",
        resourceType: "report",
        resourceId: "watch-internal-1",
        isSnapshot: true,
        snapshotPayload: {
          kind: "report",
          reportId: "watchlist:watch-internal-1",
          resourceType: "watchlist",
          resourceId: "watch-internal-1",
          title: "Proof report",
          subtitle: "Latest verified moves",
          summary: "One move included.",
          generatedAt: "2026-06-08T01:00:00.000Z",
          aiWeeklySummary: {
            paragraph:
              "Competitors concentrated this week's movement on promotional offers.",
            generatedAt: "2026-06-08T01:05:00.000Z",
            periodEnd: "2026-06-08T01:00:00.000Z",
            strategyWatchlistIds: ["watch-internal-1"],
            ownerId: "owner-secret",
          },
          ownerId: "owner-secret",
          recipientEmail: "owner@example.com",
          externalMessageId: "provider-msg-1",
          delivery: { recipientEmail: "owner@example.com" },
          rawProviderPayload: { id: "provider-msg-1" },
          stats: [{ label: "Moves", value: "1", secret: "stat-secret" }],
          insightDepth: {
            topHooks: [
              {
                label: "Offer",
                count: 1,
                detail: "Discount",
                ownerId: "owner-secret",
              },
            ],
            mediaMix: [],
            campaignDurations: [],
            metricProof: [],
            creativeTimeline: [
              {
                label: "Launch",
                detail: "New offer",
                timestamp: "2026-06-08T01:00:00.000Z",
                secret: "timeline-secret",
              },
            ],
            landingPageHistory: [],
            rawMetadata: { ownerId: "owner-secret" },
          },
          sourceCoverage: {
            totalInput: 2,
            included: 1,
            excluded: 1,
            note: "1 proof-backed event included.",
            proofMix: {
              verifiedProof: 1,
              scanSpotted: 0,
              needsReview: 0,
              proofPending: 0,
              proofFailed: 0,
              excluded: 1,
              unknown: 0,
              ownerId: "owner-secret",
            },
            excludedCounts: {
              proof_pending: 1,
              "owner-secret": 99,
            },
          },
          rows: [
            {
              id: "watch-event-internal-1",
              advertiser: "Competitor",
              previewHeadline: "New offer",
              offer: "20% off",
              cta: "Shop now",
              formatLabel: "Image",
              languageLabel: "English",
              previewImageUrl: null,
              creativeText: "Creative",
              translatedText: "Creative",
              landingPage: {
                url: "",
                headline: "",
                captureLabel: "",
                capturedAt: null,
                signals: [
                  {
                    label: "CTA",
                    value: "Shop now",
                    sourceLabel: "Landing page",
                    rawProviderPayload: "provider-msg-1",
                  },
                ],
                secret: "landing-secret",
              },
              analysisFields: [
                {
                  label: "Offer",
                  value: "20% off",
                  rawMetadata: "provider-msg-1",
                },
              ],
              tags: ["discount"],
              note: null,
              ownerId: "owner-secret",
              rawMetadata: { providerMessageId: "provider-msg-1" },
              event: {
                typeLabel: "Offer",
                title: "New offer",
                summary: "A new offer launched.",
                createdAt: "2026-06-08T01:00:00.000Z",
                priorityScore: 82,
                priorityBand: "high",
                recommendedAction: "Review",
                proofTrail: "Evidence capture",
                proofStatusLabel: "Verified evidence",
                sourceTypeLabel: "Saved evidence",
                sourceUrl: "javascript:alert(1)",
                metaAdId: null,
                delivery: { recipientEmail: "owner@example.com" },
              },
            },
          ],
        },
        createdAt: "2026-06-08T01:00:00.000Z",
        expiresAt: null,
        revokedAt: null,
      }),
      getWatchlist: vi.fn(),
      listCollectionItems: vi.fn(),
      listWatchEvents: vi.fn(),
    }));

    const { loader } = await import("~/routes/share.$token");
    const result = await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never);
    const payload = (
      result as unknown as { payload: Record<string, unknown> | null }
    ).payload;

    expect(payload).toBeNull();
    expect(
      (result as unknown as { pdfPath: string | null }).pdfPath,
    ).toBeNull();
  });

  it("rejects legacy watchlist report snapshots that lack proof eligibility metadata", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      resolveWorkspaceBrandIdentity: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getCollection: vi.fn(),
      getDigest: vi.fn(),
      getShareLink: vi.fn().mockResolvedValue({
        id: "share-1",
        token: "token-1",
        userId: "user-1",
        resourceType: "report",
        resourceId: "watch-internal-1",
        isSnapshot: true,
        snapshotPayload: {
          kind: "report",
          reportId: "watchlist:watch-internal-1",
          resourceType: "watchlist",
          resourceId: "watch-internal-1",
          title: "Legacy report",
          rows: [
            {
              id: "watch-event-internal-1",
              advertiser: "Suppressed competitor",
              previewHeadline: "Suppressed move",
              offer: "",
              cta: "",
              formatLabel: "",
              languageLabel: "",
              previewImageUrl: null,
              creativeText: "",
              translatedText: "",
              landingPage: {
                url: "",
                headline: "",
                captureLabel: "",
                capturedAt: null,
                signals: [],
              },
              analysisFields: [],
              tags: [],
              note: null,
              rawMetadata: { status: "suppressed" },
            },
          ],
        },
        createdAt: "2026-06-08T01:00:00.000Z",
        expiresAt: null,
        revokedAt: null,
      }),
      getWatchlist: vi.fn(),
      listCollectionItems: vi.fn(),
      listWatchEvents: vi.fn(),
    }));

    const { loader } = await import("~/routes/share.$token");
    const result = await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never);

    expect((result as unknown as { payload: unknown }).payload).toBeNull();
    expect(JSON.stringify(result)).not.toContain("watch-event-internal-1");
  });

  it("does not render raw JSON for unsupported snapshot payloads", async () => {
    vi.doMock("react-router", async () => {
      const actual =
        await vi.importActual<typeof import("react-router")>("react-router");
      return {
        ...actual,
        Link: ({
          children,
          to,
          ...props
        }: {
          children: ReactNode;
          to: string;
        }) => createElement("a", { href: to, ...props }, children),
        useLoaderData: vi.fn().mockReturnValue({
          mode: "snapshot",
          resourceType: "digest",
          preparedBy: null,
          payload: {
            recipientEmail: "owner@example.com",
            externalMessageId: "provider-msg-1",
            errorMessage: "provider payload should not render",
          },
        }),
      };
    });

    const { default: ShareRoute } = await import("~/routes/share.$token");
    const markup = renderToStaticMarkup(createElement(ShareRoute));

    expect(markup).toContain("Snapshot unavailable");
    expect(markup).toContain("create a fresh share link");
    expect(markup).not.toContain("owner@example.com");
    expect(markup).not.toContain("provider-msg-1");
    expect(markup).not.toContain("externalMessageId");
  });
});

describe("deactivateWatchlistsBeyondPlanLimit", () => {
  it("pauses everything past the new plan's limit, keeping the newest active", async () => {
    const mock = createCapturingDb([], 4);

    const changed = await deactivateWatchlistsBeyondPlanLimit(
      { DB: mock.db } as never,
      "user-1",
      3,
    );

    expect(changed).toBe(4);
    const update = mock.statements.find((statement) =>
      statement.sql.includes("UPDATE watchlist"),
    );
    expect(update?.sql).toContain("SET is_active = 0");
    expect(update?.sql).toContain("ORDER BY created_at DESC");
    expect(update?.sql).toContain("LIMIT ?");
    expect(update?.bindings.slice(1)).toEqual(["user-1", "user-1", 3]);
  });

  it("keeps the newest watchlist when downgrading to free's single slot", async () => {
    const mock = createCapturingDb([], 2);

    const changed = await deactivateWatchlistsBeyondPlanLimit(
      { DB: mock.db } as never,
      "user-1",
      1,
    );

    expect(changed).toBe(2);
    const update = mock.statements.find((statement) =>
      statement.sql.includes("UPDATE watchlist"),
    );
    expect(update?.bindings.slice(1)).toEqual(["user-1", "user-1", 1]);
  });
});

describe("/app/shares route", () => {
  it("names the route as shared-link administration, not the Reports index", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: to }, children),
        useActionData: vi.fn().mockReturnValue(undefined),
        useLoaderData: vi.fn().mockReturnValue({ shares: [] }),
      };
    });
    const { default: SharesRoute, meta } = await import("~/routes/app.shares");
    const markup = renderToStaticMarkup(createElement(SharesRoute));

    expect(meta()).toEqual([{ title: "Shared links | Five to Nine" }]);
    expect(markup).toContain("Shared links");
    expect(markup).toContain("No active share links");
    // WP-A3.1: the empty state points at the real prerequisite (Competitors),
    // not the Agency-paywalled Reports index; no header cross-nav action.
    expect(markup).toContain('href="/app/watchlists"');
    expect(markup).not.toContain('href="/app/reports"');
    expect(markup).not.toContain("Reports &amp; shared links");
  });

  it("lists active share links with absolute URLs", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/env.server", () => ({
      appOrigin: vi.fn(() => "https://0509.io"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listActiveShareLinks: vi.fn().mockResolvedValue([
        {
          id: "share-1",
          token: "token-abc",
          userId: "user-1",
          resourceType: "collection",
          resourceId: "collection-1",
          isSnapshot: true,
          snapshotPayload: null,
          createdAt: "2026-06-01T00:00:00.000Z",
          expiresAt: "2026-09-01T00:00:00.000Z",
          revokedAt: null,
        },
      ]),
      revokeShareLink: vi.fn(),
    }));

    const { loader } = await import("~/routes/app.shares");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/shares"),
      params: {},
    } as never);

    expect(result.shares).toEqual([
      {
        id: "share-1",
        url: "https://0509.io/share/token-abc",
        resourceLabel: "Collection",
        mode: "Snapshot",
        state: "Snapshot",
        createdAt: "2026-06-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  it("withholds an expired report approval and points the owner to re-review", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/env.server", () => ({ appOrigin: vi.fn(() => "https://0509.io") }));
    vi.doMock("~/lib/report-approval", () => ({
      isApprovedReportSnapshot: vi.fn(() => false),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listActiveShareLinks: vi.fn().mockResolvedValue([
        {
          id: "report-share-expired",
          token: "expired-token",
          userId: "user-1",
          resourceType: "report",
          resourceId: "collection:col-1",
          isSnapshot: true,
          snapshotPayload: {
            reviewState: "approved",
            evidenceState: "current",
            approvalExpiresAt: "2020-01-01T00:00:00.000Z",
          },
          createdAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2099-07-01T00:00:00.000Z",
          revokedAt: null,
        },
      ]),
      revokeShareLink: vi.fn(),
    }));

    const { loader } = await import("~/routes/app.shares");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/shares"),
      params: {},
    } as never);

    expect(result.shares[0]).toMatchObject({
      state: "Approval expired · review again",
      recoveryPath: "/app/reports/collection:col-1",
    });
  });

  it("revokes a link through the action with the session user's scope", async () => {
    const revokeShareLinkMock = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listActiveShareLinks: vi.fn(),
      revokeShareLink: revokeShareLinkMock,
    }));

    const { action } = await import("~/routes/app.shares");
    const body = new URLSearchParams({
      intent: "revoke-share",
      shareLinkId: "share-1",
    });
    const result = await action({
      context: {},
      request: new Request("https://0509.io/app/shares", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
      params: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(revokeShareLinkMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "share-1",
    );
  });

  it("reports an already-revoked link as an idempotent not-found result", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      revokeShareLink: vi.fn().mockResolvedValue(false),
    }));

    const { action } = await import("~/routes/app.shares");
    const body = new URLSearchParams({
      intent: "revoke-share",
      shareLinkId: "share-1",
    });
    const result = await action({
      context: {},
      request: new Request("https://0509.io/app/shares", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
      params: {},
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "revoke-share",
      shareLinkId: "share-1",
      message: "Share link not found — it may already be revoked.",
    });
  });
});
