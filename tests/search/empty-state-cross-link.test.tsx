import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The issue 1568 observed case: a finished 0-verified /search render for an
// unknown brand. The search completed (not warming, not delayed) with no
// verified ad, so the empty-state card is the dead-end a buyer hits. This
// fixture mirrors that finished-empty state — discoveryProgress is NOT
// "warming" so isSearchWarming is false and buildSearchAnswer produces the
// "empty" state that drives completedEmptySearch.
const emptyNoResultsLoaderData = {
	mode: "advertiser" as const,
	filters: {
		query: "xyzabc123nope.com",
		country: "all",
		platform: "all",
		creativeType: "all" as const,
		status: "all" as const,
		firstSeenFrom: "",
		lastSeenFrom: "",
	},
	fingerprint: "fp-empty",
	result: {
		ads: [] as AdRecord[],
		nextCursor: null,
		source: "meta_library_browser" as const,
		provider: "meta_library_browser" as const,
		cacheStatus: "stale" as const,
		discoveryStatus: "complete" as const,
		discoveryProgress: "complete" as const,
		discoveryEmptyReason: "no_results" as "no_results" | undefined,
		discoverySummary: null,
		discoveryFailureClass: null,
	},
	selectedAd: null,
	collections: [],
	plan: null,
	session: null,
	competitorWebsite: {
		raw: "https://xyzabc123nope.com",
		normalizedUrl: "https://xyzabc123nope.com",
		host: "xyzabc123nope.com",
		displayName: "Xyzabc123nope",
		searchTerm: "xyzabc123nope.com",
		error: null,
	},
	trackingRole: "competitor" as const,
	inputError: null,
	searchScope: "broader" as const,
	displayDomain: "xyzabc123nope.com",
	relevanceApplied: false,
	watchedWatchlist: null,
	showOpsNav: false,
	showPresenceNav: false,
};

function verifiedAd(overrides: Partial<AdRecord> = {}): AdRecord {
	return {
		metaAdId: overrides.metaAdId ?? "ad-1",
		advertiser: "Nike",
		body: "Run through summer.",
		previewHeadline: "Run through summer with gear that can take the heat.",
		previewSubhead: "",
		hook: "Shop Now",
		offer: "",
		cta: "Shop Now",
		format: "image",
		languageLabel: "English",
		destinationType: "website",
		landingPageUrl: "https://www.nike.com/launch",
		adSnapshotUrl: null,
		countries: ["all"],
		platforms: ["Instagram"],
		firstSeenAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
		lastSeenAt: null,
		active: true,
		researchSummary: "",
		source: "meta_library_browser",
		analysisFields: [],
		...overrides,
	};
}

// The non-empty (>=1 verified) case: the result list drives the buyer, so the
// empty-state cross-links must NOT appear — the card is unchanged.
const verifiedLoaderData = {
	...emptyNoResultsLoaderData,
	filters: { ...emptyNoResultsLoaderData.filters, query: "nike.com" },
	fingerprint: "fp-nike",
	result: {
		...emptyNoResultsLoaderData.result,
		ads: [verifiedAd()],
		discoveryEmptyReason: undefined,
	},
	competitorWebsite: {
		raw: "https://nike.com",
		normalizedUrl: "https://nike.com",
		host: "nike.com",
		displayName: "Nike",
		searchTerm: "nike.com",
		error: null,
	},
	displayDomain: "nike.com",
};

async function renderSearch(data: typeof emptyNoResultsLoaderData) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");

		return {
			...actual,
			Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: vi.fn().mockReturnValue(undefined),
			useLoaderData: vi.fn().mockReturnValue(data),
			useLocation: vi.fn().mockReturnValue({ pathname: "/search", search: "", hash: "" }),
			useNavigate: vi.fn().mockReturnValue(vi.fn()),
			useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
			useRevalidator: vi.fn().mockReturnValue({ state: "idle", revalidate: vi.fn() }),
			useRouteLoaderData: vi.fn().mockReturnValue({ session: null }),
		};
	});

	vi.doMock("~/components/dashboard-shell", () => ({
		DashboardShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
	}));

	const { default: SearchRoute } = await import("~/routes/search");
	return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("search empty-state cross-link to /capture-rules (issue 1568)", () => {
	it("links to /capture-rules from inside the 0-verified empty-state card", async () => {
		const markup = await renderSearch(emptyNoResultsLoaderData);

		// The empty-state honest copy is still present.
		expect(markup).toContain("not evidence that the competitor is inactive");

		// The /capture-rules anchor exists with the honest label.
		expect(markup).toContain('href="/capture-rules"');
		expect(markup).toContain("Read what we refuse to alert on");

		// The /ad-aggression methodology link is the secondary handoff.
		expect(markup).toContain('href="/ad-aggression"');
		expect(markup).toContain("How the score works");
	});

	it("renders the cross-links inside the .f9-wk-sec-acts container, not empty", async () => {
		const markup = await renderSearch(emptyNoResultsLoaderData);

		// The section action container exists and is no longer empty for the
		// 0-verified case — it carries the /capture-rules anchor.
		const secActs = markup.match(/<div class="f9-wk-sec-acts">([\s\S]*?)<\/div>/);
		expect(secActs).not.toBeNull();
		expect(secActs![1]).toContain('href="/capture-rules"');
		expect(secActs![1].trim().length).toBeGreaterThan(0);
	});

	it("does not add the cross-links to the non-empty (>=1 verified) card", async () => {
		const markup = await renderSearch(verifiedLoaderData);

		// A verified result renders the result list, not the empty-state honest
		// copy — the result row names the advertiser.
		expect(markup).toContain("Nike");
		expect(markup).not.toContain("not evidence that the competitor is inactive");

		// The empty-state cross-links must NOT appear on the non-empty card.
		expect(markup).not.toContain('href="/capture-rules"');
		expect(markup).not.toContain("Read what we refuse to alert on");
		expect(markup).not.toContain("How the score works");
	});
});
