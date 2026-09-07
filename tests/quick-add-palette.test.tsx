// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickAddPalette, classifyQuickAddInput } from "~/components/quick-add-palette";
import { isQuickAddShortcut } from "~/routes/app-layout";

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

async function renderPalette({
  onClose = () => {},
  searchAction = async () => ({ ok: true }),
}: {
  onClose?: () => void;
  searchAction?: (args: { request: Request }) => Promise<unknown>;
} = {}) {
  function Host() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(QuickAddPalette, {
          onClose: () => {
            setOpen(false);
            onClose();
          },
        })
      : createElement("p", null, "closed");
  }

  const Stub = createRoutesStub([
    { path: "/app", Component: Host },
    { path: "/search", action: searchAction, Component: () => null },
    { path: "/app/watchlists", Component: () => createElement("p", null, "watchlist page") },
  ]);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const currentRoot = root;
  await act(async () => {
    currentRoot.render(createElement(Stub, { initialEntries: ["/app"] }));
  });
  return container;
}

function getDialog(view: HTMLElement) {
  return view.querySelector<HTMLElement>('[role="dialog"]');
}

describe("QuickAddPalette", () => {
  it("renders an accessible dialog and focuses the input on open", async () => {
    const view = await renderPalette();
    const dialog = getDialog(view);
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("quick-add-title");
    expect(view.querySelector("#quick-add-title")).not.toBeNull();
    const input = dialog?.querySelector<HTMLInputElement>('input[name="quickAddTarget"]');
    expect(document.activeElement).toBe(input);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const view = await renderPalette({ onClose });
    const dialog = getDialog(view)!;
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getDialog(view)).toBeNull();
  });

  it("traps Tab focus inside the dialog", async () => {
    const view = await renderPalette();
    const dialog = getDialog(view)!;
    const focusable = dialog.querySelectorAll<HTMLElement>("input, button");
    const last = focusable[focusable.length - 1];
    last.focus();
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    // Wrapped back to the first focusable element instead of leaving the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });

  it("submits create-watchlist to /search with the website field for domain input", async () => {
    const seen: Array<Record<string, string>> = [];
    const view = await renderPalette({
      searchAction: async ({ request }) => {
        const formData = await request.formData();
        seen.push(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
        return { ok: true };
      },
    });
    const dialog = getDialog(view)!;
    const input = dialog.querySelector<HTMLInputElement>('input[name="quickAddTarget"]')!;
    const form = dialog.querySelector("form")!;
    await act(async () => {
      input.value = "nykaa.com";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(seen).toHaveLength(1);
    expect(seen[0].intent).toBe("create-watchlist");
    expect(seen[0].website).toBe("nykaa.com");
    expect(seen[0].mode).toBe("advertiser");
    expect(seen[0].trackingRole).toBe("competitor");
  });

  it("shows the plan-limit message with the upgrade link on limit errors", async () => {
    const view = await renderPalette({
      searchAction: async () => ({
        ok: false,
        error: "plan_limit_exceeded",
        message: "You have reached your competitor tracking limit.",
        upgradePath: "/app/billing?source=search#plans",
      }),
    });
    const dialog = getDialog(view)!;
    const input = dialog.querySelector<HTMLInputElement>('input[name="quickAddTarget"]')!;
    const form = dialog.querySelector("form")!;
    await act(async () => {
      input.value = "nykaa.com";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(dialog.textContent).toContain("You have reached your competitor tracking limit.");
    const upgrade = dialog.querySelector<HTMLAnchorElement>(
      'a[href="/app/billing?source=search#plans"]',
    );
    expect(upgrade?.textContent).toBe("View plans");
    // Dialog stays open for recovery.
    expect(getDialog(view)).not.toBeNull();
  });
});

describe("classifyQuickAddInput", () => {
  it("routes domain-like input to the website field", () => {
    expect(classifyQuickAddInput(" nykaa.com ")).toEqual({ field: "website", value: "nykaa.com" });
    expect(classifyQuickAddInput("https://mamaearth.in/store")).toEqual({
      field: "website",
      value: "https://mamaearth.in/store",
    });
  });

  it("routes brand names to the query field", () => {
    expect(classifyQuickAddInput("Nykaa")).toEqual({ field: "query", value: "Nykaa" });
    expect(classifyQuickAddInput("skincare serum co.")).toEqual({
      field: "query",
      value: "skincare serum co.",
    });
  });
});

describe("isQuickAddShortcut", () => {
  const base = { key: "k", metaKey: true, ctrlKey: false };

  it("matches Cmd+K and Ctrl+K outside typing contexts", () => {
    expect(isQuickAddShortcut({ ...base, target: document.body })).toBe(true);
    expect(
      isQuickAddShortcut({ key: "K", metaKey: false, ctrlKey: true, target: document.body }),
    ).toBe(true);
    expect(isQuickAddShortcut({ key: "k", metaKey: false, ctrlKey: false, target: document.body })).toBe(
      false,
    );
  });

  it("ignores the shortcut while typing in inputs and textareas", () => {
    expect(isQuickAddShortcut({ ...base, target: document.createElement("input") })).toBe(false);
    expect(isQuickAddShortcut({ ...base, target: document.createElement("textarea") })).toBe(false);
    expect(isQuickAddShortcut({ ...base, target: document.createElement("select") })).toBe(false);
  });
});
