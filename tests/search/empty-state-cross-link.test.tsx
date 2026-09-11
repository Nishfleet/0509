import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The issue 1568/3021 observed case: a finished 0-verified /search render for
// an unknown brand. The search completed (not warming, not delayed) with no
// verified ad, so the empty-state card is the dead-end a buyer hits. This
// fixture mirrors that finished-empty state — discoveryProgress is NOT
// "warming" so isSearchWarming is false and buildSearchAnswer produces the
// "empty" state that drives completedEmptySearch. Issue 3021 supplies the
// loader's suggestedBrands row — recently-searched domains whose cached
// result is fresh and non-empty.
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
	suggestedBrands: ["nykaa.com", "allbirds.com"],
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

describe("search empty-state next action (issue 3021)", () => {
	it("compresses to one honest line plus one primary action", async () => {
		const markup = await renderSearch(emptyNoResultsLoaderData);

		// The honest "not evidence" sentence is told exactly once — the answer
		// panel's near-identical note and the summary sub-line are suppressed.
		expect(
			markup.match(/not evidence that the competitor is inactive/g),
		).toHaveLength(1);

		// The issue 1568 doc links were the brochure this issue removes: the
		// empty card no longer carries /capture-rules or the methodology
		// handoff — one real next step replaces the reading list.
		expect(markup).not.toContain('href="/capture-rules"');
		expect(markup).not.toContain("Read what we refuse to alert on");
		expect(markup).not.toContain('href="/methodology/ad-aggression-score"');
		expect(markup).not.toContain("How the score works");

		// Exactly one primary re-search action survives (BL-031).
		const acts = markup.match(
			/<div class="f9-wk-acts">([\s\S]*?)<\/div>/,
		);
		expect(acts).not.toBeNull();
		expect(acts![1].match(/<a /g)).toHaveLength(1);
	});

	it("offers suggested-brand chips from the recently-searched cache", async () => {
		const markup = await renderSearch(emptyNoResultsLoaderData);

		const suggest = markup.match(
			/<div[^>]*class="f9-wk-suggest"[^>]*>([\s\S]*?)<\/div>/,
		);
		expect(suggest).not.toBeNull();
		expect(suggest![1]).toContain("Recently checked:");
		expect(suggest![1]).toContain(
			'href="/search?website=nykaa.com&amp;country=all&amp;trackingRole=competitor"',
		);
		expect(suggest![1]).toContain(
			'href="/search?website=allbirds.com&amp;country=all&amp;trackingRole=competitor"',
		);

		// Chips are suggestions, not actions: they live outside the .f9-wk-acts
		// primary-action region, which keeps exactly one anchor.
		const acts = markup.match(
			/<div class="f9-wk-acts">([\s\S]*?)<\/div>/,
		);
		expect(acts![1]).not.toContain("nykaa.com");
	});

	it("omits the chip row when the cache offers no suggestions", async () => {
		const markup = await renderSearch({
			...emptyNoResultsLoaderData,
			suggestedBrands: [],
		});

		expect(markup).toContain("not evidence that the competitor is inactive");
		expect(markup).not.toContain("f9-wk-suggest");
		expect(markup).not.toContain("f9-wk-chip");
	});

	it("does not add chips or the empty line to the non-empty (>=1 verified) card", async () => {
		const markup = await renderSearch(verifiedLoaderData);

		// A verified result renders the result list, not the empty-state honest
		// copy — the result row names the advertiser.
		expect(markup).toContain("Nike");
		expect(markup).not.toContain("not evidence that the competitor is inactive");

		// Suggested-brand chips stay off the non-empty card even though the
		// fixture carries suggestedBrands — the result list drives the buyer.
		expect(markup).not.toContain("f9-wk-suggest");
		expect(markup).not.toContain("f9-wk-chip");

		// The only /capture-rules anchor on the non-empty card is the trust-proof
		// note at the signup gate (issue 2049), identified by its own copy — not
		// the empty-state cross-link.
		expect(markup).toContain("Read the capture-validity guarantee");
		expect(markup).not.toContain("Read what we refuse to alert on");
	});
});
