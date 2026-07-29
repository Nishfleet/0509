// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

/**
 * F2 remediation round 2 — PDF rail hide must be a RENDERED guard.
 *
 * Text-parsing app.css (indexOf selector → brace-slice the body) is
 * structurally hollow: renaming `.f9-ed-report-rail` to
 * `.f9-ed-report-rail-broken` leaves the string match green while the real
 * DOM rail stays visible under the base `.f9-ed-report-rail { display: grid }`
 * rule. This file mounts the share-PDF variant, injects the shipped CSS, and
 * asserts the rail's computed display is none. Mutations that delete the
 * rule, force `display: block !important`, or rename the selector out from
 * under the DOM class all fail here.
 */

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
let styleEl: HTMLStyleElement | null = null;

beforeEach(() => {
	vi.resetModules();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	document.head.replaceChildren();
	document.body.replaceChildren();
	styleEl = document.createElement("style");
	styleEl.setAttribute("data-f2-rail-guard", "true");
	styleEl.textContent = appCss;
	document.head.appendChild(styleEl);
	document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
	const mountedRoot = root;
	if (mountedRoot) {
		await act(async () => mountedRoot.unmount());
		root = null;
	}
	styleEl = null;
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
	const mountedRoot = createRoot(document.getElementById("root") as HTMLElement);
	root = mountedRoot;
	await act(async () => {
		mountedRoot.render(createElement(ShareRoute));
	});
	return document.body;
}

describe("share-PDF rail visibility (F2 rendered guard)", () => {
	it("hides the contents rail in the screen-rendered PDF variant", async () => {
		const body = await renderPdfShareVariant();

		expect(body.querySelector("main.f9-share-pdf")).not.toBeNull();
		const rail = body.querySelector(
			"aside.f9-ed-report-rail",
		) as HTMLElement | null;
		expect(rail, "ReportView must mount the contents rail in the PDF tree").not.toBeNull();

		const railStyle = getComputedStyle(rail!);
		expect(railStyle.display).toBe("none");

		const report = body.querySelector(".f9-ed-report") as HTMLElement | null;
		expect(report).not.toBeNull();
		expect(getComputedStyle(report!).display).toBe("block");

		const evidenceBody = body.querySelector(
			".f9-ed-evidence-body",
		) as HTMLElement | null;
		if (evidenceBody) {
			expect(getComputedStyle(evidenceBody).gridTemplateColumns).toBe(
				"minmax(0, 1fr)",
			);
		}
	});
});
