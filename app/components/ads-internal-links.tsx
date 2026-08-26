import { Link, useLoaderData } from "react-router";

import type { IndexableAdsLink } from "~/lib/ads-internal-links";

export function BrowseTrackedCompetitors({
  links,
}: {
  links: readonly IndexableAdsLink[] | undefined;
}) {
  if (!links || links.length === 0) {
    return null;
  }

  return (
    <section className="ld-quiet" id="tracked-competitors">
      <div className="ld-section-head">
        <span className="ld-kicker">Public brand pages</span>
        <h2>Browse tracked competitors</h2>
        <p>
          Fresh, indexable Meta ad pages for competitors we currently have on record. These are
          the same brand pages the sitemap lists.
        </p>
      </div>
      <div className="ld-quiet-grid" aria-label="Tracked competitors">
        {links.map((link) => (
          <article key={link.domain}>
            <h3>
              <Link to={link.path}>{link.name}</Link>
            </h3>
            <p>See {link.domain} ads on Five to Nine.</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CompareAdsExampleLink() {
  const data = useLoaderData() as { featuredAdsLink?: IndexableAdsLink | null } | null | undefined;
  const featuredAdsLink = data?.featuredAdsLink ?? null;
  const href = featuredAdsLink?.path ?? "/search";
  const label = featuredAdsLink
    ? `See ${featuredAdsLink.name}'s ads on Five to Nine`
    : "See competitor ads on Five to Nine";

  return (
    <p className="ld-pricing-note">
      <Link to={href}>{label}</Link>
    </p>
  );
}
