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

async function renderEmptyState(props: Record<string, unknown>) {
	const { EmptyState } = await import("~/components/empty-state");
	return renderToStaticMarkup(
		createElement(EmptyState, props as unknown as Parameters<typeof EmptyState>[0]),
	);
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("EmptyState", () => {
	it("renders the dashed panel variant by default with role=status", async () => {
		await mockRouter();
		const markup = await renderEmptyState({
			title: "No entities yet",
			description: "Add your brand or a competitor to start.",
			action: { label: "Add from search", to: "/search" },
		});

		expect(markup).toContain("f9-dash-state f9-dash-state-empty");
		expect(markup).toContain('role="status"');
		expect(markup).toContain("<h2>No entities yet</h2>");
		expect(markup).toContain("Add your brand or a competitor to start.");
		expect(markup).toContain('href="/search"');
		expect(markup).toContain("f9-wk-btn");
		expect(markup).toContain("Add from search");
	});

	it("renders the optional sample link as a secondary action beside the primary", async () => {
		await mockRouter();
		const markup = await renderEmptyState({
			title: "Add your first competitor",
			description: "Paste a website to start tracking.",
			action: { label: "Add competitor", to: "/search" },
			sample: { label: "See a sample brief", to: "/#demo" },
		});

		expect(markup).toContain("f9-empty-actions");
		expect(markup).toContain("f9-wk-btn");
		expect(markup).toContain("f9-wk-btn-quiet");
		expect(markup).toContain('href="/#demo"');
		expect(markup).toContain("See a sample brief");
	});

	it("supports h3 headings so page outlines stay coherent", async () => {
		await mockRouter();
		const markup = await renderEmptyState({
			title: "Nothing here",
			headingLevel: "h3",
		});

		expect(markup).toContain("<h3>Nothing here</h3>");
		expect(markup).not.toContain("<h2>");
	});

	it("renders the inline variant as a single muted sentence", async () => {
		await mockRouter();
		const markup = await renderEmptyState({
			title: "No presence items yet.",
			description: "Check a website source to fetch updates.",
			variant: "inline",
		});

		expect(markup).toContain("f9-wk-dim f9-empty-inline");
		expect(markup).toContain('role="status"');
		expect(markup).toContain("No presence items yet.");
		expect(markup).toContain("Check a website source to fetch updates.");
		expect(markup).not.toContain("f9-dash-state");
	});

	it("renders the row variant inside work lists", async () => {
		await mockRouter();
		const markup = await renderEmptyState({
			title: "No API keys yet",
			description: "Create one when you are ready to connect an external tool.",
			variant: "row",
		});

		expect(markup).toContain("f9-wk-workrow f9-empty-row");
		expect(markup).toContain('role="status"');
		expect(markup).toContain("<strong>No API keys yet</strong>");
		expect(markup).toContain("Create one when you are ready to connect an external tool.");
	});
});
