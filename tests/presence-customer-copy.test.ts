import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  presenceCustomerErrorCopy,
  sanitizePresenceCoverageEntry,
  sanitizePresencePollCursor,
} from "~/lib/presence-customer-copy";
import type { PresencePollCursorRecord, PresenceSourceCoverageEntry } from "~/lib/presence-types";

const RAW_SENTINEL = "RAW_PROVIDER_ERROR email=owner@example.com token=secret-token";

function coverage(overrides: Partial<PresenceSourceCoverageEntry> = {}): PresenceSourceCoverageEntry {
  return {
    sourceId: "website",
    label: "Website / open web",
    status: "degraded",
    coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
    reasonCode: "fetch_failed",
    reasonMessage: RAW_SENTINEL,
    actionNeeded: RAW_SENTINEL,
    connectorId: "website",
    ...overrides,
  };
}

function cursor(overrides: Partial<PresencePollCursorRecord> = {}): PresencePollCursorRecord {
  return {
    sourceTargetId: "target-1",
    cursor: {
      feedUrl: "https://provider.example/feed?token=secret-token",
      lastChangedAt: "2026-07-15T00:00:00.000Z",
      lastChangeCount: 1,
      lastChangedUrlHashes: ["hash-1"],
      errorMessage: RAW_SENTINEL,
    },
    etag: "provider-etag-secret-token",
    lastModified: "provider-last-modified",
    lastPolledAt: "2026-07-15T00:00:00.000Z",
    lastSuccessAt: null,
    lastErrorCode: "unknown_provider_code",
    lastErrorMessage: RAW_SENTINEL,
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Presence customer error copy", () => {
  it("maps known and unknown codes without carrying raw error text", () => {
    const known = presenceCustomerErrorCopy("robots_disallowed");
    const unknown = presenceCustomerErrorCopy(RAW_SENTINEL);

    expect(known.message).toContain("robots.txt");
    expect(known.action).toContain("public access");
    expect(unknown.reasonCode).toBe("degraded");
    expect(unknown.message).toContain("could not complete");
    expect(JSON.stringify({ known, unknown })).not.toContain(RAW_SENTINEL);
  });

  it("sanitizes persisted coverage errors to a stable customer-safe payload", () => {
    const safe = sanitizePresenceCoverageEntry(coverage({ reasonCode: "unknown_provider_code" }));

    expect(safe.reasonCode).toBe("degraded");
    expect(safe.reasonMessage).toContain("could not complete");
    expect(safe.actionNeeded).toContain("Try again");
    expect(JSON.stringify(safe)).not.toContain(RAW_SENTINEL);
  });

  it("projects poll cursors to non-sensitive fields and sanitizes errors", () => {
    const safe = sanitizePresencePollCursor(cursor());

    expect(safe).toMatchObject({
      sourceTargetId: "target-1",
      etag: null,
      lastModified: null,
      lastErrorCode: "degraded",
    });
    expect(safe?.cursor).toEqual({
      lastChangedAt: "2026-07-15T00:00:00.000Z",
      lastChangeCount: 1,
      lastChangedUrlHashes: ["hash-1"],
    });
    expect(JSON.stringify(safe)).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(safe)).not.toContain("secret-token");
  });
});

describe("Presence detail customer HTML", () => {
  it("does not serialize persisted poll errors in the detail loader payload", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn(async () => ({
        workspaceUserId: "user-1",
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(async () => "starter"),
    }));
    vi.doMock("~/lib/presence-entitlements", () => ({
      canUsePresenceFeature: vi.fn(() => true),
      presenceModeAllowed: vi.fn(() => true),
    }));
    vi.doMock("~/lib/presence-data.server", () => ({
      getPollCursor: vi.fn(async () => cursor()),
      getTrackedEntity: vi.fn(async () => ({
        id: "entity-1",
        userId: "user-1",
        label: "Acme",
        trackingMode: "competitor",
        canonicalUrl: null,
        notes: null,
        isActive: true,
        deletedAt: null,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      })),
      listPresenceItems: vi.fn(async () => []),
      listSourceTargetsForEntity: vi.fn(async () => []),
    }));
    vi.doMock("~/lib/presence-service.server", () => ({
      getPresenceWorkspaceSnapshot: vi.fn(async () => ({
        entities: [],
        recentItems: [],
      })),
      requirePresenceWorkspaceAccess: vi.fn(async () => undefined),
    }));
    vi.doMock("~/lib/presence-source-coverage.server", () => ({
      applyEntitySourceTargetsCoverage: vi.fn((entry) => entry),
      applyPresenceSourcePlanGates: vi.fn((entries) => entries),
      evaluatePresenceSourceCoverage: vi.fn(async () => coverage()),
      listPresenceSourceCoverage: vi.fn(async () => []),
    }));
    vi.doMock("~/lib/presence-access-gates.server", () => ({
      connectorHasCustomerPollPath: vi.fn(() => true),
    }));
    vi.doMock("~/lib/presence-entity-brief.server", () => ({
      buildPresenceEntityBrief: vi.fn(({ sourceCoverage }: { sourceCoverage: PresenceSourceCoverageEntry[] }) => ({
        state: "degraded",
        headline: "Source check hit a limitation",
        summary: "The latest source check could not complete.",
        proofStrength: "Stale or partial",
        sourceConfidence: "Low — source degraded",
        nextAction: {
          label: "Try again later or review the source settings.",
        },
        recentChanges: [],
        sourceCoverage,
        lastPollAt: null,
        lastChangeAt: null,
      })),
    }));

    const route = await import("~/routes/app.presence.$entityId");
    const result = await route.loader({
      context: {},
      request: new Request("https://0509.io/app/presence/entity-1"),
      params: { entityId: "entity-1" },
    } as never);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(RAW_SENTINEL);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).toContain("could not complete");
  });

  it("does not render persisted coverage error text", async () => {
    type MockProps = { children?: ReactNode } & Record<string, unknown>;
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      return {
        ...actual,
        useLoaderData: () => ({
          entity: {
            id: "entity-1",
            label: "Acme",
            trackingMode: "competitor",
            canonicalUrl: null,
          },
          sources: [],
          pollableSources: [],
          items: [],
          compareEntities: [],
          sourceCoverage: [coverage({ reasonCode: "robots_disallowed" })],
          brief: {
            state: "degraded",
            headline: "Source check hit a limitation",
            summary: "The latest source check could not complete.",
            proofStrength: "Stale or partial",
            sourceConfidence: "Low — source degraded",
            nextAction: {
              label: "Try again later or review the source settings.",
            },
            recentChanges: [],
            sourceCoverage: [coverage({ reasonCode: "robots_disallowed" })],
            lastPollAt: null,
            lastChangeAt: null,
          },
        }),
        useActionData: () => null,
        useNavigation: () => ({ state: "idle", formData: null }),
        Form: ({ children, ...props }: MockProps) => createElement("form", props, children),
        Link: ({ children, ...props }: MockProps) => createElement("a", props, children),
      };
    });

    const route = await import("~/routes/app.presence.$entityId");
    const html = renderToStaticMarkup(createElement(route.default));

    expect(html).toContain("Source check hit a limitation");
    expect(html).toContain("Check that the source allows public access");
    expect(html).not.toContain(RAW_SENTINEL);
    expect(html).not.toContain("secret-token");
  });
});
