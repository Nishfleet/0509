// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BL-009 — the report's client action card.
 *
 * Two defects from PR #396 are pinned here: the page used to render TWO
 * floating "I reviewed this evidence." checkboxes (one per form), and its
 * primary was "Download PDF" rather than the thing the page exists to do.
 * Brief §5: Rank 1 = "Send to client", once per screen.
 */

type Props = { children?: ReactNode } & Record<string, unknown>;

function component(tag: string) {
	return ({ children, ...props }: Props) => createElement(tag, props, children);
}

const loaderData = {
	accessDenied: false,
	report: {
		reportId: "watchlist:watch-1",
		resourceType: "watchlist",
		resourceId: "watch-1",
	},
	preparedBy: "Agency Fixture Studio",
	pdfAvailable: true,
	reportReadiness: { ok: true, reason: "Evidence is current and ready for review." },
	reviewFingerprint: "review-fingerprint",
	reviewNonce: "review-nonce",
};

async function renderRoute(overrides: Record<string, unknown> = {}) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Form: component("form"),
			Link: ({ children, to, ...props }: Props & { to?: string }) =>
				createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: () => null,
			useLoaderData: () => ({ ...loaderData, ...overrides }),
			useNavigation: () => ({ state: "idle", formData: null, location: null }),
			useParams: () => ({ id: "watchlist:watch-1" }),
		};
	});
	vi.doMock("~/components/dashboard-page", () => ({ DashboardPage: component("main") }));
	vi.doMock("~/components/dashboard-route-loading", () => ({
		DashboardRouteError: component("div"),
		DashboardRouteLoading: component("div"),
	}));
	vi.doMock("~/components/report-view", () => ({
		ReportView: ({ railActions, brandingNote }: Props) =>
			createElement("article", null, railActions as ReactNode, brandingNote as ReactNode),
	}));
	vi.doMock("~/components/action-feedback", () => ({ ActionFeedback: component("div") }));
	vi.doMock("~/components/copy-button", () => ({ CopyButton: component("button") }));

	const route = await import("~/routes/app.reports");
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => root.render(createElement(route.default)));
	return { container, root };
}

beforeEach(() => {
	vi.resetModules();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	document.body.replaceChildren();
});

describe("report client action card", () => {
	it("carries exactly one reviewed-state control for the whole page", async () => {
		const { container, root } = await renderRoute();
		try {
			const checkboxes = container.querySelectorAll('input[type="checkbox"][name="reviewed"]');
			expect(checkboxes).toHaveLength(1);

			const control = checkboxes[0] as HTMLInputElement;
			// It stays a real field of the share form, so the browser still
			// enforces the attestation without any JavaScript.
			expect(control.getAttribute("form")).toBe("report-share-form");
			expect(control.hasAttribute("required")).toBe(true);
			expect(control.value).toBe("true");
			expect(control.checked).toBe(false);
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});

	it("mirrors that one control into the PDF submission instead of asking twice", async () => {
		const { container, root } = await renderRoute();
		try {
			const mirror = () =>
				container.querySelector('input[type="hidden"][name="reviewed"]') as HTMLInputElement;
			expect(mirror().value).toBe("false");

			const control = container.querySelector(
				'input[type="checkbox"][name="reviewed"]',
			) as HTMLInputElement;
			await act(async () => control.click());

			expect(mirror().value).toBe("true");
			expect(
				container.querySelectorAll('input[type="checkbox"][name="reviewed"]'),
			).toHaveLength(1);
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});

	it("makes 'Send to client' the single Rank-1 and demotes the PDF download to Rank 2", async () => {
		const { container, root } = await renderRoute();
		try {
			const rank1 = container.querySelectorAll(".f9-evidence-cta--rank1");
			expect(rank1).toHaveLength(1);
			expect(rank1[0].textContent).toContain("Send to client");
			expect(rank1[0].classList.contains("f9-wk-btn")).toBe(true);

			const rank2 = container.querySelector(".f9-evidence-cta--rank2") as HTMLElement;
			expect(rank2.textContent).toContain("Download PDF");
			expect(rank2.classList.contains("f9-wk-lnk")).toBe(true);
			// #478: the PDF deliverable is gated on the same review tick as the
			// share form, so it starts disabled until the box is ticked.
			expect((rank2 as HTMLButtonElement).disabled).toBe(true);

			// The retired styles never ship again (brief §5).
			expect(container.querySelector(".f9-primary-button")).toBeNull();
			expect(container.querySelector(".f9-secondary-button")).toBeNull();
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});

	it("keeps PDF entitlement honest without removing report review or sharing", async () => {
		const { container, root } = await renderRoute({ pdfAvailable: false });
		try {
			expect(container.textContent).toContain(
				"PDF export is unavailable for this workspace. Review plan access before preparing a client copy.",
			);
			expect(container.querySelector('input[value="download-pdf"]')).toBeNull();
			expect(container.querySelector('input[value="share-report"]')).not.toBeNull();
			expect(container.querySelector('input[type="checkbox"][name="reviewed"]')).not.toBeNull();
			expect(container.querySelectorAll(".f9-wk-btn")).toHaveLength(1);
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});

	it("states why the report cannot be sent yet rather than only disabling the button", async () => {
		const { container, root } = await renderRoute({
			reportReadiness: { ok: false, reason: "Recapture the evidence before sharing this report." },
		});
		try {
			expect(container.textContent).toContain("Evidence report · review required");
			expect(container.textContent).toContain(
				"Recapture the evidence before sharing this report.",
			);
			expect(container.textContent).toContain("Review or recapture evidence");

			const control = container.querySelector(
				'input[type="checkbox"][name="reviewed"]',
			) as HTMLInputElement;
			expect(control.disabled).toBe(true);
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});
});
