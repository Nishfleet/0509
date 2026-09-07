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

async function renderFeedback(props: Record<string, unknown>, children?: ReactNode) {
	const { ActionFeedback } = await import("~/components/action-feedback");
	return renderToStaticMarkup(
		createElement(ActionFeedback, props as unknown as Parameters<typeof ActionFeedback>[0], children),
	);
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("ActionFeedback", () => {
	it("renders nothing without a message", async () => {
		await mockRouter();
		expect(await renderFeedback({ data: undefined })).toBe("");
		expect(await renderFeedback({ data: null })).toBe("");
		expect(await renderFeedback({ data: { ok: true } })).toBe("");
		expect(await renderFeedback({ data: { ok: true, message: "" } })).toBe("");
	});

	it("scopes rendering to the owning intent", async () => {
		await mockRouter();
		const data = { ok: true, intent: "invite", message: "Invite sent." };

		expect(await renderFeedback({ data, intent: "invite" })).toContain("Invite sent.");
		expect(await renderFeedback({ data, intent: "revoke" })).toBe("");
		expect(await renderFeedback({ data, intent: ["revoke", "invite"] })).toContain("Invite sent.");
		// Intent-scoped slots never render intent-less legacy data.
		expect(
			await renderFeedback({ data: { ok: true, message: "Legacy." }, intent: "invite" }),
		).toBe("");
	});

	it("renders intent-less results only in the fallback slot", async () => {
		await mockRouter();
		const legacy = { ok: false, message: "Something failed." };
		const scoped = { ok: false, intent: "invite", message: "Scoped." };

		expect(await renderFeedback({ data: legacy, fallback: true })).toContain("Something failed.");
		expect(await renderFeedback({ data: scoped, fallback: true })).toBe("");
	});

	it("filters repeated-row feedback with match echoes", async () => {
		await mockRouter();
		const data = { ok: true, intent: "update-item", itemId: "item-1", message: "Updated." };

		expect(
			await renderFeedback({ data, intent: "update-item", match: { itemId: "item-1" } }),
		).toContain("Updated.");
		expect(
			await renderFeedback({ data, intent: "update-item", match: { itemId: "item-2" } }),
		).toBe("");
	});

	it("carries role=status on success and role=alert on errors", async () => {
		await mockRouter();
		const success = await renderFeedback({ data: { ok: true, message: "Saved." } });
		const failure = await renderFeedback({ data: { ok: false, message: "Nope." } });

		expect(success).toContain('role="status"');
		expect(success).toContain('aria-live="polite"');
		expect(success).toContain('aria-atomic="true"');
		expect(success).toContain("is-success");
		expect(failure).toContain('role="alert"');
		expect(failure).toContain('aria-live="assertive"');
		expect(failure).toContain('aria-atomic="true"');
		expect(failure).toContain("is-error");
	});

	it("appends the plan-limit upsell link only for plan_limit_exceeded errors", async () => {
		await mockRouter();
		const limited = {
			ok: false,
			error: "plan_limit_exceeded",
			message: "You've reached your collection limit.",
		};

		const markup = await renderFeedback({
			data: limited,
			fallback: true,
			planLimitTo: "/app/billing?source=collections#plans",
		});
		expect(markup).toContain("View plans");
		expect(markup).toContain("/app/billing?source=collections#plans");
		expect(markup).toContain("to raise the limit.");

		const plain = await renderFeedback({
			data: { ok: false, message: "Nope." },
			fallback: true,
			planLimitTo: "/app/billing?source=collections#plans",
		});
		expect(plain).not.toContain("View plans");
	});

	it("appends custom children (share URL and copy affordance)", async () => {
		await mockRouter();
		const { ActionFeedback } = await import("~/components/action-feedback");
		const React = await import("react");
		const markup = renderToStaticMarkup(
			React.createElement(
				ActionFeedback,
				{
					data: {
						ok: true,
						intent: "share-collection",
						message: "https://0509.io/share/tok",
						displayMessage: "Share link created.",
					},
					intent: "share-collection",
				},
				React.createElement("a", { href: "https://0509.io/share/tok" }, "https://0509.io/share/tok"),
			),
		);

		expect(markup).toContain("Share link created.");
		expect(markup).toContain("https://0509.io/share/tok");
	});

	it("keeps legacy share responses readable when message still carries the URL", async () => {
		await mockRouter();
		const markup = await renderFeedback({
			data: {
				ok: true,
				intent: "share-report",
				message: "https://0509.io/share/legacy-token",
			},
			intent: "share-report",
		});

		expect(markup).toContain("Snapshot link created.");
		expect(markup).not.toContain("https://0509.io/share/legacy-token");
	});
});
