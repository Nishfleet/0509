/**
 * Competitor detail tabs — brief §6.4 (anchor tab bar, R1 Zillow fallback).
 *
 * The opened competitor used to be ONE 9,814px mobile scroll: change feed,
 * creative wall, trends, intelligence, glossary, evidence cards, delivery
 * forms, target lists, run history and the setup form, all stacked. §6.4
 * breaks that into five real surfaces in a fixed order.
 *
 * Everything here is pure and URL-shaped on purpose: the tab bar is
 * navigation, not state (brief §11 — "the tab bar is URL-driven, not
 * state-driven"), which is what makes it deep-linkable and back-button
 * correct without a line of client JS.
 */

export const WATCHLIST_DETAIL_TAB_PARAM = "tab";

export interface WatchlistDetailTabDefinition {
  id: WatchlistDetailTabId;
  /** Rendered sentence-case in the shared working tab bar. */
  label: string;
  /** Spoken name for the panel this tab controls. */
  panelLabel: string;
}

export type WatchlistDetailTabId =
  | "changed"
  | "evidence"
  | "creative"
  | "delivery"
  | "library"
  | "setup";

/** Fixed order, brief §6.4. Never reordered per plan, per state or per user. */
export const WATCHLIST_DETAIL_TABS: readonly WatchlistDetailTabDefinition[] = [
  { id: "changed", label: "What changed", panelLabel: "What changed" },
  { id: "evidence", label: "Evidence", panelLabel: "Evidence" },
  { id: "creative", label: "Creative", panelLabel: "Creative" },
  { id: "delivery", label: "Delivery", panelLabel: "Delivery" },
  { id: "library", label: "Library", panelLabel: "Library" },
  { id: "setup", label: "Setup", panelLabel: "Setup" },
];

/**
 * The change feed is the default because that is what an alert email, a
 * digest deep link (`?event=`) and a band click are all asking about.
 */
export const DEFAULT_WATCHLIST_DETAIL_TAB: WatchlistDetailTabId = "changed";

const TAB_IDS = new Set<string>(WATCHLIST_DETAIL_TABS.map((tab) => tab.id));

/** Unknown, blank and absent all resolve to the change feed — never a 404. */
export function resolveWatchlistDetailTab(
  value: string | null | undefined,
): WatchlistDetailTabId {
  const candidate = value?.trim().toLowerCase() ?? "";
  return TAB_IDS.has(candidate)
    ? (candidate as WatchlistDetailTabId)
    : DEFAULT_WATCHLIST_DETAIL_TAB;
}

/**
 * Canonical href for an opened competitor. The default tab drops the `tab`
 * param entirely so an emailed `?watchlist=…&event=…` link and a click on
 * "What changed" are the same URL — one history entry, not two.
 */
export function watchlistDetailTabHref(
  watchlistId: string,
  tab: WatchlistDetailTabId = DEFAULT_WATCHLIST_DETAIL_TAB,
  options: { eventId?: string | null } = {},
): string {
  const params = new URLSearchParams({ watchlist: watchlistId });
  if (tab !== DEFAULT_WATCHLIST_DETAIL_TAB) {
    params.set(WATCHLIST_DETAIL_TAB_PARAM, tab);
  }
  const eventId = options.eventId?.trim();
  if (eventId) {
    params.set("event", eventId);
  }
  return `/app/watchlists?${params.toString()}`;
}

/**
 * The one honest count the bar may carry (brief §6.4 "optional accent count
 * suffix"): confirmed changes captured inside the board's window. It is the
 * same number the rail's number card prints, from the same rollup — a tab
 * badge must never be a second, differently-derived claim.
 */
export function watchlistDetailTabCount(
  tab: WatchlistDetailTabId,
  capturedChanges: number,
): number | null {
  if (tab !== "changed") return null;
  return capturedChanges > 0 ? capturedChanges : null;
}
