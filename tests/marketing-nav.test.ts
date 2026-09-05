import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");
		return {
			...actual,
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
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
	{ href: "/#demo", label: "Sample brief" },
	{ href: "/#pricing", label: "Pricing" },
	{ href: "/help", label: "Help" },
	{ href: "/docs", label: "Docs" },
	{ href: "/status", label: "Status" },
	{ href: "/auth/login", label: "Sign in" },
	{ href: "/app", label: "Open app" },
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
		// stay available as account links.
		expect(markup).toContain("class=\"ld-nav-pill\"");
		expect(markup).toContain("href=\"/auth/signup\"");
		expect(markup).toContain(">Sign up</a>");
	});

	it("is the header used by landing, both compare pages, and the legal doc shell", async () => {
		const marketing = readFileSync("app/routes/marketing.tsx", "utf8");
		const magicbrief = readFileSync("app/routes/compare.magicbrief.tsx", "utf8");
		const metaLibrary = readFileSync("app/routes/compare.meta-ad-library.tsx", "utf8");

		expect(marketing).toContain("<MarketingNav />");
		expect(magicbrief).toContain("<MarketingNav />");
		expect(metaLibrary).toContain("<MarketingNav />");

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
