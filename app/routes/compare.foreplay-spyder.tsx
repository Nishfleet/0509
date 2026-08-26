import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageTitle = "Five to Nine vs Foreplay Spyder";
const pageDescription =
  "Foreplay Spyder tracks competitor Meta ads and landing pages inside Foreplay. Five to Nine diffs what changed and keeps the source proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/foreplay-spyder");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/foreplay-spyder",
  });

const spyderStrengths = [
  {
    title: "Competitor ads and landing pages, 24/7",
    detail:
      "Foreplay's Spyder product watches a competitor's new Meta ads and landing pages, keeps a desktop and mobile landing-page archive, and sends Slack and email summaries.",
  },
  {
    title: "Sits inside a huge creative library",
    detail:
      "Spyder rides on Foreplay's ad index and swipe-file workflow. If your team already lives in Foreplay for creative research, Spyder is the monitoring add-on in the same house.",
  },
  {
    title: "Agent access on listed plans",
    detail:
      "Foreplay publishes an MCP connector on all plans. That is table stakes in this category, and they already ship it.",
  },
] as const;

const spyderCosts = [
  {
    title: "Archives, does not diff",
    detail:
      "Spyder stores new ads and page captures. Public Foreplay writing describes an archive without a before/after diff on an existing ad or page. You still have to spot what changed.",
  },
  {
    title: "Priced as a creative platform",
    detail:
      "Foreplay's public list prices run from $59 a month (Basic) to $459 (Agency), plus per-user and per-brand add-ons. Spyder is part of that stack, not a $10 monitor. Confirm current plans on Foreplay's site.",
  },
  {
    title: "Creative-first, not proof-first",
    detail:
      "The job Foreplay is best at is swipe files, briefs, and creative research. Source-linked, timestamped evidence of a specific offer or price change is a different job.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Before/after on the commercial fields",
    ours: "We compare each scan to the last one and look for offer, price, CTA, and hook changes, then save the screenshot, the page text, and the original source link.",
  },
  {
    theirs: "Scheduled checks you do not configure per URL",
    ours: "Paid plans check every 3–6 hours. You paste a domain; you do not set a check interval on each landing-page URL.",
  },
  {
    theirs: "Honest scope",
    ours: "We read the Meta Ad Library and the live landing page. We do not aggregate TikTok, Google, or LinkedIn ad libraries, and we do not ship a 200-million-ad swipe file.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does Foreplay Spyder cost?",
    answer:
      "Spyder is part of Foreplay. Public list prices as of August 2026 run from the Basic plan through Agency. Confirm current plans on Foreplay's site. The visible copy on this page cites those figures.",
  },
  {
    question: "Does Foreplay Spyder show what changed?",
    answer:
      "Spyder archives new ads and landing pages. Public Foreplay writing describes that archive without a before/after diff on an existing ad or page. Five to Nine's job is the diff plus saved proof.",
  },
  {
    question: "Should I use Foreplay or Five to Nine?",
    answer:
      "Use Foreplay if you need a creative swipe file and a large multi-platform ad index. Use Five to Nine if you need scheduled, source-backed proof of Meta ad and landing-page changes. Many teams could use both for different jobs.",
  },
] as const;

export default function CompareForeplaySpyderRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/foreplay-spyder",
            comparedProductName: "Foreplay Spyder",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Foreplay Spyder archives competitor ads and pages. Five to Nine diffs what changed.
        </h1>
        <p className="ld-deck-copy">
          Foreplay Spyder watches a competitor's new Meta ads and landing pages on Foreplay plans
          listed from $59 to $459 a month. It is a strong archive. Five to Nine is for the before
          and after, with a source link. Competitor prices on this page are public list prices as of
          August 2026 — check the vendor's site for current plans. For the broader creative-platform
          comparison, see <Link to="/compare/foreplay">Five to Nine vs Foreplay</Link>.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input
            aria-label="Competitor website"
            name="website"
            placeholder="paste-a-competitor-website.com…"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
          />
          <button type="submit">
            Try it free, no account <span aria-hidden="true">→</span>
          </button>
        </Form>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Credit where due</span>
          <h2>What Foreplay Spyder does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spyderStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest trade-off</span>
          <h2>Where an archive differs from a diff.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spyderCosts.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>What Five to Nine adds on top.</h2>
        <div className="ld-how-grid">
          {fiveToNineAdds.map((row, index) => (
            <article key={row.theirs}>
              <span className="ld-step">{String(index + 1).padStart(2, "0")}</span>
              <h3>{row.theirs}</h3>
              <p>{row.ours}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-final">
        <h2>
          Start with the free preview <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no account
          needed. Also see <Link to="/compare/panoramata">Five to Nine vs Panoramata</Link>.
          Questions? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
