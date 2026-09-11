import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";
import { createDigestRun, upsertDigestDelivery } from "~/lib/data/digests.server";

import { appEnv, db, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #2471 — the briefs route's delivery trail must not lie about older
 * briefs.
 *
 * The loader fetches only the newest 80 `delivery_attempt` rows across ALL
 * digests (`listDeliveryAttempts({ limit: 80 })`), while the sidebar lists up
 * to 60 briefs. Two consequences, both confirmed by the finding:
 *
 * 1. A brief whose per-recipient attempts exist but fall outside the global
 *    80-row window renders the legacy aggregate fallback — or, once the
 *    fallback copy was made honest, loses its per-recipient trail entirely.
 *    The selected digest (the one whose trail is actually rendered) must get
 *    its attempts from a `digestRunId`-scoped query instead of the shared
 *    window.
 * 2. A listed brief older than the window with zero attempts in it must not
 *    claim "Sent — predates per-recipient tracking" — the aggregate fallback
 *    copy must say what is actually true: "Sent — per-recipient detail not
 *    loaded".
 *
 * Seeded against real D1: one old sent brief with two of its own attempts
 * (pushed out of the 80-row window by 81 newer attempts for a newer brief),
 * plus one even older sent brief with no attempt rows at all. The loader runs
 * with mocked auth; the route component renders the real loader data.
 */

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

const PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

async function seedPlan(userId: string) {
	await db()
		.prepare(`INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, 'agency', ?)`)
		.bind(userId, "2026-01-01T00:00:00.000Z")
		.run();
}

async function seedSentDigest(options: {
	userId: string;
	watchlistId: string;
	periodStart: string;
	periodEnd: string;
}) {
	const digestRunId = await createDigestRun(
		appEnv,
		options.userId,
		options.periodStart,
		options.periodEnd,
		{
			kind: "scheduled",
			adsSeen: 0,
		},
		{
			returnClaim: true,
			items: [
				{
					watchlistId: options.watchlistId,
					watchlistName: "Glowkart",
					eventType: "ad_new",
					title: "Baseline captured",
					summary: "We recorded this week's movement.",
				},
			],
		},
	);
	const id = typeof digestRunId === "string" ? digestRunId : digestRunId.digestRunId;
	await upsertDigestDelivery(appEnv, id, {
		provider: "email",
		status: "sent",
		recipientEmail: `${options.userId}@example.test`,
		externalMessageId: null,
		errorMessage: null,
		deliveredAt: options.periodEnd,
	});
	return id;
}

async function seedDeliveryAttempt(options: {
	userId: string;
	digestRunId: string;
	channel: "email" | "slack";
	status: string;
	createdAt: string;
}) {
	await db()
		.prepare(
			`INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, lane, channel, provider, status,
        webhook_status, target_value, event_ids_json, payload_snapshot_json,
        idempotency_key, sent_at, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, 'customer', ?, 'cloudflare', ?, ?, ?, '[]', '{}', ?, ?, ?, ?)`,
		)
		.bind(
			uid("da"),
			options.userId,
			options.digestRunId,
			options.channel,
			options.status,
			options.status === "sent" ? "delivered" : "pending",
			`${options.userId}@example.test`,
			`seed:${options.digestRunId}:${options.channel}:${uid("idem")}`,
			options.status === "sent" ? options.createdAt : null,
			options.createdAt,
			options.createdAt,
		)
		.run();
}

async function callBriefsLoader(url: string) {
	const { loader } = await import("~/routes/app.briefs");
	return loader({
		context: { cloudflare: { env: { ...appEnv } as unknown as Record<string, unknown> } },
		params: {},
		request: new Request(url),
	} as never);
}

async function renderBriefs(data: unknown, search = "") {
	vi.resetModules();
	await mockRoute(data, search);
	const { default: BriefsRoute } = await import("~/routes/app.briefs");
	return renderToStaticMarkup(createElement(BriefsRoute));
}

let seededUserId: string;

beforeEach(() => {
	vi.resetModules();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.doMock("~/lib/auth.server", async () => {
		const actual = await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
		return {
			...actual,
			requireWorkspaceSession: async () => ({
				session: {
					user: { id: seededUserId, email: `${seededUserId}@example.test`, name: "Fixture" },
					expires: new Date(Date.now() + 3600_000).toISOString(),
				},
				workspaceUserId: seededUserId,
				isMember: false,
				ownerName: "Fixture",
			}),
		};
	});
});

afterEach(() => {
	vi.doUnmock("~/lib/auth.server");
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("briefs delivery trail outside the global attempt window (issue #2471)", () => {
	it("fetches the selected digest's attempts with a digestRunId-scoped query and renders the honest fallback copy for older briefs", async () => {
		const userId = await seedUser(uid("user"));
		seededUserId = userId;
		await seedPlan(userId);
		const watchlistId = await seedWatchlist(userId, uid("wl"));

		// An old sent brief whose own per-recipient attempts exist but sit
		// outside the newest-80 window.
		const selectedId = await seedSentDigest({
			userId,
			watchlistId,
			periodStart: "2026-06-01T00:00:00.000Z",
			periodEnd: "2026-06-08T00:00:00.000Z",
		});
		const OLD_ATTEMPT_AT = "2026-06-08T00:30:00.000Z";
		await seedDeliveryAttempt({ userId, digestRunId: selectedId, channel: "email", status: "sent", createdAt: OLD_ATTEMPT_AT });
		await seedDeliveryAttempt({ userId, digestRunId: selectedId, channel: "slack", status: "sent", createdAt: OLD_ATTEMPT_AT });

		// An even older sent brief with no attempt rows at all — the sidebar
		// fallback case.
		const olderId = await seedSentDigest({
			userId,
			watchlistId,
			periodStart: "2026-05-25T00:00:00.000Z",
			periodEnd: "2026-06-01T00:00:00.000Z",
		});

		// A newer brief carrying 81 attempts, pushing the old attempts out of
		// the loader's newest-80 window.
		const newerId = await seedSentDigest({
			userId,
			watchlistId,
			periodStart: "2026-06-15T00:00:00.000Z",
			periodEnd: "2026-06-22T00:00:00.000Z",
		});
		for (let i = 0; i < 81; i += 1) {
			await seedDeliveryAttempt({
				userId,
				digestRunId: newerId,
				channel: "email",
				status: "sent",
				createdAt: `2026-06-22T00:0${i % 10}:00.000Z`,
			});
		}

		const data = (await callBriefsLoader(
			`http://localhost/app/briefs?digest=${selectedId}`,
		)) as {
			selectedDigestAttempts: unknown[];
			digestAttemptsByDigestId: Record<string, unknown[]>;
		};

		// RED today: the selected brief's attempts fall outside the global
		// newest-80 window, so the trail renders the legacy aggregate fallback
		// instead of its real per-recipient record.
		expect(data.selectedDigestAttempts).toHaveLength(2);

		const markup = await renderBriefs(data, `digest=${selectedId}`);
		// RED today: the fallback copy claims the brief predates
		// per-recipient tracking, which is false — the attempt rows exist.
		expect(markup).not.toContain("predates per-recipient tracking");
		expect(markup).toContain("Sent — per-recipient detail not loaded");
		// The selected brief's own trail renders its real per-recipient
		// statuses.
		expect(data.digestAttemptsByDigestId[selectedId]).toHaveLength(2);
		expect(data.digestAttemptsByDigestId[olderId]).toEqual([]);
	});
});
