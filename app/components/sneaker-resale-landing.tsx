import { Form, Link } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  SNEAKER_RESALE_MARKETS,
  sneakerResaleSignupPath,
  type SneakerResaleLocaleId,
} from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { faqPageJsonLd, jsonLdScriptProps, webPageJsonLd } from "~/lib/seo";

/**
 * Real sneaker-resale advertisers that have a live, indexable `/ads/:domain`
 * brand page built from real Meta Ad Library captures. The sneaker-resale
 * landing page used to name brands in copy only (Jordan / StockX / GOAT in
 * the FAQ) and link to zero `/ads/` pages — orphaned from the market's #1
 * swing (#1290). Each entry here is a domain whose `/ads/` page is live and
 * indexable today (verified against the production sitemap); a domain
 * without a cached page 301-redirects to `/search` and is intentionally
 * omitted so this section never ships a dead link.
 */
export const SNEAKER_RESALE_BRAND_PAGES: ReadonlyArray<{ name: string; domain: string }> = [
  { name: "Nike", domain: "nike.com" },
  { name: "Adidas", domain: "adidas.com" },
  { name: "ASOS", domain: "asos.com" },
  { name: "Decathlon", domain: "decathlon.com" },
  { name: "StockX", domain: "stockx.com" },
  { name: "Saucony", domain: "saucony.com" },
  { name: "ASICS", domain: "asics.com" },
  { name: "Hoka", domain: "hoka.com" },
  { name: "PUMA", domain: "puma.com" },
  { name: "New Balance", domain: "newbalance.com" },
  { name: "Crocs", domain: "crocs.com" },
  { name: "Foot Locker", domain: "footlocker.com" },
  { name: "Zappos", domain: "zappos.com" },
  { name: "DSW", domain: "dsw.com" },
  { name: "Vans", domain: "vans.com" },
  { name: "Converse", domain: "converse.com" },
  { name: "Under Armour", domain: "underarmour.com" },
  { name: "Stadium Goods", domain: "stadiumgoods.com" },
  { name: "Flight Club", domain: "flightclub.com" },
  { name: "KICKS CREW", domain: "kickscrew.com" },
  { name: "JD Sports", domain: "jdsports.com" },
  { name: "Finish Line", domain: "finishline.com" },
];

export function SneakerResaleLanding({ locale }: { locale: SneakerResaleLocaleId }) {
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

      <section className="ld-quiet ld-reveal">
        <div className="ld-section-head">
          <span className="ld-kicker">{copy.brandsKicker}</span>
          <h2>{copy.brandsTitle}</h2>
          <p className="ld-deck-copy">{copy.brandsDeck}</p>
        </div>
        <ul className="ld-brand-links" aria-label={copy.brandsTitle}>
          {SNEAKER_RESALE_BRAND_PAGES.map((brand) => (
            <li key={brand.domain}>
              <Link to={`/ads/${brand.domain}`}>
                <strong>{brand.name}</strong>
                <span>{brand.domain}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="ld-quiet ld-reveal">
        <div className="ld-section-head">
          <span className="ld-kicker">{copy.swingKicker}</span>
          <h2>{copy.swingTitle}</h2>
          <p className="ld-deck-copy">{copy.swingDeck}</p>
        </div>
        <ul className="ld-brand-links ld-swing" aria-label={copy.swingTitle}>
          {copy.swing.map((item) => (
            <li key={item.brand}>
              <Link to={`/search?q=${item.domain}`}>
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
