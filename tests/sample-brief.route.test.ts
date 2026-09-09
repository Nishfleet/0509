import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOWED_SIGNUP_SOURCES, SAMPLE_BRIEF_SIGNUP_SOURCE } from "~/lib/signup-source";
import { SITEMAP_PATHS } from "~/lib/seo";

/**
 * Issue #2136 — /sample-brief renders one real Monday brief for a public
 * brand from stored rows only, and must never leak a customer workspace name,
 * email, watchlist id, or a non-indexable domain.
 */

const FIXTURE_DOMAIN = "nykaa.com";
const FIXTURE_BRAND_NAME = "Nykaa";
const CUSTOMER_WATCHLIST_NAME = "Acme Pvt Ltd internal list";
const CUSTOMER_WATCHLIST_ID = "wl_secret_fixture_001";
const CUSTOMER_EMAIL = "owner@acme-secret.example";

const RECENT_ISO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

function fixtureLinks() {
  return [
    { domain: FIXTURE_DOMAIN, path: `/ads/${FIXTURE_DOMAIN}`, name: FIXTURE_BRAND_NAME },
    { domain: "decoy.com", path: "/ads/decoy.com", name: "Decoy" },
  ];
}

function fixtureEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev_fixture_1",
    watchlist_id: CUSTOMER_WATCHLIST_ID,
    run_id: "run_fixture_1",
    event_type: "landing_page_offer_changed",
    status: "confirmed",
    importance_score: 80,
    ad_id: null,
    baseline_from_run_id: null,
    candidate_id: null,
    proof_capture_id: "proof_fixture_1",
    title: "Landing page offer changed",
    // System-generated summaries can embed the customer's watchlist name —
    // the fixture deliberately does so the scrub is proven, not assumed.
    summary: `The offer changed on ${CUSTOMER_WATCHLIST_NAME}.`,
    metadata_json: JSON.stringify({
      sourceUrl: "https://nykaa.com/offer",
      from: "20% off",
      to: "30% off",
      capturedAt: RECENT_ISO,
    }),
    confirmed_at: RECENT_ISO,
    suppressed_at: null,
    invalidated_at: null,
    last_evaluated_at: null,
    created_at: RECENT_ISO,
    watchlist_name: CUSTOMER_WATCHLIST_NAME,
    watchlist_target_id: "https://www.nykaa.com",
    ...overrides,
  };
}

function fixtureRunRow() {
  return {
    watchlist_id: CUSTOMER_WATCHLIST_ID,
    target_id: "https://www.nykaa.com",
    ads_seen: 12,
  };
}

interface MockOptions {
  links?: ReturnType<typeof fixtureLinks>;
  eventRows?: Array<Record<string, unknown>>;
  runRows?: Array<Record<string, unknown>>;
}

function installMocks(options: MockOptions = {}) {
  const env = { DB: { fixture: true } };
  const links = options.links ?? fixtureLinks();
  const eventRows = options.eventRows ?? [fixtureEventRow()];
  const runRows = options.runRows ?? [fixtureRunRow()];

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/ads-internal-links.server", () => ({
    loadIndexableAdsInternalLinks: vi.fn(async () => links),
  }));
  vi.doMock("~/lib/data/d1.server", () => ({
    queryAll: vi.fn(async (_env: unknown, sql: string) => {
      if (sql.includes("FROM watch_event")) {
        return eventRows;
      }
      if (sql.includes("FROM watchlist_run")) {
        return runRows;
      }
      return [];
    }),
    queryOne: vi.fn(async () => null),
    queryIn: vi.fn(async () => []),
    execute: vi.fn(async () => ({ success: true })),
  }));
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn(),
      useRouteLoaderData: () => undefined,
    };
  });

  return { env };
}

async function runLoader(env: Record<string, unknown>) {
  const { loader } = await import("~/routes/sample-brief");
  return loader({
    context: { cloudflare: { env } },
    request: new Request("https://0509.io/sample-brief"),
  } as never);
}

async function renderWithData(data: Awaited<ReturnType<typeof runLoader>>) {
  const React = await import("react");
  const { useLoaderData } = await import("react-router");
  vi.mocked(useLoaderData).mockReturnValue(data);
  const { default: SampleBriefRoute } = await import("~/routes/sample-brief");
  return renderToStaticMarkup(React.createElement(SampleBriefRoute));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/ads-internal-links.server");
  vi.doUnmock("~/lib/data/d1.server");
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/sample-brief", () => {
  it("renders a brief for a fixture domain from stored rows, with dates and source links intact", async () => {
    const mocks = installMocks();

    const data = await runLoader(mocks.env);
    expect(data.kind).toBe("brief");
    expect(data.domain).toBe(FIXTURE_DOMAIN);
    expect(data.brandName).toBe(FIXTURE_BRAND_NAME);
    expect(data.digestHtml).toBeTruthy();

    const markup = await renderWithData(data);

    // Heading names the public brand; the stored event renders with its
    // capture date and source link intact.
    expect(markup).toContain(`A real Monday brief for ${FIXTURE_BRAND_NAME}`);
    expect(markup).toContain("Landing page offer changed");
    expect(markup).toContain("https://nykaa.com/offer");

    // The issue-specified CTA deep-links into signup with the competitor
    // prefilled and the allowlisted attribution marker.
    expect(markup).toContain("Get this every Monday, free");
    expect(markup).toContain(
      `/auth/signup?competitor=${FIXTURE_DOMAIN}&amp;source=sample_brief`,
    );
  });

  it("contains no customer workspace name, email, or watchlist id", async () => {
    const mocks = installMocks();

    const data = await runLoader(mocks.env);
    const markup = await renderWithData(data);

    expect(markup).not.toContain(CUSTOMER_WATCHLIST_NAME);
    expect(markup).not.toContain(CUSTOMER_WATCHLIST_ID);
    expect(markup).not.toContain(CUSTOMER_EMAIL);
    expect(data.digestHtml).not.toContain(CUSTOMER_WATCHLIST_NAME);
    expect(data.digestHtml).not.toContain(CUSTOMER_WATCHLIST_ID);
    // No /app/watchlists deep links can form without event/watchlist ids.
    expect(data.digestHtml).not.toContain("/app/watchlists");
  });

  it("renders the quiet-brief variant for the newest indexable domain when nothing was filed", async () => {
    const mocks = installMocks({ eventRows: [] });

    const data = await runLoader(mocks.env);
    expect(data.kind).toBe("quiet");
    expect(data.domain).toBe(FIXTURE_DOMAIN);

    const markup = await renderWithData(data);
    expect(markup).toContain(`A real Monday brief for ${FIXTURE_BRAND_NAME}`);
    expect(markup).toContain("All quiet");
    // Real stored run counts, not fabricated ones.
    expect(markup).toContain("1 check");
    expect(markup).not.toContain(CUSTOMER_WATCHLIST_ID);
  });

  it("returns 200 in the empty case (no indexable domains at all)", async () => {
    const mocks = installMocks({ links: [], eventRows: [], runRows: [] });

    const data = await runLoader(mocks.env);
    expect(data.kind).toBe("empty");
    expect(data.digestHtml).toBeNull();

    const markup = await renderWithData(data);
    expect(markup).toContain("A real Monday brief");
    expect(markup).toContain("No stored brief is available");
    expect(markup).toContain("Get this every Monday, free");
    expect(markup).toContain("/auth/signup?source=sample_brief");
  });
});

describe("/sample-brief source contract", () => {
  it("registers the route, the sitemap entry, and the signup-source marker", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("sample-brief", "routes/sample-brief.tsx")');
    expect(SITEMAP_PATHS).toContain("/sample-brief");
    expect(SAMPLE_BRIEF_SIGNUP_SOURCE).toBe("sample_brief");
    expect(ALLOWED_SIGNUP_SOURCES).toContain("sample_brief");

    const source = readFileSync("app/routes/sample-brief.tsx", "utf8");
    // Public page: no session guard, and no live discovery provider.
    expect(source).not.toMatch(/requireSession|getSession|requireUser|getOptionalSession/);
    expect(source).not.toMatch(/meta-api|browser-run/);
  });
});
