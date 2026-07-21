import { Link } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

/**
 * Single source of truth for the public wordmark tagline. Every public
 * surface (nav, footer, doc header) shows this one string so the brand line
 * never drifts (SF-2).
 */
export const MARKETING_TAGLINE = "Competitor change monitoring";

/**
 * One shared header nav for every public surface — landing, compare pages,
 * and the legal/doc shell. Reuses the existing `ld-nav*` classes byte-for-byte
 * (no new CSS). Links are absolute-to-home hashes so Pricing / Sample brief
 * work from any page, not just the landing route.
 */
export function MarketingNav() {
  return (
    <header className="ld-nav">
      <Link className="ld-brand" to="/" aria-label="Five to Nine home">
        <BrandWordmark meta={MARKETING_TAGLINE} />
      </Link>

      <nav className="ld-nav-links" aria-label="Primary">
        <Link to="/search">Search preview</Link>
        <Link to="/#demo">Sample brief</Link>
        <Link to="/#pricing">Pricing</Link>
        <Link to="/help">Help</Link>
        <Link to="/docs">Docs</Link>
      </nav>

      <nav className="ld-nav-actions" aria-label="Account">
        <Link className="f9-link-arrow" to="/auth/login">
          Sign in
        </Link>
        <Link className="ld-nav-pill" to="/app">
          Open app
        </Link>
      </nav>
    </header>
  );
}
