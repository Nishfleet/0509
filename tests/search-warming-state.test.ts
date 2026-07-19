import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const originalSearch =
	"?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&country=all" +
	"&platform=Instagram&creativeType=video&status=active&firstSeenFrom=2026-07-01" +
	"&lastSeenFrom=2026-07-15&trackingRole=competitor&broader=1&after=cursor-2&selected=ad-9";

const warmingLoaderData = {
	mode: "advertiser" as const,
	filters: {
		query: "nykaa.com",
		country: "all",
		platform: "Instagram",
		creativeType: "video" as const,
		status: "active" as const,
		firstSeenFrom: "2026-07-01",
		lastSeenFrom: "2026-07-15",
	},
	fingerprint: "fp-nykaa",
	result: {
		ads: [],
		nextCursor: null,
		source: "meta_library_browser" as const,
		provider: "meta_library_browser" as const,
		cacheStatus: "miss" as const,
		discoveryStatus: "degraded" as const,
		discoveryProgress: "warming" as const,
		discoverySummary:
			"Commercial discovery is already warming this query. Cached results should appear shortly.",
		discoveryFailureClass: null,
	},
	selectedAd: null,
	collections: [],
	session: null,
	competitorWebsite: {
		raw: "https://nykaa.com",
		normalizedUrl: "https://nykaa.com",
		host: "nykaa.com",
		displayName: "Nykaa",
		searchTerm: "nykaa.com",
		error: null,
	},
	trackingRole: "competitor" as const,
	inputError: null,
	searchScope: "broader" as const,
	displayDomain: "nykaa.com",
	showOpsNav: false,
	showPresenceNav: false,
};

async function renderWarmingSearch() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");

		return {
			...actual,
			Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: vi.fn().mockReturnValue(undefined),
			useLoaderData: vi.fn().mockReturnValue(warmingLoaderData),
			useLocation: vi.fn().mockReturnValue({ pathname: "/search", search: originalSearch, hash: "" }),
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

describe("public search warming recovery", () => {
	it("renders one honest live status with an explicit retry instead of a contradictory terminal answer", async () => {
		const markup = await renderWarmingSearch();

		expect(markup).toContain("Search in progress");
		expect(markup).toContain("Checking the Ad Library now");
		expect(markup).toContain("Usually under a minute");
		expect(markup).toContain('role="status"');
		expect(markup).toContain('aria-live="polite"');
		expect(markup).not.toContain('aria-busy="true"');
		// Auto-revalidate replaces the manual-only recovery path; retry may still
		// appear for delayed states but warming itself is not "click to continue".
		expect(markup).not.toContain("Live search is temporarily unavailable");
		expect(markup).not.toContain("We couldn&#x27;t confirm any ads");
	});

	it("preserves the complete original query on the customer-triggered retry", async () => {
		const markup = await renderWarmingSearch();
		const escapedHref = `/search${originalSearch}`.replaceAll("&", "&amp;");

		expect(markup).toContain(`href="${escapedHref}"`);
		expect(markup).toContain("broader=1");
		expect(markup).toContain("after=cursor-2");
		expect(markup).toContain("selected=ad-9");
	});
});
