import { Link } from "react-router";
import type { KeyboardEvent } from "react";

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
 * `aria-selected` is the non-visual active signal (§10).
 *
 * The bar speaks the WAI-ARIA tabs pattern: `role="tablist"` owns the
 * `role="tab"` links, each tab names its panel through `aria-controls`, and
 * a roving tabindex keeps one tab in the Tab order while ArrowLeft /
 * ArrowRight / Home / End move focus between tabs. Activation stays manual —
 * an arrow key moves focus without navigating, Enter follows the link —
 * because each tab is a page load, not an in-place disclosure. No tab
 * expands in place, so no `aria-expanded`.
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
      <ul onKeyDown={onTabKeyDown} role="tablist">
        {WATCHLIST_DETAIL_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const count = watchlistDetailTabCount(tab.id, capturedChanges);
          return (
            <li key={tab.id} role="none">
              <Link
                aria-controls={`competitor-panel-${tab.id}`}
                aria-selected={isActive}
                className={isActive ? "f9-wk-tab is-on" : "f9-wk-tab"}
                id={`competitor-tab-${tab.id}`}
                preventScrollReset
                role="tab"
                tabIndex={isActive ? 0 : -1}
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

/**
 * Roving tabindex for the tablist: arrows wrap, Home/End jump to the edges.
 * Focus moves without activating — these tabs are real page links, so
 * activation is Enter/click only (manual-activation model).
 */
function onTabKeyDown(event: KeyboardEvent<HTMLElement>) {
  const key = event.key;
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
    return;
  }
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  const index = tabs.indexOf(event.target as HTMLElement);
  if (index === -1) return;
  const next =
    key === "ArrowRight"
      ? (index + 1) % tabs.length
      : key === "ArrowLeft"
        ? (index - 1 + tabs.length) % tabs.length
        : key === "Home"
          ? 0
          : tabs.length - 1;
  event.preventDefault();
  tabs[next]?.focus();
}
