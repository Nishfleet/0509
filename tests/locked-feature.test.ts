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

async function renderLocked(props: Record<string, unknown>) {
	const { LockedFeature } = await import("~/components/locked-feature");
	return renderToStaticMarkup(
		createElement(LockedFeature, props as unknown as Parameters<typeof LockedFeature>[0]),
	);
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("LockedFeature", () => {
	it("renders a neutral gate with exactly one upgrade CTA and never the error color", async () => {
		await mockRouter();
		const markup = await renderLocked({
			eyebrow: "Reports",
			title: "Client-ready reports",
			reason: "Open client-ready reports and share the evidence with your team",
			planNeeded: "Agency plan",
			upgradeTo: "/app/billing?source=reports#plans",
		});

		expect(markup).toContain("f9-app-panel f9-locked-feature");
		expect(markup).toContain('role="status"');
		expect(markup).not.toContain("is-error");
		expect(markup).toContain("included in the Agency plan.");
		expect(markup.match(/f9-primary-button/g)).toHaveLength(1);
		expect(markup).toContain('href="/app/billing?source=reports#plans"');
		expect(markup).toContain("Upgrade to Agency");
		// No secondary link unless seeExampleTo is provided.
		expect(markup).not.toContain("f9-secondary-button");
	});

	it("renders an optional example link and an h2 when embedded", async () => {
		await mockRouter();
		const markup = await renderLocked({
			eyebrow: "Client rooms",
			title: "Client rooms",
			reason: "Keep everything together for agency delivery",
			planNeeded: "Agency plan",
			upgradeTo: "/app/billing?source=clients#plans",
			seeExampleTo: "/compare/magicbrief",
			headingLevel: "h2",
		});

		expect(markup).toContain("<h2");
		expect(markup).not.toContain("<h1");
		expect(markup).toContain("f9-secondary-button");
		expect(markup).toContain('href="/compare/magicbrief"');
		expect(markup).toContain("See an example");
	});
});
