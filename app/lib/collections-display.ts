import type { FactRow } from "~/components/evidence/fact-rail";
import { formatAdLongevityLabel } from "~/lib/ad-display";
import { formatAdvertiserLabel, formatMachineTokenLabel } from "~/lib/landing-page-display";
import { proofLinkForAd } from "~/lib/proof-link";
import type { AdRecord, CollectionItemRecord, CollectionRecord } from "~/lib/types";

/**
 * Pure presentation helpers for `/app/collections` — BL-014, the IA inversion.
 *
 * Same split as `~/lib/watchlist-display` and `~/lib/search-display`: every
 * string the customer reads is decided here and unit-tested, so the route file
 * stays composition. The route re-exports the test-facing names.
 *
 * Brief: docs/design/EVIDENCE-DESK-BRIEF.md §5, §6.3, §6.6, §6.8, §6.9, §7.
 */

/* ------------------------------------------------------------------ *
 * §5 — one Rank-1 per screen
 * ------------------------------------------------------------------ */

/**
 * Which single slot owns this screen's Rank-1 action.
 *
 * The audit's defect #4 was interchangeable button styles; the brief's answer
 * is that a screen with two ink-filled primaries is a bug (§5). Collections
 * can show a plan gate, a create panel, an empty board and an empty collection
 * — each of which wants a primary — so the budget is resolved in one place and
 * every other slot drops to Rank 2.
 *
 * Order is prerequisite-first: you cannot save evidence into a collection you
 * are not allowed to create.
 */
export type CollectionPrimarySlot = "gate" | "create" | "items-empty" | "none";

export function resolveCollectionPrimarySlot(input: {
  /** False when the plan excludes collections or the limit is reached. */
  canCreate: boolean;
  hasCollections: boolean;
  hasSelection: boolean;
  /** Filtered-to-zero is not empty: hidden rows still count as content. */
  hasItems: boolean;
}): CollectionPrimarySlot {
  // A plan that cannot hold a single collection has nothing else to show, so
  // the gate IS the page. A plan that is merely at its limit still has boards
  // full of evidence: that limit is a Rank-2 note beside the create panel, not
  // a wall over the content the customer already paid for.
  if (!input.hasCollections) return input.canCreate ? "create" : "gate";
  if (input.hasSelection && !input.hasItems) return "items-empty";
  return "none";
}

/* ------------------------------------------------------------------ *
 * §6.8 — the honest one-liners this route ships
 * ------------------------------------------------------------------ */

/** Brief §6.8 per-surface table, "Collection, empty". */
export const COLLECTION_ITEMS_EMPTY_COPY =
  "Nothing saved here yet. Anything you save from a search or a watchlist shows up here with the capture that proves it.";

export const COLLECTION_BOARD_EMPTY_COPY =
  "A collection keeps reusable evidence together — the ad, the offer, the landing page, its recorded source, and your team's notes.";

export const COLLECTION_FILTERED_EMPTY_COPY =
  "Nothing saved here matches that competitor. Clear the filter to see everything in this collection, or switch to another one.";

/** Provenance promise shown before the first collection exists. */
export const RESERVED_COLLECTION_SLOT_COPY =
  "The first thing you save lands here with its source, the evidence itself, and the note your team adds.";

/** Brief §6.5.4 honesty note, restated for a saved capture. */
export const COLLECTION_CAPTURE_NOTE =
  "This is the stored capture, not a re-render.";

/* ------------------------------------------------------------------ *
 * §6.3 — status strip values
 * ------------------------------------------------------------------ */

export function formatSavedItemsValue(shown: number, hidden: number): string | null {
  if (shown === 0 && hidden === 0) return null;
  if (hidden > 0) {
    return `${shown} of ${shown + hidden} shown`;
  }
  return `${shown} ${shown === 1 ? "item" : "items"}`;
}

export function formatCollectionsUsedValue(used: number, limit: number): string | null {
  if (limit <= 0) return null;
  return `${used} of ${limit} used`;
}

/** The newest capture in a collection, or null when nothing is filed yet. */
export function latestSavedAt(items: readonly CollectionItemRecord[]): string | null {
  let newest: string | null = null;
  for (const item of items) {
    const stamp = item.createdAt;
    if (!stamp) continue;
    if (newest === null || stamp > newest) newest = stamp;
  }
  return newest;
}

/* ------------------------------------------------------------------ *
 * §6.9 — the saved item as an evidence plate
 * ------------------------------------------------------------------ */

/**
 * How this evidence reached the collection. Everything the plate claims about
 * time is decided from this, because the three kinds hold genuinely different
 * facts (brief §8.1, §8.3):
 *
 * - `captured` — we took the capture ourselves, so we hold a capture TIME.
 * - `filed`    — someone on the team pasted a link and typed the date they saw
 *                it. We hold an observation DATE and nothing else: no capture
 *                of our own, and no run we ever watched.
 * - `sample`   — demo material, labelled as such.
 */
export type SavedItemSourceKind = "captured" | "filed" | "sample";

export function resolveSavedItemSourceKind(
  source: AdRecord["source"] | undefined,
): SavedItemSourceKind {
  if (source === "external") return "filed";
  if (source === "demo") return "sample";
  return "captured";
}

/** Sentence-case provenance for the ruled row and its detail pane. */
export function resolveSavedItemStatus(source: AdRecord["source"] | undefined): string {
  switch (resolveSavedItemSourceKind(source)) {
    case "filed":
      return "Filed";
    case "sample":
      return "Sample";
    default:
      return "Captured";
  }
}

/** Brief §8.3: demo and external material is labelled inline, in mono. */
export function resolveSavedItemVerification(source: AdRecord["source"] | undefined): string {
  if (source === "demo") return "DEMO DATA — SAMPLE RESULTS";
  if (source === "external") return "EXTERNAL EVIDENCE";
  return "STORED CAPTURE";
}

/**
 * The plate's header capture stamp — brief §8.1 ("every number and quote in
 * the UI traces to a stored capture; it never estimates and never
 * interpolates") and §13.1.
 *
 * ONLY a capture we took has a capture time, and only `evidenceCapturedAt`
 * records it. The row's `createdAt` is when the item was filed into the
 * collection, which is a different fact — stamping it on the plate header
 * claims we were watching at a moment we were not. So there is no fallback:
 * a captured ad with no `evidenceCapturedAt`, and every filed or sample item,
 * returns null and the plate prints its own "capture time not recorded".
 */
export function resolveSavedItemCapturedAt(item: CollectionItemRecord): string | null {
  if (resolveSavedItemSourceKind(item.ad.source) !== "captured") return null;
  const stamp = item.ad.evidenceCapturedAt?.trim();
  if (!stamp) return null;
  return Number.isNaN(new Date(stamp).getTime()) ? null : stamp;
}

/**
 * A date a person typed, rendered back exactly as they recorded it.
 *
 * Deliberately NOT `LocalTime`: an observation date carries no time and no
 * zone, so converting it into the viewer's timezone would slide "24 Jul" to
 * "23 Jul" west of UTC and invent precision we were never given. Anchoring to
 * UTC returns the typed date unchanged. (The global-first rule governs
 * timestamps of things we observed; this is the customer's own input.)
 */
export function formatRecordedObservationDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export function resolveSavedItemChannel(ad: Pick<AdRecord, "platforms" | "format">): string {
  const platform = ad.platforms?.[0]?.trim();
  const token = platform || ad.format?.trim() || "";
  return token ? formatMachineTokenLabel(token) : "Channel not recorded";
}

/**
 * The stored capture's own words, in the order a reader wants them. Blank
 * lines are dropped rather than printed as empty quotes — an unreadable
 * capture degrades to the plate's own muted sentence (§6.9).
 */
export function savedItemCaptureLines(
  ad: Pick<AdRecord, "hook" | "previewHeadline" | "body" | "creativeText">,
): string[] {
  const lines = [ad.hook, ad.previewHeadline, ad.body, ad.creativeText]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0);
  // A capture often repeats its hook as the headline; quote it once.
  return Array.from(new Set(lines)).slice(0, 3);
}

/**
 * Headline and quoted capture for one plate.
 *
 * The hook is the finding, so it heads the plate in display type — but an
 * externally filed link often has NOTHING else stored, and printing the same
 * sentence twice (once as the headline, once as the quote) is the kind of
 * machine repetition the audit flagged. When the hook is all we hold, the
 * plate renders as a pure capture with no headline, which is exactly what
 * `EvidencePlate` supports rather than inventing one (§6.9).
 */
export function resolveSavedItemPlate(
  ad: Pick<AdRecord, "hook" | "previewHeadline" | "body" | "creativeText">,
): { headline?: string; captureLines: string[] } {
  const lines = savedItemCaptureLines(ad);
  const headline = ad.hook?.trim() || "";
  if (!headline) return { captureLines: lines };

  const rest = lines.filter((line) => line.toLowerCase() !== headline.toLowerCase());
  if (rest.length === 0) return { captureLines: lines };
  return { headline, captureLines: rest };
}

/**
 * Facts an agency would actually quote — brief §6.6, capped at the rail's 8
 * rows. Every unknown still renders as a row, in the Dovetail honest-degrade
 * voice (R5), which is what deletes the six-box insight grid from this route.
 */
export function buildSavedItemFacts(item: CollectionItemRecord): FactRow[] {
  const ad = item.ad;
  const kind = resolveSavedItemSourceKind(ad.source);

  /**
   * The time row is source-aware, and this is the whole point.
   *
   * A filed link stores the typed observation date in `firstSeenAt` with
   * `lastSeenAt: null` and `active: false` — it was never watched. Running it
   * through the longevity helper turns "I saw this on 24 Jul" into
   * "Running 3 days", a duration nobody observed. So a filed item states the
   * date it was observed and makes no claim about how long anything ran.
   */
  const timeRow: FactRow =
    kind === "captured"
      ? {
          key: "Running",
          value: formatAdLongevityLabel(ad),
          missingLabel: "not published",
        }
      : {
          key: "Observed",
          value: formatRecordedObservationDate(ad.firstSeenAt),
          missingLabel: "date not recorded",
        };

  return [
    {
      key: "Advertiser",
      value: formatAdvertiserLabel(ad.advertiser),
    },
    {
      key: "Offer",
      value: ad.offer?.trim() || null,
      missingLabel: "not published",
    },
    {
      key: "Call to action",
      value: ad.cta?.trim() || null,
      missingLabel: "none captured",
    },
    timeRow,
    {
      key: "Tags",
      value: item.tags.length > 0 ? item.tags.join(", ") : null,
      missingLabel: "none yet",
    },
    {
      key: "Your note",
      value: item.note?.trim() || null,
      missingLabel: "none yet",
    },
  ];
}

/**
 * The provenance sentence under a saved plate (§8.1).
 *
 * A filed link has no capture of ours behind it, so it must not borrow the
 * stored-capture note — saying "this is the stored capture" about a URL
 * somebody pasted is the same false claim as stamping it with a capture time.
 */
export function savedItemFootnote(item: CollectionItemRecord): string {
  switch (resolveSavedItemSourceKind(item.ad.source)) {
    case "filed":
      return "Filed by your team from a link they saw. We did not capture this page ourselves.";
    case "sample":
      return "Sample data — not a real capture.";
    default:
      return `Captured from the ad library. ${COLLECTION_CAPTURE_NOTE}`;
  }
}

export function savedItemProofLink(item: CollectionItemRecord): string | null {
  return proofLinkForAd(item.ad);
}

/** One plain sentence for the ruled list; depth stays in the detail pane. */
export function savedItemRowSummary(item: CollectionItemRecord): string {
  const candidates = [
    item.ad.hook,
    item.ad.previewHeadline,
    item.ad.offer,
    item.ad.body,
    item.ad.creativeText,
    item.note,
  ];
  return (
    candidates.map((value) => value?.trim() ?? "").find(Boolean) ??
    "Evidence saved without readable copy."
  );
}

/* ------------------------------------------------------------------ *
 * §6.6 — the ONE fact rail that replaces the five-action rail
 * ------------------------------------------------------------------ */

/**
 * The collection summarised in one edited rail. This is the row-for-box swap
 * the brief demands (§6.6, A2): the six "Insight depth" boxes — top hooks,
 * media mix, durations, metric proof, creative timeline, landing-page history
 * — become honest rows that say `none yet` instead of advertising a box the
 * product could not fill.
 */
export function buildCollectionFacts(input: {
  collection: Pick<CollectionRecord, "description"> | null;
  items: readonly CollectionItemRecord[];
  hiddenByFilter: number;
  collectionsUsed: number;
  collectionLimit: number;
}): FactRow[] {
  const { items } = input;
  const filteredMissingLabel = input.hiddenByFilter > 0 ? "hidden by filter" : "none yet";
  const advertisers = new Set<string>();
  const channels = new Set<string>();
  const tags = new Set<string>();
  let external = 0;
  let withProof = 0;

  for (const item of items) {
    const advertiser = item.ad.advertiser?.trim();
    if (advertiser) advertisers.add(advertiser.toLowerCase());
    const channel = item.ad.platforms?.[0]?.trim() || item.ad.format?.trim();
    if (channel) channels.add(formatMachineTokenLabel(channel));
    for (const tag of item.tags) tags.add(tag);
    if (item.ad.source === "external") external += 1;
    if (proofLinkForAd(item.ad)) withProof += 1;
  }

  return [
    {
      key: "Saved evidence",
      value:
        input.hiddenByFilter > 0
          ? formatSavedItemsValue(items.length, input.hiddenByFilter)
          : items.length > 0
            ? `${items.length}`
            : null,
      missingLabel: "none yet",
    },
    {
      key: "Competitors",
      value: advertisers.size > 0 ? `${advertisers.size}` : null,
      missingLabel: filteredMissingLabel,
    },
    {
      key: "Channels",
      value: channels.size > 0 ? Array.from(channels).slice(0, 3).join(", ") : null,
      missingLabel: filteredMissingLabel,
    },
    {
      key: "Filed by your team",
      value: external > 0 ? `${external}` : null,
      missingLabel: filteredMissingLabel,
    },
    {
      key: "Openable evidence",
      value: items.length > 0 ? `${withProof} of ${items.length}` : null,
      missingLabel: filteredMissingLabel,
    },
    {
      key: "Tags in use",
      value: tags.size > 0 ? Array.from(tags).slice(0, 4).join(", ") : null,
      missingLabel: filteredMissingLabel,
    },
    {
      key: "Hidden by filter",
      value: input.hiddenByFilter > 0 ? `${input.hiddenByFilter}` : null,
      missingLabel: "nothing hidden",
    },
    {
      key: "Collections",
      value: formatCollectionsUsedValue(input.collectionsUsed, input.collectionLimit),
      missingLabel: "not included on this plan",
    },
  ];
}

/* ------------------------------------------------------------------ *
 * §5 — the locked-action nudge
 * ------------------------------------------------------------------ */

/**
 * One upgrade nudge instead of an "Upgrade for X" button beside every locked
 * action. This is what retires the floating "Upgrade to Agency" text link the
 * audit flagged in the old right rail (§5, retired styles).
 */
export function formatLockedActionsLabel(locked: readonly string[]): string | null {
  const names = locked.filter((label) => label.trim().length > 0);
  if (names.length === 0) return null;
  if (names.length === 1) return `Upgrade to unlock ${names[0]}`;
  return `Upgrade to unlock ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Keeps the collection deep-link shape in one place. */
export function collectionHref(collectionId: string, advertiserFilter?: string | null): string {
  const params = new URLSearchParams({ collection: collectionId });
  if (advertiserFilter) params.set("advertiser", advertiserFilter);
  return `/app/collections?${params.toString()}`;
}

/** Deep-link one saved record without changing the loader's collection read. */
export function collectionItemHref(
  collectionId: string,
  itemId: string,
  advertiserFilter?: string | null,
): string {
  const params = new URLSearchParams({ collection: collectionId, item: itemId });
  if (advertiserFilter) params.set("advertiser", advertiserFilter);
  return `/app/collections?${params.toString()}`;
}
