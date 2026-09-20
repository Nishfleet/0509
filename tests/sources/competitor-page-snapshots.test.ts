import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SourceAdapter,
  SourceChange,
  SourceSnapshotRecord,
} from "~/lib/sources/types";

/**
 * Issue #2581 — the competitor-page read path for source snapshots.
 * `loadCompetitorSourceSnapshots` in run.server.ts builds the `snapshots`
 * map SourceSections renders: one entry per enabled adapter, the latest
 * stored `source_snapshot` row plus the diff of the last two (the same
 * `adapter.diff(prev, next)` call the write path made). D1 is a minimal
 * fake chain; the registry is mocked so the enabled set is explicit.
 */

interface SnapshotRow {
  id: string;
  watchlist_id: string;
  source_id: string;
  fetched_at: string;
  payload_json: string;
  created_at: string;
}

function makeRow(
  sourceId: string,
  fetchedAt: string,
  payload: Record<string, unknown>,
): SnapshotRow {
  return {
    id: `snap-${sourceId}-${fetchedAt}`,
    watchlist_id: "wl-1",
    source_id: sourceId,
    fetched_at: fetchedAt,
    payload_json: JSON.stringify(payload),
    created_at: fetchedAt,
  };
}

// --- Mocked seams ---------------------------------------------------------

/** source_id → rows newest-first, as the ORDER BY would return them. */
let rowsBySource: Record<string, SnapshotRow[]>;
let failedSourceReads: Set<string>;
let boundArgs: unknown[][];

vi.mock("~/lib/data/d1.server", () => ({
  ensureDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      bind: vi.fn((...args: unknown[]) => {
        boundArgs.push(args);
        const [watchlistId, sourceId, limit] = args as [string, string, number];
        return {
          all: vi.fn(async () => {
            if (failedSourceReads.has(sourceId)) {
              throw new Error("D1 read failed");
            }
            const results = (rowsBySource[sourceId] ?? [])
              .filter((row) => row.watchlist_id === watchlistId)
              .slice(0, limit);
            return { results };
          }),
          first: vi.fn(async () => null),
          run: vi.fn(async () => ({})),
        };
      }),
    })),
  })),
}));

let enabledSources: SourceAdapter[];

vi.mock("~/lib/sources/registry.server", () => ({
  getEnabledSources: vi.fn(() => enabledSources),
}));

const { loadCompetitorSourceSnapshots, getRecentSourceSnapshots } = await import(
  "~/lib/sources/run.server"
);

function fakeAdapter(id: string, diff?: SourceChange[]): SourceAdapter {
  return {
    id: id as SourceAdapter["id"],
    label: id,
    kind: "ads",
    implemented: true,
    cadence: "each_check",
    requiresEnv: () => true,
    fetch: vi.fn(),
    diff: vi.fn(() => diff ?? []),
    Section: () => null,
  } as SourceAdapter;
}

const env = {} as never;

describe("loadCompetitorSourceSnapshots", () => {
  beforeEach(() => {
    rowsBySource = {};
    failedSourceReads = new Set();
    boundArgs = [];
    enabledSources = [];
  });

  it("returns the latest snapshot and the diff of the last two per enabled adapter", async () => {
    const adapter = fakeAdapter("google_ads", [
      { eventType: "ad_launched", title: "New creative", summary: "s", metadata: {} },
    ]);
    enabledSources = [adapter];
    rowsBySource = {
      google_ads: [
        makeRow("google_ads", "2026-09-19T00:00:00.000Z", { creatives: [{ creativeId: "c3" }] }),
        makeRow("google_ads", "2026-09-18T00:00:00.000Z", { creatives: [{ creativeId: "c2" }] }),
        makeRow("google_ads", "2026-09-17T00:00:00.000Z", { creatives: [{ creativeId: "c1" }] }),
      ],
    };

    const map = await loadCompetitorSourceSnapshots(env, "wl-1", "starter");

    const entry = map.google_ads;
    expect(entry.snapshot?.id).toBe("snap-google_ads-2026-09-19T00:00:00.000Z");
    // The same diff call the write path made when the latest was stored:
    // diff(second-latest record, { payload: latest.payload }).
    expect(adapter.diff).toHaveBeenCalledTimes(1);
    const [prevArg, nextArg] = vi.mocked(adapter.diff).mock.calls[0];
    expect((prevArg as SourceSnapshotRecord).id).toBe("snap-google_ads-2026-09-18T00:00:00.000Z");
    expect(nextArg).toEqual({ payload: { creatives: [{ creativeId: "c3" }] } });
    expect(entry.diff).toHaveLength(1);
    // The read asks for exactly the last two rows.
    expect(boundArgs).toEqual([["wl-1", "google_ads", 2]]);
  });

  it("diffs against null when only one snapshot exists, matching the first-fetch write path", async () => {
    const adapter = fakeAdapter("subdomains", [
      { eventType: "ad_launched", title: "First", summary: "s", metadata: {} },
    ]);
    enabledSources = [adapter];
    rowsBySource = {
      subdomains: [makeRow("subdomains", "2026-09-19T00:00:00.000Z", { names: ["a.example.com"] })],
    };

    const map = await loadCompetitorSourceSnapshots(env, "wl-1", "free");

    expect(map.subdomains.snapshot?.payload).toEqual({ names: ["a.example.com"] });
    const [prevArg, nextArg] = vi.mocked(adapter.diff).mock.calls[0];
    expect(prevArg).toBeNull();
    expect(nextArg).toEqual({ payload: { names: ["a.example.com"] } });
    expect(map.subdomains.diff).toHaveLength(1);
  });

  it("returns null snapshot and empty diff for an enabled source with no rows, without calling diff", async () => {
    const adapter = fakeAdapter("hiring");
    enabledSources = [adapter];

    const map = await loadCompetitorSourceSnapshots(env, "wl-1", "agency");

    expect(map.hiring).toEqual({ snapshot: null, diff: [] });
    expect(adapter.diff).not.toHaveBeenCalled();
  });

  it("scopes rows to the watchlist and degrades a failed source read without failing the others", async () => {
    const good = fakeAdapter("google");
    const bad = fakeAdapter("tiktok");
    enabledSources = [good, bad];
    rowsBySource = {
      google: [makeRow("google", "2026-09-19T00:00:00.000Z", { ok: true })],
      tiktok: [makeRow("tiktok", "2026-09-19T00:00:00.000Z", { ok: true })],
    };
    failedSourceReads = new Set(["tiktok"]);

    const map = await loadCompetitorSourceSnapshots(env, "wl-1", "starter");

    expect(map.google.snapshot?.payload).toEqual({ ok: true });
    expect(map.tiktok).toEqual({ snapshot: null, diff: [] });
  });

  it("keeps the snapshot when the adapter diff throws on a stored payload", async () => {
    const adapter = fakeAdapter("linkedin");
    vi.mocked(adapter.diff).mockImplementation(() => {
      throw new Error("unknown payload shape");
    });
    enabledSources = [adapter];
    rowsBySource = {
      linkedin: [makeRow("linkedin", "2026-09-19T00:00:00.000Z", { legacy: true })],
    };

    const map = await loadCompetitorSourceSnapshots(env, "wl-1", "starter");

    expect(map.linkedin.snapshot?.payload).toEqual({ legacy: true });
    expect(map.linkedin.diff).toEqual([]);
  });
});

describe("getRecentSourceSnapshots", () => {
  beforeEach(() => {
    rowsBySource = {};
    failedSourceReads = new Set();
    boundArgs = [];
    enabledSources = [];
  });

  it("returns rows newest-first and honours the limit", async () => {
    rowsBySource = {
      google: [
        makeRow("google", "2026-09-19T00:00:00.000Z", { n: 3 }),
        makeRow("google", "2026-09-18T00:00:00.000Z", { n: 2 }),
        makeRow("google", "2026-09-17T00:00:00.000Z", { n: 1 }),
      ],
    };

    const rows = await getRecentSourceSnapshots(env, "wl-1", "google", 2);

    expect(rows.map((row) => row.fetchedAt)).toEqual([
      "2026-09-19T00:00:00.000Z",
      "2026-09-18T00:00:00.000Z",
    ]);
    expect(rows[0].payload).toEqual({ n: 3 });
  });
});
