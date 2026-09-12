import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import type { HiringJob } from "~/lib/sources/hiring/hiring-signals.server";

/**
 * Hiring snapshot + diff (#2199). `run.server` (the 7-day gate's snapshot
 * lookup) and `d1.server` (the stored `job_board_*` columns) are mocked; the
 * provider feed fetch is a stubbed `globalThis.fetch` so the real
 * normalization in hiring-signals.server runs. The diff is pure.
 */

const competitorId = "wl-1";
const competitorLabel = "Acme";

// --- Mocks -------------------------------------------------------------

let latestSnapshot: SourceSnapshotRecord | null = null;
let storedRow: Record<string, unknown> | null = null;
let fetchCalls = 0;

vi.mock("~/lib/sources/run.server", () => ({
  getLatestSourceSnapshot: vi.fn(async () => latestSnapshot),
}));

vi.mock("~/lib/data/d1.server", () => ({
  ensureDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => storedRow),
      })),
    })),
  })),
}));

const { fetchHiringSnapshot, diffHiring } = await import(
  "~/lib/sources/hiring/hiring-snapshot.server"
);

beforeEach(() => {
  latestSnapshot = null;
  storedRow = {
    target_id: "https://acme.example",
    job_board_provider: "greenhouse",
    job_board_slug: "acme",
    job_board_verified: 1,
  };
  fetchCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jobs: [
          {
            id: 101,
            title: "Staff Engineer",
            location: { name: "London" },
            departments: [{ name: "Engineering" }],
            absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
            updated_at: "2026-09-09T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
          },
        ],
      }),
    } as Response;
  });
});

// --- Fixtures ----------------------------------------------------------

function job(overrides: Partial<HiringJob> = {}): HiringJob {
  return {
    id: "j1",
    title: "Engineer",
    location: null,
    department: null,
    url: null,
    postedAt: null,
    ...overrides,
  };
}

function boardPayload(
  jobs: HiringJob[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jobs,
    provider: "greenhouse",
    slug: "acme",
    verified: true,
    label: "Acme",
    counts: { byDepartment: {}, byLocation: {} },
    fetchedAt: "2026-09-10T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    ...overrides,
  };
}

function record(
  payload: Record<string, unknown>,
  fetchedAt = "2026-09-03T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
): SourceSnapshotRecord {
  return {
    id: "snap-1",
    watchlistId: competitorId,
    sourceId: "hiring",
    fetchedAt,
    payload,
    createdAt: fetchedAt,
  };
}

function nextInput(
  jobs: HiringJob[],
  overrides: Record<string, unknown> = {},
): SourceSnapshotInput {
  return { payload: boardPayload(jobs, overrides) };
}

// --- 7-day weekly gate -------------------------------------------------

describe("fetchHiringSnapshot — weekly gate", () => {
  it("returns cadence when the latest stored snapshot is fresh", async () => {
    latestSnapshot = record(
      boardPayload([job({ id: "j1" })]),
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const result = await fetchHiringSnapshot({} as never, {
      competitorId,
      competitorLabel,
    });
    expect(result).toEqual({ unavailable: true, reason: "cadence" });
    expect(fetchCalls).toBe(0);
  });

  it("proceeds when the latest stored snapshot is stale", async () => {
    latestSnapshot = record(
      boardPayload([job({ id: "j1" })]),
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const result = await fetchHiringSnapshot({} as never, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    expect(fetchCalls).toBe(1);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload.provider).toBe("greenhouse");
    expect(result.payload.slug).toBe("acme");
    expect(result.competitorUpdate).toEqual({
      job_board_provider: "greenhouse",
      job_board_slug: "acme",
      job_board_verified: 1,
    });
  });
});

// --- no board ----------------------------------------------------------

describe("fetchHiringSnapshot — no derivable domain", () => {
  it("stores an honest no-board snapshot instead of alerting", async () => {
    latestSnapshot = null;
    storedRow = {
      target_id: "not a url",
      job_board_provider: null,
      job_board_slug: null,
      job_board_verified: null,
    };
    const result = await fetchHiringSnapshot({} as never, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload.reason).toBe("no_board");
    expect(result.payload.provider).toBeNull();
    expect(result.payload.jobs).toEqual([]);
    expect(result.payload.label).toBe(competitorLabel);
    expect(fetchCalls).toBe(0);
  });

  it("treats a missing target_id as no board", async () => {
    latestSnapshot = null;
    storedRow = {
      target_id: null,
      job_board_provider: null,
      job_board_slug: null,
      job_board_verified: null,
    };
    const result = await fetchHiringSnapshot({} as never, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload.reason).toBe("no_board");
    expect(fetchCalls).toBe(0);
  });
});

// --- diff --------------------------------------------------------------

describe("diffHiring", () => {
  it("never alerts on a baseline (prev null)", () => {
    expect(diffHiring(null, nextInput([job({ id: "a" })]))).toEqual([]);
  });

  it("never alerts for an unconfirmed (label-guessed) board", () => {
    const prev = record(boardPayload([job({ id: "a" })]));
    const next = nextInput([job({ id: "a" }), job({ id: "b" })], {
      verified: false,
    });
    expect(diffHiring(prev, next)).toEqual([]);
  });

  it("never alerts on a no-board payload", () => {
    const prev = record(boardPayload([job({ id: "a" })]));
    const next: SourceSnapshotInput = {
      payload: {
        jobs: [],
        provider: null,
        slug: null,
        verified: null,
        reason: "no_board",
        label: "Acme",
      },
    };
    expect(diffHiring(prev, next)).toEqual([]);
  });

  it("emits exactly ONE grouped change for N=1 opened, M=0 closed", () => {
    const prev = record(boardPayload([job({ id: "a" })]));
    const next = nextInput([job({ id: "a" }), job({ id: "b" })]);
    const changes = diffHiring(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].eventType).toBe("website_page_changed");
    expect(changes[0].metadata.kind).toBe("role_change");
    expect(changes[0].metadata.opened).toBe(1);
    expect(changes[0].metadata.closed).toBe(0);
    expect(changes[0].metadata.openedJobIds).toEqual(["b"]);
    expect(changes[0].metadata.closedJobIds).toEqual([]);
    expect(changes[0].title).toContain("Acme");
  });

  it("emits one grouped change for M=5 closed, N=0 opened", () => {
    const prevJobs = ["a", "b", "c", "d", "e"].map((id) => job({ id }));
    const prev = record(boardPayload(prevJobs));
    const next = nextInput([]);
    const changes = diffHiring(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].metadata.opened).toBe(0);
    expect(changes[0].metadata.closed).toBe(5);
    expect(changes[0].metadata.closedJobIds).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("fires on a small opened count even when closed stays below its threshold", () => {
    const prevJobs = ["a", "b", "c", "d", "e"].map((id) => job({ id }));
    const prev = record(boardPayload(prevJobs));
    // 4 of the 5 previous roles are gone (below the M>=5 bar) + 2 new ids.
    const next = nextInput([
      job({ id: "a" }),
      job({ id: "f" }),
      job({ id: "g" }),
    ]);
    const changes = diffHiring(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].metadata.opened).toBe(2);
    expect(changes[0].metadata.closed).toBe(4);
  });

  it("stays silent when N=0 opened and M=4 closed", () => {
    const prevJobs = ["a", "b", "c", "d"].map((id) => job({ id }));
    const prev = record(boardPayload(prevJobs));
    expect(diffHiring(prev, nextInput([]))).toEqual([]);
  });

  it("groups top departments and locations, with (none)/(not listed) buckets", () => {
    const prev = record(
      boardPayload([
        job({ id: "p4" }),
        job({ id: "p5" }),
        job({ id: "p6" }),
        job({ id: "p7" }),
        job({ id: "p8" }),
        job({ id: "s1" }),
      ]),
    );
    const next = nextInput([
      job({ id: "o1", department: "Engineering", location: "London" }),
      job({ id: "o2", department: "Engineering", location: null }),
      job({ id: "o3", department: null, location: "London" }),
      job({ id: "s1" }),
    ]);
    const changes = diffHiring(prev, next);
    expect(changes).toHaveLength(1);
    const md = changes[0].metadata;
    expect(md.kind).toBe("role_change");
    expect(md.opened).toBe(3);
    expect(md.closed).toBe(5);
    expect(md.openedTopDepartments).toEqual([
      { group: "Engineering", count: 2 },
      { group: "(none)", count: 1 },
    ]);
    expect(md.openedTopLocations).toEqual([
      { group: "London", count: 2 },
      { group: "(not listed)", count: 1 },
    ]);
    expect(md.closedTopDepartments).toEqual([{ group: "(none)", count: 5 }]);
    expect(md.closedTopLocations).toEqual([{ group: "(not listed)", count: 5 }]);
    // The summary carries both sides' counts.
    expect(changes[0].summary).toContain("3 roles opened and 5 roles closed");
  });

  it("never emits one change per job id", () => {
    const prev = record(boardPayload([]));
    const next = nextInput(
      Array.from({ length: 12 }, (_, i) => job({ id: `n${i}` })),
    );
    expect(diffHiring(prev, next)).toHaveLength(1);
  });
});
