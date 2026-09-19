import { describe, expect, it } from "vitest";

import { buildPresenceEntityBrief } from "~/lib/presence-entity-brief.server";
import type {
  PresenceItemRecord,
  PresencePollCursorRecord,
  PresenceSourceCoverageEntry,
  SourceTargetRecord,
  TrackedEntityRecord,
} from "~/lib/presence-types";

function entity(overrides: Partial<TrackedEntityRecord> = {}): TrackedEntityRecord {
  return {
    id: overrides.id ?? "entity-1",
    userId: overrides.userId ?? "user-1",
    trackingMode: overrides.trackingMode ?? "competitor",
    label: overrides.label ?? "Acme Corp",
    canonicalUrl: overrides.canonicalUrl ?? "https://acme.example",
    notes: overrides.notes ?? null,
    isActive: overrides.isActive ?? true,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

function source(overrides: Partial<SourceTargetRecord> = {}): SourceTargetRecord {
  return {
    id: overrides.id ?? "target-1",
    trackedEntityId: overrides.trackedEntityId ?? "entity-1",
    userId: overrides.userId ?? "user-1",
    connectorId: overrides.connectorId ?? "website",
    targetKey: overrides.targetKey ?? "acme.example",
    targetUrl: overrides.targetUrl ?? "https://acme.example/blog",
    targetHandle: overrides.targetHandle ?? null,
    metadata: overrides.metadata ?? {},
    coverageLabel: overrides.coverageLabel ?? "PUBLIC_WEB_BEST_EFFORT",
    isActive: overrides.isActive ?? true,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

function item(overrides: Partial<PresenceItemRecord> = {}): PresenceItemRecord {
  return {
    id: overrides.id ?? "item-1",
    sourceTargetId: overrides.sourceTargetId ?? "target-1",
    trackedEntityId: overrides.trackedEntityId ?? "entity-1",
    userId: overrides.userId ?? "user-1",
    connectorId: overrides.connectorId ?? "website",
    externalId: overrides.externalId ?? null,
    canonicalUrl: overrides.canonicalUrl ?? "https://acme.example/blog/post",
    urlHash: overrides.urlHash ?? "hash-1",
    title: overrides.title ?? "Launch post",
    bodyExcerpt: overrides.bodyExcerpt ?? "New pricing page.",
    author: overrides.author ?? null,
    publishedAt: overrides.publishedAt ?? "2026-07-01T12:00:00.000Z",
    observedAt: overrides.observedAt ?? "2026-07-02T00:00:00.000Z",
    contentHash: overrides.contentHash ?? "content-1",
    raw: overrides.raw ?? null,
    isTombstone: overrides.isTombstone ?? false,
    revision: overrides.revision ?? 1,
    createdAt: overrides.createdAt ?? "2026-07-02T00:00:00.000Z",
  };
}

function websiteCoverage(status: PresenceSourceCoverageEntry["status"]): PresenceSourceCoverageEntry {
  return {
    sourceId: "website",
    label: "Website / open web",
    status,
    coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
    reasonCode: null,
    reasonMessage: null,
    actionNeeded: null,
    connectorId: "website",
  };
}

function cursor(overrides: Partial<PresencePollCursorRecord> = {}): PresencePollCursorRecord {
  return {
    sourceTargetId: overrides.sourceTargetId ?? "target-1",
    cursor: overrides.cursor ?? {},
    etag: overrides.etag ?? null,
    lastModified: overrides.lastModified ?? null,
    lastPolledAt: overrides.lastPolledAt ?? null,
    lastSuccessAt: overrides.lastSuccessAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    updatedAt: overrides.updatedAt ?? "2026-07-02T00:00:00.000Z",
  };
}

describe("buildPresenceEntityBrief", () => {
  it("returns not_enough_data when no website sources exist", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [],
      items: [],
      sourceCoverage: [websiteCoverage("available")],
    });

    expect(brief.state).toBe("not_enough_data");
    expect(brief.nextAction.label).toBe("Add website source");
    expect(brief.recentChanges).toHaveLength(0);
  });

  it("returns queued when website sources exist but were never polled", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [{ sourceTargetId: "target-1", cursor: null }],
    });

    expect(brief.state).toBe("queued");
    expect(brief.headline).toContain("first check");
  });

  it("returns ready when recent website items exist", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [item()],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 1,
              lastChangedUrlHashes: ["hash-1"],
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.state).toBe("ready");
    expect(brief.recentChanges).toHaveLength(1);
    expect(brief.proofStrength).toContain("Public web");
  });

  it("summarises stored mentions alongside website changes, each with its source (issue #3179)", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [item()],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 1,
              lastChangedUrlHashes: ["hash-1"],
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
      mentionItems: [
        item({
          id: "mention-1",
          sourceTargetId: "rss-target-1",
          connectorId: "rss",
          title: "Acme featured in a launch roundup",
          canonicalUrl: "https://news.example/acme-roundup",
          observedAt: "2026-07-02T06:00:00.000Z",
        }),
      ],
    });

    expect(brief.state).toBe("ready");
    expect(brief.summary).toContain("website changes and public mentions");
    const mention = brief.recentChanges.find((change) => change.id === "mention-1");
    expect(mention).toBeDefined();
    expect(mention?.canonicalUrl).toBe("https://news.example/acme-roundup");
    expect(mention?.connectorId).toBe("rss");
  });

  it("reads a mention-only entity as ready with the mention summary, not a false quiet (issue #3179)", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
      mentionItems: [
        item({
          id: "mention-old",
          sourceTargetId: "rss-target-1",
          connectorId: "gdelt",
          title: "Acme in the news",
          canonicalUrl: "https://news.example/acme",
          observedAt: "2026-07-01T10:00:00.000Z",
        }),
        item({
          id: "mention-new",
          sourceTargetId: "rss-target-1",
          connectorId: "rss",
          title: "Acme raises a round",
          canonicalUrl: "https://wire.example/acme-raises",
          observedAt: "2026-07-02T09:00:00.000Z",
        }),
      ],
    });

    expect(brief.state).toBe("ready");
    expect(brief.summary).toBe("Found 2 public mentions of Acme Corp, each with its source.");
    // Newest first, capped at three.
    expect(brief.recentChanges.map((change) => change.id)).toEqual(["mention-new", "mention-old"]);
  });

  it("does not treat leftover connector_id='podcast' mention rows as live mentions (issue #3447)", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
      mentionItems: [
        item({
          id: "mention-podcast",
          sourceTargetId: "podcast-target-1",
          connectorId: "podcast" as PresenceItemRecord["connectorId"],
          title: "Leftover podcast capture",
          canonicalUrl: "https://show.example/ep-1",
          observedAt: "2026-09-13T22:50:00.000Z",
        }),
        item({
          id: "mention-rss",
          sourceTargetId: "rss-target-1",
          connectorId: "rss",
          title: "Acme in a roundup",
          canonicalUrl: "https://news.example/acme",
          observedAt: "2026-07-02T09:00:00.000Z",
        }),
      ],
    });

    expect(brief.recentChanges.map((change) => change.id)).toEqual(["mention-rss"]);
    expect(brief.recentChanges.some((change) => change.connectorId === "podcast")).toBe(false);
  });

  it("keeps the never-polled entity queued even when mentions exist (issue #3179)", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [{ sourceTargetId: "target-1", cursor: null }],
      mentionItems: [
        item({
          id: "mention-1",
          sourceTargetId: "rss-target-1",
          connectorId: "rss",
          title: "Acme in the news",
          canonicalUrl: "https://news.example/acme",
          observedAt: "2026-07-02T09:00:00.000Z",
        }),
      ],
    });

    // A mention is public proof, but the website source still owes its first
    // check — the brief must not claim "ready" before that check lands.
    expect(brief.state).toBe("queued");
  });

  it("scopes proof strength to the source that produced the latest displayed change", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [
        source({ id: "target-1", coverageLabel: "PUBLIC_WEB_BEST_EFFORT" }),
        source({ id: "target-2", targetKey: "acme.example/feed", coverageLabel: "VERIFIED_PUBLIC_FEED" }),
      ],
      items: [item({ sourceTargetId: "target-1", urlHash: "page-hash" })],
      sourceCoverage: [{ ...websiteCoverage("connected"), coverageLabel: "VERIFIED_PUBLIC_FEED" }],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 1,
              lastChangedUrlHashes: ["page-hash"],
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
        {
          sourceTargetId: "target-2",
          cursor: cursor({
            sourceTargetId: "target-2",
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.state).toBe("ready");
    expect(brief.proofStrength).toBe("Public web — best effort");
  });

  it("summarizes the full latest poll count while capping displayed changes", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: Array.from({ length: 8 }, (_, index) =>
        item({
          id: `item-${index}`,
          canonicalUrl: `https://acme.example/blog/post-${index}`,
          urlHash: `hash-${index}`,
          observedAt: "2026-07-02T00:00:00.000Z",
        }),
      ),
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 8,
              lastChangedUrlHashes: Array.from({ length: 8 }, (_, index) => `hash-${index}`),
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.summary).toContain("Found 8 proof-backed updates");
    expect(brief.recentChanges).toHaveLength(5);
  });

  it("only displays exact item hashes from the latest poll when checks are close together", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [
        item({
          id: "older-item",
          title: "Older launch",
          canonicalUrl: "https://acme.example/blog/older",
          urlHash: "older-hash",
          observedAt: "2026-07-02T00:00:00.000Z",
        }),
        item({
          id: "latest-item",
          title: "Latest launch",
          canonicalUrl: "https://acme.example/blog/latest",
          urlHash: "latest-hash",
          observedAt: "2026-07-02T00:03:00.000Z",
        }),
      ],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:03:00.000Z",
              lastChangeCount: 1,
              lastChangedUrlHashes: ["latest-hash"],
            },
            lastPolledAt: "2026-07-02T00:03:00.000Z",
            lastSuccessAt: "2026-07-02T00:03:00.000Z",
          }),
        },
      ],
    });

    expect(brief.summary).toContain("Found 1 proof-backed update");
    expect(brief.recentChanges).toHaveLength(1);
    expect(brief.recentChanges[0]?.title).toBe("Latest launch");
  });

  it("includes hidden removals in the latest poll summary count", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [item({ observedAt: "2026-07-02T00:00:00.000Z" })],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 3,
              lastChangedUrlHashes: ["hash-1", "removed-hash-1", "removed-hash-2"],
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.summary).toContain("Found 3 proof-backed website changes");
    expect(brief.summary).toContain("including removals");
    expect(brief.recentChanges).toHaveLength(1);
  });

  it("does not treat retained items as recent changes after a later quiet poll", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [item({ observedAt: "2026-07-01T00:00:00.000Z" })],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.state).toBe("all_quiet");
    expect(brief.recentChanges).toHaveLength(0);
  });

  it("does not treat a prior change as recent after a later quiet poll", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [item({ observedAt: "2026-07-02T00:00:00.000Z" })],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: { lastChangedAt: "2026-07-02T00:00:00.000Z" },
            lastPolledAt: "2026-07-02T00:03:00.000Z",
            lastSuccessAt: "2026-07-02T00:03:00.000Z",
          }),
        },
      ],
    });

    expect(brief.state).toBe("all_quiet");
    expect(brief.recentChanges).toHaveLength(0);
  });

  it("does not treat a prior change as recent after a later failed poll", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [item({ observedAt: "2026-07-02T00:00:00.000Z" })],
      sourceCoverage: [
        {
          ...websiteCoverage("degraded"),
          reasonCode: "robots_disallowed",
          reasonMessage: "Robots.txt disallows this path.",
        },
      ],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 1,
            },
            lastPolledAt: "2026-07-02T00:03:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
            lastErrorCode: "robots_disallowed",
            lastErrorMessage: "Robots.txt disallows this path.",
          }),
        },
      ],
    });

    expect(brief.state).toBe("degraded");
    expect(brief.recentChanges).toHaveLength(0);
    expect(brief.proofStrength).toBe("Stale or partial");
  });

  it("surfaces deletion-only changes from latest poll cursor metadata", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 1,
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.state).toBe("ready");
    expect(brief.summary).toContain("including removals");
    expect(brief.lastChangeAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("surfaces deletion-only changes even when another website source is unpolled", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source({ id: "target-1" }), source({ id: "target-2", targetKey: "acme.example/pricing" })],
      items: [],
      sourceCoverage: [
        {
          ...websiteCoverage("connected"),
          actionNeeded: "Run first check for 1 source target",
        },
      ],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            sourceTargetId: "target-1",
            cursor: {
              lastChangedAt: "2026-07-02T00:00:00.000Z",
              lastChangeCount: 1,
            },
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
        { sourceTargetId: "target-2", cursor: null },
      ],
    });

    expect(brief.state).toBe("ready");
    expect(brief.summary).toContain("including removals");
  });

  it("returns all_quiet after a successful poll with no new items", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    });

    expect(brief.state).toBe("all_quiet");
    expect(brief.summary).toContain("no new public content");
  });

  it("returns queued when one of multiple website sources was never polled", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source({ id: "target-1" }), source({ id: "target-2", targetKey: "acme.example/pricing" })],
      items: [],
      sourceCoverage: [
        {
          ...websiteCoverage("connected"),
          actionNeeded: "Run first check for 1 source target",
        },
      ],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            sourceTargetId: "target-1",
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
        { sourceTargetId: "target-2", cursor: null },
      ],
    });

    expect(brief.state).toBe("queued");
    expect(brief.summary).toContain("1 website source target");
  });

  it("returns degraded when the latest poll failed without inventing proof", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [
        {
          ...websiteCoverage("degraded"),
          reasonCode: "robots_disallowed",
          reasonMessage: "Robots.txt disallows this path.",
          actionNeeded: "Review source limitation",
        },
      ],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastErrorCode: "robots_disallowed",
            lastErrorMessage: "Robots.txt disallows this path.",
          }),
        },
      ],
    });

    expect(brief.state).toBe("degraded");
    expect(brief.summary).toContain("Robots.txt disallows this path.");
    expect(brief.recentChanges).toHaveLength(0);
  });

  it("scopes the first slice to website/open-web sources only", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source({ connectorId: "x", id: "target-x" })],
      items: [item({ connectorId: "x", sourceTargetId: "target-x", title: "Social post" })],
      sourceCoverage: [websiteCoverage("available")],
    });

    expect(brief.state).toBe("not_enough_data");
    expect(brief.recentChanges).toHaveLength(0);
  });
});

describe("proof honesty — failed checks can never read as quiet or confident", () => {
  it("reports degraded, not all_quiet, when the latest poll failed after an earlier success", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source({ coverageLabel: "VERIFIED_PUBLIC_FEED" })],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-20T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
            lastErrorCode: "fetch_failed",
          }),
        },
      ],
    });

    expect(brief.state).toBe("degraded");
    expect(brief.headline).toBe("Latest website check failed");
    expect(brief.proofStrength).toBe("Stale — last check failed");
    expect(brief.sourceConfidence).toBe("Low — latest check failed");
  });

  it("never claims high confidence before the first check has run", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source({ coverageLabel: "VERIFIED_PUBLIC_FEED" })],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [{ sourceTargetId: "target-1", cursor: null }],
    });

    expect(brief.state).toBe("queued");
    expect(brief.sourceConfidence).toBe("Not checked yet — we run the first check shortly");
    expect(brief.sourceConfidence).not.toContain("High");
  });

  it("says no successful check exists instead of all quiet when polls only ever failed", () => {
    const brief = buildPresenceEntityBrief({
      entity: entity(),
      sources: [source()],
      items: [],
      sourceCoverage: [websiteCoverage("connected")],
      pollCursors: [
        {
          sourceTargetId: "target-1",
          cursor: cursor({
            lastPolledAt: "2026-07-20T00:00:00.000Z",
            lastSuccessAt: null,
            lastErrorCode: "fetch_failed",
          }),
        },
      ],
    });

    expect(brief.state).toBe("degraded");
    expect(brief.proofStrength).toBe("No successful check yet");
  });
});
