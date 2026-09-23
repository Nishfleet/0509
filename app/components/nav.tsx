import type { ReactNode } from "react";
import { NavLink } from "react-router";

export const signedInNav = [
  { href: "/app", label: "Home", end: true },
  { href: "/app/competitors", label: "Competitors", end: false },
  { href: "/app/alerts", label: "Alerts", end: false },
  { href: "/app/settings", label: "Settings", end: false },
] as const;

const NAV_CLASS =
  "fixed inset-x-0 bottom-0 z-10 border-t border-ink bg-card pb-[env(safe-area-inset-bottom)] min-[860px]:static min-[860px]:z-auto min-[860px]:border-t-0 min-[860px]:border-r min-[860px]:border-line min-[860px]:pb-0";

const LIST_CLASS = "grid grid-cols-4 min-[860px]:grid-cols-1";

const LINK_CLASS =
  "flex min-h-11 w-full min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center font-mono text-[0.66rem] leading-[1.3] tracking-[0.06em] whitespace-nowrap uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink min-[860px]:flex-row min-[860px]:justify-start min-[860px]:gap-3 min-[860px]:px-4 min-[860px]:text-left min-[860px]:text-[0.72rem]";

function AppNav() {
  return (
    <nav aria-label="App" data-app-nav="" className={NAV_CLASS}>
      <ul className={LIST_CLASS}>
        {signedInNav.map((item) => (
          <li key={item.href} className="min-w-0">
            <NavLink
              to={item.href}
              end={item.end}
              className={({ isActive }) =>
                `${LINK_CLASS} ${isActive ? "text-ink underline decoration-2 underline-offset-4" : "text-ink-soft no-underline"}`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={`size-[5px] shrink-0 ${isActive ? "bg-ink" : "bg-transparent"}`}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SignedInFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-[860px]:grid min-[860px]:min-h-dvh min-[860px]:grid-cols-[11rem_minmax(0,1fr)]">
      <AppNav />
      <div className="min-w-0 pb-[var(--app-nav-clearance)] min-[860px]:pb-0">{children}</div>
    </div>
  );
}
