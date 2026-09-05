import { Link } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { MARKETING_TAGLINE } from "~/components/marketing-nav";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const BRAND_ORIGIN_LINE =
  "Named for 05:09 — your competitor brief is filed before the workday starts.";

/**
 * Shared marketing footer for the public funnel: landing page, compare
 * pages, and switch pages. Keep every public marketing surface on this one
 * footer so link groups (support, legal, compare, switch) never drift apart.
 */
export function MarketingFooter() {
  return (
    <footer className="ld-footer">
      <Link className="ld-footer-brand" to="/" aria-label="Five to Nine home">
        <BrandWordmark meta={MARKETING_TAGLINE} />
      </Link>
      <p>
        Five to Nine helps teams see competitor offer and landing-page changes before the next
        sales call.
      </p>
      <p className="ld-footer-origin">{BRAND_ORIGIN_LINE}</p>
      <nav aria-label="Footer">
        <Link to="/help">Help</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/api/docs">API docs</Link>
        <Link to="/status">Status</Link>
        <Link to="/changelog">Changelog</Link>
        <Link to="/competitor-monitoring">Proof brief</Link>
        <Link to="/capture-rules">Proof rules</Link>
        <Link to="/trust">Trust</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        <a href="https://inish.in/">Nish's daily reads</a>
      </nav>
      <nav className="ld-footer-compare" aria-label="Compare">
        <span className="ld-footer-group-label">Compare</span>
        <Link to="/compare/meta-ad-library">vs checking the Meta Ad Library by hand</Link>
        <Link to="/compare/magicbrief">vs MagicBrief</Link>
        <Link to="/compare/visualping">vs Visualping</Link>
        <Link to="/compare/visualping-ad-library">vs Visualping for ad libraries</Link>
        <Link to="/compare/spyland">vs Spyland</Link>
        <Link to="/compare/pulzifi">vs Pulzifi</Link>
        <Link to="/compare/foreplay">vs Foreplay</Link>
        <Link to="/compare/foreplay-spyder">vs Foreplay Spyder</Link>
        <Link to="/compare/panoramata">vs Panoramata</Link>
        <Link to="/compare/adspyder">vs AdSpyder</Link>
      </nav>
      <nav className="ld-footer-compare" aria-label="Switch">
        <span className="ld-footer-group-label">Switch</span>
        <Link to="/switch/magicbrief">from MagicBrief</Link>
        <Link to="/switch/panoramata">from Panoramata</Link>
        <Link to="/switch/visualping">from Visualping</Link>
      </nav>
      <nav className="ld-footer-compare" aria-label="By industry">
        <span className="ld-footer-group-label">By industry</span>
        <Link to="/sneaker-resale">Sneaker resale competitor ads</Link>
      </nav>
    </footer>
  );
}
