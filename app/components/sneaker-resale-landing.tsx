import { Form, Link } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import {
  SNEAKER_RESALE_MARKETS,
  sneakerResaleSignupPath,
  type SneakerResaleLocaleId,
} from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { faqPageJsonLd, jsonLdScriptProps, webPageJsonLd } from "~/lib/seo";

/**
 * `indexableAdsLinks` is the sneaker-resale publisher cluster's live,
 * indexable `/ads/:domain` brand pages — the route loader resolves it from
 * the same sitemap indexability signal the sitemap itself uses
 * (`loadSneakerResaleAdsInternalLinks`, issue #1547), so the section can
 * never point at a brand page that would render noindex or 301 to /search.
 * The sneaker-resale landing page used to name brands in copy only (Jordan /
 * StockX / GOAT in the FAQ) and link to zero `/ads/` pages — orphaned from
 * the market's #1 swing (#1290). The section hides entirely when no cluster
 * page is indexable (a sitemap hiccup degrades the loader to []).
 */
export function SneakerResaleLanding({
  locale,
  indexableAdsLinks,
}: {
  locale: SneakerResaleLocaleId;
  indexableAdsLinks: readonly IndexableAdsLink[];
}) {
  const copy = sneakerResaleCopy(locale);
  const market = SNEAKER_RESALE_MARKETS.find((entry) => entry.id === locale);
  if (!market) {
    throw new Error(`unknown sneaker-resale locale: ${locale}`);
  }

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: copy.title,
            description: copy.description,
            pathname: market.pathname,
          }),
        )}
      />
      <script {...jsonLdScriptProps(faqPageJsonLd(copy.faq))} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          {
            name: "Home",
            pathname: market.id === "en" ? "/" : `/${market.id}`,
          },
          { name: "Sneaker resale", pathname: market.pathname },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{copy.kicker}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">{copy.h1}</h1>
        <p className="ld-deck-copy">{copy.deck}</p>

        <Form className="ld-command" method="get" action="/search" aria-label={copy.searchLabel}>
          <input
            aria-label={copy.searchLabel}
            name="website"
            placeholder={copy.searchPlaceholder}
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
          />
          <button type="submit">
            {copy.searchButton} <span aria-hidden="true">→</span>
          </button>
        </Form>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">{copy.problemKicker}</span>
          <h2>{copy.problemTitle}</h2>
        </div>
        <div className="ld-quiet-grid">
          {copy.problems.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>{copy.productTitle}</h2>
        <div className="ld-how-grid">
          {copy.products.map((item, index) => (
            <article key={item.title}>
              <span className="ld-step">{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {indexableAdsLinks.length > 0 ? (
        <section className="ld-quiet ld-reveal">
          <div className="ld-section-head">
            <span className="ld-kicker">{copy.brandsKicker}</span>
            <h2>{copy.brandsTitle}</h2>
            <p className="ld-deck-copy">{copy.brandsDeck}</p>
          </div>
          <ul className="ld-brand-links" aria-label={copy.brandsTitle}>
            {indexableAdsLinks.map((link) => (
              <li key={link.domain}>
                <Link to={link.path}>
                  <strong>{link.name}</strong>
                  <span>{link.domain}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ld-quiet ld-reveal">
        <div className="ld-section-head">
          <span className="ld-kicker">{copy.swingKicker}</span>
          <h2>{copy.swingTitle}</h2>
          <p className="ld-deck-copy">{copy.swingDeck}</p>
        </div>
        <ul className="ld-brand-links ld-swing" aria-label={copy.swingTitle}>
          {copy.swing.map((item) => (
            <li key={item.brand}>
              {/*
               * A mover whose /ads/:domain page is live and indexable links
               * straight to the real ad wall; the rest fall back to the live
               * search surface (#1521 keeps every tile followable, #1547
               * retargets populated domains per the copy file's own note).
               */}
              <Link
                to={
                  indexableAdsLinks.some((link) => link.domain === item.domain)
                    ? `/ads/${item.domain}`
                    : `/search?q=${item.domain}`
                }
              >
                <strong>{item.brand}</strong>
                <span>{item.line}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="ld-pricing-note" role="note">
          {copy.swingSource}
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">{copy.honestKicker}</span>
          <h2>{copy.honestTitle}</h2>
        </div>
        <div className="ld-quiet-grid">
          {copy.honest.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label={copy.faqTitle}>
          <span className="ld-kicker">{copy.faqKicker}</span>
          <h2>{copy.faqTitle}</h2>
          <dl className="proof-trail-list">
            {copy.faq.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="ld-final">
        <div className="ld-migration-cta">
          <div>
            <span className="ld-kicker">{copy.ctaKicker}</span>
            <h2>{copy.ctaTitle}</h2>
            <p>{copy.ctaBody}</p>
          </div>
          <a className="ld-cta-button" href={sneakerResaleSignupPath(locale)}>
            {copy.ctaButton} <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <nav className="ld-final" aria-label={copy.otherLanguagesLabel}>
        <p className="ld-pricing-note">
          {copy.otherLanguagesLabel}:{" "}
          {SNEAKER_RESALE_MARKETS.map((entry, index) => (
            <span key={entry.id}>
              {index > 0 ? " · " : null}
              {entry.id === locale ? (
                <span>{entry.nativeName}</span>
              ) : (
                <Link to={entry.pathname}>{entry.nativeName}</Link>
              )}
            </span>
          ))}
        </p>
        <p className="ld-pricing-note">
          <Link to="/pricing">Pricing</Link>
          {" · "}
          <Link to="/competitor-monitoring">Proof brief</Link>
        </p>
      </nav>

      <MarketingFooter />
    </main>
  );
}
