import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCompetitorWebsite } from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Idle public /search loader payload: no query, no website, no session. This
// is the resting preview page a crawler fetches first.
const idleSearchLoaderData = {
	mode: "advertiser" as const,
	filters: {
		query: "",
		country: "all",
		platform: "all",
		creativeType: "all" as const,
		status: "all" as const,
		firstSeenFrom: "",
		lastSeenFrom: "",
		pageId: "",
	},
	fingerprint: "fp-idle",
	result: buildIdleSearchResult(),
	selectedAd: null,
	stealSummary: null,
	selectionEnrichmentPending: false,
	collections: [],
	plan: null,
	session: null,
	competitorWebsite: emptyCompetitorWebsite(),
	trackingRole: "competitor" as const,
	inputError: null,
	searchScope: "exact" as const,
	displayDomain: null,
	relevanceApplied: false,
	watchedWatchlist: null,
	showOpsNav: false,
	showPresenceNav: false,
};

const SEARCH_TITLE = "Search competitor Meta ads free | Five to Nine";
const SEARCH_DESCRIPTION =
	"Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.";

async function renderIdleSearch() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");

		return {
			...actual,
			Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: vi.fn().mockReturnValue(undefined),
			useLoaderData: vi.fn().mockReturnValue(idleSearchLoaderData),
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

function jsonLdBlocks(markup: string) {
	const blocks = Array.from(
		markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
		(match) => match[1],
	);
	return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("public /search — truthful WebPage JSON-LD", () => {
	it("emits exactly one WebPage JSON-LD block on the idle public render", async () => {
		const markup = await renderIdleSearch();

		const scriptTags = markup.match(/type="application\/ld\+json"/g) ?? [];
		expect(scriptTags).toHaveLength(1);

		const blocks = jsonLdBlocks(markup);
		expect(blocks).toHaveLength(1);
		const block = blocks[0]!;
		expect(block["@context"]).toBe("https://schema.org");
		expect(block["@type"]).toBe("WebPage");
	});

	it("names the page exactly like the document head meta", async () => {
		const markup = await renderIdleSearch();
		const block = jsonLdBlocks(markup)[0]!;

		// Same strings the route's `meta` puts in the head via publicSeoMeta.
		expect(block.name).toBe(SEARCH_TITLE);
		expect(block.description).toBe(SEARCH_DESCRIPTION);
		expect(block.url).toBe("https://0509.io/search");
		expect(markup).toContain(`"name":"${SEARCH_TITLE}"`);
		expect(markup).toContain(`"description":"${SEARCH_DESCRIPTION}"`);
		expect(markup).toContain('"url":"https://0509.io/search"');
	});

	it("keeps the WebPage entity scoped to WebPage/WebSite/Organization and free of invented claims", async () => {
		const markup = await renderIdleSearch();
		const block = jsonLdBlocks(markup)[0]!;
		const serialized = JSON.stringify(block);

		// The only schema types present are the ones webPageJsonLd emits.
		const typeValues = Array.from(serialized.matchAll(/"@type":"([^"]+)"/g), (match) => match[1]);
		expect(typeValues.sort()).toEqual(["Organization", "WebPage", "WebSite"]);

		// No result lists, rankings, prices, guarantees, or advertiser claims.
		for (const unsupported of [
			'"@type":"SearchResultsPage"',
			'"@type":"ItemList"',
			'"@type":"Product"',
			'"@type":"Offer"',
			'"@type":"AggregateRating"',
			'"@type":"Review"',
		]) {
			expect(serialized).not.toContain(unsupported);
		}
		expect(serialized).not.toMatch(/price/i);
		expect(serialized).not.toMatch(/rank/i);
		expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
		// No result counts or result-list claims beyond the page's own
		// truthful description text.
		expect(serialized).not.toContain("resultCount");
		expect(serialized).not.toMatch(/\d+\s+results?/i);
	});

	it("pins the search route to the same description const for head meta and JSON-LD", async () => {
		const { readFileSync } = await import("node:fs");
		const source = readFileSync("app/routes/search.tsx", "utf8");

		expect(source).toContain("webPageJsonLd({");
		expect(source).toContain(`name: "${SEARCH_TITLE}"`);
		// The meta block and the JSON-LD block share one description const.
		expect(source).toContain("description: searchDescription");
	});
});
