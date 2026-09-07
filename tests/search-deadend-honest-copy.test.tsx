import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The live dead-end for a real, heavily-advertising B2B brand (issue 1569):
// a stale cached 0-row result from the Meta library browser. The search
// completed with no verified ad, so the copy must state the honest reason and
// must NOT blame the product ("coverage may be incomplete", "checks are
// delayed") or claim results are still coming.
const noResultsLoaderData = {
	mode: "advertiser" as const,
	filters: {
		query: "slack.com",
		country: "all",
		platform: "Instagram",
		creativeType: "video" as const,
		status: "active" as const,
		firstSeenFrom: "2026-07-01",
		lastSeenFrom: "2026-07-15",
	},
	fingerprint: "fp-slack",
	result: {
		ads: [],
		nextCursor: null,
		source: "meta_library_browser" as const,
		provider: "meta_library_browser" as const,
		cacheStatus: "stale" as const,
		discoveryStatus: "degraded" as const,
		discoveryProgress: "warming" as const,
		discoveryEmptyReason: "no_results" as const,
		discoverySummary:
			"Commercial discovery is already warming this query. Cached results should appear shortly.",
		discoveryFailureClass: null,
	},
	selectedAd: null,
	collections: [],
	session: null,
	competitorWebsite: {
		raw: "https://slack.com",
		normalizedUrl: "https://slack.com",
		host: "slack.com",
		displayName: "Slack",
		searchTerm: "slack.com",
		error: null,
	},
	trackingRole: "competitor" as const,
	inputError: null,
	searchScope: "broader" as const,
	displayDomain: "slack.com",
	showOpsNav: false,
	showPresenceNav: false,
};

async function renderNoResultsSearch() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");

		return {
			...actual,
			Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: vi.fn().mockReturnValue(undefined),
			useLoaderData: vi.fn().mockReturnValue(noResultsLoaderData),
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

describe("search no_results dead-end honest copy (issue 1569)", () => {
	it("states the honest reason and never blames the product or claims results are still coming", async () => {
		const markup = await renderNoResultsSearch();

		// The honest guidance sentence is present.
		expect(markup).toContain("did not verify a connected ad");
		expect(markup).toContain("not evidence that the competitor is inactive");

		// The false-cause copy is gone from the whole page — visible AND sr-only.
		expect(markup).not.toContain("coverage may be incomplete");
		expect(markup).not.toContain("Fresh checks are delayed");
		expect(markup).not.toContain("still checking");
		expect(markup).not.toContain("we&#x27;ll refresh automatically");
		expect(markup).not.toContain("we&rsquo;ll refresh automatically");
	});

	it("keeps the sr-only status region in sync with the visible honest copy", async () => {
		const markup = await renderNoResultsSearch();

		// The sr-only live region exists and carries the honest sentence.
		const srOnly = markup.match(/f9-sr-only[^>]*>([^<]+)</);
		expect(srOnly).not.toBeNull();
		expect(srOnly![1]).toContain("did not verify a connected ad");
		// The sr-only text must not carry the false cause.
		expect(srOnly![1]).not.toContain("coverage may be incomplete");
		expect(srOnly![1]).not.toContain("Fresh checks are delayed");
	});
});
