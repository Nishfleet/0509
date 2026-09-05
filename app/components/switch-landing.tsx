import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { canonicalLinks, faqPageJsonLd, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";
import type { SwitchPage, SwitchSource } from "~/lib/switch-pages";

export function switchPageLinks(page: SwitchPage): LinksFunction {
  return () => canonicalLinks(page.pathname);
}

export function switchPageMeta(page: SwitchPage): MetaFunction {
  return () =>
    publicSeoMeta({
      title: page.title,
      description: page.description,
      pathname: page.pathname,
    });
}

function SourceLink({ source }: { source: SwitchSource }) {
  return (
    <a href={source.href} rel="noreferrer" target="_blank">
      {source.label}
    </a>
  );
}

function SwitchHero({ page }: { page: SwitchPage }) {
  return (
    <section className="ld-hero">
      <p className="ld-case">
        <span>{page.kicker}</span>
      </p>
      <h1 className="ld-wall ld-wall-compact">{page.headline}</h1>
      <p className="ld-deck-copy">{page.deck}</p>
    </section>
  );
}

function SwitchComplaint({ page }: { page: SwitchPage }) {
  return (
    <section className="ld-quiet">
      <div className="ld-section-head">
        <span className="ld-kicker">{page.complaint.kicker}</span>
        <h2>{page.complaint.heading}</h2>
      </div>
      <div className="ld-quiet-grid">
        <article>
          <h3>Quoted source</h3>
          <p>
            {page.complaint.quote} Source: <SourceLink source={page.complaint.source} />
          </p>
        </article>
      </div>
    </section>
  );
}

function SwitchBoundary({ page }: { page: SwitchPage }) {
  return (
    <>
      <section className="ld-how">
        <h2>What transfers.</h2>
        <div className="ld-how-grid">
          {page.transfers.map((row, index) => (
            <article key={row.title}>
              <span className="ld-step">{String(index + 1).padStart(2, "0")}</span>
              <h3>{row.title}</h3>
              <p>{row.detail}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Not imported</span>
          <h2>What does not transfer.</h2>
        </div>
        <div className="ld-quiet-grid">
          {page.doesNotTransfer.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
      {page.extraSection ? (
        <section className="ld-quiet">
          <div className="ld-section-head">
            <span className="ld-kicker">{page.extraSection.kicker}</span>
            <h2>{page.extraSection.heading}</h2>
          </div>
          <div className="ld-quiet-grid">
            {page.extraSection.items.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function SwitchFaq({ page }: { page: SwitchPage }) {
  if (page.faqEntries.length === 0) {
    return null;
  }
  return (
    <section className="ld-quiet" id="faq">
      <div className="ld-pricing-faq" aria-label={`${page.productName} switch FAQ`}>
        <span className="ld-kicker">FAQ</span>
        <h2>{page.productName} switch questions, answered honestly.</h2>
        <dl className="proof-trail-list">
          {page.faqEntries.map((entry) => (
            <div key={entry.question}>
              <dt>{entry.question}</dt>
              <dd>{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function SwitchClose({ page }: { page: SwitchPage }) {
  const sources = [page.complaint.source, ...page.furtherSources];
  return (
    <>
      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Sources</span>
          <h2>Every claim on this page has a link.</h2>
        </div>
        <ul>
          {sources.map((source) => (
            <li key={source.href}>
              <SourceLink source={source} />
            </li>
          ))}
          {page.relatedComparePath ? (
            <li>
              Full product comparison: <Link to={page.relatedComparePath}>{page.relatedComparePath}</Link>
            </li>
          ) : null}
        </ul>
      </section>
      <section className="ld-final">
        <h2>Start with the free preview</h2>
        <p className="ld-pricing-note">
          No demo form, no email gate. Try the public search preview and see what is publicly
          available before you decide anything.
        </p>
        <Link className="ld-cta-button" to={`/search?q=${encodeURIComponent(page.ctaBrand)}`}>
          Try the free preview <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}

export function SwitchLanding({ page }: { page: SwitchPage }) {
  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: page.title,
            description: page.description,
            pathname: page.pathname,
            comparedProductName: page.productName,
          }),
        )}
      />
      {page.faqEntries.length > 0 ? (
        <script {...jsonLdScriptProps(faqPageJsonLd(page.faqEntries))} />
      ) : null}
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: `Switch from ${page.productName}`, pathname: page.pathname },
        ]}
      />
      <SwitchHero page={page} />
      <SwitchComplaint page={page} />
      <SwitchBoundary page={page} />
      <SwitchFaq page={page} />
      <SwitchClose page={page} />
      <MarketingFooter />
    </main>
  );
}
