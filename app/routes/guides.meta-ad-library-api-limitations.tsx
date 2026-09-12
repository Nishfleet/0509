/**
 * /guides/meta-ad-library-api-limitations — the category's structural
 * factual explainer (issue #3127).
 *
 * Answers the "Meta Ad Library API limitations / coverage" query — the
 * highest-intent research question in the category, asked by the growth
 * marketer weighing API-DIY against a monitoring tool. Unlike the cluster's
 * how-to guides, this page is a cited explainer: every claim about what
 * Meta's API returns carries an inline link to Meta's own documentation,
 * and a "facts checked" line keeps the drift visible (the #3019 cited-facts
 * pattern).
 *
 * The structural fact, verified 2026-09-12 against Meta's own pages: the
 * official Ad Library API returns ads about social issues, elections or
 * politics worldwide (7-year archive), and ads of any type only where they
 * were delivered to the UK or EU during the past year. A commercial
 * competitor ad that never ran in the UK/EU is not in the API's result set
 * at all — so for non-UK/EU commercial monitoring the complementary
 * approach is continuous capture of the public Ad Library surface, which is
 * what the free /search preview reads. Ends in the no-account /search
 * preview (source=guide-api-limitations).
 */

import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  articleJsonLd,
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

import "~/styles/marketing.css";

const PATHNAME = "/guides/meta-ad-library-api-limitations";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-api-limitations` marker (see app/lib/signup-source.ts). No
 * account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-api-limitations";

const pageDescription =
  "What the official Meta Ad Library API actually returns — political and issue ads worldwide for 7 years, and ads of any type only when delivered to the UK or EU during the past year — and what that coverage boundary means for monitoring a competitor's commercial ads anywhere else.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "Meta Ad Library API limitations — what the official API covers, where, and where it quietly stops.";

// The date the guide shipped and the date its sources section states
// ("facts checked 12 September 2026") — the Article entity publishes nothing
// the page does not.
const guideDatePublished = "2026-09-12";
const guideDateModified = "2026-09-12";

/**
 * Meta's own primary sources. Every coverage claim on this page links one of
 * these inline, and the facts-checked note lists all three.
 */
const META_AD_LIBRARY_API_PAGE = "https://www.facebook.com/ads/library/api/";
const META_ADS_ARCHIVE_REFERENCE =
  "https://developers.facebook.com/docs/graph-api/reference/ads_archive/";
const META_AD_LIBRARY_PUBLIC = "https://www.facebook.com/ads/library/";

const coverageFacts = [
  {
    title: "Political and issue ads — worldwide, seven years",
    detail: (
      <>
        Meta&rsquo;s own{" "}
        <a href={META_AD_LIBRARY_API_PAGE} target="_blank" rel="noreferrer">
          Ad Library API page
        </a>{" "}
        states the API covers ads about social issues, elections or politics
        that were delivered anywhere in the world during the past 7 years.
        That set is global — but it is the transparency set, not the
        commercial one.
      </>
    ),
  },
  {
    title: "Ads of any type — only where delivered to the UK or EU",
    detail: (
      <>
        The same{" "}
        <a href={META_AD_LIBRARY_API_PAGE} target="_blank" rel="noreferrer">
          Meta API page
        </a>{" "}
        states ads of any type are covered when they were delivered to the
        United Kingdom or European Union during the past year. That is the
        regulation-driven coverage — the EU&rsquo;s transparency rules, not a
        product decision you can negotiate.
      </>
    ),
  },
  {
    title: "Nothing else — the boundary is documented",
    detail: (
      <>
        The{" "}
        <a href={META_ADS_ARCHIVE_REFERENCE} target="_blank" rel="noreferrer">
          Graph API reference
        </a>{" "}
        marks <code>ad_reached_countries</code> a required parameter and notes
        that ads which did not reach any location in the EU only return if
        they are about social issues, elections or politics. A commercial ad
        that never ran in the UK or EU is not in the result set at all.
      </>
    ),
  },
  {
    title: "A keyword query endpoint, not a feed",
    detail: (
      <>
        Per the{" "}
        <a href={META_ADS_ARCHIVE_REFERENCE} target="_blank" rel="noreferrer">
          reference
        </a>
        , the API searches archived ads by keyword across ad text, images,
        audio from video, and the call-to-action button — it does not
        translate your search terms — or by up to 10 Facebook Page IDs at
        once. There is no &ldquo;watch this domain&rdquo; call; every check is
        a query you write, run, and paginate yourself.
      </>
    ),
  },
] as const;

const gapPoints = [
  {
    title: "A US-only commercial ad does not come back",
    detail:
      "If the competitor's ads ran only outside the UK and EU — the US, India, Brazil, anywhere else — the official API has nothing to return for them unless the ad is about social issues, elections or politics. That is most commercial competitive monitoring.",
  },
  {
    title: "The commercial history is one year deep",
    detail:
      "The any-type coverage window is the past year of UK/EU delivery. The seven-year archive belongs to the political set — a commercial ad from 18 months ago is outside the API's documented coverage even for an EU advertiser.",
  },
  {
    title: "The richer fields only exist inside the covered sets",
    detail: (
      <>
        Meta&rsquo;s{" "}
        <a href={META_AD_LIBRARY_API_PAGE} target="_blank" rel="noreferrer">
          API page
        </a>{" "}
        lists estimated impressions, targeting and reach demographics, and
        advertiser and payer information (EU only) as fields on UK/EU-delivered
        ads, and spend/impression ranges on the political set. An ad outside
        the coverage boundary returns no row to hang those fields on.
      </>
    ),
  },
  {
    title: "A query answers \u201cwhat matches\u201d — never \u201cwhat changed\u201d",
    detail:
      "Even inside the covered sets, the API returns a snapshot of matching ads. Monitoring needs a baseline, a cadence, a diff, and a stored record — four things a query endpoint does not keep for you.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next.
// Every answer is grounded in this page's own cited copy — nothing new
// promised, and the visible FAQ below renders from this same array so
// structured data cannot drift from the page.
export const apiLimitationsFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Does the Meta Ad Library API return all ads?",
    answer:
      "No. Per Meta's own documentation, the API covers ads about social issues, elections or politics delivered anywhere in the world during the past 7 years, and ads of any type only where they were delivered to the UK or EU during the past year. A commercial ad that ran nowhere in the UK or EU is not in the result set.",
  },
  {
    question: "Can the API show a competitor's ads in the US or India?",
    answer:
      "Only if those ads were about social issues, elections or politics, or were also delivered to the UK or EU. A commercial ad targeted only at the US, India, or any other non-UK/EU market does not come back through the official API.",
  },
  {
    question: "How far back does the Ad Library API go?",
    answer:
      "Seven years for ads about social issues, elections or politics, and the past year for ads of any type delivered to the UK or EU — per Meta's API page. For commercial ads there is no documented longer archive.",
  },
  {
    question: "Is the Meta Ad Library API free?",
    answer:
      "The API is reached with a Meta developer access token, and Meta's reference documents no per-query price — the cost is not the binding constraint. The binding constraint is coverage: outside the political set and UK/EU-delivered ads, there is nothing to buy more of.",
  },
  {
    question: "How do I monitor a competitor's commercial ads outside the UK/EU, then?",
    answer:
      "Through the public surface, not the API. Meta's public Ad Library website shows the ads any page is currently running, free and with no account — a monitoring tool reads that surface on a cadence and keeps the dated record the API never builds. The free search preview on this site is one such read: paste the competitor's domain and see its public ad surface now.",
  },
] as const;

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Meta Ad Library API limitations: what it covers and where | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

export default function GuideMetaAdLibraryApiLimitationsRoute() {
  const structuredFaq = faqPageJsonLd(apiLimitationsFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Meta Ad Library API limitations: what it covers and where | Five to Nine",
            description: pageDescription,
            pathname: PATHNAME,
            dateModified: guideDateModified,
          }),
        )}
      />
      <script
        {...jsonLdScriptProps(
          articleJsonLd({
            headline: guideHeadline,
            description: pageDescription,
            pathname: PATHNAME,
            datePublished: guideDatePublished,
            dateModified: guideDateModified,
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Guide — Meta Ad Library API limitations</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          The official Ad Library API is a real API with a hard coverage boundary — and
          the boundary is the part most write-ups skip. This guide states what Meta
          documents it returns, what that means for watching a competitor&rsquo;s
          commercial ads outside the UK and EU, and the approach that covers the gap.
          Every claim links the primary source.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-api-limitations" />
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
            See the public ad surface now <span aria-hidden="true">→</span>
          </button>
        </Form>

        <p className="ld-honest" role="note">
          <strong>No account needed.</strong> The public search preview reads a
          competitor&rsquo;s public ads and the pages they link to from a pasted domain —
          the same public Ad Library surface anyone can open in a browser.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The documented coverage</span>
          <h2>What the official API actually returns.</h2>
          <p>
            Two sets, both quoted from Meta&rsquo;s own pages — and a documented note that
            nothing outside them comes back.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {coverageFacts.map((fact) => (
            <article key={fact.title}>
              <h3>{fact.title}</h3>
              <p>{fact.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest part</span>
          <h2>What that boundary means outside the UK and EU.</h2>
          <p>
            These follow directly from the coverage above — structural properties of the
            API, not effort problems.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {gapPoints.map((point) => (
            <article key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.detail}</p>
            </article>
          ))}
        </div>
        <p className="ld-trail-note" role="note">
          Facts checked 12 September 2026 against Meta&rsquo;s own pages:{" "}
          <a href={META_AD_LIBRARY_API_PAGE} target="_blank" rel="noreferrer">
            facebook.com/ads/library/api
          </a>{" "}
          (the coverage bullets and the UK/EU fields),{" "}
          <a href={META_ADS_ARCHIVE_REFERENCE} target="_blank" rel="noreferrer">
            developers.facebook.com/docs/graph-api/reference/ads_archive
          </a>{" "}
          (the required <code>ad_reached_countries</code> parameter and its EU-only note,
          keyword and page-ID search), and{" "}
          <a href={META_AD_LIBRARY_PUBLIC} target="_blank" rel="noreferrer">
            facebook.com/ads/library
          </a>{" "}
          (the public library of currently running ads).
        </p>
      </section>

      <section className="ld-how">
        <h2>The complementary approach: capture the public surface on a cadence.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>One competitor, one first check, free</h3>
            <p>
              Five to Nine&rsquo;s free plan runs one first check on one competitor — an
              instant read of its public Meta ads and the landing pages they link to —
              and emails the first brief. No card. Recurring checks on a schedule are a
              paid plan.
            </p>
          </article>
          <article>
            <span className="ld-step">02</span>
            <h3>The public library, not the API</h3>
            <p>
              The check reads the{" "}
              <a href={META_AD_LIBRARY_PUBLIC} target="_blank" rel="noreferrer">
                public Meta Ad Library
              </a>{" "}
              — the same page any person can open — which shows currently running
              commercial ads wherever they run, not just the UK/EU set the API
              returns.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>The record the API never builds</h3>
            <p>
              Each check is filed with its date and source link, so the history — what
              ran, what moved, when — exists whether or not Meta&rsquo;s API covers the
              market. The rules are public on{" "}
              <Link to="/capture-rules">the capture-rules page</Link>, and the standing
              guarantee lives at <Link to="/no-phantom-changes">no phantom changes</Link>.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about the Meta Ad Library API&rsquo;s limits</h3>
          <dl className="proof-trail-list">
            {apiLimitationsFaqEntries.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="ld-final">
        <h2>
          Start with the public surface <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the{" "}
          <Link to={guideSearchPreviewPath}>search preview</Link> — no account needed —
          and see the public ad surface the API does not return. Monitoring the library
          by hand instead? Read{" "}
          <Link to="/guides/how-to-monitor-meta-ad-library">
            how to monitor a competitor&rsquo;s Meta Ad Library
          </Link>{" "}
          or{" "}
          <Link to="/guides/how-to-track-competitor-ads">
            how to track competitor ads
          </Link>
          . Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly,
          including &ldquo;the official API covers what you need.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
