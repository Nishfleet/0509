import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logo = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	vi.doUnmock("react-router");
});

async function renderShare(brandIdentity: {
	brandName: string | null;
	brandWebsite: string | null;
	brandLogo: string | null;
} | null) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");
		return {
			...actual,
			Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
				React.createElement("a", { ...props, href: to }, children),
			useLoaderData: vi.fn().mockReturnValue({
				mode: "live",
				resourceType: "collection",
				collection: { id: "collection-1", name: "Launch board" },
				items: [],
				preparedBy: brandIdentity?.brandName ?? null,
				brandIdentity,
			}),
		};
	});

	const { default: ShareRoute } = await import("~/routes/share.$token");
	return renderToStaticMarkup(createElement(ShareRoute));
}

const reportSnapshot = {
	kind: "report",
	reportId: "shared-report",
	resourceType: "watchlist",
	resourceId: "shared",
	title: "Okara",
	subtitle: "advertiser · Okara",
	summary: "1 verified-evidence watch event with linked ad context where available.",
	generatedAt: "2026-07-27T06:05:00.000Z",
	stats: [{ label: "Events", value: "1" }],
	rows: [
		{
			id: "row-1",
			advertiser: "Okara",
			previewHeadline: "Team plan now ₹1,199",
			offer: "₹1,199",
			cta: "Start free",
			formatLabel: "Image",
			languageLabel: "English",
			previewImageUrl: null,
			creativeText: null,
			translatedText: null,
			landingPage: {
				url: "https://okara.example/pricing",
				headline: null,
				captureLabel: "Checked in browser",
				capturedAt: "2026-07-27T06:05:00.000Z",
				signals: [],
			},
			analysisFields: [],
			tags: [],
			note: null,
			event: {
				typeLabel: "Offer",
				title: "Okara cut its team price",
				summary: "The anchor price moved down before the weekend.",
				createdAt: "2026-07-27T06:05:00.000Z",
				priorityScore: 91,
				priorityBand: "High priority",
				recommendedAction: "Today: brief a counter-offer.",
				proofTrail: "Verified from a page snapshot",
				proofStatusLabel: "Verified evidence",
				sourceTypeLabel: "Saved evidence",
				sourceUrl: "https://okara.example/pricing",
				metaAdId: null,
			},
		},
	],
};

async function renderReportShare(brandIdentity: {
	brandName: string | null;
	brandWebsite: string | null;
	brandLogo: string | null;
} | null) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");
		return {
			...actual,
			Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
				React.createElement("a", { ...props, href: to }, children),
			useLoaderData: vi.fn().mockReturnValue({
				mode: "snapshot",
				resourceType: "report",
				payload: reportSnapshot,
				preparedBy: brandIdentity?.brandName ?? null,
				brandIdentity,
			}),
		};
	});

	const { default: ShareRoute } = await import("~/routes/share.$token");
	return renderToStaticMarkup(createElement(ShareRoute));
}

describe("shared report agency identity", () => {
	it("visibly leads with the entitled Agency logo, name, and safe website", async () => {
		const markup = await renderShare({
			brandName: "Northwind Growth",
			brandWebsite: "https://northwind.example/work",
			brandLogo: logo,
		});

		expect(markup).toContain('class="f9-share-brand-identity"');
		expect(markup).toContain(`src="${logo}"`);
		expect(markup).toContain('alt="Northwind Growth logo"');
		expect(markup).toContain("Northwind Growth");
		expect(markup).toContain('href="https://northwind.example/work"');
		expect(markup).toContain("northwind.example");
		expect(markup).not.toContain('class="f9-brandmark"');
		expect(markup).toContain('class="f9-share-powered-by"');
		expect(markup).toContain("Powered by");
		expect(markup).toContain("Five to Nine");
	});

	it("keeps the Five to Nine header when no entitled identity is present", async () => {
		const markup = await renderShare(null);

		expect(markup).toContain('class="f9-brandmark"');
		expect(markup).toContain("Shared evidence");
		expect(markup).not.toContain('class="f9-share-brand-identity"');
	});

	it("does not turn an unsafe stored website into a public link", async () => {
		const markup = await renderShare({
			brandName: "Northwind Growth",
			brandWebsite: "javascript:alert(1)",
			brandLogo: logo,
		});

		expect(markup).not.toContain("javascript:");
		expect(markup).toContain('alt="Northwind Growth logo"');
	});

	/**
	 * BL-009 regression. The report cover carries a "prepared by" byline. It
	 * must never sign an agency's white-labelled report with our own name:
	 * Five to Nine appears on a shared report ONLY in the powered-by footer,
	 * which the plan catalog governs.
	 */
	it("signs the shared report cover with the agency, never with Five to Nine", async () => {
		const markup = await renderReportShare({
			brandName: "Northwind Growth",
			brandWebsite: "https://northwind.example/work",
			brandLogo: logo,
		});

		expect(markup).toContain("f9-evidence-report-cover");
		expect(markup).toContain("Prepared by");
		expect(markup).toContain("Northwind Growth");

		const cover = markup.slice(
			markup.indexOf("f9-evidence-report-cover"),
			markup.indexOf("f9-evidence-report-numbers"),
		);
		expect(cover).toContain("Northwind Growth");
		expect(cover).not.toContain("Five to Nine");

		// Our name appears nowhere in the report document itself; the only
		// credit is the powered-by footer the plan catalog governs.
		const document = markup.slice(
			markup.indexOf("f9-evidence-report-cover"),
			markup.indexOf("f9-share-powered-by"),
		);
		expect(document).not.toContain("Five to Nine");
		expect(markup).toContain('class="f9-share-powered-by"');
		expect(markup).toContain("Powered by");
	});

	it("renders no byline cell at all when the sharer has no entitled agency name", async () => {
		const markup = await renderReportShare(null);

		expect(markup).toContain("f9-evidence-report-cover");
		const cover = markup.slice(
			markup.indexOf("f9-evidence-report-cover"),
			markup.indexOf("f9-evidence-report-numbers"),
		);
		expect(cover).not.toContain("Prepared by");
		expect(cover).not.toContain("Five to Nine");
		// A missing byline is not an orphan hole: the remaining cells still fill
		// the row (brief §6.10).
		expect(cover).toContain("Subject");
		expect(cover).toContain("Evidence");
		expect(cover).toContain("Generated");
	});

	it("declares noindex and nofollow in route metadata", async () => {
		const { meta } = await import("~/routes/share.$token");

		expect(meta()).toEqual(expect.arrayContaining([
			{ name: "robots", content: "noindex, nofollow" },
		]));
	});

	it("keeps identity and attribution in print while hiding only client actions", () => {
		const appCss = readFileSync("app/app.css", "utf8");
		const printCss = appCss.slice(appCss.indexOf("@media print"));

		expect(printCss).toContain(".f9-share-brand-identity");
		expect(printCss).toContain(".f9-share-powered-by");
		expect(printCss).toContain(".f9-evidence-report-rail");
		expect(printCss).not.toMatch(/\.f9-share-header,[\s\S]{0,160}display:\s*none/);
	});

	// The PDF rail and width contract is exercised against rendered DOM and
	// computed styles in share-pdf-rail-visibility.test.tsx.
});
