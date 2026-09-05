import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  Cite,
  CompareCitationsFooter,
  type CompareCitations,
  type CompareClaimCard,
} from "~/components/compare-citations";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import visualpingAdLibraryCitations from "~/data/compare/visualping-ad-library-citations.json";

const citations = visualpingAdLibraryCitations as CompareCitations;

const pageTitle = "Five to Nine vs Visualping for ad libraries";
const pageDescription =
  "Visualping can watch a Meta Ad Library URL on a free plan and paid check bundles. Five to Nine starts from a domain paste and diffs the commercial fields, not the pixels.";

export const links: LinksFunction = () => canonicalLinks("/compare/visualping-ad-libraries");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/visualping-ad-libraries",
  });

const visualpingStrengths: readonly CompareClaimCard[] = [
  {
    title: "A published Meta Ad Library playbook",
    detail:
      "Visualping has a public guide for monitoring a competitor's Meta Ad Library page: paste the library URL, pick a cadence, and get visual diffs when new ads appear. That playbook is real and well documented.",
    sourceId: "visualping-playbook",
  },
  {
    title: "Free to start, then metered checks",
    detail:
      "Visualping publishes a free plan and paid plans up to $350. Checks are metered and expire monthly. Confirm current limits on Visualping's pricing page.",
    sourceId: "visualping-pricing",
  },
  {
    title: "Visual, text, and element diffs",
    detail:
      "You can watch pixels, copy, or a selected box on the page, with email and other alerts on paid plans. For a single known URL, that is a solid general-purpose monitor.",
    sourceId: "visualping-home",
  },
];

const visualpingCosts: readonly CompareClaimCard[] = [
  {
    title: "You hunt the Ad Library URL yourself",
    detail:
      "The playbook starts by finding and pasting each competitor's Meta Ad Library URL, then writing a condition prompt. Five to Nine starts from a domain paste.",
    sourceId: "visualping-playbook",
  },
  {
    title: "Pixel diffs fire on noise",
    detail:
      "Visualping is a generic URL differ. Banner rotation, cookie popups, timestamps, and layout shift all look like changes. Visualping's own writing says most detected changes are not important, and that false positives will never reach zero.",
    sourceId: "visualping-false-positives",
  },
  {
    title: "The interpretation is on you",
    detail:
      "A green highlight on a new ad is useful. It does not name the offer, the price, or the CTA, and it does not store a source-linked commercial-field trail.",
  },
];

const fiveToNineAdds = [
  {
    theirs: "Domain paste, not URL hunting",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain. You do not have to find the library URL or write a condition prompt.",
  },
  {
    theirs: "Semantic diff on the commercial fields",
    ours: "We look for offer, price, CTA, and hook changes — not a pixel box turning green. Each confirmed change is saved with the page text, the original source link, and a screenshot when the capture includes one.",
  },
  {
    theirs: "No phantom-change theatre",
    ours: "We do not claim every render failure is gone. We do label results live, recent, delayed, or sample, and we do not present a stale snapshot as a fresh check. A partial load is not sold as a competitor move.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Can Visualping monitor the Meta Ad Library?",
    answer:
      "Yes. Visualping publishes a playbook for watching a competitor's Meta Ad Library URL with visual diffs. You find and paste that URL yourself and set a condition prompt.",
  },
  {
    question: "How much does Visualping cost?",
    answer:
      "Visualping publishes a free plan and paid plans metered in checks that expire monthly. Confirm current plans on Visualping's site. The visible copy on this page cites the listed range.",
  },
  {
    question: "Why would I use Five to Nine instead?",
    answer:
      "Five to Nine starts from a domain paste, diffs offer, price, CTA, and hook fields, and labels results honestly. Use Visualping if you already have the Ad Library URL and want a generic page monitor. Use Five to Nine if you want the commercial change with proof.",
  },
] as const;

export default function CompareVisualpingAdLibraryRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/visualping-ad-libraries",
            comparedProductName: "Visualping",
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
          Visualping can watch a Meta Ad Library URL. Five to Nine starts from a domain paste.
        </h1>
        <p className="ld-deck-copy">
          Visualping's Meta Ad Library playbook is real: paste the library URL, get visual diffs,
          on plans from free to $350. Five to Nine is the other job — domain paste, commercial-field
          diffs, and honest status labels so a phantom render is not sold as a competitor move.
          Competitor prices on this page are public list prices as of August 2026 — check the vendor's site for current plans.
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
          <h2>What Visualping's ad-library playbook does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {visualpingStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>
                {item.detail}
                {item.sourceId ? <Cite citations={citations} id={item.sourceId} /> : null}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest trade-off</span>
          <h2>Where a URL differ stops.</h2>
        </div>
        <div className="ld-quiet-grid">
          {visualpingCosts.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>
                {item.detail}
                {item.sourceId ? <Cite citations={citations} id={item.sourceId} /> : null}
              </p>
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
          needed. Also see{" "}
          <Link to="/compare/meta-ad-library">checking the Meta Ad Library by hand</Link>. Questions?
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly, including
          &ldquo;Visualping's playbook is enough for you.&rdquo;
        </p>
      </section>

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
