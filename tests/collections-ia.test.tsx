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
  formatRecordedObservationDate,
  formatSavedItemsValue,
  latestSavedAt,
  resolveCollectionPrimarySlot,
  resolveSavedItemCapturedAt,
  resolveSavedItemChannel,
  resolveSavedItemPlate,
  resolveSavedItemSourceKind,
  resolveSavedItemStatus,
  resolveSavedItemVerification,
  savedItemCaptureLines,
  savedItemFootnote,
} from "~/lib/collections-display";
import type { CollectionItemRecord } from "~/lib/types";

/** BL-033a — collections in the shared landing-language workspace grammar. */

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
  return (markup.match(/f9-wk-btn/g) ?? []).length;
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
    ["free first run", { collections: [], plan: "free", selectedCollection: null }, 1],
    ["first run", { collections: [], plan: "agency", selectedCollection: null }, 1],
    ["selected but empty", {}, 1],
    ["populated", { items: [savedItem()] }, 1],
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

    // The quiet capability gate owns the one filled action; the evidence is
    // still visible and the limit note never becomes a second button.
    expect(rank1Count(markup)).toBe(1);
    expect(markup).toContain("Collection limit reached");
    expect(markup).toContain("View upgrade options");
    expect(markup).not.toContain('value="create-collection"');
  });
});

describe("collections IA inversion (brief §7)", () => {
  it("puts the saved evidence before the create form in the document", async () => {
    const markup = await render({ items: [savedItem()] });

    const plate = markup.indexOf("f9-wk-row");
    const create = markup.indexOf('value="create-collection"');
    expect(plate).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(plate).toBeLessThan(create);
  });

  it("demotes the create form and the evidence form to Rank-2 disclosures", async () => {
    const markup = await render({ items: [savedItem()] });

    expect(markup).toContain("f9-library-create");
    expect(markup).toContain(">New collection<");
    expect(markup).toContain("f9-library-external");
    expect(markup).toContain(">Add an evidence link<");
  });

  it("renders the create form open, with the primary, when there is nothing to put first", async () => {
    const markup = await render({ collections: [], selectedCollection: null });

    expect(markup).toContain("Start your first collection");
    expect(markup).toContain("its recorded source, and your team&#x27;s notes");
    expect(markup).not.toContain("exactly as we captured them");
    expect(markup).toContain("The first thing you save lands here with its source");
    expect(markup).toContain('value="create-collection"');
    expect(markup).not.toContain("<summary");
  });

  it.each(["free", "agency"])(
    "does not render first-run or an empty-plan lock when %s has collections but a stale selection",
    async (plan) => {
      const markup = await render({
        collections: [collection],
        plan,
        selectedCollection: null,
      });

      expect(markup).toContain("Launch proof");
      expect(markup).toContain("Choose another collection above.");
      expect(markup).not.toContain("Start your first collection");
      expect(markup).not.toContain("Collections start on Scout");
      expect(markup).not.toContain("no collection exists on this plan yet");
    },
  );

  it("leaves no retired workspace styles on the route", async () => {
    const markup = await render({ items: [savedItem()] });

    // Brief §4.7 / §5 retired styles, and the audit's form-first master-detail.
    expect(markup).not.toContain("f9-primary-button");
    expect(markup).not.toContain("f9-secondary-button");
    expect(markup).not.toContain("f9-text-link");
    expect(markup).not.toContain("f9-master-detail");
    expect(markup).not.toContain("f9-side-panel");
    expect(markup).not.toContain("f9-work-row");
    expect(markup).not.toContain("f9-evidence-specimen");
    expect(markup).not.toContain("f9-evidence-plate");
    // A2: the six-box insight grid is gone from this route.
    expect(markup).not.toContain("f9-insight-grid");
    expect(markup).not.toContain("Insight depth");
  });

  it("renders ruled evidence rows, one selected-record pane, and quiet facts", async () => {
    const markup = await render({ items: [savedItem(), savedItem({ id: "item-2" })] });

    expect(markup.match(/class="f9-wk-row(?: |")/g) ?? []).toHaveLength(2);
    expect(markup.match(/class="f9-wk-detail"/g) ?? []).toHaveLength(1);
    // Depth is rendered once for the selected row, not repeated in every row.
    expect(markup.match(/Captured from the ad library/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain("f9-evidence-status-strip");
    expect(markup).not.toContain("f9-evidence-fact-rail");
  });
});

describe("collections evidence rows and detail (BL-033a)", () => {
  it("keeps every record in the list and opens depth only for the selected row", async () => {
    const markup = await render({
      items: [
        savedItem(),
        savedItem({ id: "item-2", ad: { advertiser: "Rival" } as never }),
      ],
    });

    expect(markup).toContain("Okara");
    expect(markup).toContain("Rival");
    expect(markup).toContain("This is the stored capture, not a re-render.");
    expect(markup).not.toContain("PLATE 01");
    expect(markup).not.toContain("f9-evidence-plate");
  });

  it("labels provenance in sentence case while retaining export-facing labels", () => {
    expect(resolveSavedItemStatus("external")).toBe("Filed");
    expect(resolveSavedItemStatus("meta_api")).toBe("Captured");
    expect(resolveSavedItemVerification("external")).toBe("EXTERNAL EVIDENCE");
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

describe("saved-item provenance is source-aware (brief §8.1, §13.1)", () => {
  it("sorts each source into what it can actually prove", () => {
    expect(resolveSavedItemSourceKind("external")).toBe("filed");
    expect(resolveSavedItemSourceKind("meta_library_browser")).toBe("captured");
    expect(resolveSavedItemSourceKind(undefined)).toBe("captured");
  });

  it("stamps a captured plate only from its own capture time", () => {
    expect(
      resolveSavedItemCapturedAt(savedItem({ ad: { evidenceCapturedAt: null } as never })),
    ).toBeNull();
    expect(resolveSavedItemCapturedAt(savedItem())).toBe("2026-07-20T08:55:00.000Z");
    // An unparseable stamp is no stamp — never a plausible-looking guess.
    expect(
      resolveSavedItemCapturedAt(savedItem({ ad: { evidenceCapturedAt: "not-a-date" } as never })),
    ).toBeNull();
  });

  it("keeps a real capture's precise timestamp in the selected detail", async () => {
    const capturedAt = "2026-07-20T08:55:00.000Z";
    const markup = await render({
      items: [savedItem({ ad: { evidenceCapturedAt: capturedAt } as never })],
    });
    const detail = markup.match(/<aside[^>]*class="f9-wk-detail"[^>]*>.*?<\/aside>/s)?.[0];

    expect(detail).toContain(
      `<dt>Captured</dt><dd><time dateTime="${capturedAt}">20 Jul 2026, 08:55 UTC</time></dd>`,
    );
  });

  it("never stamps a filed link with the time it was filed", () => {
    // Regression: `evidenceCapturedAt ?? item.createdAt` printed the filing
    // time as a capture time, so a link observed on 24 Jul was stamped 27 Jul.
    const filed = savedItem({
      createdAt: "2026-07-27T14:00:00.000Z",
      ad: { source: "external", firstSeenAt: "2026-07-24T00:00:00.000Z" } as never,
    });

    expect(resolveSavedItemCapturedAt(filed)).toBeNull();
  });

  it("gives a filed link its observed date and no invented run", () => {
    const filed = savedItem({
      ad: {
        source: "external",
        firstSeenAt: "2026-07-24T00:00:00.000Z",
        lastSeenAt: null,
        active: false,
      } as never,
    });
    const facts = buildSavedItemFacts(filed);

    expect(facts.find((row) => row.key === "Running")).toBeUndefined();
    expect(facts.find((row) => row.key === "Observed")?.value).toBe("24 Jul 2026");
    expect(facts.find((row) => row.key === "Observed")?.missingLabel).toBe("date not recorded");
  });

  it("returns a typed observation date unshifted by the viewer's timezone", () => {
    expect(formatRecordedObservationDate("2026-07-24T00:00:00.000Z")).toBe("24 Jul 2026");
    expect(formatRecordedObservationDate(null)).toBeNull();
    expect(formatRecordedObservationDate("nonsense")).toBeNull();
  });

  it("does not call a pasted link a stored capture of ours", () => {
    expect(savedItemFootnote(savedItem({ ad: { source: "external" } as never }))).toBe(
      "Filed by your team from a link they saw. We did not capture this page ourselves.",
    );
    expect(savedItemFootnote(savedItem())).toContain("This is the stored capture, not a re-render.");
  });

  it("renders the honest degrade end to end on a filed plate", async () => {
    const markup = await render({
      items: [
        savedItem({
          createdAt: "2026-07-27T14:00:00.000Z",
          ad: {
            source: "external",
            platforms: ["LinkedIn"],
            firstSeenAt: "2026-07-24T00:00:00.000Z",
            lastSeenAt: null,
            active: false,
            evidenceCapturedAt: null,
          } as never,
        }),
      ],
    });

    const detail = markup.match(/<aside[^>]*class="f9-wk-detail"[^>]*>.*?<\/aside>/s)?.[0];

    expect(detail).toContain("Filed");
    expect(detail).toContain(
      "Filed by your team from a link they saw. We did not capture this page ourselves.",
    );
    expect(markup).toContain("24 Jul 2026");
    expect(detail).not.toContain("Running");
    expect(detail).not.toContain("This is the stored capture, not a re-render.");
  });
});

describe("collections empty and filtered states (brief §6.7, §6.8)", () => {
  it("uses the brief's collection one-liner, not a bare 'Nothing saved yet'", async () => {
    const markup = await render({});

    expect(markup).toContain(COLLECTION_ITEMS_EMPTY_COPY);
    expect(markup).toContain("f9-library-list-empty");
    expect(markup).not.toContain("f9-evidence-specimen-slot");
    expect(markup).not.toContain("f9-dash-state-empty");
    expect(markup).not.toContain("Nothing saved yet");
  });

  it("states a filter that hides everything as a quiet line, with no primary", async () => {
    const markup = await render({
      advertiserFilter: "Okara",
      hiddenByAdvertiserFilter: 4,
      items: [],
    });

    expect(markup).toContain("f9-library-list-empty");
    expect(markup).toContain(COLLECTION_FILTERED_EMPTY_COPY);
    // Filtered-to-zero is not empty; the one filled
    // action remains the header's New collection command.
    expect(markup).not.toContain(COLLECTION_ITEMS_EMPTY_COPY);
    expect(rank1Count(markup)).toBe(1);
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

  it("never labels filtered-away evidence as if nothing has ever been filed", async () => {
    const markup = await render({
      advertiserFilter: "Okara",
      hiddenByAdvertiserFilter: 1,
      items: [],
    });

    expect(markup).toContain("<dt>Saved evidence</dt><dd>0 of 1 shown</dd>");
    expect(markup).toContain("<dt>Competitors</dt><dd>hidden by filter</dd>");
    expect(markup).not.toContain(">none yet<");
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

  it("uses the hidden total instead of 'none yet' when a filter removes every item", () => {
    const rows = buildCollectionFacts({
      collection,
      collectionLimit: 25,
      collectionsUsed: 1,
      hiddenByFilter: 1,
      items: [],
    });

    expect(rows.find((row) => row.key === "Saved evidence")?.value).toBe("0 of 1 shown");
    for (const key of [
      "Competitors",
      "Channels",
      "Filed by your team",
      "Openable evidence",
      "Tags in use",
    ]) {
      expect(rows.find((row) => row.key === key)?.missingLabel).toBe("hidden by filter");
    }
  });
});
