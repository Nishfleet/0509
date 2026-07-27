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
 * Mono uppercase labels, a 2.5px rule between tabs, the active tab ink
 * filled, and an optional accent count suffix. These are REAL links, so the
 * bar is URL-addressable, deep-linkable and back-button correct (§6.4), the
 * ink fill is never the only active signal (`aria-current`, §10), and the
 * whole thing needs no client state (§11).
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
    <nav aria-label="Competitor sections" className="f9-ed-tabbar">
      <ul className="f9-ed-tabbar-track">
        {WATCHLIST_DETAIL_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const count = watchlistDetailTabCount(tab.id, capturedChanges);
          return (
            <li key={tab.id}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={isActive ? "f9-ed-tab is-active" : "f9-ed-tab"}
                preventScrollReset
                to={watchlistDetailTabHref(watchlistId, tab.id)}
              >
                <span className="f9-ed-tab-label">{tab.label}</span>
                {count === null ? null : (
                  <span className="f9-ed-tab-count">{count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
