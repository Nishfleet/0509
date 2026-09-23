import { NavLink } from "react-router";
import type { ReactNode } from "react";

const places = [
  { to: "/app", label: "Home", end: true },
  { to: "/app/competitors", label: "Competitors", end: false },
  { to: "/app/alerts", label: "Alerts", end: false },
  { to: "/app/settings", label: "Settings", end: false },
] as const;

export function Nav() {
  return (
    <nav
      aria-label="Places"
      data-slot="nav"
      className="border-ink bg-card fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] min-[860px]:static min-[860px]:min-h-dvh min-[860px]:w-52 min-[860px]:shrink-0 min-[860px]:border-t-0 min-[860px]:border-r min-[860px]:pb-0"
    >
      <ul className="grid grid-cols-4 min-[860px]:flex min-[860px]:flex-col min-[860px]:gap-1 min-[860px]:p-4">
        {places.map((place) => (
          <li key={place.to} className="min-w-0">
            <NavLink
              to={place.to}
              end={place.end}
              className="group text-ink-soft aria-[current=page]:text-ink focus-visible:outline-ink flex min-h-11 flex-col items-center justify-center gap-1 font-mono text-[0.68rem] tracking-[0.08em] uppercase outline-offset-[-2px] focus-visible:outline-2 min-[860px]:flex-row min-[860px]:justify-start min-[860px]:gap-2 min-[860px]:px-3"
            >
              <span
                aria-hidden="true"
                className="bg-green size-[5px] rounded-full opacity-0 group-aria-[current=page]:opacity-100"
              />
              {place.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-[860px]:flex">
      <Nav />
      <main className="min-w-0 flex-1 p-4 pb-[92px] min-[860px]:pb-4">{children}</main>
    </div>
  );
}
