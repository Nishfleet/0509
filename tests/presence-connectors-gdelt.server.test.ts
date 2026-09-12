import { describe, expect, it, vi, beforeEach } from "vitest";

import { gdeltConnector } from "~/lib/presence-connectors/gdelt.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

/**
 * Issue #3178 — GDELT DOC 2.1 mainstream-news mention connector.
 *
 * The network hop is mocked at the `presenceSafeFetch` boundary (the module is
 * vi-mocked): the unit test asserts the rate-budget contract (exactly ONE art
 * list query per poll, fair-use maxrecords/timespan, no second hop per
 * article) plus parse/normalize behavior on real GDELT response fixtures.
 * Order-backed acceptance items gated behind env.PRESENCE_GDELT_MOCK are
 * exercised in the companion integration test on real D1.
 */

vi.mock("~/lib/presence-robots.server", () => ({
  presenceSafeFetch: vi.fn(),
}));

import { presenceSafeFetch } from "~/lib/presence-robots.server";

const mockedSafeFetch = vi.mocked(presenceSafeFetch);

beforeEach(() => {
  mockedSafeFetch.mockReset();
});

const activatedEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
  PRESENCE_GDELT_ROLLOUT: "internal",
  PRESENCE_X_ROLLOUT: "disabled",
  PRESENCE_REDDIT_ROLLOUT: "disabled",
  PRESENCE_RSS_ROLLOUT: "disabled",
} satisfies Partial<AppEnv> as AppEnv;

function makeCtx(env: AppEnv = activatedEnv): PresenceConnectorContext {
  return { env, userId: "u1", trackingMode: "competitor" };
}

/** Real GDELT DOC 2.1 artlist JSON response shape (format=json). */
const GDELT_ARTLIST = JSON.stringify({
  articles: [
    {
      url: "https://www.techrepublic.com/article/acme-robotics-expands",
      url_mobile: "",
      title: "Acme Robotics expands into European warehouses",
      seendate: "20260912T083000Z",
      socialimage: "https://img.example/1.jpg",
      domain: "techrepublic.com",
      language: "English",
      sourcecountry: "United States",
    },
    {
      // missing title -> skipped
      url: "https://bad.example/no-title",
      seendate: "20260912T090000Z",
    },
    {
      url: "https://www.bbc.com/news/tech-68012345",
      title: "Acme Robotics ships its first home robot",
      seendate: "not-a-date",
      domain: "bbc.co.uk",
      language: "English",
      sourcecountry: "United Kingdom",
    },
  ],
});

function mockHttpResponse(status: number, body: string | null) {
  mockedSafeFetch.mockResolvedValueOnce(
    status === 200
      ? {
          ok: true,
          status: 200,
          body,
          contentType: "application/json",
          etag: null,
          lastModified: null,
          finalUrl: "https://api.gdeltproject.org/api/v2/doc/doc",
        }
      : { ok: false, status, body: null, contentType: null, etag: null, lastModified: null },
  );
}

describe("gdelt mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("gdelt");
    expect(connector).toBe(gdeltConnector);
    expect(connector.id).toBe("gdelt");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const gdelt = docs.find((entry) => entry.sourceId === "gdelt");
    expect(gdelt).toBeDefined();
    expect(gdelt?.productionStatus).toBe("gated");
  });
});

describe("gdelt mention connector — validateTarget", () => {
  it("normalizes the brand match phrase into a query target", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "  Acme   Robotics  " },
      makeCtx(activatedEnv),
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe("acme robotics");
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.metadata?.query).toBe("Acme Robotics");
    // Validation does not touch the network — no wasted request against the
    // fair-use budget.
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects a missing phrase", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "" },
      makeCtx(activatedEnv),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_query");
  });

  it("rejects a phrase longer than the GDELT query bound", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "x".repeat(200) },
      makeCtx(activatedEnv),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_query");
  });

  it("fails closed when the phrase would break out of the exact-match quotes", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: 'Acme" domain:nytimes.com' },
      makeCtx(activatedEnv),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_query");
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects on a disabled rollout gate without network calls", async () => {
    const disabledEnv = { ...activatedEnv, PRESENCE_GDELT_ROLLOUT: "disabled" } as AppEnv;
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "Acme Robotics" },
      makeCtx(disabledEnv),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("connector_disabled");
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });
});

describe("gdelt mention connector — poll", () => {
  it("parses real artlist fixtures into normalized mentions", async () => {
    mockHttpResponse(200, GDELT_ARTLIST);
    const result = await gdeltConnector.poll(makeCtx(activatedEnv), {
      metadata: { query: "Acme Robotics" },
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    const first = result.items[0];
    expect(first?.canonicalUrl).toBe("https://www.techrepublic.com/article/acme-robotics-expands");
    expect(first?.title).toBe("Acme Robotics expands into European warehouses");
    // GDELT seendate (YYYYMMDDTHHMMSSZ) must parse to ISO.
    expect(first?.publishedAt).toBe("2026-09-12T08:30:00.000Z");
    expect(first?.contentHash).toBeTruthy();
    expect(first?.externalId).toBe(first?.canonicalUrl);
    // Terms compliance: every item cites the API and keeps the source domain.
    expect(first?.raw).toMatchObject({
      provider: "gdelt_doc_2_1",
      sourceDomain: "techrepublic.com",
    });
    // An unparseable seendate stays null — a fabricated date is never stored.
    expect(result.items[1]?.publishedAt).toBeNull();
  });

  it("sends exactly ONE fair-use request per poll with budgeted parameters", async () => {
    mockHttpResponse(200, GDELT_ARTLIST);
    const result = await gdeltConnector.poll(makeCtx(activatedEnv), {
      metadata: { query: "Acme Robotics" },
    });
    expect(result.ok).toBe(true);
    expect(mockedSafeFetch).toHaveBeenCalledTimes(1);
    const [url] = mockedSafeFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("mode=artlist");
    expect(String(url)).toContain("maxrecords=75");
    expect(String(url)).toContain("timespan=1d");
    // The phrase is a QUOTED exact-phrase query.
    expect(String(url)).toContain(encodeURIComponent('"Acme Robotics"'));
  });

  it("stays under the 75-record budget even when the API returns more", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      url: `https://news.example/story-${String(i).padStart(3, "0")}`,
      title: `Coverage item ${i}`,
      seendate: "20260912T080000Z",
      domain: "news.example",
      language: "English",
      sourcecountry: "United States",
    }));
    mockHttpResponse(200, JSON.stringify({ articles: many }));
    const result = await gdeltConnector.poll(makeCtx(activatedEnv), {
      metadata: { query: "Acme" },
    });
    expect(result.ok).toBe(true);
    expect(result.items.length).toBe(75);
    // Still exactly one network request for the whole poll.
    expect(mockedSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("reports rate_limited on HTTP 429 instead of retrying in a loop", async () => {
    mockHttpResponse(429, null);
    const result = await gdeltConnector.poll(makeCtx(activatedEnv), {
      metadata: { query: "Acme" },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("rate_limited");
    expect(mockedSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("reports gdelt_unavailable on an HTTP failure", async () => {
    mockHttpResponse(503, null);
    const result = await gdeltConnector.poll(makeCtx(activatedEnv), {
      metadata: { query: "Acme" },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("gdelt_unavailable");
    expect(result.items).toHaveLength(0);
  });

  it("fails honestly on a non-JSON body (never fabricates a mention)", async () => {
    mockHttpResponse(200, "<html>service page</html>");
    const result = await gdeltConnector.poll(makeCtx(activatedEnv), {
      metadata: { query: "Acme" },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("gdelt_parse_failed");
  });

  it("serves the deterministic fixture mention when PRESENCE_GDELT_MOCK=1", async () => {
    const mockEnv = { ...activatedEnv, PRESENCE_GDELT_MOCK: "1" } as AppEnv;
    const result = await gdeltConnector.poll(makeCtx(mockEnv), {
      metadata: { query: "Fixture Brand" },
    });
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toContain("Fixture brand");
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });
});
