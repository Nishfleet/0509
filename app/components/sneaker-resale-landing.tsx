import { Form, Link } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  SNEAKER_RESALE_MARKETS,
  sneakerResaleSignupPath,
  type SneakerResaleLocaleId,
} from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { faqPageJsonLd, jsonLdScriptProps, webPageJsonLd } from "~/lib/seo";

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
