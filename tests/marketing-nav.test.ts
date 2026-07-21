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
	{ href: "/auth/login", label: "Sign in" },
	{ href: "/app", label: "Open app" },
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
		// Single account CTA — the "Create account" vs "Open app" split is retired.
		expect(markup).not.toContain("Create account");
	});

	it("is the header used by landing, both compare pages, and the legal doc shell", () => {
		const marketing = readFileSync("app/routes/marketing.tsx", "utf8");
		const magicbrief = readFileSync("app/routes/compare.magicbrief.tsx", "utf8");
		const metaLibrary = readFileSync("app/routes/compare.meta-ad-library.tsx", "utf8");
		const docShell = readFileSync("app/components/public-doc-shell.tsx", "utf8");

		expect(marketing).toContain("<MarketingNav />");
		expect(magicbrief).toContain("<MarketingNav />");
		expect(metaLibrary).toContain("<MarketingNav />");
		// Legal shell keeps its own f9-legal-nav chrome but shares the tagline
		// and reaches Pricing/Search/Sign in so no public section is stranded.
		expect(docShell).toContain("MARKETING_TAGLINE");
		expect(docShell).toContain('to="/#pricing"');
		expect(docShell).toContain('to="/search"');
	});
});
