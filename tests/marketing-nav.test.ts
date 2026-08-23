import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(rootData?: unknown) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");
		return {
			...actual,
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useRouteLoaderData: () => rootData,
		};
	});
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

const SHARED_LINKS = [
	{ href: "/search", label: "Search preview" },
	{ href: "/#demo", label: "Proof brief" },
	{ href: "/pricing", label: "Pricing" },
	{ href: "/help", label: "Help" },
	{ href: "/docs", label: "Docs" },
	{ href: "/status", label: "Status" },
	{ href: "/auth/login", label: "Sign in" },
	// Open app is auth-aware: anonymous visitors (and crawlers) get the login
	// destination directly so no internal link on a public page redirects.
	{ href: "/auth/login?redirectTo=%2Fapp", label: "Open app" },
	// Signup CTA: anonymous visitors can reach /auth/signup from the nav.
	{ href: "/auth/signup", label: "Sign up" },
];

describe("MarketingNav (shared public nav)", () => {
	it("renders one identical link set with a single wordmark tagline", async () => {
		await mockRouter();
		const { MarketingNav, MARKETING_TAGLINE } = await import("~/components/marketing-nav");
		const markup = renderToStaticMarkup(createElement(MarketingNav));

		for (const link of SHARED_LINKS) {
			expect(markup).toContain(`href="${link.href}"`);
			expect(markup).toContain(link.label);
		}
		expect(MARKETING_TAGLINE).toBe("Competitor change monitoring");
		expect(markup).toContain(MARKETING_TAGLINE);
		// The signup CTA is the pill: one primary action for anonymous
		// visitors, linking straight to /auth/signup. Sign in and Open app
		// stay in the markup as account links; Open app is CSS-hidden at
		// ≤860px so the compact header stays a single action row.
		expect(markup).toContain("class=\"ld-nav-pill\"");
		expect(markup).toContain("class=\"f9-link-arrow ld-nav-open-app\"");
		expect(markup).toContain("href=\"/auth/signup\"");
		expect(markup).toContain(">Sign up</a>");
	});

	it("points Open app straight at /app for signed-in visitors", async () => {
		await mockRouter({ session: { user: { id: "u1" } } });
		const { MarketingNav } = await import("~/components/marketing-nav");
		const markup = renderToStaticMarkup(createElement(MarketingNav));

		expect(markup).toContain('href="/app"');
		expect(markup).toContain(">Open app</a>");
	});

	it("hides Open app on the compact ≤860px nav so the fold stays clear", () => {
		const css = readFileSync("app/app.css", "utf8");
		const compact = css.split("@media (max-width: 860px)")[1] ?? "";
		expect(compact).toContain(".f9-home .ld-nav-actions .ld-nav-open-app");
		expect(compact).toContain(".f9-legal-page .ld-nav-actions .ld-nav-open-app");
		expect(compact).toMatch(
			/\.f9-home\s+\.ld-nav-actions\s+\.ld-nav-open-app,\s*\.f9-legal-page\s+\.ld-nav-actions\s+\.ld-nav-open-app\s*\{\s*display:\s*none;/,
		);
		expect(compact).toMatch(/\.ld-nav-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
	});

	it("is the header used by landing, all compare pages, and the legal doc shell", async () => {
		const marketing = readFileSync("app/routes/marketing.tsx", "utf8");
		const magicbrief = readFileSync("app/routes/compare.magicbrief.tsx", "utf8");
		const metaLibrary = readFileSync("app/routes/compare.meta-ad-library.tsx", "utf8");
		const visualping = readFileSync("app/routes/compare.visualping.tsx", "utf8");
		const spyland = readFileSync("app/routes/compare.spyland.tsx", "utf8");
		const pulzifi = readFileSync("app/routes/compare.pulzifi.tsx", "utf8");
		const foreplay = readFileSync("app/routes/compare.foreplay.tsx", "utf8");

		expect(marketing).toContain("<MarketingNav />");
		expect(magicbrief).toContain("<MarketingNav />");
		expect(metaLibrary).toContain("<MarketingNav />");
		expect(visualping).toContain("<MarketingNav />");
		expect(spyland).toContain("<MarketingNav />");
		expect(pulzifi).toContain("<MarketingNav />");
		expect(foreplay).toContain("<MarketingNav />");

		// The legal/doc shell no longer improvises its own chrome: its header IS
		// MarketingNav, so the tagline and the Pricing/Search/Sign in links are
		// byte-identical and no public section is stranded.
		await mockRouter();
		const { MarketingNav } = await import("~/components/marketing-nav");
		const { PublicDocHeader } = await import("~/components/public-doc-shell");
		expect(renderToStaticMarkup(createElement(PublicDocHeader))).toBe(
			renderToStaticMarkup(createElement(MarketingNav)),
		);
	});
});
