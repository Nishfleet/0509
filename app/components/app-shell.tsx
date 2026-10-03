import type { ReactNode } from "react";

import { Nav } from "./nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-[860px]:flex">
      <a
        href="#app-content"
        className="sr-only focus:not-sr-only focus:absolute focus:inset-x-0 focus:top-0 focus:z-20 focus:flex focus:min-h-11 focus:items-center focus:bg-card focus:px-4 focus:text-ink focus:outline-2 focus:outline-ink"
      >
        Skip to content
      </a>
      <Nav />
      <div className="min-w-0 flex-1 pb-[92px] min-[860px]:pb-0" id="app-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
