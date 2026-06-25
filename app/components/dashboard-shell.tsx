import { Link, NavLink } from "react-router";

import { SignOutButton } from "~/components/sign-out-button";
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

function NavSections({ sections }: { sections: DashboardNavSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.title ?? section.items[0]?.to ?? "nav"}>
          {section.title ? <p className="f9-dash-nav-section">{section.title}</p> : null}
          <nav aria-label={section.title ?? "Application"}>
            {section.items.map((item) => (
              <NavLink
                className={({ isActive }) => (isActive ? "is-active" : undefined)}
                end={item.end}
                key={item.to}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
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

  return (
    <main className={pageClassName ? `f9-dash-page ${pageClassName}` : "f9-dash-page"}>
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
              {PUBLIC_SEARCH_NAV.map((item) => (
                <NavLink
                  className={({ isActive }) => (isActive ? "is-active" : undefined)}
                  end={item.end}
                  key={item.to}
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : (
            <>
              <NavSections sections={primary} />
              <NavSections sections={settings} />

              {staff.length > 0 ? (
                <nav aria-label="Staff">
                  {staff.map((item) => (
                    <NavLink
                      className={({ isActive }) => (isActive ? "is-active" : undefined)}
                      end={item.end}
                      key={item.to}
                      to={item.to}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
              ) : null}
            </>
          )}

          {railNote}

          <div className="f9-dash-rail-footer">
            <Link to="/help">Help</Link>
            <Link to="/docs">Docs</Link>
            {isPublic ? (
              <Link to="/auth/login">Sign in</Link>
            ) : (
              <>
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                <SignOutButton />
              </>
            )}
          </div>
        </aside>

        <div className="f9-cursor-main">
          {headerActions ? <header className="f9-dash-topbar">{headerActions}</header> : null}
          {children}
        </div>

        {!isPublic && mobileNav.length > 0 ? (
          <>
            <div className="f9-dash-mobile-utility">
              <Link to="/help">Help</Link>
              <Link to="/app/billing">Billing</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              <SignOutButton />
            </div>
            <nav aria-label="Primary" className="f9-dash-mobile-nav">
              {mobileNav.map((item) => (
                <NavLink
                  className={({ isActive }) => (isActive ? "is-active" : undefined)}
                  end={item.end}
                  key={item.to}
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </>
        ) : null}
      </div>
    </main>
  );
}
