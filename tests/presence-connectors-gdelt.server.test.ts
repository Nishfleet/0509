import { beforeEach, describe, expect, it, vi } from "vitest";

import { gdeltConnector, normalizeQueryPhrase } from "~/lib/presence-connectors/gdelt.server";
import type { PresenceSafeFetchResult } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

vi.mock("~/lib/presence-robots.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/presence-robots.server")>();
  return { ...actual, presenceSafeFetch: vi.fn() };
});

import { presenceSafeFetch } from "~/lib/presence-robots.server";

const mockedSafeFetch = vi.mocked(presenceSafeFetch);

beforeEach(() => {
  mockedSafeFetch.mockReset();
});

/**
 * Issue #3178 (salvage) — the surviving hardening deltas of the parallel
 * mentions lane, ported onto the landed #3251 GDELT connector:
 *
 * 1. `normalizeQueryPhrase` — the match phrase cannot break out of the
 *    GDELT quoted-phrase wrapper or smuggle DOC 2.1 operator syntax
 *    (`sourcelang:`, `domain:`, `(` `)` OR groups, `|` alternation); a match
 *    phrase is not a query. Quotes are stripped, whitespace collapsed, the
 *    remainder fails closed.
 * 2. Stored GDELT article URLs only become canonical when they survive
 *    `normalizePublicHttpUrl` — third-party rows, honest skips otherwise.
 * 3. `poll` fail-closes on a stored phrase that no longer normalizes without
 *    spending the fair-use budget (exactly one request per poll).
 *
 * The happy path, the on-the-wire request shape and the rollout gate are the
 * integration test's job (`tests/integration/gdelt-mention-connector
 * .integration.test.ts`); this file pins the guards only. The
 * `presenceSafeFetch` boundary is module-mocked so the guards are provable
 * without the resolver's DNS hop.
 */

const rolledOutEnv = { PRESENCE_GDELT_ROLLOUT: "internal" } as AppEnv;

function makeCtx(fetchImpl: typeof fetch = vi.fn()): PresenceConnectorContext {
  return {
    env: rolledOutEnv,
    userId: "user-gdelt-1",
    trackingMode: "competitor",
    connection: null,
    fetchImpl,
  };
}

function safeFetchOk(body: string): PresenceSafeFetchResult {
  return { ok: true, status: 200, body, contentType: "application/json", etag: null, lastModified: null };
}

/** GDELT DOC 2.1 artlist JSON fixture: one good, one loopback, one junk. */
const GOOD_URL = "https://www.bbc.com/news/tech-68012345#section";
const GDELT_ARTLIST = JSON.stringify({
  articles: [
    { url: GOOD_URL, title: "Acme Robotics ships its first home robot", seendate: "20260912T083000Z", domain: "bbc.co.uk" },
    { url: "http://127.0.0.1:8787/secret", title: "Loopback-only article", seendate: "20260912T090000Z" },
    { url: "httpnonsense", title: "Unparseable article" },
  ],
});

describe("normalizeQueryPhrase — a match phrase is not a query", () => {
  it("strips quoting and collapses whitespace", () => {
    expect(normalizeQueryPhrase('  Acme   "Robotics"  Corp ')).toBe("Acme Robotics Corp");
    expect(normalizeQueryPhrase('Ni"ke "Air" Max')).toBe("Nike Air Max");
  });

  it("fails closed on GDELT operator metacharacters and quote-only input", () => {
    expect(normalizeQueryPhrase("Acme sourcelang:eng")).toBeNull();
    expect(normalizeQueryPhrase("Acme (robotics) OR")).toBeNull();
    expect(normalizeQueryPhrase("acme|acmi")).toBeNull();
    expect(normalizeQueryPhrase('""')).toBeNull();
  });

  it("keeps a plain phrase and enforces the 256-character API bound", () => {
    expect(normalizeQueryPhrase("Acme Robotics")).toBe("Acme Robotics");
    expect(normalizeQueryPhrase("x".repeat(256))).toBe("x".repeat(256));
    expect(normalizeQueryPhrase("x".repeat(257))).toBeNull();
  });

  it("accepts only stringish input", () => {
    expect(normalizeQueryPhrase(null)).toBeNull();
    expect(normalizeQueryPhrase(undefined)).toBeNull();
  });
});

describe("gdelt validateTarget — stores the safe quoted phrase", () => {
  it("normalizes, quotes and stores the phrase without touching the network", async () => {
    const fetchImpl = vi.fn();
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: 'Acme   "Robotics"  Corp' },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.targetKey).toBe("acme robotics corp");
    expect(result.metadata?.matchPhrase).toBe("Acme Robotics Corp");
    expect(result.metadata?.gdeltQuery).toBe('"Acme Robotics Corp"');
    // Validation is a no-network contract: the fair-use budget is untouched.
    expect(mockedSafeFetch).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the phrase carries GDELT query syntax", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: 'Acme" sourcelang:eng' },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("match_phrase_invalid");
    expect(result.coverageLabel).toBe("UNAVAILABLE");
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("keeps the landed 256-character length contract", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "x".repeat(257) },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("match_phrase_too_long");
  });
});

describe("gdelt poll — fail-closed stored phrase, public-URL canonicalization", () => {
  const target = (matchPhrase: string) => ({
    targetHandle: matchPhrase,
    targetUrl: null,
    metadata: { matchPhrase },
    targetKey: matchPhrase.toLowerCase(),
  });

  it("fail-closes on an unusable stored phrase without spending the fair-use budget", async () => {
    const result = await gdeltConnector.poll(makeCtx(), target('Acme" sourcelang:eng'));
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.errorCode).toBe("match_phrase_invalid");
    expect(result.errorMessage).toContain("fix the target's match phrase");
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("makes exactly one request and keeps only normalizable public article URLs", async () => {
    mockedSafeFetch.mockResolvedValueOnce(safeFetchOk(GDELT_ARTLIST));
    const result = await gdeltConnector.poll(makeCtx(), target("Acme Robotics"));

    expect(result.ok).toBe(true);
    // Fair-use rate budget: one serialized request per poll — never more.
    expect(mockedSafeFetch).toHaveBeenCalledTimes(1);

    // The loopback article (127.0.0.1) and the unparseable one are honestly
    // skipped, never stored or rendered.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].canonicalUrl).toBe("https://www.bbc.com/news/tech-68012345");
    expect(result.items[0].externalId).toBe("https://www.bbc.com/news/tech-68012345");
  });
});
