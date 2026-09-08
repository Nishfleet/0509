// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, useActionData, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SetupChecklistCard } from "~/components/setup-checklist-card";
import type { WorkspaceReadiness } from "~/lib/workspace-readiness.server";

/**
 * Salvaged from the parked BL-025 stack (PR #416, f761dd7) by BL-030. Only
 * the behaviour was certified by that review, so only the behaviour is here.
 *
 * The setup card answers a refused quick-create through a FETCHER (so the
 * refusal never navigates) while the bulk-import forms are still navigating
 * `<Form>`s answering through the ROUTE ACTION. React Router retains
 * `fetcher.data` after the fetcher returns to idle, so a naive
 * "fetcher-data-wins" selection makes the first refusal permanent: every later
 * import result completes on the server and is then hidden in the component
 * until a full page reload.
 *
 * These specs drive the real router (`createRoutesStub`), so they exercise the
 * actual submission ordering rather than a hand-mocked snapshot.
 */

const REFUSAL_MESSAGE =
  "We didn't start anything — there's no website to check yet.";
const PREVIEW_MESSAGE = "Ready to create 1 competitor watchlist.";

const readiness = {
  status: "needs_setup",
  readyCount: 0,
  totalCount: 4,
  items: [
    {
      id: "first_competitor",
      label: "First competitor",
      status: "needs_setup",
      detail: "Paste one competitor website to start.",
      action: { label: "Search competitor", href: "/search" },
    },
  ],
  counts: { activeWatchlists: 0 },
  billing: { plan: "starter" },
} as unknown as WorkspaceReadiness;

function previewPayload() {
  return {
    ok: true,
    intent: "preview-market-desk-import",
    message: PREVIEW_MESSAGE,
    rawText: "boat-lifestyle.com",
    preview: {
      ok: true,
      error: null,
      planLimit: 10,
      currentCount: 0,
      availableSlots: 10,
      selectedCount: 1,
      rows: [
        {
          id: "row-1",
          rowNumber: 1,
          raw: "boat-lifestyle.com",
          name: null,
          website: "https://boat-lifestyle.com",
          normalizedUrl: "https://boat-lifestyle.com",
          host: "boat-lifestyle.com",
          notes: null,
          tags: [],
          client: null,
          status: "valid",
          reason: null,
          selected: true,
          target: {
            name: "boat-lifestyle.com watch",
            targetType: "page",
            targetId: "boat-lifestyle.com",
            targetFingerprint: "page:boat-lifestyle.com",
            targetLabel: "boAt Lifestyle",
            targetCountry: "IN",
            trackingRole: "competitor",
          },
        },
      ],
      summary: { valid: 1, invalid: 0, duplicate: 0, existing: 0, over_cap: 0 },
    },
  };
}

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterEach(async () => {
  if (root) {
    const currentRoot = root;
    await act(async () => currentRoot.unmount());
  }
  root = null;
  document.body.replaceChildren();
});

async function renderSetupCard(
  action: (args: { request: Request }) => Promise<unknown>,
) {
  const Stub = createRoutesStub([
    {
      path: "/app",
      action,
      Component: () =>
        createElement(
          "div",
          null,
          createElement("output", { id: "url" }, useCurrentUrl()),
          createElement(SetupChecklistCard, {
            readiness,
            actionData: useActionData() as never,
            // The card refuses an empty or malformed website in the browser
            // (the submit stays disabled), so the refusal these specs exercise
            // is the SERVER's — a plan limit, an unverified email, a website
            // it could not normalize. Those are the ones that used to leave
            // the customer looking at `/app?index`.
            prefillWebsite: "nykaa.com",
          }),
        ),
    },
  ]);

  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const currentRoot = root;
  await act(async () => {
    currentRoot.render(createElement(Stub, { initialEntries: ["/app"] }));
  });
  return container;
}

function useCurrentUrl() {
  const location = useLocation();
  return `${location.pathname}${location.search}`;
}

/** The quick-create submit, found by its form rather than its label — the
 *  label is exactly what changes while the fetcher is in flight. */
function quickCreateSubmit(view: HTMLElement) {
  return view.querySelector<HTMLButtonElement>(
    "form.f9-evidence-setup-primary button[type='submit']",
  )!;
}

function trackButton(view: HTMLElement) {
  return [...view.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.startsWith("Track "),
  )!;
}

function importButton(view: HTMLElement, intent: string) {
  return view.querySelector<HTMLButtonElement>(`button[value="${intent}"]`);
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

describe("setup checklist quick-create pending state", () => {
  /**
   * Review finding 4: the salvage commit claims `SubmitButton.pending` exists
   * so a fetcher-driven submit still shows its in-flight treatment, but
   * nothing asserted it. A fetcher submission never enters `useNavigation()`,
   * so without the prop this button would go from idle straight to answered
   * and the customer would get no feedback on the slowest action on the page.
   */
  it("marks the submit busy while the fetcher is in flight, and clears it after", async () => {
    let release: (() => void) | null = null;
    const view = await renderSetupCard(async ({ request }) => {
      await request.formData();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: false, intent: "create-watchlist", message: REFUSAL_MESSAGE };
    });

    const button = quickCreateSubmit(view);
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.click();
    });
    await settle();

    const busy = quickCreateSubmit(view);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain("Starting first scan…");

    await act(async () => {
      release?.();
    });
    await settle();

    const settled = quickCreateSubmit(view);
    expect(settled.getAttribute("aria-busy")).toBeNull();
    expect(settled.disabled).toBe(false);
    expect(view.textContent).toContain(REFUSAL_MESSAGE);
  });
});

describe("setup checklist feedback precedence", () => {
  it("lets a bulk-import preview replace a retained quick-create refusal", async () => {
    const seenIntents: string[] = [];
    const view = await renderSetupCard(async ({ request }) => {
      const formData = await request.formData();
      const intent = String(formData.get("intent") ?? "");
      seenIntents.push(intent);
      if (intent === "create-watchlist") {
        return { ok: false, intent, message: REFUSAL_MESSAGE };
      }
      return previewPayload();
    });

    expect(view.querySelector("#url")?.textContent).toBe("/app");

    // 1. The refused quick-create answers through the fetcher, so it produces
    //    no navigation at all — the URL never becomes `/app?index`.
    await act(async () => {
      trackButton(view).click();
    });
    await settle();
    expect(seenIntents).toEqual(["create-watchlist"]);
    expect(view.querySelector("#url")?.textContent).toBe("/app");
    expect(view.textContent).toContain(REFUSAL_MESSAGE);
    expect(view.querySelector(".f9-import-preview")).toBeNull();

    // 2. A bulk-import preview is a route-action submission that lands AFTER
    //    the refusal, so it owns the single feedback slot from here.
    const preview = importButton(view, "preview-market-desk-import");
    expect(preview).not.toBeNull();
    await act(async () => {
      preview!.click();
    });
    await settle();

    expect(seenIntents).toEqual([
      "create-watchlist",
      "preview-market-desk-import",
    ]);
    expect(view.textContent).toContain(PREVIEW_MESSAGE);
    expect(view.textContent).not.toContain(REFUSAL_MESSAGE);
    expect(view.querySelector(".f9-import-preview")).not.toBeNull();
    expect(importButton(view, "create-market-desk-import")).not.toBeNull();
  });

  it("lets a later quick-create refusal replace an unusable import preview", async () => {
    const view = await renderSetupCard(async ({ request }) => {
      const formData = await request.formData();
      const intent = String(formData.get("intent") ?? "");
      if (intent === "create-watchlist") {
        return { ok: false, intent, message: REFUSAL_MESSAGE };
      }
      return {
        ok: false,
        intent: "preview-market-desk-import",
        message: "No ready competitors found.",
        rawText: "???",
        preview: {
          ok: false,
          error: null,
          planLimit: 10,
          currentCount: 0,
          availableSlots: 10,
          selectedCount: 0,
          rows: [],
          summary: {
            valid: 0,
            invalid: 1,
            duplicate: 0,
            existing: 0,
            over_cap: 0,
          },
        },
      };
    });

    await act(async () => {
      importButton(view, "preview-market-desk-import")!.click();
    });
    await settle();
    expect(view.textContent).toContain("No ready competitors found.");

    // The unusable preview keeps the quick-create form on screen; its refusal
    // is the newest answer and must not be masked by the retained route data.
    await act(async () => {
      trackButton(view).click();
    });
    await settle();
    expect(view.textContent).toContain(REFUSAL_MESSAGE);
    expect(view.textContent).not.toContain("No ready competitors found.");
  });
});
