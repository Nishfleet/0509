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
 * from any public page without scrolling or detouring through Sign in. On the
 * compact ≤860px row, Open app is hidden (app.css) so Sign in + Sign up stay
 * one ≥44px touch-target row and the homepage live-search stays above the fold.
 * Open app is auth-aware: signed-in visitors get /app directly, anonymous
 * visitors (and crawlers) get /auth/login?redirectTo=%2Fapp — the same final
 * URL the app guard would redirect to, without the redirect hop.
 */
export function MarketingNav() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;

  return (
    <header className="ld-nav f9-legal-nav">
      <Link className="ld-brand f9-brandmark" to="/" aria-label="Five to Nine home">
        <BrandWordmark meta={MARKETING_TAGLINE} />
      </Link>

      <nav className="ld-nav-links" aria-label="Primary">
        <Link to="/search">Search preview</Link>
        <Link to="/compare">Compare</Link>
        <Link to="/#demo">Proof brief</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/help">Help</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/status">Status</Link>
        {/* Switch-page links in the primary nav so a buyer who lands on any
            public surface reaches /switch/* in one click without a footer
            scroll (issue #1466). Visible at 360–1440px — the nav is a
            scrollable row at ≤860px and wraps on legal pages, no hover/JS. */}
        <SwitchFromLinks />
      </nav>

      <nav className="ld-nav-actions" aria-label="Account">
        <Link className="f9-link-arrow" to="/auth/login">
          Sign in
        </Link>
        <Link
          className="f9-link-arrow ld-nav-open-app"
          to={appLinkTarget("/app", rootData?.session)}
        >
          Open app
        </Link>
        <Link className="ld-nav-pill" to="/auth/signup">
          Sign up
        </Link>
      </nav>
    </header>
  );
}
