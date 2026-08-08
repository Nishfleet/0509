// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

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
	insightDepth: {
		topHooks: [],
		mediaMix: [],
		campaignDurations: [],
		metricProof: [],
		creativeTimeline: [],
		landingPageHistory: [],
	},
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
		},
	],
};

const appCss = readFileSync("app/app.css", "utf8");

let root: Root | null = null;

beforeEach(() => {
	vi.resetModules();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	document.head.replaceChildren();
	document.body.replaceChildren();
	const style = document.createElement("style");
	style.setAttribute("data-pdf-rail-guard", "true");
	style.textContent = appCss;
	document.head.appendChild(style);
	document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
	if (root) {
		await act(async () => root?.unmount());
		root = null;
	}
	vi.restoreAllMocks();
	vi.resetModules();
	vi.doUnmock("react-router");
	document.head.replaceChildren();
	document.body.replaceChildren();
});

async function renderPdfShareVariant() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Link: ({
				children,
				to,
				...props
			}: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
				createElement("a", { ...props, href: to }, children),
			useLoaderData: () => ({
				mode: "snapshot",
				resourceType: "report",
				payload: reportSnapshot,
				preparedBy: null,
				brandIdentity: null,
				pdfVariant: true,
				pdfPath: null,
			}),
		};
	});

	const { default: ShareRoute } = await import("~/routes/share.$token");
	root = createRoot(document.getElementById("root") as HTMLElement);
	await act(async () => {
		root?.render(createElement(ShareRoute));
	});
	return document.body;
}

describe("share PDF rail visibility", () => {
	it("hides the contents rail and renders the report at full width", async () => {
		const body = await renderPdfShareVariant();

		expect(body.querySelector("main.f9-share-pdf")).not.toBeNull();
		const rail = body.querySelector("aside.f9-evidence-report-rail") as HTMLElement | null;
		expect(rail, "ReportView must mount the contents rail in the PDF tree").not.toBeNull();
		expect(getComputedStyle(rail!).display).toBe("none");

		const report = body.querySelector(".f9-evidence-report") as HTMLElement | null;
		expect(report).not.toBeNull();
		expect(getComputedStyle(report!).display).toBe("block");
		expect(getComputedStyle(report!).width).toBe("100%");

		const evidenceBody = body.querySelector(".f9-evidence-body") as HTMLElement | null;
		expect(evidenceBody, "the one-row fixture must mount the evidence body").not.toBeNull();
		expect(getComputedStyle(evidenceBody!).gridTemplateColumns).toBe("minmax(0, 1fr)");
	});
});
