import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLLECTION_FILTERED_EMPTY_COPY,
  COLLECTION_ITEMS_EMPTY_COPY,
  buildCollectionFacts,
  buildSavedItemFacts,
  formatCollectionsUsedValue,
  formatLockedActionsLabel,
  formatSavedItemsValue,
  latestSavedAt,
  resolveCollectionPrimarySlot,
  resolveSavedItemChannel,
  resolveSavedItemPlate,
  resolveSavedItemVerification,
  savedItemCaptureLines,
} from "~/lib/collections-display";
import type { CollectionItemRecord } from "~/lib/types";

/**
 * BL-014 — the collections IA inversion.
 *
 * Brief: docs/design/EVIDENCE-DESK-BRIEF.md §5 (one Rank-1 per screen), §6.3
 * (one status strip), §6.6 (fact rail + honest inline values), §6.8 (specimen
 * empty state), §6.9 (evidence plate), §7 (content first, create demoted).
 */

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

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
    tags: ["launch", "offer"],
    ...overrides,
    ad: {
      metaAdId: "ad-1",
      advertiser: "Okara",
      body: "Two months free when you switch this week.",
      previewHeadline: "Switch and save",
      previewSubhead: "",
      hook: "Switch this week and skip two months",
      offer: "Two months free",
      cta: "Start free",
      format: "image",
      languageLabel: "English",
      destinationType: "landing_page",
      landingPageUrl: "https://okara.example/switch",
      adSnapshotUrl: "https://library.example/ad/1",
      countries: ["US"],
      platforms: ["Meta"],
      firstSeenAt: "2026-06-20T00:00:00.000Z",
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      active: true,
      researchSummary: "",
      source: "meta_library_browser",
      analysisFields: [],
      evidenceCapturedAt: "2026-07-20T08:55:00.000Z",
      ...(overrides.ad ?? {}),
    } as CollectionItemRecord["ad"],
  };
}

function installRouterMocks(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle", formData: null, location: null }),
      useParams: vi.fn().mockReturnValue({}),
      useSearchParams: vi.fn().mockReturnValue([new URLSearchParams(), vi.fn()]),
    };
  });
}

async function render(loaderData: Record<string, unknown>) {
  vi.resetModules();
  installRouterMocks({
    advertiserFilter: null,
    collections: [collection],
    hiddenByAdvertiserFilter: 0,
    items: [],
    plan: "agency",
    selectedCollection: collection,
    ...loaderData,
  });
  const { default: CollectionsRoute } = await import("~/routes/app.collections");
  return renderToStaticMarkup(createElement(CollectionsRoute));
}

function rank1Count(markup: string) {
  return (markup.match(/f9-ed-cta--rank1/g) ?? []).length;
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("collections Rank-1 budget (brief §5)", () => {
  it("routes the primary to the prerequisite, never to two slots at once", () => {
    expect(
      resolveCollectionPrimarySlot({
        canCreate: false,
        hasCollections: false,
        hasSelection: false,
        hasItems: false,
      }),
    ).toBe("gate");
    expect(
      resolveCollectionPrimarySlot({
        canCreate: true,
        hasCollections: false,
        hasSelection: false,
        hasItems: false,
      }),
    ).toBe("create");
    expect(
      resolveCollectionPrimarySlot({
        canCreate: true,
        hasCollections: true,
        hasSelection: true,
        hasItems: false,
      }),
    ).toBe("items-empty");
    expect(
      resolveCollectionPrimarySlot({
        canCreate: true,
        hasCollections: true,
        hasSelection: true,
        hasItems: true,
      }),
    ).toBe("none");
  });

  it("keeps the content visible when a paid plan is merely at its limit", () => {
    // A limit is not a wall over evidence the customer already paid for.
    expect(
      resolveCollectionPrimarySlot({
        canCreate: false,
        hasCollections: true,
        hasSelection: true,
        hasItems: true,
      }),
    ).toBe("none");
  });

  it.each([
    ["free gate", { collections: [], plan: "free", selectedCollection: null }, 1],
    ["first run", { collections: [], plan: "agency", selectedCollection: null }, 1],
    ["selected but empty", {}, 1],
    ["populated", { items: [savedItem()] }, 0],
  ])("renders exactly the expected primaries for %s", async (_label, loaderData, expected) => {
    const markup = await render(loaderData as Record<string, unknown>);
    expect(rank1Count(markup)).toBe(expected);
  });

  it("never renders a second primary when a collection is at its plan limit", async () => {
    const { getPlanLimit } = await import("~/lib/plan-entitlements");
    const limit = getPlanLimit("scout", "collections");
    const atLimit = Array.from({ length: limit }, (_value, index) => ({
      ...collection,
      id: `collection-${index + 1}`,
      name: `Board ${index + 1}`,
    }));

    const markup = await render({
      collections: atLimit,
      items: [savedItem()],
      plan: "scout",
      selectedCollection: atLimit[0],
    });

    // A limit note, at Rank 2, beside the evidence — never a wall over it.
    expect(rank1Count(markup)).toBe(0);
    expect(markup).toContain("Collections · limit reached");
    expect(markup).toContain("View plans");
    expect(markup).not.toContain('value="create-collection"');
  });
});

describe("collections IA inversion (brief §7)", () => {
  it("puts the saved evidence before the create form in the document", async () => {
    const markup = await render({ items: [savedItem()] });

    const plate = markup.indexOf("f9-ed-collection-items");
    const create = markup.indexOf('value="create-collection"');
    expect(plate).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(plate).toBeLessThan(create);
  });

  it("demotes the create form and the evidence form to Rank-2 disclosures", async () => {
    const markup = await render({ items: [savedItem()] });

    expect(markup).toContain(
      '<summary class="f9-ed-cta f9-ed-cta--rank2">New collection</summary>',
    );
    expect(markup).toContain(
      '<summary class="f9-ed-cta f9-ed-cta--rank2">Add an evidence link</summary>',
    );
  });

  it("renders the create form open, with the primary, when there is nothing to put first", async () => {
    const markup = await render({ collections: [], selectedCollection: null });

    expect(markup).toContain("Start your first collection");
    expect(markup).toContain("Plate 01 — reserved");
    expect(markup).toContain('value="create-collection"');
    expect(markup).not.toContain("<summary");
  });

  it("leaves no retired workspace styles on the route", async () => {
    const markup = await render({ items: [savedItem()] });

    // Brief §4.7 / §5 retired styles, and the audit's form-first master-detail.
    expect(markup).not.toContain("f9-primary-button");
    expect(markup).not.toContain("f9-secondary-button");
    expect(markup).not.toContain("f9-text-link");
    expect(markup).not.toContain("f9-master-detail");
    expect(markup).not.toContain("f9-side-panel");
    expect(markup).not.toContain("f9-work-row");
    // A2: the six-box insight grid is gone from this route.
    expect(markup).not.toContain("f9-insight-grid");
    expect(markup).not.toContain("Insight depth");
  });

  it("renders one status strip and one page-level fact rail", async () => {
    const markup = await render({ items: [savedItem(), savedItem({ id: "item-2" })] });

    // §6.3: the strip is the only place page-level status renders.
    expect(markup.match(/f9-ed-status-strip/g) ?? []).toHaveLength(1);
    // §7: the right rail carries ONE fact rail, not five inconsistent actions.
    expect(markup.match(/f9-ed-collection-rail/g) ?? []).toHaveLength(1);
    // Each plate keeps its own rail (§6.9) — that is the plate, not the page.
    expect(markup.match(/f9-ed-evidence-side/g) ?? []).toHaveLength(2);
  });
});

describe("collections evidence plates (brief §6.9)", () => {
  it("renders each saved item as a numbered, stamped plate", async () => {
    const markup = await render({ items: [savedItem(), savedItem({ id: "item-2" })] });

    expect(markup).toContain("PLATE 01 — Meta · STORED CAPTURE");
    expect(markup).toContain("PLATE 02 — Meta · STORED CAPTURE");
    expect(markup).toContain("This is the stored capture, not a re-render.");
  });

  it("labels externally filed evidence inline, in mono (brief §8.3)", () => {
    expect(resolveSavedItemVerification("external")).toBe("EXTERNAL EVIDENCE");
    expect(resolveSavedItemVerification("demo")).toBe("DEMO DATA — SAMPLE RESULTS");
    expect(resolveSavedItemVerification("meta_api")).toBe("STORED CAPTURE");
  });

  it("names the channel honestly when nothing was recorded", () => {
    expect(resolveSavedItemChannel({ platforms: ["LinkedIn"], format: "image" })).toBe("LinkedIn");
    expect(resolveSavedItemChannel({ platforms: [], format: "image" })).toBe("Image");
    expect(resolveSavedItemChannel({ platforms: [], format: "" as never })).toBe(
      "Channel not recorded",
    );
  });

  it("quotes the stored capture once, never a blank line", () => {
    expect(
      savedItemCaptureLines({
        hook: "Switch this week",
        previewHeadline: "Switch this week",
        body: "  ",
        creativeText: null,
      }),
    ).toEqual(["Switch this week"]);
  });

  it("never prints the same sentence as both headline and quote", () => {
    // Hook-only capture: render it as a pure capture rather than repeating it.
    expect(
      resolveSavedItemPlate({
        hook: "The price just moved",
        previewHeadline: "",
        body: "",
        creativeText: null,
      }),
    ).toEqual({ captureLines: ["The price just moved"] });

    // With more stored copy, the hook heads the plate and the rest is quoted.
    expect(
      resolveSavedItemPlate({
        hook: "The price just moved",
        previewHeadline: "",
        body: "Now 1,199 for the first year",
        creativeText: null,
      }),
    ).toEqual({
      headline: "The price just moved",
      captureLines: ["Now 1,199 for the first year"],
    });
  });

  it("keeps an unknown value as an honest row rather than dropping it", () => {
    const facts = buildSavedItemFacts(
      savedItem({ note: null, tags: [], ad: { offer: "", cta: "" } as never }),
    );

    expect(facts.find((row) => row.key === "Offer")?.missingLabel).toBe("not published");
    expect(facts.find((row) => row.key === "Your note")?.missingLabel).toBe("none yet");
    expect(facts.find((row) => row.key === "Tags")?.value).toBeNull();
    expect(facts).toHaveLength(6);
  });
});

describe("collections empty and filtered states (brief §6.7, §6.8)", () => {
  it("uses the brief's collection one-liner, not a bare 'Nothing saved yet'", async () => {
    const markup = await render({});

    expect(markup).toContain(COLLECTION_ITEMS_EMPTY_COPY);
    expect(markup).toContain("f9-ed-specimen-slot");
    expect(markup).not.toContain("f9-dash-state-empty");
    expect(markup).not.toContain("Nothing saved yet");
  });

  it("states a filter that hides everything as a quiet line, with no primary", async () => {
    const markup = await render({
      advertiserFilter: "Okara",
      hiddenByAdvertiserFilter: 4,
      items: [],
    });

    expect(markup).toContain("f9-ed-quiet-line");
    expect(markup).toContain(COLLECTION_FILTERED_EMPTY_COPY);
    // Filtered-to-zero is not empty, so no specimen and no Rank-1.
    expect(markup).not.toContain(COLLECTION_ITEMS_EMPTY_COPY);
    expect(rank1Count(markup)).toBe(0);
    expect(markup).toContain("Clear filter");
  });

  it("counts what a filter is hiding without a success banner", async () => {
    const markup = await render({
      advertiserFilter: "Okara",
      hiddenByAdvertiserFilter: 1,
      items: [savedItem()],
    });

    expect(markup).toContain("1 other saved item is hidden.");
    expect(markup).not.toContain("is-success");
  });
});

describe("collections display helpers", () => {
  it("formats the saved count, including what a filter hides", () => {
    expect(formatSavedItemsValue(0, 0)).toBeNull();
    expect(formatSavedItemsValue(1, 0)).toBe("1 item");
    expect(formatSavedItemsValue(4, 0)).toBe("4 items");
    expect(formatSavedItemsValue(2, 3)).toBe("2 of 5 shown");
  });

  it("reports plan usage only when the plan includes collections", () => {
    expect(formatCollectionsUsedValue(2, 5)).toBe("2 of 5 used");
    expect(formatCollectionsUsedValue(0, 0)).toBeNull();
  });

  it("finds the newest capture without assuming loader order", () => {
    expect(
      latestSavedAt([
        savedItem({ id: "a", createdAt: "2026-07-01T00:00:00.000Z" }),
        savedItem({ id: "b", createdAt: "2026-07-22T00:00:00.000Z" }),
        savedItem({ id: "c", createdAt: "2026-07-11T00:00:00.000Z" }),
      ]),
    ).toBe("2026-07-22T00:00:00.000Z");
    expect(latestSavedAt([])).toBeNull();
  });

  it("collapses locked actions into one nudge", () => {
    expect(formatLockedActionsLabel([])).toBeNull();
    expect(formatLockedActionsLabel(["exports"])).toBe("Upgrade to unlock exports");
    expect(formatLockedActionsLabel(["client reports", "exports", "share links"])).toBe(
      "Upgrade to unlock client reports, exports & share links",
    );
  });

  it("builds one edited rail, capped at the primitive's eight rows", () => {
    const rows = buildCollectionFacts({
      collection,
      collectionLimit: 25,
      collectionsUsed: 3,
      hiddenByFilter: 0,
      items: [savedItem(), savedItem({ id: "item-2", ad: { advertiser: "Rival" } as never })],
    });

    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row.key === "Saved evidence")?.value).toBe("2");
    expect(rows.find((row) => row.key === "Competitors")?.value).toBe("2");
    expect(rows.find((row) => row.key === "Hidden by filter")?.missingLabel).toBe("nothing hidden");
  });

  it("says 'none yet' rather than hiding an empty rail row", () => {
    const rows = buildCollectionFacts({
      collection,
      collectionLimit: 0,
      collectionsUsed: 0,
      hiddenByFilter: 0,
      items: [],
    });

    for (const key of ["Saved evidence", "Competitors", "Channels", "Tags in use"]) {
      expect(rows.find((row) => row.key === key)?.value).toBeNull();
      expect(rows.find((row) => row.key === key)?.missingLabel).toBe("none yet");
    }
    expect(rows.find((row) => row.key === "Collections")?.missingLabel).toBe(
      "not included on this plan",
    );
  });
});
