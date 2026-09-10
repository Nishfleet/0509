import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockReactRouter } from "./helpers/mock-react-router";

async function mockRouter(rootData?: unknown) {
			mockReactRouter({ loaderData: rootData });
	
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
	{ href: "/compare", label: "Compare" },
	{ href: "/pricing", label: "Pricing" },
	{ href: "/help", label: "Help" },
	{ href: "/docs", label: "Docs" },
	{ href: "/status", label: "Status" },
	{ href: "/auth/login", label: "Sign in" },
	// Open app is rendered only for signed-in visitors, so anonymous nav has
	// exactly one auth action (Sign in) plus the Sign up CTA — no second link
	// to the same login destination.
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
		// visitors, linking straight to /auth/signup. Anonymous nav carries
		// Sign in + Sign up only — Open app is not rendered because there is
		// no session, so there is one auth action per state.
		expect(markup).toContain("class=\"ld-nav-pill\"");
		expect(markup).toContain("href=\"/auth/signup\"");
		expect(markup).toContain(">Sign up</a>");
		expect(markup).not.toContain(">Open app</a>");
		expect(markup).not.toContain("ld-nav-open-app");
	});

	it("points Open app straight at /app for signed-in visitors", async () => {
		await mockRouter({ session: { user: { id: "u1" } } });
		const { MarketingNav } = await import("~/components/marketing-nav");
		const markup = renderToStaticMarkup(createElement(MarketingNav));

		expect(markup).toContain('href="/app"');
		expect(markup).toContain(">Open app</a>");
	});

	it("has no mobile-hide rule for Open app (it is gated on the session, not CSS)", () => {
		const css = readFileSync("app/app.css", "utf8");
		const compact = css.split("@media (max-width: 860px)")[1] ?? "";
		// The old ≤860px rule hid Open app for anonymous visitors via
		// display:none. Open app now only renders when a session exists, so
		// that block is dead and the CSS must not reference it anymore.
		expect(compact).not.toContain("ld-nav-open-app");
		// The compact anonymous row still keeps Sign in + Sign up nowrap.
		expect(compact).toMatch(/\.ld-nav-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
	});

	it("wraps the compact primary nav on legal pages so six public links cannot overflow 375px (#1172)", () => {
		const css = readFileSync("app/app.css", "utf8");
		const compact = css.split("@media (max-width: 860px)")[1] ?? "";
		expect(compact).toMatch(/\.ld-nav-links\s*\{[^}]*flex-wrap:\s*nowrap/s);
		expect(compact).toMatch(/\.f9-legal-page \.ld-nav-links\s*\{[^}]*flex-wrap:\s*wrap/s);
		expect(compact).toMatch(/\.f9-home \.ld-nav-links\s*\{[^}]*overflow-x:\s*auto/s);
		// The compact home nav keeps a VISIBLE native scrollbar. The prior hidden-
		// scrollbar rules made the horizontal-overflow row look static with no
		// scroll affordance; the orchestrator decision (2026-09-10) removed them so
		// the existing overflow-x:auto row shows its scrollbar at 375px. Guard that
		// the hide rules stay gone and the row stays scrollable.
		expect(compact).not.toMatch(/\.f9-home \.ld-nav-links\s*\{[^}]*scrollbar-width:\s*none/s);
		expect(compact).not.toContain(".f9-home .ld-nav-links::-webkit-scrollbar");
	});

	it("is the header used by landing, all compare pages, switch pages, and the legal doc shell", async () => {
		const marketing = readFileSync("app/routes/marketing.tsx", "utf8");
		const metaLibrary = readFileSync("app/routes/compare.meta-ad-library.tsx", "utf8");
		const visualping = readFileSync("app/routes/compare.visualping.tsx", "utf8");
		const visualpingAdLibrary = readFileSync("app/routes/compare.visualping-ad-libraries.tsx", "utf8");
		const spyland = readFileSync("app/routes/compare.spyland.tsx", "utf8");
		const pulzifi = readFileSync("app/routes/compare.pulzifi.tsx", "utf8");
		const foreplay = readFileSync("app/routes/compare.foreplay.tsx", "utf8");
		const foreplaySpyder = readFileSync("app/routes/compare.foreplay-spyder.tsx", "utf8");
		const panoramata = readFileSync("app/routes/compare.panoramata.tsx", "utf8");
		const adspyder = readFileSync("app/routes/compare.adspyder.tsx", "utf8");
		const switchLanding = readFileSync("app/components/switch-landing.tsx", "utf8");

		expect(marketing).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(metaLibrary).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(visualping).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(visualpingAdLibrary).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(spyland).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(pulzifi).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(foreplay).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(foreplaySpyder).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(panoramata).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(adspyder).toMatch(/<MarketingNav\b[^>]*\/>/);
		expect(switchLanding).toMatch(/<MarketingNav\b[^>]*\/>/);

		// The legal/doc shell no longer improvises its own chrome: its header IS
		// MarketingNav with switch links suppressed, so the tagline and the
		// Pricing/Search/Sign in links are byte-identical and no public section
		// is stranded.
		await mockRouter();
		const { MarketingNav } = await import("~/components/marketing-nav");
		const { PublicDocHeader } = await import("~/components/public-doc-shell");
		expect(renderToStaticMarkup(createElement(PublicDocHeader))).toBe(
			renderToStaticMarkup(createElement(MarketingNav, { showSwitchLinks: false })),
		);
	});
});
