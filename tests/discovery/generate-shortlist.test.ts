import { afterEach, describe, expect, it, vi } from "vitest";

import { generateShortlist } from "../../app/lib/discovery/run.server";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));
vi.mock("../../app/lib/discovery/generators/ai.server", () => ({ aiGenerator: () => Promise.resolve([]) }));
const hn = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("../../app/lib/discovery/generators/hn.server", () => ({ hnGenerator: hn.run }));

const SELF = { workspaceId: "ws-generate", name: "Gymshark", domain: "gymshark.com", description: null, kind: "domain" as const };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateShortlist", () => {
  it("shortlists what the hn generator returns", async () => {
    hn.run.mockResolvedValue([
      {
        name: "Alphalete",
        domain: "alphaleteathletics.com",
        evidence: [{ sourceUrl: "https://news.ycombinator.com/item?id=1", excerpt: "Gymshark and Alphalete", generator: "hn" }],
      },
    ]);

    const result = await generateShortlist(SELF, []);

    expect(result.shortlisted.map((entry) => entry.name)).toEqual(["Alphalete"]);
  });

  it("logs a rejected generator by name and message and returns an empty shortlist", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    hn.run.mockRejectedValue(new Error("hn generator fetch failed with status 503"));

    const result = await generateShortlist(SELF, []);

    expect(result.shortlisted).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      JSON.stringify({ event: "discovery.generator_failed", generator: "hn", message: "hn generator fetch failed with status 503" }),
    );
  });
});
