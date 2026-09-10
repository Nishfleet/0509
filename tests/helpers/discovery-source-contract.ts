/**
 * Shared contract harness for ad-discovery sources.
 *
 * Every discovery source — the Meta browser/API pair today, plus the queued
 * Google Ads Transparency, Google Search, LinkedIn, TikTok, subdomain and
 * hiring sources — has to honour the same two-part contract:
 *
 *   in:  raw page fixtures (JSON payloads or rendered HTML), in request order
 *   out: normalized `AdRecord`s, plus honest labelling when part of the
 *        source failed
 *
 * The honesty half is the half a fresh source forgets, so it is asserted here
 * rather than re-derived per source:
 *
 *   - a partial capture must never read as a complete one
 *   - a labelled failure must carry a `DiscoveryFailureClass`, and never be
 *     presented as a healthy complete capture
 *   - a provider that still served a successful page must not be globally
 *     cooled down
 *   - the discovery cache is only written for a complete capture
 *
 * This module is deliberately source-agnostic: it never imports
 * `~/lib/ad-source.server` or any provider module. The test mocks whichever
 * provider it exercises, hands the fixture fetcher in, and supplies fixtures
 * plus expected records. See the migrated
 * `describe("interactive Meta pagination honesty")` in
 * `tests/ad-source.test.ts` for the worked example.
 */

import { expect, vi, type Mock } from "vitest";

import type {
  AdRecord,
  CommercialDiscoveryStatus,
  DiscoveryFailureClass,
  SearchResponse,
} from "~/lib/types";

/* -------------------------------------------------------------------------- *
 * Fixtures: one entry per page the source is expected to fetch.
 * -------------------------------------------------------------------------- */

export type DiscoveryPageFixture =
  | { readonly kind: "json"; readonly name: string; readonly payload: unknown }
  | { readonly kind: "html"; readonly name: string; readonly html: string }
  | { readonly kind: "failure"; readonly name: string; readonly error: unknown };

/** A page that arrives as a parsed JSON payload. */
export function jsonPage(name: string, payload: unknown): DiscoveryPageFixture {
  return { kind: "json", name, payload };
}

/** A page that arrives as rendered HTML. */
export function htmlPage(name: string, html: string): DiscoveryPageFixture {
  return { kind: "html", name, html };
}

/** A page whose fetch rejects, e.g. a bounded later page that is unavailable. */
export function failingPage(name: string, error: unknown): DiscoveryPageFixture {
  return { kind: "failure", name, error };
}

/* -------------------------------------------------------------------------- *
 * The fixture-backed page fetcher.
 * -------------------------------------------------------------------------- */

export type FixturePageFetcher = Mock<(...args: unknown[]) => Promise<unknown>>;

/**
 * Builds a page fetcher from fixtures: one call consumes one fixture, a
 * `failingPage` rejects, and asking for a page past the end of the fixture
 * list throws — so a source that fetches unboundedly fails loudly instead of
 * silently looping or quietly passing.
 *
 * The runner then requires exactly one call per fixture, which is what makes
 * an under-fetch (a source that quietly stops early) fail as loudly as an
 * over-fetch.
 */
export function createFixturePageFetcher(
  pages: readonly DiscoveryPageFixture[],
): FixturePageFetcher {
  const remaining = [...pages];
  const consumed: string[] = [];

  return vi.fn(async (..._args: unknown[]) => {
    const next = remaining.shift();
    if (!next) {
      throw new Error(
        `discovery fixture fetcher ran out of pages after [${consumed.join(", ")}]`,
      );
    }
    consumed.push(next.name);
    if (next.kind === "failure") {
      throw next.error;
    }
    return next.kind === "html" ? next.html : next.payload;
  });
}

/* -------------------------------------------------------------------------- *
 * Honesty semantics: what the result must say about itself.
 * -------------------------------------------------------------------------- */

export interface DiscoveryHonestyExpectation {
  status: CommercialDiscoveryStatus;
  /**
   * `true` requires the partial flag to be set; `false` requires the result to
   * make no partial claim (the flag is allowed to be absent, which reads as
   * not-partial).
   */
  partial: boolean;
  failureClass: DiscoveryFailureClass | null;
  /** Substring the operator-facing summary must contain. */
  summaryIncludes?: string;
}

/**
 * Asserts the self-description of a discovery result. Beyond the exact
 * fields, this enforces the cross-field invariant every source owes us: a
 * labelled failure is never presented as a healthy complete capture.
 */
export function expectDiscoveryHonesty(
  result: SearchResponse,
  expected: DiscoveryHonestyExpectation,
): void {
  expect(result.discoveryStatus).toBe(expected.status);
  expect(result.discoveryPartial ?? false).toBe(expected.partial);
  expect(result.discoveryFailureClass).toBe(expected.failureClass);

  if (expected.failureClass !== null) {
    expect(
      result.discoveryPartial === true || result.discoveryStatus !== "healthy",
      "a labelled failure must not read as a healthy complete capture",
    ).toBe(true);
  }

  if (expected.summaryIncludes) {
    expect(result.discoverySummary).toEqual(
      expect.stringContaining(expected.summaryIncludes),
    );
  }
}

/** Asserts normalized records, positionally, with a subset match per record. */
export function expectNormalizedRecords(
  actual: readonly AdRecord[],
  expected: readonly Partial<AdRecord>[],
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((record, index) => {
    expect(actual[index]).toMatchObject(record);
  });
}

/* -------------------------------------------------------------------------- *
 * The runner: fixtures + expected records in, contract assertions out.
 * -------------------------------------------------------------------------- */

export interface DiscoverySourceContractCase {
  /** Case name, used in the runner's own failure messages. */
  name: string;
  /**
   * Page fixtures, in the order the source is expected to request them. The
   * runner requires exactly one fetch per fixture, so an unused fixture fails.
   */
  pages: readonly DiscoveryPageFixture[];
  /** What the result must contain and how it must label itself. */
  expect: {
    records: readonly Partial<AdRecord>[];
    nextCursor?: string | null;
    honesty: DiscoveryHonestyExpectation;
  };
  /** Drives the real source code with the fixture-backed fetcher. */
  drive: (context: { fetchPage: FixturePageFetcher }) => Promise<SearchResponse>;
}

export interface DiscoverySourceContractRun {
  result: SearchResponse;
  /** Wall-clock start, so cooldown windows can be checked against it. */
  startedAt: number;
}

/**
 * Runs one contract case: builds the fixture fetcher, drives the source, then
 * asserts the page-fetch bound, records, cursor and honesty. Provider-state
 * and cache-write assertions stay in the test, because only the test holds
 * those mocks.
 */
export async function runDiscoverySourceContract(
  contract: DiscoverySourceContractCase,
): Promise<DiscoverySourceContractRun> {
  const fetchPage = createFixturePageFetcher(contract.pages);
  const startedAt = Date.now();

  const result = await contract.drive({ fetchPage });

  // Exactly one fetch per fixture. Over-fetch throws inside the fetcher, but a
  // source is allowed to catch that and report a partial result, so the count
  // is asserted rather than inferred; under-fetch shows up here too.
  expect(
    fetchPage,
    `${contract.name}: expected exactly ${contract.pages.length} page fetch(es)`,
  ).toHaveBeenCalledTimes(contract.pages.length);

  expectNormalizedRecords(result.ads, contract.expect.records);
  if (contract.expect.nextCursor !== undefined) {
    expect(result.nextCursor).toBe(contract.expect.nextCursor);
  }
  expectDiscoveryHonesty(result, contract.expect.honesty);

  return { result, startedAt };
}

/* -------------------------------------------------------------------------- *
 * Provider-state and cache writes.
 * -------------------------------------------------------------------------- */

interface MockLike {
  mock: { calls: unknown[][] };
}

export interface DiscoveryProviderStateExpectation {
  provider: string;
  status?: CommercialDiscoveryStatus;
  failureClass?: DiscoveryFailureClass | null;
  lastSuccessAt?: string | null;
  /** `metadata.partial` the write must carry. */
  partial?: boolean;
  /** Set when the write must stamp a failure timestamp. */
  lastFailureAtIsSet?: boolean;
}

/** Asserts the source degraded provider state with the expected shape. */
export function expectProviderStateWritten(
  upsertProviderState: MockLike,
  expected: DiscoveryProviderStateExpectation,
): void {
  expect(upsertProviderState).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      provider: expected.provider,
      ...(expected.status === undefined ? {} : { status: expected.status }),
      ...(expected.failureClass === undefined
        ? {}
        : { failureClass: expected.failureClass }),
      ...(expected.lastSuccessAt === undefined
        ? {}
        : { lastSuccessAt: expected.lastSuccessAt }),
      ...(expected.partial === undefined
        ? {}
        : { metadata: expect.objectContaining({ partial: expected.partial }) }),
      ...(expected.lastFailureAtIsSet === true
        ? { lastFailureAt: expect.any(String) }
        : {}),
    }),
  );
}

/** The provider-state input from the first write; throws when none happened. */
export function latestProviderStateWrite(upsertProviderState: MockLike): {
  provider: string;
  failureClass: DiscoveryFailureClass | null;
  metadata: Record<string, unknown> | null;
} {
  const input = upsertProviderState.mock.calls[0]?.[1];
  if (!input || typeof input !== "object") {
    throw new Error("no discovery provider-state write was recorded");
  }
  return input as {
    provider: string;
    failureClass: DiscoveryFailureClass | null;
    metadata: Record<string, unknown> | null;
  };
}

/**
 * Asserts a failed provider was put in global cooldown for `windowMs`, timed
 * from before the run started — never from an earlier cached success.
 */
export function expectProviderStateCooledDown(
  providerStateInput: { metadata: Record<string, unknown> | null },
  windowMs: number,
  notBefore: number,
): void {
  const raw = providerStateInput.metadata?.cooldownUntil;
  expect(typeof raw).toBe("string");
  const cooldownUntil = Date.parse(raw as string);
  expect(Number.isNaN(cooldownUntil)).toBe(false);
  expect(cooldownUntil).toBeGreaterThanOrEqual(notBefore + windowMs);
  expect(cooldownUntil).toBeLessThanOrEqual(Date.now() + windowMs);
}

/** Asserts no recorded provider-state write put the provider in cooldown. */
export function expectNoProviderCooldown(upsertProviderState: MockLike): void {
  for (const call of upsertProviderState.mock.calls) {
    const input = call[1] as { metadata?: Record<string, unknown> | null } | undefined;
    expect(input?.metadata?.cooldownUntil ?? null).toBeNull();
  }
}

/** Asserts the discovery cache was left alone (partial or failed captures). */
export function expectCacheNotWritten(upsertCacheEntry: MockLike): void {
  expect(upsertCacheEntry).not.toHaveBeenCalled();
}

/* -------------------------------------------------------------------------- *
 * The shared discovery data module (`~/lib/data.server`).
 *
 * Every discovery source reads and writes the same discovery cache and
 * provider-state rows through this module, so the mock is built once here
 * instead of being copied into each source's test.
 * -------------------------------------------------------------------------- */

export interface DiscoveryProviderStateFixture {
  provider: string;
  status: CommercialDiscoveryStatus;
  failureClass: DiscoveryFailureClass | null;
  summary: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: string;
}

/**
 * A stored provider-state row; override only the fields a case is about.
 * `provider` is required rather than defaulted, so a new source's case cannot
 * silently seed another provider's state.
 */
export function discoveryProviderStateFixture(
  overrides: Partial<DiscoveryProviderStateFixture> &
    Pick<DiscoveryProviderStateFixture, "provider">,
): DiscoveryProviderStateFixture {
  return {
    status: "healthy",
    failureClass: null,
    summary: "Fixture discovery provider state.",
    lastSuccessAt: "2026-07-29T12:00:00.000Z",
    lastFailureAt: null,
    metadata: null,
    updatedAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
}

export interface DiscoveryDataModuleMock {
  upsertDiscoveryProviderState: Mock;
  upsertDiscoveryCacheEntry: Mock;
}

/**
 * Installs the `~/lib/data.server` mock every discovery source test needs:
 * no cached entry unless one is supplied, the given stored provider state (or
 * none), and spyable write paths. Returns the write spies so the caller can
 * assert on them.
 */
export function mockDiscoveryDataModule(input: {
  providerState?: DiscoveryProviderStateFixture | null;
  cacheEntry?: unknown;
  upsertDiscoveryProviderState?: Mock;
  upsertDiscoveryCacheEntry?: Mock;
} = {}): DiscoveryDataModuleMock {
  const upsertDiscoveryProviderState = input.upsertDiscoveryProviderState ?? vi.fn();
  const upsertDiscoveryCacheEntry = input.upsertDiscoveryCacheEntry ?? vi.fn();

  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry: vi.fn().mockResolvedValue(input.cacheEntry ?? null),
    getDiscoveryProviderState: vi.fn().mockResolvedValue(input.providerState ?? null),
    upsertDiscoveryCacheEntry,
    createDiscoveryFetchLog: vi.fn(),
    upsertDiscoveryProviderState,
  }));

  return { upsertDiscoveryProviderState, upsertDiscoveryCacheEntry };
}
