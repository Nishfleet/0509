import { Link, useRouteLoaderData } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { SwitchFromLinks } from "~/components/switch-from-links";
import { appLinkTarget } from "~/lib/app-link";
import type { RootLoaderData } from "~/root";

/**
 * Single source of truth for the public wordmark tagline. Every public
 * surface (nav, footer, doc header) shows this one string so the brand line
 * never drifts (SF-2).
 */
export const MARKETING_TAGLINE = "Competitor change monitoring";

export interface MarketingPrimaryLink {
  label: string;
  to: string;
}

/**
 * THE one shared public destination list — the canonical primary nav for
 * every public surface. MarketingNav renders it inline below, and the public
 * /search rail consumes it via PUBLIC_SEARCH_NAV in dashboard-navigation, so
 * landing and search can never drift (issue #2324). No Home entry: the brand
 * wordmark/account block is Home.
 */
export const MARKETING_PRIMARY_LINKS: readonly MarketingPrimaryLink[] = [
  { label: "Search preview", to: "/search" },
  { label: "Compare", to: "/compare" },
  { label: "Pricing", to: "/pricing" },
  { label: "Help", to: "/help" },
  { label: "Docs", to: "/docs" },
  { label: "Status", to: "/status" },
];

export interface MarketingNavProps {
  /** Show the three /switch/* "from <tool>" links in the primary nav (default true). */
  showSwitchLinks?: boolean;
}

/**
 * THE single public header for every public surface — landing, /ads/* brand
 * pages, and the legal/doc shell (via `PublicDocHeader`). One canonical link
 * list (Search preview, Pricing, Help, Docs, Status) plus Sign in / Open app
 * and the Sign up CTA — no per-surface improvisation. Uses the `ld-nav*`
 * classes, styled for both `.f9-home` and `.f9-legal-page` containers in
 * app.css. Links are absolute-to-home hashes so Pricing works from any page,
 * not just the landing route.
 *
 * The signup CTA is the pill so an anonymous visitor can reach /auth/signup
 * from any public page without scrolling or detouring through Sign in.
 * Open app is rendered only when a session is present: signed-in visitors get
 * /app directly, while anonymous visitors see no duplicate auth action (Sign in
 * + Sign up only), so the compact ≤860px row never carries a second link to the
 * same login destination.
 */
export function MarketingNav({ showSwitchLinks = true }: MarketingNavProps) {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;

  return (
    <header className="ld-nav f9-legal-nav">
      <Link className="ld-brand f9-brandmark" to="/" aria-label="Five to Nine home">
        <BrandWordmark meta={MARKETING_TAGLINE} />
      </Link>

      <nav className="ld-nav-links" aria-label="Primary">
        {MARKETING_PRIMARY_LINKS.map((link) => (
          <Link key={link.to} to={link.to}>
            {link.label}
          </Link>
        ))}
        {showSwitchLinks ? (
          <>
            {/* Switch-page links in the primary nav so a buyer who lands on any
                public surface reaches /switch/* in one click without a footer
                scroll (issue #1466). Surfaces that already render the H1 strip
                (/search, /competitor-monitoring) or the legal/doc shell opt out
                via showSwitchLinks={false}. No hover/JS — plain server links. */}
            <SwitchFromLinks />
          </>
        ) : null}
      </nav>

      <nav className="ld-nav-actions" aria-label="Account">
        <Link className="f9-link-arrow" to="/auth/login">
          Sign in
        </Link>
        {rootData?.session ? (
          <Link
            className="f9-link-arrow ld-nav-open-app"
            to={appLinkTarget("/app", rootData.session)}
          >
            Open app
          </Link>
        ) : null}
        <Link className="ld-nav-pill" to="/auth/signup">
          Sign up
        </Link>
      </nav>
    </header>
  );
}
