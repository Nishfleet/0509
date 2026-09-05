import type { ReactNode } from "react";

import { PrimaryAction } from "~/components/evidence/cta";

/**
 * The workspace page shell.
 *
 * Evidence Desk (BL-005): `volume` stamps `data-wk-volume` on the content
 * wrapper so the Plain volume (brief §3 — long-dwell settings surfaces) keeps
 * the tokens and the CTA hierarchy while dropping the offset shadows. The
 * default is the Workspace volume.
 */

export type DashboardVolume = "workspace" | "plain";

export interface DashboardPageProps {
  children: React.ReactNode;
  className?: string;
  volume?: DashboardVolume;
}

export function DashboardPage({ children, className, volume = "workspace" }: DashboardPageProps) {
  return (
    <div
      className={className ? `f9-dash-content ${className}` : "f9-dash-content"}
      data-wk-volume={volume}
    >
      {children}
    </div>
  );
}


/**
 * The `action` slot carries the page's single Rank-1 primary action (brief
 * §5, DESIGN.md WP-A3) — the one thing the page exists to do, never a
 * cross-navigation shortcut to a sidebar destination.
 */
