import type { ReactNode } from "react";

import { Nav } from "./nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-[860px]:flex">
      <Nav />
      <div className="min-w-0 flex-1 pb-[92px] min-[860px]:pb-0">{children}</div>
    </div>
  );
}
