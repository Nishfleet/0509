// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import AppLayoutRoute from "~/routes/app-layout";
import CollectionsRoute from "~/routes/app.collections";
import type { CollectionItemRecord } from "~/lib/types";

/**
 * BL-014 remediation — the §5 contract is a SCREEN contract.
 *
 * The first version of these specs rendered the collections route on its own,
 * which pinned the component boundary instead of what the customer sees: the
 * workspace shell used to carry its own standing ink-filled "+ Add competitor",
 * so a page primary made two. BL-042 deleted that shell-owned row outright, so
 * the shell now contributes no primary on any route and the page's own primary
 * is the screen's only one. The contract is unchanged and still asserted the
 * same way: everything here renders the real app layout with the real route
 * inside it and counts every ink-filled primary on the screen — `.f9-wk-btn`
 * (the landing-language rank) and `.f9-primary-button` (the legacy style)
 * together — plus proves the deleted row is absent.
 *
 * These are live-DOM specs, so they also cover what static markup cannot: the
 * disclosures actually toggling, focus landing on the summary, and the
 * switcher's `aria-current`.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;

const collection = {
  id: "collection-1",
  userId: "user-1",
  name: "Launch proof",
  description: "Current competitor examples",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

function savedItem(overrides: Partial<CollectionItemRecord> = {}): CollectionItemRecord {
  return {
    id: "item-1",
    collectionId: "collection-1",
    adId: "ad-1",
    note: "Runs every launch week.",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
    tags: ["launch"],
    ...overrides,
    ad: {
      metaAdId: "ad-1",
      advertiser: "Okara",
      body: "Two months free when you switch this week.",
      previewHeadline: "Switch and save",
      hook: "Switch this week and skip two months",
      offer: "Two months free",
      cta: "Start free",
      format: "image",
      platforms: ["Meta"],
      firstSeenAt: "2026-06-20T00:00:00.000Z",
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      active: true,
      source: "meta_library_browser",
      analysisFields: [],
      adSnapshotUrl: "https://library.example/ad/1",
      landingPageUrl: null,
      evidenceCapturedAt: "2026-07-20T08:55:00.000Z",
      ...(overrides.ad ?? {}),
    } as CollectionItemRecord["ad"],
  };
}

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

/** The whole screen: real layout shell, real route, one memory router. */
async function renderScreen(loaderData: Record<string, unknown>) {
  const Stub = createRoutesStub([
    {
      path: "/app",
      Component: AppLayoutRoute,
      loader: () => ({
        session: { user: { email: "owner@example.invalid", name: "Owner" } },
        showOpsNav: false,
        showPresenceNav: false,
      }),
      children: [
        {
          path: "collections",
          Component: CollectionsRoute,
          loader: () => ({
            advertiserFilter: null,
            collections: [collection],
            hiddenByAdvertiserFilter: 0,
            items: [],
            plan: "agency",
            selectedCollection: collection,
            ...loaderData,
          }),
        },
      ],
    },
  ]);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const currentRoot = root;
  await act(async () => {
    currentRoot.render(createElement(Stub, { initialEntries: ["/app/collections"] }));
  });
  return container;
}

/** Every ink-filled primary on the screen, shell included. */
function screenPrimaries(view: HTMLElement) {
  return Array.from(view.querySelectorAll(".f9-wk-btn, .f9-primary-button"));
}

describe("collections screen-level Rank-1 budget (brief §5)", () => {
  it.each([
    ["free first run", { collections: [], plan: "free", selectedCollection: null }, 1],
    ["first run", { collections: [], plan: "agency", selectedCollection: null }, 1],
    ["collection selected, nothing filed", {}, 1],
    ["populated", { items: [savedItem()] }, 1],
  ])("shows at most one ink primary for %s", async (_label, loaderData, expected) => {
    const view = await renderScreen(loaderData as Record<string, unknown>);

    expect(screenPrimaries(view)).toHaveLength(expected);
    expect(view.querySelector(".f9-dash-topbar")).toBeNull();
  });

  it("keeps the whole screen free of a second primary when a plan is at its limit", async () => {
    const { getPlanLimit } = await import("~/lib/plan-entitlements");
    const limit = getPlanLimit("scout", "collections");
    const atLimit = Array.from({ length: limit }, (_value, index) => ({
      ...collection,
      id: `collection-${index + 1}`,
      name: `Board ${index + 1}`,
    }));

    const view = await renderScreen({
      collections: atLimit,
      items: [savedItem()],
      plan: "scout",
      selectedCollection: atLimit[0],
    });

    expect(screenPrimaries(view)).toHaveLength(1);
    expect(screenPrimaries(view)[0]?.textContent).toContain("View upgrade options");
  });
});

describe("collections plan × action surface", () => {
  it("keeps every Agency collection action as quiet text below the evidence", async () => {
    const view = await renderScreen({ items: [savedItem()] });

    const row = view.querySelector(".f9-library-actions");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Package for client");
    expect(row?.textContent).toContain("Export collection");
    expect(row?.textContent).toContain("Create share link");
    expect(row?.textContent).toContain("Delete collection");
    expect(row?.textContent).not.toContain("Compare plans");
    expect(row?.querySelectorAll(".f9-wk-btn")).toHaveLength(0);
  });

  it("still exposes both export formats behind the one control", async () => {
    const view = await renderScreen({ items: [savedItem()] });

    const exportPanel = view.querySelector(".f9-library-export");
    const links = Array.from(exportPanel?.querySelectorAll("a") ?? []).map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toEqual([
      "/export/collection/collection-1",
      "/export/collection/collection-1?format=json",
    ]);
  });
});

describe("collections disclosures and switcher (live DOM)", () => {
  it("toggles a disclosure open and closed from its summary", async () => {
    const view = await renderScreen({ items: [savedItem()] });

    const details = view.querySelector<HTMLDetailsElement>(".f9-library-external");
    const summary = details?.querySelector<HTMLElement>("summary");
    expect(details?.open).toBe(false);

    await act(async () => summary?.click());
    expect(details?.open).toBe(true);

    await act(async () => summary?.click());
    expect(details?.open).toBe(false);
  });

  it("puts focus on the summary, which is the control", async () => {
    const view = await renderScreen({ items: [savedItem()] });

    const summary = view.querySelector<HTMLElement>(".f9-library-export summary");
    expect(summary).not.toBeNull();
    await act(async () => summary?.focus());
    expect(document.activeElement).toBe(summary);
  });

  it("groups the page panels so they cannot all be open at once", async () => {
    const view = await renderScreen({ items: [savedItem()] });

    // Native exclusive accordion (`<details name>`), so this stays zero-JS.
    // happy-dom does not implement the exclusive behaviour itself, so the
    // contract asserted here is the grouping; the live proof measures the
    // resulting height.
    const panelGroups = Array.from(view.querySelectorAll("details"))
      .map((details) => details.getAttribute("name"))
      .filter(Boolean);
    expect(panelGroups).toEqual([
      "f9-collection-item", // the item's editor
      "f9-collection-panel", // Export
      "f9-collection-panel", // Rename
      "f9-collection-panel", // Add an evidence link
      "f9-collection-panel", // New collection
    ]);
  });

  it("marks exactly one switcher link as the current collection", async () => {
    const second = { ...collection, id: "collection-2", name: "Second board" };
    const view = await renderScreen({
      collections: [collection, second],
      items: [savedItem()],
    });

    const links = Array.from(view.querySelectorAll(".f9-library-switch-item"));
    expect(links).toHaveLength(2);
    const current = links.filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Launch proof");
    // Navigation, never a CTA (§5 "Non-button — Navigation").
    for (const link of links) {
      expect(link.className).not.toContain("f9-wk-btn");
    }
  });
});
