import { Link, NavLink, useLocation, useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";

import { SignOutButton } from "~/components/sign-out-button";
import { navIconFor } from "~/components/icons";
import {
  DASHBOARD_PRIMARY_NAV,
  PUBLIC_SEARCH_NAV,
  buildDashboardMobileNav,
  isDestinationMemberActive,
  filterDashboardNav,
  type DashboardNavItem,
} from "~/lib/dashboard-navigation";

export interface DashboardShellProps {
  /** Signed-out search uses a minimal public rail */
  isPublic?: boolean;
  /** Page wrapper class, e.g. f9-find-page for search-specific overrides */
  pageClassName?: string;
  /** Public-shell identity block; signed-in shells use the user's own
   * name/email and need none of these (tri-audit S7). */
  accountLabel?: string;
  accountTitle?: string;
  accountDetail?: string;
  userName?: string | null;
  userEmail?: string | null;
  showPresenceNav?: boolean;
  railNote?: React.ReactNode;
  /**
   * Opens the ⌘K command palette. BL-030: the affordance is visible chrome in
   * the rail, not folklore — it is the one navigation control whose cost does
   * not scale with the number of competitors.
   */
  onCommandPalette?: () => void;
  children: React.ReactNode;
}

function navLinkClassName({ isActive, isPending }: { isActive: boolean; isPending: boolean }) {
  return [isActive ? "is-active" : null, isPending ? "is-pending" : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

/**
 * BL-030 — a rail row. Text only: the concept's rail carries no icons, no
 * mono caps and no boxes, so a row is a label and (when the caller has one)
 * a count. Green never appears here — the rail is monochrome by rule, and
 * green belongs to the work.
 */
function WorkspaceNavLink({ item }: { item: DashboardNavItem }) {
  const location = useLocation();
  // A destination owns its member pages: Settings is the active row on
  // /app/billing, Deliver on /app/digests — the customer is never nowhere.
  const memberActive = isDestinationMemberActive(item, location.pathname);
  return (
    <NavLink
      className={(state) => {
        const base = navLinkClassName({
          ...state,
          isActive: state.isActive || memberActive,
        });
        return ["f9-dash-nav-link", "f9-wk-nav-a", base].filter(Boolean).join(" ");
      }}
      end={item.end}
      prefetch="intent"
      to={item.to}
    >
      <span>{item.label}</span>
    </NavLink>
  );
}

function initialFor(...candidates: (string | null | undefined)[]) {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed.slice(0, 1).toUpperCase();
  }
  return "F";
}

export function DashboardShell({
  isPublic = false,
  pageClassName,
  accountLabel = "Workspace",
  accountTitle = "Five to Nine",
  accountDetail = "",
  userName,
  userEmail,
  showPresenceNav = false,
  railNote,
  onCommandPalette,
  children,
}: DashboardShellProps) {
  const primary = filterDashboardNav(DASHBOARD_PRIMARY_NAV, {
    showPresence: showPresenceNav,
  });
  const mobileNav = isPublic
    ? []
    : buildDashboardMobileNav({ showPresence: showPresenceNav });
  const navigation = useNavigation();
  const location = useLocation();
  const isNavigating = Boolean(navigation.location);
  const previousPathnameRef = useRef(location.pathname);
  const mainRef = useRef<HTMLDivElement>(null);
  const mobilePrimaryRef = useRef<HTMLElement>(null);
  const [routeAnnouncement, setRouteAnnouncement] = useState("");
  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) return;
    previousPathnameRef.current = location.pathname;

    const routeName = formatRouteName(location.pathname);
    setRouteAnnouncement(`Navigated to ${routeName}.`);
    const frame = window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      mobilePrimaryRef.current
        ?.querySelector<HTMLElement>('a[aria-current="page"]')
        ?.scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "center",
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  const pageClasses = ["f9-dash-page", isPublic ? "f9-dash-page-public" : "f9-dash-page-app", pageClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClasses}>
      <a className="f9-skip-link" href="#f9-main-content">
        Skip to content
      </a>
      <div className={`f9-route-progress ${isNavigating ? "is-visible" : ""}`} aria-hidden="true" />
      <div className="f9-cursor-shell">
        {isPublic ? (
          <aside className="f9-cursor-rail f9-cursor-rail-desktop" aria-label="Application">
            <div className="f9-cursor-account">
              <span>{accountLabel}</span>
              <strong>{accountTitle}</strong>
              <small>{accountDetail}</small>
            </div>

            <nav aria-label="Search">
              {PUBLIC_SEARCH_NAV.map((item) => {
                const Icon = navIconFor(item);
                return (
                  <NavLink
                    className={(state) => {
                      const base = navLinkClassName(state);
                      return ["f9-dash-nav-link", base].filter(Boolean).join(" ");
                    }}
                    end={item.end}
                    key={item.to}
                    prefetch="intent"
                    to={item.to}
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {railNote}

            <div className="f9-dash-rail-footer">
              <Link prefetch="intent" to="/docs">
                Docs
              </Link>
              <Link prefetch="intent" to="/auth/login">
                Sign in
              </Link>
            </div>
          </aside>
        ) : (
          /**
           * BL-030 — the rail is the workspace's ink block. The landing
           * punctuates a long bone page with full-bleed ink bands; a
           * workspace screen recurs a hundred times a day and cannot, so the
           * ink moves to the one element that is always present. Nine visible
           * rows: eight daily jobs plus the "Workspace & account" disclosure
           * holding the seven long-dwell settings routes. Sixteen
           * destinations, none removed.
           */
          <aside
            aria-label="Application"
            className="f9-cursor-rail f9-cursor-rail-desktop f9-wk-rail"
          >
            <div className="f9-wk-rail-head">
              <Link className="f9-wk-wordmark" prefetch="intent" to="/app">
                Five to Nine
              </Link>
            </div>

            {onCommandPalette ? (
              <button
                aria-haspopup="dialog"
                aria-keyshortcuts="Meta+K Control+K"
                className="f9-wk-search"
                onClick={onCommandPalette}
                type="button"
              >
                Search&hellip;
                <span aria-hidden="true" className="f9-wk-key">
                  &#8984;K
                </span>
              </button>
            ) : null}

            <div className="f9-wk-nav">
              {primary.map((section) => (
                <div className="f9-dash-nav-group" key={section.items[0]?.to ?? "nav"}>
                  <nav aria-label="Workspace">
                    {section.items.map((item) => (
                      <WorkspaceNavLink item={item} key={item.to} />
                    ))}
                  </nav>
                </div>
              ))}

            </div>

            {railNote}

            <div className="f9-wk-foot">
              <div className="f9-wk-acct">
                <span aria-hidden="true" className="f9-wk-avatar">
                  {initialFor(userName, userEmail, accountTitle)}
                </span>
                <span>
                  <b className="f9-dash-user-name">{userName?.trim() || accountTitle}</b>
                  <small>{userEmail?.trim() || accountDetail}</small>
                </span>
              </div>
              {/* BL-035 re-adjudication: Help, Docs and the support address
                  duplicated the Help & support route inside the disclosure.
                  The foot now owns identity and the one session action only. */}
              <div className="f9-wk-foot-action">
                <SignOutButton />
              </div>
            </div>
          </aside>
        )}

        {!isPublic && mobileNav.length > 0 ? (
          <nav
            aria-label="Workspace sections"
            className="f9-dash-mobile-nav"
            ref={mobilePrimaryRef}
          >
            {mobileNav.map((item) => {
              // Same member-page ownership as the rail: Settings stays the
              // active mobile row on /app/billing (PR-5a review, Grok 2).
              const memberActive = isDestinationMemberActive(item, location.pathname);
              return (
                <NavLink
                  className={(state) =>
                    navLinkClassName({
                      ...state,
                      isActive: state.isActive || memberActive,
                    })
                  }
                  end={item.end}
                  key={item.to}
                  prefetch="intent"
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              );
            })}
            <SignOutButton />
          </nav>
        ) : null}

        <div aria-live="polite" className="f9-sr-only" role="status">
          {routeAnnouncement}
        </div>
        <div className="f9-cursor-main" id="f9-main-content" ref={mainRef} tabIndex={-1}>
          {children}
        </div>
      </div>
    </main>
  );
}

function formatRouteName(pathname: string) {
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? "overview";
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
