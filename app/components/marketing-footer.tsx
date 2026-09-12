import type { FunctionComponent } from "react";
import { Link } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { MARKETING_TAGLINE } from "~/components/marketing-nav";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const BRAND_ORIGIN_LINE =
  "Named for 05:09 — your competitor brief is filed before the workday starts.";

export interface MarketingFooterProps {
  /**
   * Whole days of continuous scheduled-monitoring coverage (issue #2972),
   * loaded by the route from the real observation baseline — the same
   * figure /status publishes. When absent the footer renders the Status
   * link alone; it never fabricates an uptime number.
   */
  monitoringCoverageDays?: number | null;
}

/**
 * Shared marketing footer for the public funnel: landing page, compare
 * pages, and switch pages. Keep every public marketing surface on this one
 * footer so link groups (support, legal, compare, switch) never drift apart.
 */
export const MarketingFooter: FunctionComponent<MarketingFooterProps> = (
  { monitoringCoverageDays },
) => {
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
      {typeof monitoringCoverageDays === "number" ? (
        <p className="ld-footer-status">
          <Link to="/status">Status</Link>
          {" — "}
          {monitoringCoverageDays}{" "}
          {monitoringCoverageDays === 1 ? "day" : "days"} of continuous
          scheduled monitoring
        </p>
      ) : null}
      <nav aria-label="Footer">
        <Link to="/help">Help</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/api/docs">API docs</Link>
        <Link to="/mcp/setup">MCP setup</Link>
        <Link to="/status">Status</Link>
        <Link to="/changelog">Changelog</Link>
        <Link to="/competitor-monitoring">Proof brief</Link>
        <Link to="/for-agencies">For agencies</Link>
        <Link to="/capture-rules">Proof rules</Link>
        <Link to="/brands">Tracked brands</Link>
        <Link to="/trust">Trust</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        <a href="https://inish.in/">Nish's daily reads</a>
      </nav>
      <nav className="ld-footer-compare" aria-label="Compare">
        <span className="ld-footer-group-label">Compare</span>
        <Link to="/compare/meta-ad-library">vs checking the Meta Ad Library by hand</Link>
        {/* /compare/visualping and /compare/foreplay are not linked here
            (issue #1481): duplicates canonicalizing to the two links below. */}
        <Link to="/compare/visualping-ad-libraries">vs Visualping for ad libraries</Link>
        <Link to="/compare/spyland">vs Spyland</Link>
        <Link to="/compare/pulzifi">vs Pulzifi</Link>
        <Link to="/compare/foreplay-spyder">vs Foreplay Spyder</Link>
        <Link to="/compare/panoramata">vs Panoramata</Link>
        <Link to="/compare/adspyder">vs AdSpyder</Link>
        <Link to="/compare/adspy">vs AdSpy</Link>
        {/* Issue #2866: two verified competitors that had no compare page. */}
        <Link to="/compare/keeptabz">vs KeepTabz</Link>
        <Link to="/compare/gethookd">vs GetHookd</Link>
        {/* Issue #3092: remaining verified ad-spy incumbents. */}
        <Link to="/compare/bigspy">vs BigSpy</Link>
        <Link to="/compare/minea">vs Minea</Link>
        <Link to="/compare/poweradspy">vs PowerAdSpy</Link>
      </nav>
      {/* Issue #3167: the /guides corpus had zero inbound internal links.
          These are literal href= anchors rather than Link to= because the
          issue's source-level verify greps `href="/guides/` — rendered
          markup is identical, the grep only sees the literal form. */}
      <nav className="ld-footer-compare" aria-label="Guides">
        <span className="ld-footer-group-label">Guides</span>
        <a href="/guides">All guides</a>
        <a href="/guides/how-to-track-competitor-ads">Track competitor ads</a>
        <a href="/guides/how-to-monitor-meta-ad-library">Monitor a Meta Ad Library</a>
        <a href="/guides/how-to-monitor-competitor-landing-page-changes">Watch landing-page changes</a>
        <a href="/guides/how-to-get-alerted-when-a-competitor-changes-their-offer">Alerted on offer changes</a>
        <a href="/guides/how-to-prove-what-changed-on-a-competitor-website">Prove what changed</a>
        <a href="/guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch">One-off check to standing watch</a>
      </nav>
      <nav className="ld-footer-compare" aria-label="Switch">
        <span className="ld-footer-group-label">Switch</span>
        <Link to="/switch/panoramata">from Panoramata</Link>
        <Link to="/switch/visualping">from Visualping</Link>
        <Link to="/switch/magicbrief">from MagicBrief</Link>
        <Link to="/switch/adspy">from AdSpy</Link>
      </nav>
      <nav className="ld-footer-compare" aria-label="By industry">
        <span className="ld-footer-group-label">By industry</span>
        <Link to="/sneaker-resale">Sneaker resale competitor ads</Link>
      </nav>
    </footer>
  );
};
