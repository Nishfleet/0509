/**
 * WP-17: 16px stroke icons for the workspace rail / status chips.
 * Inline SVG only — no icon package dependency.
 */

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

function IconBase({ title, children, className, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={["f9-icon", className].filter(Boolean).join(" ")}
      fill="none"
      height="16"
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 16 16"
      width="16"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconOverview(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="5" rx="1" width="5" x="2" y="2" />
      <rect height="5" rx="1" width="5" x="9" y="2" />
      <rect height="5" rx="1" width="5" x="2" y="9" />
      <rect height="5" rx="1" width="5" x="9" y="9" />
    </IconBase>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5 13.5 13.5" />
    </IconBase>
  );
}

export function IconCompetitors(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 13V6.5a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1V13" />
      <path d="M8.5 13V4a1 1 0 0 1 1-1H12a1 1 0 0 1 1 1v9" />
      <path d="M2 13h12" />
    </IconBase>
  );
}

export function IconPresence(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M3.5 8a4.5 4.5 0 0 1 9 0" />
      <path d="M1.75 8a6.25 6.25 0 0 1 12.5 0" />
    </IconBase>
  );
}

export function IconCollections(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 4.5h10v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5Z" />
      <path d="M5.5 4.5V3.75A1.25 1.25 0 0 1 6.75 2.5h2.5A1.25 1.25 0 0 1 10.5 3.75V4.5" />
    </IconBase>
  );
}

export function IconBriefs(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 2.75h8a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </IconBase>
  );
}

export function IconReports(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 12.5V7.5" />
      <path d="M8 12.5V3.5" />
      <path d="M12.5 12.5v-5" />
    </IconBase>
  );
}

export function IconShare(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="4" cy="8" r="1.5" />
      <circle cx="12" cy="4.5" r="1.5" />
      <circle cx="12" cy="11.5" r="1.5" />
      <path d="M5.4 7.3 10.6 5.2M5.4 8.7 10.6 10.8" />
    </IconBase>
  );
}

export function IconClients(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="11" cy="6.5" r="1.5" />
      <path d="M2.5 12.5c.4-2 1.9-3.25 3.5-3.25S9.1 10.5 9.5 12.5" />
      <path d="M9.75 12.25c.2-1.3 1.2-2.1 2.25-2.1 1.1 0 1.95.85 2.15 2.1" />
    </IconBase>
  );
}

export function IconBell(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 6.5a3.5 3.5 0 0 1 7 0c0 3.25 1.25 4 1.25 4H3.25S4.5 9.75 4.5 6.5Z" />
      <path d="M6.75 12.25a1.25 1.25 0 0 0 2.5 0" />
    </IconBase>
  );
}

export function IconKey(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5.5" cy="8" r="2.75" />
      <path d="M8 8h5.5l-1.25 1.25M11.25 8v1.5" />
    </IconBase>
  );
}

export function IconCode(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.5 4.5 2.5 8l3 3.5" />
      <path d="M10.5 4.5 13.5 8l-3 3.5" />
    </IconBase>
  );
}

export function IconTeam(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="5" r="2" />
      <path d="M3.5 12.5c.5-2.4 2.2-3.75 4.5-3.75s4 1.35 4.5 3.75" />
    </IconBase>
  );
}

export function IconBilling(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="9" rx="1.5" width="12" x="2" y="3.5" />
      <path d="M2 6.5h12" />
      <path d="M5 10h2.5" />
    </IconBase>
  );
}

export function IconAccount(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="5.25" r="2.25" />
      <path d="M3.25 13c.6-2.6 2.5-4 4.75-4s4.15 1.4 4.75 4" />
    </IconBase>
  );
}

export function IconHelp(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M6.4 6.2a1.7 1.7 0 0 1 3.2.9c0 1.2-1.6 1.5-1.6 2.6" />
      <path d="M8 11.6h.01" />
    </IconBase>
  );
}

export function IconOps(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2.75v1.5M8 11.75v1.5M2.75 8h1.5M11.75 8h1.5M4.1 4.1l1.05 1.05M10.85 10.85l1.05 1.05M11.9 4.1l-1.05 1.05M5.15 10.85l-1.05 1.05" />
    </IconBase>
  );
}

export function IconStatus(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M5.5 8.1 7.2 9.7 10.6 6.1" />
    </IconBase>
  );
}

export function IconHome(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.75 7.5 8 3.25 13.25 7.5" />
      <path d="M4.25 6.75V12.5h7.5V6.75" />
    </IconBase>
  );
}

export function IconEmpty(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="9" rx="1.5" width="10" x="3" y="3.5" />
      <path d="M5.5 7h5M5.5 9.5h3.5" />
    </IconBase>
  );
}

/** Map nav labels / paths to icons for the rail. */
export function navIconFor(item: { label: string; to: string }) {
  const path = item.to.toLowerCase();
  if (path === "/app" || item.label === "Overview") return IconOverview;
  if (path.startsWith("/search") || item.label === "Search") return IconSearch;
  if (path.includes("watchlist") || item.label === "Competitors") return IconCompetitors;
  if (path.includes("presence")) return IconPresence;
  if (path.includes("collection")) return IconCollections;
  if (path.includes("digest") || item.label === "Briefs") return IconBriefs;
  if (path.includes("report")) return IconReports;
  if (path.includes("share")) return IconShare;
  if (path.includes("client")) return IconClients;
  if (path.includes("notification")) return IconBell;
  if (path.includes("source-access")) return IconKey;
  if (path.includes("developer")) return IconCode;
  if (path.includes("team")) return IconTeam;
  if (path.includes("billing")) return IconBilling;
  if (path.includes("account")) return IconAccount;
  if (path.includes("support") || path.includes("help")) return IconHelp;
  if (path.includes("ops")) return IconOps;
  if (path === "/" || item.label === "Home") return IconHome;
  if (path.includes("pricing")) return IconBilling;
  return IconStatus;
}
