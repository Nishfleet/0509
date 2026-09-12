import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SampleBriefData } from "~/lib/sample-brief.server";

/**
 * Issue #2136 — /sample-brief public "real Monday brief" page.
 *
 * Covered here:
 *   1. The loader picks the newest sitemap-indexable domain that has at least
 *      one confirmed watch_event in the sample window and builds its digest
 *      HTML through the existing digest builder from stored rows only.
 *      Issue #2969: the window widens tier by tier (30 → 90 → 180 → 365
 *      days) until a real stored change is found, so the public page no
 *      longer leads with an empty week.
 *   2. The digest HTML never leaks a customer workspace name, email, or
 *      watchlist id — the exact stored watchlist name is scrubbed from any
 *      title/summary that embeds it, and the items carry no event/watchlist
 *      ids (so the digest builder's per-item deep links resolve to the public
 *      /ads/:domain page instead of a customer workspace row).
 *   3. The route renders a brief for a fixture domain with the signup CTA.
 *   4. The empty case renders the honest quiet-brief (200), never a
 *      fabricated list.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

// ---------------------------------------------------------------------------
// Data layer — loadSampleBrief against a fake D1 + mocked sitemap gate.
// ---------------------------------------------------------------------------

interface FakeQuery {
  sql: string;
  bindings: unknown[];
}

interface FakeEventRow {
  created_at: string;
  watchlist_id: string;
  status: string;
}

function fakeD1Env(tables: { watchlists?: unknown[]; events?: FakeEventRow[] }) {
  const queries: FakeQuery[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            queries.push({ sql, bindings });
            return {
              async all() {
                if (sql.includes("FROM watchlist")) {
                  return { results: tables.watchlists ?? [] };
                }
                if (sql.includes("FROM watch_event")) {
                  // Honour the real SQL's window: the since binding rides in
                  // the suffix (last two bindings are [since, limit]).
                  const since = String(bindings[bindings.length - 2]);
                  const limit = Number(bindings[bindings.length - 1]);
                  const watchlists = bindings.slice(0, -2).map(String);
                  const rows = (tables.events ?? [])
                    .filter(
                      (event: FakeEventRow) =>
                        watchlists.includes(event.watchlist_id) &&
                        event.status === "confirmed" &&
                        event.created_at >= since,
                    )
                    .slice(0, limit);
                  return { results: rows };
                }
                throw new Error(`Unexpected SQL: ${sql}`);
              },
            };
          },
        };
      },
    },
  };
  return { env, queries };
}

function watchlistRow(overrides: Partial<{ id: string; target_id: string; name: string }> = {}) {
  return {
    id: overrides.id ?? "wl-1",
    target_id: overrides.target_id ?? "https://nykaa.com",
    name: overrides.name ?? "Nish's secret watch",
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    watchlist_id: "wl-1",
    run_id: "run-1",
    event_type: "landing_page_offer_changed",
    status: "confirmed",
    importance_score: 75,
    ad_id: null,
    baseline_from_run_id: null,
    candidate_id: null,
    proof_capture_id: null,
    // The stored title/summary embed the owner's watchlist name and other
    // account identifiers — they must NEVER reach the public digest.
    title: "Offer changed on Nish's secret watch",
    summary: "Stored for owner user-12345's watchlist.",
    // The real-world metadata carries proofTargetIdentity, built as
    // [watchlistId, adId, canonicalPageIdentity].join(":") — it embeds the
    // watchlist id and must never reach the public digest.
    metadata_json: JSON.stringify({
      from: "$68",
      to: "$52",
      proofTargetIdentity: "wl-1:ad-1:nykaa.com",
    }),
    // Relative, not absolute: this confirmed change must stay inside the
    // 30-day window whenever the suite runs (issue #3215).
    confirmed_at: isoAgo(2 * DAY_MS),
    suppressed_at: null,
    invalidated_at: null,
    last_evaluated_at: isoAgo(2 * DAY_MS),
    created_at: isoAgo(2 * DAY_MS),
    ...overrides,
  };
}

let loadIndexableAdsInternalLinks: ReturnType<typeof vi.fn>;

function installLoaderMocks(options: {
  links?: { domain: string; path: string; name: string }[];
  watchlists?: unknown[];
  events?: FakeEventRow[];
} = {}) {
  loadIndexableAdsInternalLinks = vi.fn().mockResolvedValue(
    options.links ?? [
      { domain: "nykaa.com", path: "/ads/nykaa.com", name: "Nykaa" },
      { domain: "meesho.com", path: "/ads/meesho.com", name: "Meesho" },
    ],
  );
  vi.doMock("~/lib/ads-internal-links.server", () => ({
    loadIndexableAdsInternalLinks,
    displayNameFromDomain: (domain: string) =>
      domain === "nykaa.com" ? "Nykaa" : domain === "meesho.com" ? "Meesho" : domain,
  }));
  return fakeD1Env({
    watchlists: options.watchlists,
    events: options.events,
  });
}

async function runLoader(env: Record<string, unknown>): Promise<SampleBriefData> {
  const { loadSampleBrief } = await import("~/lib/sample-brief.server");
  return loadSampleBrief(env as never);
}

describe("loadSampleBrief (issue #2136)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/ads-internal-links.server");
    vi.doUnmock("~/lib/data/d1.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("picks the newest indexable domain with a stored event and builds a digest from stored rows only", async () => {
    const { env } = installLoaderMocks({
      // Newest indexable domain (nykaa) has a stored event → it wins.
      watchlists: [watchlistRow()],
      events: [eventRow()],
    });

    const result = await runLoader(env);

    expect(result.quiet).toBe(false);
    expect(result.domain).toBe("nykaa.com");
    expect(result.brand).toBe("Nykaa");
    // The digest HTML is built by the existing digest builder.
    expect(result.digestHtml).toContain("Top moves");
    // The title is derived from the event type (system vocabulary).
    expect(result.digestHtml).toContain("Offer changed");
    // The digest builder renders the capture date (formatted). The fixture
    // uses a relative timestamp (issue #3215), so assert the shape of the
    // rendered date rather than a calendar day that would drift.
    expect(result.digestHtml).toMatch(/\d{1,2} Sept(ember)? \d{4}/);
  });

  it("never leaks a customer workspace name, email, or watchlist id into the digest", async () => {
    const { env } = installLoaderMocks({
      watchlists: [watchlistRow()],
      events: [eventRow()],
    });

    const result = await runLoader(env);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "Nish's secret watch",
      "user-12345",
      "wl-1",
      "run-1",
      "evt-1",
      "watchlist",
      "proofTargetIdentity",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The stored title/summary (which embed the owner's watchlist name and
    // user id) are never used verbatim — the title is derived from the event
    // type and the summary is a generic safe line.
    expect(result.digestHtml).not.toContain("Nish's secret watch");
    expect(result.digestHtml).not.toContain("user-12345");
    expect(result.digestHtml).toContain("Offer changed");
    // The digest builder's per-item deep link resolves to the public /ads
    // page, never a customer workspace row.
    expect(result.digestHtml).toContain("/ads/nykaa.com");
    expect(result.digestHtml).not.toContain("/app/watchlists");
  });

  it("skips a non-indexable domain even when it has stored events", async () => {
    const { env } = installLoaderMocks({
      // Only meesho is indexable; nykaa is not in the sitemap set.
      links: [{ domain: "meesho.com", path: "/ads/meesho.com", name: "Meesho" }],
      watchlists: [
        watchlistRow({ id: "wl-nykaa", target_id: "https://nykaa.com" }),
        watchlistRow({ id: "wl-meesho", target_id: "https://meesho.com" }),
      ],
      events: [
        eventRow({ id: "evt-nykaa", watchlist_id: "wl-nykaa", created_at: isoAgo(1 * DAY_MS) }),
        eventRow({ id: "evt-meesho", watchlist_id: "wl-meesho", created_at: isoAgo(2 * DAY_MS) }),
      ],
    });

    const result = await runLoader(env);

    // nykaa is not indexable, so meesho (the only indexable domain) wins.
    expect(result.domain).toBe("meesho.com");
    expect(result.brand).toBe("Meesho");
    expect(result.quiet).toBe(false);
  });

  it("renders the honest quiet-brief when no indexable domain has a stored event", async () => {
    const { env } = installLoaderMocks({
      watchlists: [watchlistRow()],
      events: [],
    });

    const result = await runLoader(env);

    expect(result.quiet).toBe(true);
    expect(result.domain).toBe("nykaa.com");
    expect(result.brand).toBe("Nykaa");
    // The quiet-brief is a real digest, not a fabricated list.
    expect(result.digestHtml).toContain("All quiet");
    expect(result.digestHtml).not.toContain("Top moves");
    // Issue #2969: the quiet copy names the widest window actually searched.
    expect(result.digestHtml).toContain("in the last 365 days.");
  });

  it("widens the window past the 30-day tier until a real change is found (issue #2969)", async () => {
    const { env } = installLoaderMocks({
      watchlists: [watchlistRow()],
      // The only stored change is 150 days old — outside the 30- and 90-day
      // windows, inside the 180-day tier.
      events: [eventRow({ created_at: isoAgo(150 * DAY_MS) })],
    });

    const result = await runLoader(env);

    expect(result.quiet).toBe(false);
    expect(result.domain).toBe("nykaa.com");
    // The brief period is the tier that produced the rows (180 days), so the
    // digest is honest about its own recency (tolerance for test ticking).
    const startMs = Date.parse(result.periodStart);
    const target = Date.now() - 180 * DAY_MS;
    expect(Math.abs(startMs - target)).toBeLessThan(60_000);
    expect(result.digestHtml).toContain("Top moves");
  });

  it("prefers the shallowest tier: a fresh event wins over an older one", async () => {
    const { env } = installLoaderMocks({
      watchlists: [watchlistRow()],
      // A fresh event exists, so the 30-day tier must be used without
      // widening — even though an older change is also on file.
      events: [
        eventRow({ id: "evt-fresh", created_at: isoAgo(10 * DAY_MS) }),
        eventRow({ id: "evt-old", created_at: isoAgo(150 * DAY_MS) }),
      ],
    });

    const result = await runLoader(env);

    expect(result.quiet).toBe(false);
    const startMs = Date.parse(result.periodStart);
    const target = Date.now() - 30 * DAY_MS;
    expect(Math.abs(startMs - target)).toBeLessThan(60_000);
  });

  it("renders the quiet-brief with no brand when no domain is indexable at all", async () => {
    const { env } = installLoaderMocks({ links: [] });

    const result = await runLoader(env);

    expect(result.quiet).toBe(true);
    expect(result.domain).toBe("");
    expect(result.brand).toBe("");
    expect(result.digestHtml).toContain("All quiet");
  });
});

// ---------------------------------------------------------------------------
// Route — renders a brief for a fixture domain, no workspace name/email, 200
// in the empty case.
// ---------------------------------------------------------------------------

function createContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

let currentData: SampleBriefData;

function installRenderMocks() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
    };
  });
}

async function render(data: SampleBriefData): Promise<string> {
  currentData = data;
  const { default: SampleBriefRoute } = await import("~/routes/sample-brief");
  return renderToStaticMarkup(createElement(SampleBriefRoute));
}

function populatedBrief(overrides: Partial<SampleBriefData> = {}): SampleBriefData {
  return {
    domain: "nykaa.com",
    brand: "Nykaa",
    digestHtml: "<div>Top moves: offer changed $68 → $52</div>",
    quiet: false,
    periodStart: isoAgo(30 * DAY_MS),
    periodEnd: new Date().toISOString(),
    ...overrides,
  };
}

describe("/sample-brief route (issue #2136)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("react-router");
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/sample-brief.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("loader returns the sample brief data", async () => {
    const loadSampleBrief = vi.fn().mockResolvedValue(populatedBrief());
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/sample-brief.server", () => ({ loadSampleBrief }));

    const { loader } = await import("~/routes/sample-brief");
    const data = await (loader as (args: unknown) => Promise<SampleBriefData>)({
      context: createContext({ DB: {} }),
    });

    expect(data.domain).toBe("nykaa.com");
    expect(data.brand).toBe("Nykaa");
    expect(loadSampleBrief).toHaveBeenCalledWith(expect.anything());
  });

  it("renders a brief for a fixture domain with the heading and signup CTA", async () => {
    installRenderMocks();
    const markup = await render(populatedBrief());

    expect(markup).toContain("A real Monday brief for Nykaa");
    expect(markup).toContain("Top moves");
    // The signup CTA carries the competitor domain and the sample_brief source.
    expect(markup).toContain(
      'href="/auth/signup?competitor=nykaa.com&amp;source=sample_brief"',
    );
    expect(markup).toContain("Get this every Monday, free");
  });

  it("renders the quiet-brief heading and CTA in the empty case (200, never a fabricated list)", async () => {
    installRenderMocks();
    const markup = await render(
      populatedBrief({
        quiet: true,
        digestHtml: "<div>All quiet: no competitor moves worth action.</div>",
      }),
    );

    expect(markup).toContain("A real Monday brief");
    expect(markup).not.toContain("A real Monday brief for");
    expect(markup).toContain("All quiet");
    expect(markup).toContain("Get this every Monday, free");
    // The CTA still carries the sample_brief source.
    expect(markup).toContain("source=sample_brief");
  });
});
