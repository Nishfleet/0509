import { Link } from "react-router";

import {
  WATCHLIST_DETAIL_TABS,
  watchlistDetailTabCount,
  watchlistDetailTabHref,
  type WatchlistDetailTabId,
} from "~/lib/watchlist-detail-tabs";

/**
 * Anchor tab bar — brief §6.4.
 *
 * BL-035 moves the same URL contract onto the P0 working tabs: sentence-case
 * labels, one 1px underline, and an optional quiet count. These are REAL
 * links, so the bar stays deep-linkable and back-button correct (§6.4);
 * `aria-current` is the non-visual active signal (§10).
 *
 * On mobile the bar scrolls inside its own container and must never cause
 * page horizontal scroll (§9.1).
 */
export function DetailTabBar({
  watchlistId,
  activeTab,
  capturedChanges,
}: {
  watchlistId: string;
  activeTab: WatchlistDetailTabId;
  /** Confirmed changes in the board window — the only badge we can source. */
  capturedChanges: number;
}) {
  return (
    <nav aria-label="Competitor sections" className="f9-wk-tabs f9-watchdetail-tabs">
      <ul>
        {WATCHLIST_DETAIL_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const count = watchlistDetailTabCount(tab.id, capturedChanges);
          return (
            <li key={tab.id}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={isActive ? "f9-wk-tab is-on" : "f9-wk-tab"}
                preventScrollReset
                to={watchlistDetailTabHref(watchlistId, tab.id)}
              >
                <span>{tab.label}</span>
                {count === null ? null : (
                  <span className="f9-wk-tab-n">{count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
