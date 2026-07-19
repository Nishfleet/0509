// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DashboardShell } from "~/components/dashboard-shell";

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const currentRoot = root;
    await act(async () => currentRoot.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
});

async function renderShell(initialPath: string) {
  const Stub = createRoutesStub([
    {
      path: "/app/*",
      Component: () =>
        createElement(DashboardShell, {
          accountLabel: "Workspace",
          accountTitle: "Five to Nine",
          accountDetail: "Starter plan",
          children: createElement("p", null, "Body content"),
        }),
    },
  ]);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const currentRoot = root;
  await act(async () => {
    currentRoot.render(createElement(Stub, { initialEntries: [initialPath] }));
  });
  return container;
}

describe("DashboardShell accessibility (WP-43)", () => {
  it("renders a skip link as the first focusable element, targeting the main content", async () => {
    const view = await renderShell("/app/watchlists");

    const shell = view.querySelector("main");
    expect(shell).not.toBeNull();
    const firstFocusable = shell?.querySelector(
      "a[href], button, input, select, textarea, [tabindex]",
    );
    expect(firstFocusable?.classList.contains("f9-skip-link")).toBe(true);
    expect(firstFocusable?.getAttribute("href")).toBe("#f9-main-content");
    expect(firstFocusable?.textContent).toBe("Skip to content");

    const target = view.querySelector("#f9-main-content");
    expect(target).not.toBeNull();
    expect(target?.classList.contains("f9-cursor-main")).toBe(true);
    // tabindex=-1 so the skip target can receive programmatic focus.
    expect(target?.getAttribute("tabindex")).toBe("-1");
  });

  it("marks the active nav link with aria-current=page", async () => {
    const view = await renderShell("/app/watchlists");

    const current = Array.from(view.querySelectorAll('a[aria-current="page"]'));
    expect(current.length).toBeGreaterThan(0);
    for (const link of current) {
      expect(link.getAttribute("href")).toBe("/app/watchlists");
    }
  });
});
