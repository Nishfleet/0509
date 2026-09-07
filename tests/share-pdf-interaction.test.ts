// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

const REPORT_SNAPSHOT_PAYLOAD = {
	kind: "report",
	reportId: "shared-report",
	resourceType: "collection",
	resourceId: "shared",
	title: "Board evidence",
	subtitle: "Latest saved evidence",
	summary: "One saved item.",
	generatedAt: "2026-07-01T00:00:00.000Z",
	aiWeeklySummary: null,
	stats: [],
	insightDepth: {
		topHooks: [],
		mediaMix: [],
		campaignDurations: [],
		metricProof: [],
		creativeTimeline: [],
		landingPageHistory: [],
	},
	rows: [],
};

const shareData = {
	mode: "snapshot" as const,
	resourceType: "report" as const,
	payload: REPORT_SNAPSHOT_PAYLOAD,
	preparedBy: null,
	brandIdentity: null,
	pdfVariant: false,
	pdfPath: "/share/token-1/pdf",
};

function component(tag: string) {
	return ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
		createElement(tag, props, children);
}

let root: Root | null;

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	root = null;
	document.body.innerHTML = '<div id="root"></div>';

	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
				createElement("a", { ...props, href: to }, children),
			useLoaderData: () => shareData,
		};
	});
	vi.doMock("~/components/ad-longevity-pill", () => ({ AdLongevityPill: component("span") }));
	vi.doMock("~/components/ad-thumb", () => ({ AdThumb: component("span") }));
	vi.doMock("~/components/brand-wordmark", () => ({ BrandWordmark: component("span") }));
	vi.doMock("~/components/local-time", () => ({ LocalTime: component("time") }));
	vi.doMock("~/components/report-view", () => ({
		ReportView: ({ railActions }: { railActions?: ReactNode }) =>
			createElement("section", null, railActions),
	}));
	vi.doMock("~/components/share-brand-identity", () => ({ ShareBrandIdentity: component("span") }));
	vi.doMock("~/components/digest-intelligence", () => ({
		DigestIntelligence: component("span"),
		DigestMovementSummary: component("span"),
		DigestProofPacket: component("span"),
	}));
});

afterEach(() => {
	const mountedRoot = root;
	if (mountedRoot) {
		act(() => mountedRoot.unmount());
		root = null;
	}
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.resetModules();
	document.body.replaceChildren();
});

async function renderShare() {
	const { default: ShareRoute } = await import("~/routes/share.$token");
	const mountedRoot = createRoot(document.getElementById("root") as HTMLElement);
	root = mountedRoot;
	await act(async () => {
		mountedRoot.render(createElement(ShareRoute));
	});
	return document.querySelector('a[data-pdf-preparing], a[href$="/pdf"]') as HTMLAnchorElement;
}

describe("public share PDF interaction", () => {
	it("allows the first click, blocks a second click, and resets after 75 seconds", async () => {
		const link = await renderShare();

		expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(true);
		await act(async () => undefined);
		expect(link.getAttribute("aria-disabled")).toBe("true");
		expect(link.textContent).toBe("Preparing…");

		expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);

		await act(async () => {
			vi.advanceTimersByTime(75_000);
		});
		expect(link.getAttribute("aria-disabled")).toBe("false");
		expect(link.textContent).toBe("Download PDF");
	});

	it("cleans up the reset timer when unmounted", async () => {
		const link = await renderShare();
		await act(async () => {
			link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});
		expect(vi.getTimerCount()).toBe(1);

		await act(async () => root?.unmount());
		root = null;
		expect(vi.getTimerCount()).toBe(0);
	});
});
