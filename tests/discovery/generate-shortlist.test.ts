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
vi.mock("../../app/lib/discovery/generators/news", () => ({
  newsGenerator: () =>
    Promise.resolve([
      {
        name: "Alphalete",
        domain: "alphaleteathletics.com",
        evidence: [{ sourceUrl: "https://www.example.com", excerpt: "Gymshark and Alphalete", generator: "news" }],
      },
    ]),
}));
vi.mock("../../app/lib/discovery/generators/hn", () => ({
  hnGenerator: () => Promise.reject(new Error("hn search returned 503")),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateShortlist", () => {
  it("logs a rejected generator by name and message and still returns the others", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await generateShortlist(
      { workspaceId: "ws-generate", name: "Gymshark", domain: "gymshark.com", description: null, kind: "domain" },
      [],
    );

    expect(result.shortlisted.map((entry) => entry.name)).toEqual(["Alphalete"]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      JSON.stringify({ event: "discovery.generator_failed", generator: "hn", message: "hn search returned 503" }),
    );
  });
});
