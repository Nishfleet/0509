import { Link } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

/**
 * Single source of truth for the public wordmark tagline. Every public
 * surface (nav, footer, doc header) shows this one string so the brand line
 * never drifts (SF-2).
 */
export const MARKETING_TAGLINE = "Competitor change monitoring";

/**
 * THE single public header for every public surface — landing, /ads/* brand
 * pages, and the legal/doc shell (via `PublicDocHeader`). One canonical link
 * list (Search preview, Pricing, Help, Docs, Status) plus Sign in / Open app /
 * Sign up — no per-surface improvisation. The signup CTA ("Sign up") is the
 * pill so anonymous visitors can start from any public page without scrolling
 * or detouring through Sign in; Sign in and Open app stay available for
 * returning visitors. Uses the `ld-nav*` classes, styled for both `.f9-home`
 * and `.f9-legal-page` containers in app.css. Links are absolute-to-home
 * hashes so Pricing works from any page, not just the landing route.
 */
export function MarketingNav() {
  return (
    <header className="ld-nav f9-legal-nav">
      <Link className="ld-brand f9-brandmark" to="/" aria-label="Five to Nine home">
        <BrandWordmark meta={MARKETING_TAGLINE} />
      </Link>

      <nav className="ld-nav-links" aria-label="Primary">
        <Link to="/search">Search preview</Link>
        <Link to="/#demo">Sample brief</Link>
        <Link to="/#pricing">Pricing</Link>
        <Link to="/help">Help</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/status">Status</Link>
      </nav>

      <nav className="ld-nav-actions" aria-label="Account">
        <Link className="f9-link-arrow" to="/auth/login">
          Sign in
        </Link>
        <Link to="/app">Open app</Link>
        <Link className="ld-nav-pill" to="/auth/signup">
          Sign up
        </Link>
      </nav>
    </header>
  );
}
