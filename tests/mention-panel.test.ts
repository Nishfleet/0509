import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MentionPanel } from "~/components/presence/mention-panel";
import {
  MENTION_PANEL_DEFAULT_PAGE_SIZE,
  loadMentionPanel,
} from "~/lib/mention-panel-loader.server";
import type {
  PresenceConnectorId,
  PresenceCoverageLabel,
  PresenceItemRecord,
  PresenceSourceCoverageEntry,
  SourceTargetRecord,
} from "~/lib/presence-types";

// `rss` is the Phase 1 connector (#1375, not yet landed). The loader is
// connector-agnostic over PresenceConnectorId, so the test seeds `rss` fixtures
// via cast to prove the loader picks them up the moment Phase 1 lands.
const RSS = "rss" as PresenceConnectorId;

type Env = { DB: unknown } & Record<string, unknown>;

function makeEnv(): Env {
  return { DB: {} } as Env;
}

function sourceTarget(overrides: Partial<SourceTargetRecord> & { connectorId: PresenceConnectorId }): SourceTargetRecord {
  return {
    id: `st_${overrides.connectorId}`,
    trackedEntityId: "te_1",
    userId: "user_1",
    targetKey: `key_${overrides.connectorId}`,
    targetUrl: null,
    targetHandle: null,
    metadata: {},
    coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
    isActive: true,
    deletedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function coverageEntry(
  connectorId: PresenceConnectorId,
  coverageLabel: PresenceCoverageLabel,
  status: PresenceSourceCoverageEntry["status"] = "available",
): PresenceSourceCoverageEntry {
  return {
    sourceId: connectorId as unknown as PresenceSourceCoverageEntry["sourceId"],
    label: connectorId,
    status,
    coverageLabel,
    reasonCode: null,
    reasonMessage: null,
    actionNeeded: null,
    connectorId,
  };
}

function presenceItem(overrides: Partial<PresenceItemRecord> & { connectorId: PresenceConnectorId }): PresenceItemRecord {
  return {
    id: `pi_${overrides.connectorId}_${overrides.publishedAt ?? overrides.observedAt}`,
    sourceTargetId: `st_${overrides.connectorId}`,
    trackedEntityId: "te_1",
    userId: "user_1",
    externalId: null,
    canonicalUrl: `https://example.com/${overrides.connectorId}/${overrides.publishedAt ?? overrides.observedAt}`,
    urlHash: `hash_${overrides.connectorId}_${overrides.publishedAt ?? overrides.observedAt}`,
    title: `${overrides.connectorId} mention ${overrides.publishedAt ?? overrides.observedAt}`,
    bodyExcerpt: null,
    author: null,
    publishedAt: overrides.publishedAt ?? null,
    observedAt: overrides.observedAt ?? "2026-08-20T00:00:00.000Z",
    contentHash: "ch",
    raw: null,
    isTombstone: false,
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

interface MockDeps {
  sources?: SourceTargetRecord[];
  coverage?: PresenceSourceCoverageEntry[];
  itemsByConnector?: Record<string, PresenceItemRecord[]>;
}

async function mockLoaderDeps(deps: MockDeps) {
  vi.doMock("~/lib/presence-data.server", () => ({
    listSourceTargetsForEntity: vi.fn(async () => deps.sources ?? []),
    listPresenceItems: vi.fn(async (_env: unknown, _userId: unknown, options: { connectorId?: PresenceConnectorId }) => {
      const key = options.connectorId ?? "";
      return deps.itemsByConnector?.[key] ?? [];
    }),
  }));
  vi.doMock("~/lib/presence-source-coverage.server", () => ({
    listPresenceSourceCoverage: vi.fn(async () => deps.coverage ?? []),
    // keep the real plan-gate applier semantics in scope, but the loader only
    // needs the function to pass through; tests supply already-gated coverage.
    applyPresenceSourcePlanGates: vi.fn((entries: PresenceSourceCoverageEntry[]) => entries),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("mention panel loader", () => {
  it("returns ONLY items whose connectorId is an enabled source_target connectorId, scoped to trackedEntityId, ordered by publishedAt DESC", async () => {
    vi.resetModules();
    await mockLoaderDeps({
      sources: [
        sourceTarget({ connectorId: "website", coverageLabel: "PUBLIC_WEB_BEST_EFFORT" }),
        sourceTarget({ connectorId: RSS, coverageLabel: "VERIFIED_PUBLIC_FEED" }),
      ],
      coverage: [
        coverageEntry("website", "PUBLIC_WEB_BEST_EFFORT", "connected"),
        coverageEntry(RSS, "VERIFIED_PUBLIC_FEED", "available"),
        coverageEntry("x", "UNAVAILABLE", "unavailable"),
      ],
      itemsByConnector: {
        website: [
          // a stray x item must be filtered out even if the data layer returns it
          presenceItem({ connectorId: "x", publishedAt: "2026-08-25T00:00:00.000Z", observedAt: "2026-08-25T00:00:00.000Z" }),
          presenceItem({ connectorId: "website", publishedAt: "2026-08-10T00:00:00.000Z", observedAt: "2026-08-11T00:00:00.000Z" }),
        ],
        rss: [
          presenceItem({ connectorId: RSS, publishedAt: "2026-08-20T00:00:00.000Z", observedAt: "2026-08-20T00:00:00.000Z" }),
          presenceItem({ connectorId: RSS, publishedAt: null, observedAt: "2026-08-05T00:00:00.000Z" }),
        ],
      },
    });

    const { loadMentionPanel } = await import("~/lib/mention-panel-loader.server");
    const result = await loadMentionPanel({
      env: makeEnv() as never,
      workspaceUserId: "user_1",
      trackedEntityId: "te_1",
      trackingMode: "competitor",
      planFamily: "agency",
    });

    expect(result.state).toBe("mentions");
    // Ordered by publishedAt DESC (null publishedAt falls back to observedAt).
    expect(result.items.map((i) => i.id)).toEqual([
      "pi_rss_2026-08-20T00:00:00.000Z",
      "pi_website_2026-08-10T00:00:00.000Z",
      "pi_rss_2026-08-05T00:00:00.000Z", // null publishedAt → observedAt 2026-08-05
    ]);
    // The stray x item is excluded — only enabled connectorIds appear.
    expect(result.items.every((i) => i.connectorId === "website" || i.connectorId === RSS)).toBe(true);
    expect(result.items.some((i) => i.connectorId === "x")).toBe(false);
    // enabledConnectorIds reflects the entity's enabled source_target connectors.
    expect(result.enabledConnectorIds).toContain("website");
    expect(result.enabledConnectorIds).toContain(RSS);
    // The loader is read-only and scopes every fetch to trackedEntityId.
    const { listPresenceItems } = await import("~/lib/presence-data.server");
    for (const call of vi.mocked(listPresenceItems).mock.calls) {
      expect(call[2]).toMatchObject({ trackedEntityId: "te_1" });
    }
  });

  it("filters out connectors whose coverageLabel is UNAVAILABLE at the loader, not as rendered 'no data'", async () => {
    vi.resetModules();
    await mockLoaderDeps({
      sources: [
        sourceTarget({ connectorId: "website", coverageLabel: "PUBLIC_WEB_BEST_EFFORT" }),
        sourceTarget({ connectorId: "x", coverageLabel: "OFFICIAL_PUBLIC_API" }),
      ],
      coverage: [
        coverageEntry("website", "PUBLIC_WEB_BEST_EFFORT", "connected"),
        coverageEntry("x", "UNAVAILABLE", "unavailable"),
      ],
      itemsByConnector: {
        website: [presenceItem({ connectorId: "website", publishedAt: "2026-08-01T00:00:00.000Z" })],
        // x is UNAVAILABLE so the loader must NOT call listPresenceItems for x.
        x: [presenceItem({ connectorId: "x", publishedAt: "2026-09-01T00:00:00.000Z" })],
      },
    });

    const { loadMentionPanel } = await import("~/lib/mention-panel-loader.server");
    const result = await loadMentionPanel({
      env: makeEnv() as never,
      workspaceUserId: "user_1",
      trackedEntityId: "te_1",
      trackingMode: "competitor",
      planFamily: "agency",
    });

    expect(result.state).toBe("mentions");
    expect(result.enabledConnectorIds).toEqual(["website"]);
    expect(result.items.every((i) => i.connectorId === "website")).toBe(true);
    const { listPresenceItems } = await import("~/lib/presence-data.server");
    const fetchedConnectors = vi.mocked(listPresenceItems).mock.calls.map((c) => c[2]?.connectorId);
    expect(fetchedConnectors).not.toContain("x");
  });

  it("renders the honest empty state when the entity has zero enabled mention sources", async () => {
    vi.resetModules();
    await mockLoaderDeps({
      sources: [],
      coverage: [coverageEntry("website", "PUBLIC_WEB_BEST_EFFORT", "available")],
      itemsByConnector: {},
    });

    const { loadMentionPanel } = await import("~/lib/mention-panel-loader.server");
    const result = await loadMentionPanel({
      env: makeEnv() as never,
      workspaceUserId: "user_1",
      trackedEntityId: "te_1",
      trackingMode: "competitor",
      planFamily: "agency",
    });

    expect(result.state).toBe("empty-no-sources");
    expect(result.items).toEqual([]);
    expect(result.enabledConnectorIds).toEqual([]);
  });

  it("renders the honest empty state when enabled sources exist but zero polled items", async () => {
    vi.resetModules();
    await mockLoaderDeps({
      sources: [sourceTarget({ connectorId: "website", coverageLabel: "PUBLIC_WEB_BEST_EFFORT" })],
      coverage: [coverageEntry("website", "PUBLIC_WEB_BEST_EFFORT", "connected")],
      itemsByConnector: { website: [] },
    });

    const { loadMentionPanel } = await import("~/lib/mention-panel-loader.server");
    const result = await loadMentionPanel({
      env: makeEnv() as never,
      workspaceUserId: "user_1",
      trackedEntityId: "te_1",
      trackingMode: "competitor",
      planFamily: "agency",
    });

    expect(result.state).toBe("empty-no-items");
    expect(result.items).toEqual([]);
    expect(result.enabledConnectorIds).toEqual(["website"]);
  });

  it("renders the plan-gate state for free plan on competitor mode, never a fabricated summary", async () => {
    vi.resetModules();
    await mockLoaderDeps({
      sources: [sourceTarget({ connectorId: "website", coverageLabel: "PUBLIC_WEB_BEST_EFFORT" })],
      coverage: [coverageEntry("website", "PUBLIC_WEB_BEST_EFFORT", "connected")],
      itemsByConnector: {
        website: [presenceItem({ connectorId: "website", publishedAt: "2026-08-01T00:00:00.000Z" })],
      },
    });

    const { loadMentionPanel } = await import("~/lib/mention-panel-loader.server");
    const result = await loadMentionPanel({
      env: makeEnv() as never,
      workspaceUserId: "user_1",
      trackedEntityId: "te_1",
      trackingMode: "competitor",
      planFamily: "free",
    });

    expect(result.state).toBe("plan-gated");
    expect(result.items).toEqual([]);
    expect(result.planGateFeature).toBe("presence_competitor_tracking");
    // The data layer is never reached when the plan gate fires.
    const { listPresenceItems } = await import("~/lib/presence-data.server");
    expect(vi.mocked(listPresenceItems)).not.toHaveBeenCalled();
  });

  it("documents a default page size and clamps the limit", async () => {
    vi.resetModules();
    await mockLoaderDeps({
      sources: [sourceTarget({ connectorId: "website", coverageLabel: "PUBLIC_WEB_BEST_EFFORT" })],
      coverage: [coverageEntry("website", "PUBLIC_WEB_BEST_EFFORT", "connected")],
      itemsByConnector: { website: [] },
    });

    const { loadMentionPanel, MENTION_PANEL_DEFAULT_PAGE_SIZE } = await import(
      "~/lib/mention-panel-loader.server"
    );
    expect(MENTION_PANEL_DEFAULT_PAGE_SIZE).toBeGreaterThan(0);

    const result = await loadMentionPanel({
      env: makeEnv() as never,
      workspaceUserId: "user_1",
      trackedEntityId: "te_1",
      trackingMode: "competitor",
      planFamily: "agency",
    });
    expect(result.pageSize).toBe(MENTION_PANEL_DEFAULT_PAGE_SIZE);
  });
});

describe("mention panel render", () => {
  it("renders a connectorId + coverageLabel badge and a canonicalUrl that links out with target=_blank and rel=noreferrer", () => {
    const html = renderToStaticMarkup(
      createElement(MentionPanel, {
        state: "mentions",
        enabledConnectorIds: ["website"],
        pageSize: MENTION_PANEL_DEFAULT_PAGE_SIZE,
        planGateFeature: null,
        items: [
          {
            id: "pi_1",
            connectorId: "website",
            coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
            canonicalUrl: "https://brand.example/post-1",
            title: "Brand mentioned in newsletter",
            bodyExcerpt: null,
            author: null,
            publishedAt: "2026-08-20T00:00:00.000Z",
            observedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
      }),
    );

    // connectorId badge (formatCoverageLabel("website") => "Website")
    expect(html).toContain("Website");
    // coverageLabel badge (formatCoverageLabel("PUBLIC_WEB_BEST_EFFORT") => "Public web — best effort")
    expect(html).toContain("Public web — best effort");
    // canonicalUrl links out with the standard rel attrs the rest of the app uses
    expect(html).toContain('href="https://brand.example/post-1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("renders the honest empty state for empty-no-sources, never a fabricated mention", () => {
    const html = renderToStaticMarkup(
      createElement(MentionPanel, {
        state: "empty-no-sources",
        items: [],
        enabledConnectorIds: [],
        pageSize: MENTION_PANEL_DEFAULT_PAGE_SIZE,
        planGateFeature: null,
      }),
    );
    expect(html).toContain("No mentions yet — add a source to start tracking.");
  });

  it("renders the honest empty state for empty-no-items, never a fabricated mention", () => {
    const html = renderToStaticMarkup(
      createElement(MentionPanel, {
        state: "empty-no-items",
        items: [],
        enabledConnectorIds: ["website"],
        pageSize: MENTION_PANEL_DEFAULT_PAGE_SIZE,
        planGateFeature: null,
      }),
    );
    expect(html).toContain("No mentions yet — add a source to start tracking.");
  });

  it("renders the plan-gate empty state for free plan on competitor mode, not a fabricated mentions summary", () => {
    const html = renderToStaticMarkup(
      createElement(MentionPanel, {
        state: "plan-gated",
        items: [],
        enabledConnectorIds: [],
        pageSize: MENTION_PANEL_DEFAULT_PAGE_SIZE,
        planGateFeature: "presence_competitor_tracking",
      }),
    );
    expect(html).toContain("Competitor mention tracking isn&#x27;t included in your current plan.");
    // never a fabricated mention summary
    expect(html).not.toContain("Latest ");
  });
});
