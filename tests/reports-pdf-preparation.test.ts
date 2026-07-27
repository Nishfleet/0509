// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Props = { children?: ReactNode } & Record<string, unknown>;

function component(tag: string) {
	return ({ children, ...props }: Props) => createElement(tag, props, children);
}

const loaderData = {
	report: {
		reportId: "collection:collection-1",
		resourceType: "collection",
		resourceId: "collection-1",
	},
	preparedBy: null,
	pdfAvailable: true,
	reportReadiness: { ok: true, reason: "Evidence is current and ready for review." },
	reviewFingerprint: "review-fingerprint",
	reviewNonce: "review-nonce",
};

async function importRoute() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Form: component("form"),
			Link: ({ children, to, ...props }: Props & { to?: string }) =>
				createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: () => null,
			useLoaderData: () => loaderData,
			useNavigation: () => ({ state: "idle", formData: null, location: null }),
		};
	});
	vi.doMock("~/components/dashboard-page", () => ({ DashboardPage: component("main") }));
	vi.doMock("~/components/dashboard-route-loading", () => ({
		DashboardRouteError: component("div"),
		DashboardRouteLoading: component("div"),
	}));
	// The client action card lives in the report's contents rail (brief §6.10),
	// so the stub has to render the `railActions` slot for the PDF form to exist.
	vi.doMock("~/components/report-view", () => ({
		ReportView: ({ railActions, brandingNote }: Props) =>
			createElement("article", null, railActions as ReactNode, brandingNote as ReactNode),
	}));
	vi.doMock("~/components/action-feedback", () => ({ ActionFeedback: component("div") }));
	vi.doMock("~/components/copy-button", () => ({ CopyButton: component("button") }));
	return await import("~/routes/app.reports");
}

function pdfForm(container: HTMLElement) {
	return [...container.querySelectorAll("form")].find((form) =>
		form.querySelector('input[value="download-pdf"]'),
	) as HTMLFormElement;
}

async function renderRoute() {
	const route = await importRoute();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => root.render(createElement(route.default)));
	return { container, root, form: pdfForm(container) };
}

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.resetModules();
	document.body.replaceChildren();
});

describe("ReportsRoute PDF preparation lifecycle", () => {
	it("prevents duplicate submits, exposes busy state, and resets after 75 seconds", async () => {
		const { container, root, form } = await renderRoute();
		try {
			expect(form).toBeTruthy();
			expect(form.getAttribute("aria-busy")).toBe("false");
			expect(form.dataset.pdfPreparing).toBe("false");

			const firstSubmit = new Event("submit", { bubbles: true, cancelable: true });
			await act(async () => form.dispatchEvent(firstSubmit));
			expect(firstSubmit.defaultPrevented).toBe(false);
			expect(form.getAttribute("aria-busy")).toBe("true");
			expect(form.dataset.pdfPreparing).toBe("true");
			expect(form.querySelector('button[disabled]')).toBeTruthy();

			await act(async () => vi.advanceTimersByTime(74_999));
			expect(form.dataset.pdfPreparing).toBe("true");

			const duplicateSubmit = new Event("submit", { bubbles: true, cancelable: true });
			await act(async () => form.dispatchEvent(duplicateSubmit));
			expect(duplicateSubmit.defaultPrevented).toBe(true);

			await act(async () => vi.advanceTimersByTime(1));
			expect(form.getAttribute("aria-busy")).toBe("false");
			expect(form.dataset.pdfPreparing).toBe("false");
			expect(container.textContent).toContain("Download PDF");
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});

	it("cleans up the reset timer when the report unmounts", async () => {
		const { container, root, form } = await renderRoute();
		try {
			await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
			expect(vi.getTimerCount()).toBe(1);
			await act(async () => root.unmount());
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			container.remove();
		}
	});
});
