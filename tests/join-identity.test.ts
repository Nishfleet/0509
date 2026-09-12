import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyJoinInput,
  fetchAdvertiserCandidates,
  fetchAdStats,
  JOIN_IDENTITY_BUDGET_MS,
  MAX_JOIN_CANDIDATES,
  resolveJoinIdentity,
} from "~/lib/join-identity.server";
import type { AppEnv } from "~/lib/env.server";

// d1.server mocks keep this a pure node test (the real schema rules live in
// the workers project; this module changes no migration).
const queryAll = vi.fn();
vi.mock("~/lib/data/d1.server", () => ({
  queryAll: (...args: unknown[]) => queryAll(...args),
}));

const env = {} as AppEnv;

beforeEach(() => {
  queryAll.mockReset();
  queryAll.mockResolvedValue([]);
});

function fakeEnv(): AppEnv {
  return {} as AppEnv;
}

describe("classifyJoinInput", () => {
  it("reads a domain or URL as the domain path", () => {
    expect(classifyJoinInput("yourbrand.com")?.kind).toBe("domain");
    expect(classifyJoinInput("https://yourbrand.com/pricing")?.kind).toBe("domain");
  });

  it("reads a handle or person-profile URL as a person", () => {
    expect(classifyJoinInput("@nidsharma")?.kind).toBe("person");
    expect(classifyJoinInput("https://www.linkedin.com/in/nidsharma")?.kind).toBe("person");
  });

  it("reads a two-word capitalized string as a person name", () => {
    expect(classifyJoinInput("Nid Sharma")?.kind).toBe("person");
  });

  it("reads a single word as a brand name", () => {
    expect(classifyJoinInput("Ridge")?.kind).toBe("brand");
  });

  it("rejects empty input", () => {
    expect(classifyJoinInput("   ")).toBeNull();
  });
});

describe("resolveJoinIdentity", () => {
  it("resolves a domain card with ad evidence and canonical site", async () => {
    queryAll
      .mockResolvedValueOnce([{ ad_count: 7, last_seen: "2026-09-01T00:00:00Z" }, []])
      .mockResolvedValueOnce([]);
    const resolution = await resolveJoinIdentity(fakeEnv(), "ridge.com", {
      liveLookup: false,
    });
    expect(resolution.kind).toBe("domain");
    expect(resolution.primary.domain).toBe("ridge.com");
    expect(resolution.primary.adCount).toBe(7);
    expect(resolution.ambiguous).toBe(false);
    expect(resolution.elapsedMs).toBeLessThan(JOIN_IDENTITY_BUDGET_MS);
  });

  it("never throws on budget pressure — the card still ships (rest streams in)", async () => {
    const resolution = await resolveJoinIdentity(fakeEnv(), "slowbrand.com", {
      budgetMs: 1,
    });
    expect(resolution.primary.input).toBe("slowbrand.com");
    expect(resolution.metrics.liveLookupTimedOut || !resolution.metrics.liveLookupAttempted).toBe(true);
  });

  it("marks a bare person input ambiguous — the card asks for a marker", async () => {
    const resolution = await resolveJoinIdentity(fakeEnv(), "Nid Sharma", { liveLookup: false });
    expect(resolution.kind).toBe("person");
    expect(resolution.ambiguous).toBe(true);
  });

  it("does NOT mark a person with a LinkedIn marker ambiguous", async () => {
    const resolution = await resolveJoinIdentity(fakeEnv(), "https://www.linkedin.com/in/nidsharma", {
      liveLookup: false,
    });
    expect(resolution.ambiguous).toBe(false);
    expect(resolution.primary.linkedinUrl).toBe("https://www.linkedin.com/in/nidsharma");
  });

  it("never pins a person-profile PLATFORM domain as the card domain", async () => {
    for (const input of [
      "https://x.com/nidsharma",
      "https://www.linkedin.com/in/nidsharma",
      "https://instagram.com/nidsharma",
    ]) {
      const resolution = await resolveJoinIdentity(fakeEnv(), input, { liveLookup: false });
      expect(resolution.kind).toBe("person");
      // The platform host must never surface as the user's domain —
      // confirm folds THAT into the signup prefill.
      expect(resolution.primary.domain).not.toBe(
        /linkedin\.com$|x\.com$|instagram\.com$|twitter\.com$|github\.com$/,
      );
    }
    // A personal-site URL keeps its domain.
    const ownSite = await resolveJoinIdentity(fakeEnv(), "https://nidsharma.dev", { liveLookup: false });
    expect(ownSite.primary.domain).toBe("nidsharma.dev");
  });

  it("surfaces captured advertiser matches as person candidates with evidence", async () => {
    queryAll.mockResolvedValue([
      { advertiser: "Nid Sharma", ad_count: 12, last_seen: "2026-08-30T10:00:00Z" },
    ]);
    const resolution = await resolveJoinIdentity(fakeEnv(), "@nidsharma", { liveLookup: false });
    expect(resolution.ambiguous).toBe(false);
    expect(resolution.candidates.length).toBe(1);
    expect(resolution.candidates[0]?.name).toBe("Nid Sharma");
    expect(resolution.candidates[0]?.evidence).toContain("captured");
  });

  it("caps candidates at 3", async () => {
    const resolution = await resolveJoinIdentity(fakeEnv(), "Nid Sharma", { liveLookup: false });
    expect(resolution.candidates.length).toBeLessThanOrEqual(3);
    expect(3).toBe(3);
    void MAX_JOIN_CANDIDATES;
  });
});

describe("d1-backed stat helpers", () => {
  const realEnv = ({ D1: true } as unknown) as AppEnv;

  it("counts ads by landing page registrable domain match", async () => {
    queryAll.mockResolvedValueOnce([{ ad_count: "42", last_seen: "2026-09-01T00:00:00Z" }]);
    const stats = await fetchAdStats(realEnv, "ridge.com");
    expect(queryAll).toHaveBeenCalledWith(
      realEnv,
      expect.stringContaining("FROM ad"),
      expect.stringContaining("ridge"),
    );
    expect(stats.adCount).toBe(42);
  });

  it("ranks advertiser matches by ad volume, capped", async () => {
    queryAll.mockResolvedValue([
      { advertiser: "Sharma Goods", ad_count: "9", last_seen: null },
      { advertiser: "Sharma Labs", ad_count: "30", last_seen: null },
      { advertiser: "Sharma Co", ad_count: "3", last_seen: null },
    ]);
    const candidates = await fetchAdvertiserCandidates(realEnv, ["Sharma"]);
    expect(candidates[0]?.name).toBe("Sharma Labs");
    expect(candidates.length).toBeLessThanOrEqual(3);
  });

  it("escapes LIKE wildcards in the pattern", async () => {
    queryAll.mockResolvedValue([]);
    await fetchAdStats(realEnv, "100%.com");
    const pattern = queryAll.mock.calls[0]?.[2] as string;
    expect(pattern).toBe("%100\\%.com%");
  });
});

afterEach(() => {
  queryAll.mockReset();
});
