// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(navigation: Record<string, unknown> = { state: "idle" }) {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");

		return {
			...actual,
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useNavigation: vi.fn().mockReturnValue(navigation),
		};
	});
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("ConfirmSubmitButton", () => {
	it("arms on the first real click and submits the same native button on the second", async () => {
		await mockRouter();
		const { ConfirmSubmitButton } = await import("~/components/confirm-button");
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const submit = vi.fn((event: Event) => event.preventDefault());

		try {
			await act(async () => {
				root.render(
					createElement(
						"form",
						{ onSubmit: submit },
						createElement(ConfirmSubmitButton, {
							children: "Delete entity",
							confirmLabel: "Confirm — delete entity?",
							name: "intent",
							value: "delete-entity",
						}),
					),
				);
			});

			const button = container.querySelector("button");
			expect(button).toBeInstanceOf(HTMLButtonElement);
			expect(button?.type).toBe("submit");

			await act(async () => {
				button?.click();
			});
			expect(submit).not.toHaveBeenCalled();
			expect(button?.textContent).toContain("Confirm — delete entity?");
			expect(button?.className).toContain("f9-confirm-armed");

			await act(async () => {
				button?.click();
			});
			expect(submit).toHaveBeenCalledTimes(1);
			expect(button?.textContent).toContain("Delete entity");
			expect(button?.getAttribute("name")).toBe("intent");
			expect(button?.getAttribute("value")).toBe("delete-entity");
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});

	it("renders a plain submit button with submitter name/value semantics when disarmed", async () => {
		await mockRouter();
		const { ConfirmSubmitButton } = await import("~/components/confirm-button");

		const markup = renderToStaticMarkup(
			createElement(ConfirmSubmitButton, {
				children: "Delete collection",
				className: "f9-secondary-button",
				confirmLabel: "Confirm — delete?",
				intent: "delete-collection",
				name: "mode",
				value: "hard",
			}),
		);

		expect(markup).toContain('type="submit"');
		expect(markup).toContain('name="mode"');
		expect(markup).toContain('value="hard"');
		expect(markup).toContain("Delete collection");
		expect(markup).toContain('class="f9-secondary-button"');
		expect(markup).not.toContain("f9-danger-button");
		expect(markup).not.toContain("Confirm — delete?");
		expect(markup).toContain('aria-live="polite"');
		expect(markup).toContain('aria-atomic="true"');
	});

	it("swaps to the filled danger confirm state when armed", async () => {
		await mockRouter();
		const { ConfirmSubmitButton } = await import("~/components/confirm-button");

		const markup = renderToStaticMarkup(
			createElement(ConfirmSubmitButton, {
				children: "Delete collection",
				className: "f9-secondary-button",
				confirmLabel: "Confirm — delete?",
				initiallyArmed: true,
				name: "mode",
				value: "hard",
			}),
		);

		expect(markup).toContain("Confirm — delete?");
		expect(markup).toContain("f9-danger-button");
		expect(markup).toContain("is-filled");
		expect(markup).toContain("f9-confirm-armed");
		// Submitter semantics survive the armed swap: same button, same form post.
		expect(markup).toContain('type="submit"');
		expect(markup).toContain('name="mode"');
		expect(markup).toContain('value="hard"');
		// Screen readers hear the state change.
		expect(markup).toContain("Activate again to confirm");
	});

	it("keeps the light variant as an outline (no red fill) for recoverable actions", async () => {
		await mockRouter();
		const { ConfirmSubmitButton } = await import("~/components/confirm-button");

		const markup = renderToStaticMarkup(
			createElement(ConfirmSubmitButton, {
				children: "Revoke",
				confirmLabel: "Confirm — revoke?",
				initiallyArmed: true,
				variant: "light",
			}),
		);

		expect(markup).toContain("f9-danger-button");
		expect(markup).not.toContain("is-filled");
		expect(markup).toContain("Confirm — revoke?");
	});

	it("shows the pending spinner through SubmitButton when the matching intent is submitting", async () => {
		const formData = new FormData();
		formData.set("intent", "delete-collection");
		await mockRouter({ state: "submitting", formData });
		const { ConfirmSubmitButton } = await import("~/components/confirm-button");

		const markup = renderToStaticMarkup(
			createElement(ConfirmSubmitButton, {
				children: "Delete collection",
				confirmLabel: "Confirm — delete?",
				intent: "delete-collection",
				pendingLabel: "Deleting…",
			}),
		);

		expect(markup).toContain("f9-button-spinner");
		expect(markup).toContain("Deleting…");
		expect(markup).toContain("disabled");
	});

	it("maps variants to armed class names", async () => {
		await mockRouter();
		const { armedConfirmClassName } = await import("~/components/confirm-button");

		expect(armedConfirmClassName("danger")).toBe("f9-danger-button is-filled f9-confirm-armed");
		expect(armedConfirmClassName("light")).toBe("f9-danger-button f9-confirm-armed");
	});
});
