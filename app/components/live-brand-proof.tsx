import { Link } from "react-router";

import { displayNameFromDomain } from "~/lib/ads-internal-links";
import type { DemoBrandPageDomain } from "~/lib/demo-brand-pages";

/**
 * "See it on a live brand" proof block for the sitemap-canonical `/compare/*`
 * pages (issue 2124). A comparison page that only asserts "domain paste +
 * proof" without showing one real proof page is parity copy — a paragraph a
 * chat prompt could write. This block links the visitor to a tracked
 * `/ads/:domain` page that returns HTTP 200 with verified ads, so the
 * comparison-intent visitor sees the product working instead of only reading
 * claims.
 *
 * The linked domain MUST be a tracked demo brand from the production sitemap
 * (never a screenshot fixture, never a vendor-owned domain). When that brand
 * also has a live `/timeline/:domain` offer-history page, the block adds a
 * second link labelled as offer history.
 */
export function LiveBrandProof({
  domain,
  hasTimeline = true,
}: {
  domain: DemoBrandPageDomain;
  hasTimeline?: boolean;
}) {
  // Derive the visible brand name from the domain (the same helper every
  // public /ads/:domain surface uses) so the label can never drift from the
  // linked domain — a hardcoded literal next to a separately-sourced domain
  // would keep saying "Nike" if the seed ever changed to nykaa.com.
  const brandName = displayNameFromDomain(domain);
  return (
    <section className="ld-quiet">
      <div className="ld-section-head">
        <span className="ld-kicker">See it on a live brand</span>
        <h2>Watch a real brand wall, not a claim.</h2>
      </div>
      <p>
        This is what a tracked brand looks like in Five to Nine — a live{" "}
        <Link to={`/ads/${domain}`}>{brandName} ad wall</Link> with verified ads
        {hasTimeline ? (
          <>
            {" "}
            and its{" "}
            <Link to={`/timeline/${domain}`}>{brandName} offer history</Link>
          </>
        ) : null}
        . Paste any competitor domain into the search preview to see the same
        for yourself.
      </p>
    </section>
  );
}
