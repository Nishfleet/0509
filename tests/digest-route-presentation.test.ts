import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Props = { children?: ReactNode } & Record<string, unknown>;

function component(tag: string) {
	return ({ children, ...props }: Props) => createElement(tag, props, children);
}

async function mockRoute(loaderData: unknown, search = "") {
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
			useSearchParams: () => [new URLSearchParams(search), vi.fn()],
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
	vi.doMock("~/components/copy-button", () => ({ CopyButton: component("button") }));
	vi.doMock("~/components/local-time", () => ({
		LocalTime: ({ iso }: { iso: string }) => createElement("time", null, iso),
	}));
	vi.doMock("~/components/plan-limit-state", () => ({ PlanLimitState: component("div") }));
	vi.doMock("~/components/submit-button", () => ({ SubmitButton: component("button") }));
}

function digestData(
	summary: Record<string, unknown> | null | undefined,
	attempts: Array<Record<string, unknown>> = [],
) {
	const digest = {
		id: "digest-1",
		periodStart: "2026-07-08T00:00:00.000Z",
		periodEnd: "2026-07-15T00:00:00.000Z",
		createdAt: "2026-07-15T09:14:00.000Z",
		items: [],
		summary,
	};
	return {
		digests: [digest],
		digestAttemptsByDigestId: { "digest-1": attempts },
		selectedDigest: digest,
		selectedDigestAttempts: attempts,
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
		// The machine's reading is framed as derived and sits BELOW the evidence
		// it reads — never above the changes with a verification-shaped label.
		expect(markup).toContain("AI summary · a reading of the changes above");
		expect(markup).not.toContain("checked against the filed changes");
		const summaryAt = markup.indexOf("AI summary · a reading of the changes above");
		const checkedSectionAt = markup.indexOf("What we checked");
		expect(summaryAt).toBeGreaterThan(checkedSectionAt);
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

	it.each(["", "?firstrun=1"])(
		"renders one designed brief and retires the separate first-run front page for %s",
		async (search) => {
			await mockRoute(digestData(null), search);
			const { default: DigestsRoute } = await import("~/routes/app.digests");
			const markup = renderToStaticMarkup(createElement(DigestsRoute));

			expect(markup).toContain('class="f9-wk-brief"');
			expect(markup).toContain("Brief history");
			expect(markup).toContain("Showing 1 recent brief on file.");
			expect(markup).toContain('id="first-brief-detail"');
			expect(markup).toContain(
				'href="/app/digests?digest=digest-1#first-brief-detail"',
			);
			expect(markup).toContain("2026-07-15T09:14:00.000Z");
			expect(markup).not.toContain("f9-wire-frontpage");
			expect(markup).not.toContain("FIRST BRIEF · FILED");
			expect(markup).not.toContain("05:09");
		},
	);

	it("reports the newest filing shown even when a backfill has an older period", async () => {
		const data = digestData(null);
		data.digests.push({
			...data.selectedDigest,
			id: "digest-backfill",
			periodEnd: "2026-07-10T00:00:00.000Z",
			createdAt: "2026-07-20T12:30:00.000Z",
		});
		await mockRoute(data);

		const { default: DigestsRoute } = await import("~/routes/app.digests");
		const markup = renderToStaticMarkup(createElement(DigestsRoute));

		expect(markup).toMatch(
			/Newest filing shown <time>2026-07-20T12:30:00\.000Z<\/time>/,
		);
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

	it("does not call a provider-accepted email delivered or sent while delivery is unconfirmed", async () => {
		await mockRoute(
			digestData(null, [{
				channel: "email",
				targetValue: "Configured email recipient",
				status: "sent",
				webhookStatus: "provider_unknown",
				errorMessage: "The email provider accepted this message, but final delivery is unconfirmed.",
				providerStatusLastSeenAt: null,
				sentAt: "2026-07-15T09:14:00.000Z",
				createdAt: "2026-07-15T09:14:00.000Z",
			}]),
		);

		const { default: DigestsRoute } = await import("~/routes/app.digests");
		const markup = renderToStaticMarkup(createElement(DigestsRoute));

		expect(markup).toContain("Delivery unconfirmed");
		expect(markup).toContain("Email delivery unconfirmed");
		expect(markup).not.toContain(">Sent<");
		expect(markup).not.toContain("Email sent");
	});

	it.each([
		["WhatsApp", "pending", "whatsapp"],
		["WhatsApp", "provider_unknown", "whatsapp"],
		["Slack", "pending", "slack"],
		["Slack", "provider_unknown", "slack"],
	])(
		"does not call provider-accepted %s sent while receipt state is %s",
		async (channelLabel, webhookStatus, channel) => {
			await mockRoute(
				digestData(null, [{
					channel,
					targetValue: channel === "whatsapp" ? "Configured WhatsApp recipient" : "Connected Slack workspace",
					status: "sent",
					webhookStatus,
					errorMessage: `${channelLabel} accepted this message for sending, but final delivery is unconfirmed.`,
					providerStatusLastSeenAt: null,
					sentAt: "2026-07-15T09:14:00.000Z",
					createdAt: "2026-07-15T09:14:00.000Z",
				}]),
			);

			const { default: DigestsRoute } = await import("~/routes/app.digests");
			const markup = renderToStaticMarkup(createElement(DigestsRoute));

			expect(markup).toContain("Delivery unconfirmed");
			expect(markup).toContain(`${channelLabel} delivery unconfirmed`);
			expect(markup).not.toContain(`${channelLabel} sent`);
		},
	);

	it("keeps a confirmed WhatsApp receipt labelled delivered", async () => {
		await mockRoute(
			digestData(null, [{
				channel: "whatsapp",
				targetValue: "Configured WhatsApp recipient",
				status: "sent",
				webhookStatus: "delivered",
				errorMessage: null,
				providerStatusLastSeenAt: "2026-07-15T09:15:00.000Z",
				sentAt: "2026-07-15T09:14:00.000Z",
				createdAt: "2026-07-15T09:14:00.000Z",
			}]),
		);

		const { default: DigestsRoute } = await import("~/routes/app.digests");
		const markup = renderToStaticMarkup(createElement(DigestsRoute));

		expect(markup).toContain("WhatsApp delivered");
		expect(markup).toContain(">Delivered<");
		expect(markup).not.toContain("Delivery unconfirmed");
	});
});
