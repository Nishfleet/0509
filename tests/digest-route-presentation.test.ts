import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Props = { children?: ReactNode } & Record<string, unknown>;

function component(tag: string) {
	return ({ children, ...props }: Props) => createElement(tag, props, children);
}

async function mockRoute(loaderData: unknown) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Form: component("form"),
			Link: ({ children, to, ...props }: Props & { to?: string }) =>
				createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: () => null,
			useLoaderData: () => loaderData,
			useNavigation: () => ({ state: "idle", location: null }),
			useSearchParams: () => [new URLSearchParams(), vi.fn()],
		};
	});

	vi.doMock("~/components/dashboard-page", () => ({
		DashboardPage: component("main"),
		DashboardPageHeader: ({ title, lead }: { title: string; lead?: string }) =>
			createElement("header", null, createElement("h1", null, title), lead),
	}));
	vi.doMock("~/components/dashboard-route-loading", () => ({
		DashboardRouteError: component("div"),
		DashboardRouteLoading: component("div"),
	}));
	vi.doMock("~/components/digest-intelligence", () => ({
		DigestDecisionSummary: component("div"),
		DigestIntelligence: component("div"),
		DigestMovementSummary: component("div"),
		DigestProofPacket: component("div"),
	}));
	vi.doMock("~/components/copy-button", () => ({ CopyButton: component("button") }));
	vi.doMock("~/components/empty-state", () => ({ EmptyState: component("div") }));
	vi.doMock("~/components/insight-depth-panel", () => ({ InsightDepthPanel: component("div") }));
	vi.doMock("~/components/local-time", () => ({
		LocalTime: ({ iso }: { iso: string }) => createElement("time", null, iso),
	}));
	vi.doMock("~/components/plan-limit-state", () => ({ PlanLimitState: component("div") }));
	vi.doMock("~/components/proof-glossary", () => ({ ProofGlossary: component("div") }));
	vi.doMock("~/components/submit-button", () => ({ SubmitButton: component("button") }));
}

function digestData(summary: Record<string, unknown> | null | undefined) {
	const digest = {
		id: "digest-1",
		periodStart: "2026-07-08T00:00:00.000Z",
		periodEnd: "2026-07-15T00:00:00.000Z",
		items: [],
		summary,
	};
	return {
		digests: [digest],
		digestAttemptsByDigestId: { "digest-1": [] },
		selectedDigest: digest,
		selectedDigestAttempts: [],
		canAccessDigests: true,
	};
}

beforeEach(() => vi.resetModules());
afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("digests customer presentation", () => {
	it("renders the persisted strategy paragraph as a customer-visible note", async () => {
		await mockRoute(
			digestData({
				strategyParagraph: "Competitors leaned into creator-led proof this week.",
				strategyGeneratedAt: "2026-07-15T12:00:00.000Z",
			}),
		);

		const { default: DigestsRoute } = await import("~/routes/app.digests");
		const markup = renderToStaticMarkup(createElement(DigestsRoute));

		expect(markup).toContain("AI summary of the week");
		expect(markup).toContain("Competitors leaned into creator-led proof this week.");
		expect(markup).toContain("Written by AI from the changes logged in this digest.");
	});

	it.each([
		["null summary", null],
		["missing strategy paragraph", {}],
		["blank strategy paragraph", { strategyParagraph: "   " }],
		["non-string strategy paragraph", { strategyParagraph: 42 }],
	])("does not render an AI summary for an absent or invalid %s", async (_label, summary) => {
		await mockRoute(digestData(summary));

		const { default: DigestsRoute } = await import("~/routes/app.digests");
		const markup = renderToStaticMarkup(createElement(DigestsRoute));

		expect(markup).not.toContain("AI summary of the week");
		expect(markup).not.toContain("What competitors did this week");
	});

	it.each([
		["omitted count is singular", 3, 2, 1, "1 lower-priority change omitted"],
		["omitted count is plural", 5, 2, 3, "3 lower-priority changes omitted"],
	])("renders %s cohort feedback", async (_label, total, included, omitted, expected) => {
		await mockRoute(digestData({ totalEligibleEvents: total, includedEvents: included, omittedEvents: omitted }));

		const { default: DigestsRoute } = await import("~/routes/app.digests");
		const markup = renderToStaticMarkup(createElement(DigestsRoute));

		expect(markup).toContain(`Showing ${included} of ${total} eligible changes; ${expected} from this digest.`);
	});

	it("omits cohort feedback when counts are null or omitted count is zero", async () => {
		for (const summary of [
			{ totalEligibleEvents: 3, includedEvents: 3, omittedEvents: 0 },
			{ totalEligibleEvents: 3, includedEvents: 2, omittedEvents: null },
			{ totalEligibleEvents: 3, includedEvents: 2 },
			{ totalEligibleEvents: null, includedEvents: 2, omittedEvents: 1 },
		]) {
			vi.resetModules();
			await mockRoute(digestData(summary));
			const { default: DigestsRoute } = await import("~/routes/app.digests");
			const markup = renderToStaticMarkup(createElement(DigestsRoute));
			expect(markup).not.toContain("eligible changes;");
		}
	});
});
