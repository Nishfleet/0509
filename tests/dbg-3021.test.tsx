import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdRecord } from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const data = {
	mode: "advertiser" as const,
	filters: { query: "xyzabc123nope.com", country: "all", platform: "all", creativeType: "all" as const, status: "all" as const, firstSeenFrom: "", lastSeenFrom: "" },
	fingerprint: "fp-empty",
	result: {
		ads: [] as AdRecord[], nextCursor: null,
		source: "meta_library_browser" as const, provider: "meta_library_browser" as const,
		cacheStatus: "stale" as const, discoveryStatus: "complete" as const,
		discoveryProgress: "complete" as const, discoveryEmptyReason: "no_results" as const,
		discoverySummary: null, discoveryFailureClass: null,
	},
	selectedAd: null, collections: [], plan: null, session: null,
	competitorWebsite: { raw: "https://xyzabc123nope.com", normalizedUrl: "https://xyzabc123nope.com", host: "xyzabc123nope.com", displayName: "Xyzabc123nope", searchTerm: "xyzabc123nope.com", error: null },
	trackingRole: "competitor" as const, inputError: null, searchScope: "broader" as const,
	displayDomain: "xyzabc123nope.com", relevanceApplied: false, watchedWatchlist: null,
	suggestedBrands: ["nykaa.com", "allbirds.com"], showOpsNav: false, showPresenceNav: false,
};

describe("dbg", () => {
	it("dumps honest-line carriers", async () => {
		vi.doMock("react-router", async () => {
			const actual = await vi.importActual<typeof import("react-router")>("react-router");
			const React = await import("react");
			return {
				...actual,
				Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
				Link: ({ children, to, ...props }: MockLinkProps) => React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
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
		const markup = renderToStaticMarkup(createElement(SearchRoute));
		const re = /not evidence that the competitor is inactive/g;
		let m; let i = 0;
		while ((m = re.exec(markup))) {
			i++;
			console.log(`--- occurrence ${i} @${m.index} ---`);
			console.log(markup.slice(Math.max(0, m.index - 320), m.index + 120));
		}
		expect(i).toBeGreaterThan(0);
	}, 60000);
});
