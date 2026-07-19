import { Link, NavLink, useLocation, useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";

import { SignOutButton } from "~/components/sign-out-button";
import { navIconFor } from "~/components/icons";
import {
  DASHBOARD_PRIMARY_NAV,
  DASHBOARD_SETTINGS_NAV,
  DASHBOARD_STAFF_NAV,
  PUBLIC_SEARCH_NAV,
  buildDashboardMobileNav,
  filterDashboardNav,
  type DashboardNavSection,
} from "~/lib/dashboard-navigation";
import { SUPPORT_EMAIL } from "~/lib/support";

export interface DashboardShellProps {
  /** Signed-out search uses a minimal public rail */
  isPublic?: boolean;
  /** Page wrapper class, e.g. f9-search-page for search-specific overrides */
  pageClassName?: string;
  accountLabel: string;
  accountTitle: string;
  accountDetail: string;
  userName?: string | null;
  userEmail?: string | null;
  showPresenceNav?: boolean;
  showOpsNav?: boolean;
  railNote?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

function navLinkClassName({ isActive, isPending }: { isActive: boolean; isPending: boolean }) {
  return [isActive ? "is-active" : null, isPending ? "is-pending" : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

const MOBILE_UTILITY_NAV = [
  { label: "Team", to: "/app/team" },
  { label: "Client rooms", to: "/app/clients" },
  { label: "Support", to: "/app/support" },
  { label: "Billing", to: "/app/billing" },
] as const;

function navItemMatchesPath(item: { to: string; end?: boolean }, pathname: string) {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function NavSections({ sections }: { sections: DashboardNavSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <div className="f9-dash-nav-group" key={section.title ?? section.items[0]?.to ?? "nav"}>
          {section.title ? <p className="f9-dash-nav-section">{section.title}</p> : null}
          <nav aria-label={section.title ?? "Application"}>
            {section.items.map((item) => {
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
        </div>
      ))}
    </>
  );
}

export function DashboardShell({
  isPublic = false,
  pageClassName,
  accountLabel,
  accountTitle,
  accountDetail,
  userName,
  userEmail,
  showPresenceNav = false,
  showOpsNav = false,
  railNote,
  headerActions,
  children,
}: DashboardShellProps) {
  const primary = filterDashboardNav(DASHBOARD_PRIMARY_NAV, {
    showPresence: showPresenceNav,
    showOps: showOpsNav,
  });
  const settings = filterDashboardNav(DASHBOARD_SETTINGS_NAV, {
    showPresence: showPresenceNav,
    showOps: showOpsNav,
  });
  const staff = DASHBOARD_STAFF_NAV.filter((item) => !item.requiresOps || showOpsNav);
  const mobileNav = isPublic ? [] : buildDashboardMobileNav({ showPresence: showPresenceNav });
  const navigation = useNavigation();
  const location = useLocation();
  const isNavigating = Boolean(navigation.location);
  const hasMountedRef = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const mobilePrimaryRef = useRef<HTMLElement>(null);
  const mobileUtilityRef = useRef<HTMLElement>(null);
  const [routeAnnouncement, setRouteAnnouncement] = useState("");
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const routeName = formatRouteName(location.pathname);
    setRouteAnnouncement(`Navigated to ${routeName}.`);
    const frame = window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      for (const nav of [mobilePrimaryRef.current, mobileUtilityRef.current]) {
        nav?.querySelector<HTMLElement>('a[aria-current="page"]')?.scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "center",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  const currentMobileLabel = [...mobileNav, ...MOBILE_UTILITY_NAV]
    .find((item) => navItemMatchesPath(item, location.pathname))?.label ?? "Navigate";
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
        <aside className="f9-cursor-rail f9-cursor-rail-desktop" aria-label="Application">
          <div className="f9-cursor-account">
            <span>{accountLabel}</span>
            <strong>{accountTitle}</strong>
            <small>{accountDetail}</small>
            {userName ? (
              <>
                <strong className="f9-dash-user-name">{userName}</strong>
                {userEmail ? <small>{userEmail}</small> : null}
              </>
            ) : null}
          </div>

          {isPublic ? (
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
          ) : (
            <>
              <NavSections sections={primary} />
              <NavSections sections={settings} />

              {staff.length > 0 ? (
                <nav aria-label="Staff">
                  {staff.map((item) => {
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
              ) : null}
            </>
          )}

          {railNote}

          <div className="f9-dash-rail-footer">
            <Link prefetch="intent" to="/help">
              Help
            </Link>
            <Link prefetch="intent" to="/docs">
              Docs
            </Link>
            {isPublic ? (
              <Link prefetch="intent" to="/auth/login">
                Sign in
              </Link>
            ) : (
              <>
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                <SignOutButton />
              </>
            )}
          </div>
        </aside>

        {!isPublic && mobileNav.length > 0 ? (
          <>
            <p className="f9-dash-mobile-context">
              <strong>{currentMobileLabel}</strong>
              <span>Swipe for more</span>
            </p>
            <nav aria-label="Primary" className="f9-dash-mobile-nav" ref={mobilePrimaryRef}>
              {mobileNav.map((item) => (
                <NavLink
                  className={navLinkClassName}
                  end={item.end}
                  key={item.to}
                  prefetch="intent"
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <nav aria-label="Workspace and account" className="f9-dash-mobile-utility" ref={mobileUtilityRef}>
              {MOBILE_UTILITY_NAV.map((item) => (
                <NavLink
                  className={navLinkClassName}
                  key={item.to}
                  prefetch="intent"
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              ))}
              <SignOutButton />
            </nav>
          </>
        ) : null}

        <div aria-live="polite" className="f9-sr-only" role="status">
          {routeAnnouncement}
        </div>
        <div className="f9-cursor-main" id="f9-main-content" ref={mainRef} tabIndex={-1}>
          {headerActions ? <header className="f9-dash-topbar">{headerActions}</header> : null}
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
