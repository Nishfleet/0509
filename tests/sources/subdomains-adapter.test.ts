import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceSnapshotRecord, SourceSnapshotInput } from "~/lib/sources/types";

/**
 * Adapter tests for the subdomains source — issue #2198.
 *
 * The adapter's `fetch` does a D1 lookup (watchlist.target_id → registrable
 * domain) then delegates to `fetchSubdomains`. We mock both so the test
 * never touches the network or D1.
 */

// Captured D1 query result for the watchlist lookup.
let mockTargetId: string | null;

// Captured fetchSubdomains result.
let mockFetchResult:
  | { unavailable: true; reason: string }
  | { names: Array<{ name: string; kind: "public" | "internal"; firstSeen: string }>; truncated: boolean };

function makeDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () =>
          mockTargetId ? { target_id: mockTargetId } : null,
        ),
      })),
    })),
  };
}

vi.mock("~/lib/data/d1.server", () => ({
  ensureDb: vi.fn(() => makeDb()),
}));

vi.mock("~/lib/sources/subdomains/subdomain-signals.server", () => ({
  fetchSubdomains: vi.fn(async () => mockFetchResult),
  classifySubdomain: vi.fn((name: string) =>
    name.startsWith("dev.") || name.startsWith("mail.") ? "internal" : "public",
  ),
}));

const { subdomainsAdapter } = await import("~/lib/sources/subdomains.server");

const baseEnv = {
  DB: {} as never,
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
} as unknown as Parameters<typeof subdomainsAdapter.fetch>[0];

describe("subdomainsAdapter", () => {
  beforeEach(() => {
    mockTargetId = "https://notion.so";
    mockFetchResult = {
      names: [
        { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
        { name: "dev.notion.so", kind: "internal", firstSeen: "2026-02-01T00:00:00.000Z" },
      ],
      truncated: false,
    };
  });

  it("exports implemented: true and requiresEnv: true", () => {
    expect(subdomainsAdapter.implemented).toBe(true);
    expect(subdomainsAdapter.requiresEnv(baseEnv)).toBe(true);
  });

  it("fetch returns a snapshot payload with domain, names, truncated", async () => {
    const result = await subdomainsAdapter.fetch(baseEnv, {
      competitorId: "wl-1",
      competitorLabel: "Notion",
    });
    if ("unavailable" in result) throw new Error("expected snapshot");
    const payload = result.payload as { domain: string; names: unknown[]; truncated: boolean };
    expect(payload.domain).toBe("notion.so");
    expect(payload.names).toHaveLength(2);
    expect(payload.truncated).toBe(false);
  });

  it("fetch returns unavailable when the watchlist has no target_id", async () => {
    mockTargetId = null;
    const result = await subdomainsAdapter.fetch(baseEnv, {
      competitorId: "wl-missing",
      competitorLabel: "Ghost",
    });
    expect(result.unavailable).toBe(true);
    if (result.unavailable) expect(result.reason).toBe("no_domain");
  });

  it("fetch returns unavailable when fetchSubdomains is unavailable", async () => {
    mockFetchResult = { unavailable: true, reason: "fetch_failed" };
    const result = await subdomainsAdapter.fetch(baseEnv, {
      competitorId: "wl-1",
      competitorLabel: "Notion",
    });
    expect(result.unavailable).toBe(true);
    if (result.unavailable) expect(result.reason).toBe("fetch_failed");
  });

  it("diff delegates to diffSubdomainSnapshots (baseline → [])", () => {
    const next: SourceSnapshotInput = {
      payload: {
        domain: "notion.so",
        names: [
          { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
        ],
        truncated: false,
      },
    };
    expect(subdomainsAdapter.diff(null, next)).toEqual([]);
  });

  it("diff returns changes for new public names only", () => {
    const prev: SourceSnapshotRecord = {
      id: "snap-1",
      watchlistId: "wl-1",
      sourceId: "subdomains",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      payload: {
        domain: "notion.so",
        names: [
          { name: "api.notion.so", kind: "public", firstSeen: "2026-03-01T00:00:00.000Z" },
        ],
        truncated: false,
      } as never,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const next: SourceSnapshotInput = {
      payload: {
        domain: "notion.so",
        names: [
          { name: "api.notion.so", kind: "public", firstSeen: "2026-03-01T00:00:00.000Z" },
          { name: "ai.notion.so", kind: "public", firstSeen: "2026-07-01T00:00:00.000Z" },
          { name: "dev.notion.so", kind: "internal", firstSeen: "2026-02-01T00:00:00.000Z" },
        ],
        truncated: false,
      },
    };
    const changes = subdomainsAdapter.diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].metadata).toMatchObject({ subdomain: "ai.notion.so", kind: "public" });
  });

  it("Section is the SubdomainsSection component", () => {
    expect(subdomainsAdapter.Section).toBeDefined();
    expect(typeof subdomainsAdapter.Section).toBe("function");
  });
});
