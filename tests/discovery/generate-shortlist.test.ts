import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureException } from "@sentry/cloudflare";

import { DiscoveryUnavailableError, generateShortlist } from "../../app/lib/discovery/run.server";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
const ai = vi.hoisted(() => ({ run: vi.fn() }));
const hn = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("../../app/lib/discovery/generators/ai.server", () => ({ aiGenerator: ai.run }));

vi.mock("../../app/lib/discovery/generators/hn.server", () => ({ hnGenerator: hn.run }));

const SELF = {
  workspaceId: "ws-generate",
  name: "Gymshark",
  domain: "gymshark.com",
  description: null,
  kind: "domain" as const,
};

beforeEach(() => {
  ai.run.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureException).mockClear();
});

describe("generateShortlist", () => {
  it("shortlists what the hn generator returns", async () => {
    hn.run.mockResolvedValue([
      {
        name: "Alphalete",
        domain: "alphaleteathletics.com",
        evidence: [
          { sourceUrl: "https://news.ycombinator.com/item?id=1", excerpt: "Gymshark and Alphalete", generator: "hn" },
        ],
      },
    ]);

    const result = await generateShortlist(SELF, []);

    expect(result.shortlisted.map((entry) => entry.name)).toEqual(["Alphalete"]);
  });

  it("logs a rejected generator by name and message, reports it to Sentry, and keeps what the other one found", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("hn generator fetch failed with status 503");
    hn.run.mockRejectedValue(failure);
    ai.run.mockResolvedValue([
      {
        name: "Alphalete",
        domain: "alphaleteathletics.com",
        evidence: [{ sourceUrl: "https://gymshark.com/", excerpt: "Proposed", generator: "ai" }],
      },
    ]);

    const result = await generateShortlist(SELF, []);

    expect(result.shortlisted.map((entry) => entry.name)).toEqual(["Alphalete"]);
    expect(errors).toHaveBeenCalledWith(
      JSON.stringify({
        event: "discovery.generator_failed",
        generator: "hn",
        message: "hn generator fetch failed with status 503",
      }),
    );
    expect(captureException).toHaveBeenCalledWith(failure, { tags: { discovery_generator: "hn" } });
  });

  it("throws, instead of returning an empty shortlist, when every generator failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    hn.run.mockRejectedValue(new Error("hn generator fetch failed with status 503"));
    ai.run.mockRejectedValue(new Error("gateway down"));

    const run = generateShortlist(SELF, []);

    await expect(run).rejects.toBeInstanceOf(DiscoveryUnavailableError);
    await expect(run).rejects.toThrow(/hn: hn generator fetch failed with status 503; ai: gateway down/);
  });

  it("marks the failure as a billing refusal when a generator was refused for payment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    hn.run.mockRejectedValue(new Error("hn generator fetch failed with status 503"));
    ai.run.mockRejectedValue(new Error("AiError: 2021: account limited, payment required"));

    const failure: unknown = await generateShortlist(SELF, []).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DiscoveryUnavailableError);
    expect(failure).toHaveProperty("billingRefused", true);
  });

  it("leaves billingRefused false for an ordinary outage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    hn.run.mockRejectedValue(new Error("hn generator fetch failed with status 503"));
    ai.run.mockRejectedValue(new Error("gateway down"));

    const failure: unknown = await generateShortlist(SELF, []).catch((error: unknown) => error);

    expect(failure).toHaveProperty("billingRefused", false);
  });

  it("returns an empty shortlist when the generators ran and found nothing", async () => {
    hn.run.mockResolvedValue([]);

    const result = await generateShortlist(SELF, []);

    expect(result.shortlisted).toEqual([]);
    expect(captureException).not.toHaveBeenCalled();
  });
});
