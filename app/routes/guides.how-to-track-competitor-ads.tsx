/**
 * /guides/how-to-track-competitor-ads — honest how-to guide (issue #2152).
 *
 * Targets the "how to track competitor ads" query class. The page lays out
 * the two do-it-yourself ways people actually do this — the free manual
 * Monday workflow (Meta Ad Library + screenshots + a sheet) and the n8n/Apify
 * DIY automation route with the real Apify price cited — then states plainly
 * where both break: inactive ads disappear from the Ad Library, skipped weeks
 * leave permanent gaps, and neither shows a landing-page diff.
 *
 * The automated answer is positioned honestly: the free first check (Free
 * plan: one competitor, instant first scan, one first brief, no card —
 * recurring checks and briefs are paid). The CTA is the public /search preview
 * carrying the allowlisted `source=guide_track_ads` marker — no account
 * needed. Guardrails from the issue: no named competitor tools are
 * disparaged, no multi-platform coverage is claimed (Meta Ad Library only),
 * and the manual method is explicitly stated to be free.
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

const PATHNAME = "/guides/how-to-track-competitor-ads";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide_track_ads` marker (see app/lib/signup-source.ts). No account
 * needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide_track_ads";

const pageDescription =
  "How to track competitor ads: the free manual Ad Library workflow, the n8n or Apify DIY route with real prices, where both break, and the free first check that automates it.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "How to track competitor ads: the free way, the DIY way, and where both break.";

// The date the guide shipped and the date its own copy states ("checked 9
// September 2026") — the Article entity publishes nothing the page does not.
const guideDatePublished = "2026-09-09";
const guideDateModified = "2026-09-09";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "How to track competitor ads | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const manualSteps = [
  {
    title: "Open the Meta Ad Library",
    detail:
      "Go to the Ad Library, pick a country, and search the competitor's page name. It shows the ads that page is currently running — free, no account, open to everyone.",
  },
  {
    title: "Screenshot what is running",
    detail:
      "Capture each active ad you care about — creative, copy, and CTA — and save the screenshots somewhere you will actually find them next week.",
  },
  {
    title: "Log it in a sheet",
    detail:
      "One row per ad: date checked, what ran, what the landing page said, any price or offer. Next Monday, do it again and compare against last week's rows by eye.",
  },
] as const;

const diyOptions = [
  {
    title: "n8n, self-hosted",
    detail:
      "A scheduled n8n workflow can fetch a page or hit a scraping API on a timer and append results to a sheet or database. n8n itself is free to self-host; you supply the server, the scraper, and the maintenance.",
  },
  {
    title: "Apify actors",
    detail:
      "Apify sells hosted scrapers (\u201cactors\u201d), including ones that read the Ad Library. The free tier includes $5 of platform usage a month; paid plans start at $29/month (Starter), checked 9 September 2026 on apify.com/pricing. Many store actors also charge per result on top of the plan.",
  },
  {
    title: "What you still build yourself",
    detail:
      "Both give you raw captures. Turning captures into \u201cwhat changed since last week\u201d — storage, before/after diffing, and an alert when something moves — is yours to write and to keep running.",
  },
] as const;

const breakPoints = [
  {
    title: "Inactive ads disappear",
    detail:
      "The Ad Library only shows ads that are active right now. The moment a competitor pauses one, it vanishes — so if you did not capture it while it ran, it is gone. A manual sheet only ever holds the weeks you remembered to save.",
  },
  {
    title: "Skipped weeks are permanent gaps",
    detail:
      "The Monday routine depends on you showing up every Monday. One holiday or one busy week is a hole in the record, and an ad launched and killed inside that gap never enters your sheet at all.",
  },
  {
    title: "No landing-page diff",
    detail:
      "The Ad Library shows the ad, not the page it links to. A dropped price, a swapped CTA, or a rewritten offer on the landing page is invisible to the manual workflow and to a basic scraper unless you also snapshot and diff the pages yourself.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const trackAdsFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Is tracking competitor ads free?",
    answer:
      "Yes, the manual method is free: the Meta Ad Library is a public archive that shows any page's currently running ads, and a spreadsheet costs nothing. What it costs is your time — roughly a weekly session per competitor — and whatever weeks you forget are gone. Five to Nine's free plan automates one competitor with a first check and a first brief, also with no card — recurring scheduled checks are paid.",
  },
  {
    question: "What happens when a competitor pauses an ad?",
    answer:
      "It disappears from the Meta Ad Library, which only lists active ads. If you did not screenshot or save it while it was running, there is nothing to go back to. A scheduled watch captures ads while they run, so the record survives the pause.",
  },
  {
    question: "Can I automate this myself with n8n or Apify?",
    answer:
      "Yes. A self-hosted n8n workflow on a schedule, or an Apify actor that reads the Ad Library, both work. Apify's free tier includes $5 of monthly usage and paid plans start at $29/month (Starter), checked 9 September 2026 on apify.com/pricing — and many actors add per-result fees. Either way you still build and maintain the storage, the before/after diffing, and the alerting yourself.",
  },
  {
    question: "Does Five to Nine track ads on more than one platform?",
    answer:
      "No. Five to Nine reads the Meta Ad Library only — other platforms' ad libraries are not covered. What it adds on top is the part the manual workflow cannot do: scheduled checks, before/after diffs, saved evidence with source links, and landing-page change detection.",
  },
] as const;

export default function GuideHowToTrackCompetitorAdsRoute() {
  const structuredFaq = faqPageJsonLd(trackAdsFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "How to track competitor ads | Five to Nine",
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
          <span>Guide — how to track competitor ads</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          There are two honest do-it-yourself ways to track a competitor&rsquo;s ads — a manual
          weekly routine that costs nothing but your time, and a self-built automation. This guide
          walks through both, what they really cost, and the three places they quietly fail.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide_track_ads" />
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
            See a competitor&rsquo;s ads now <span aria-hidden="true">→</span>
          </button>
        </Form>

        <p className="ld-honest" role="note">
          <strong>No account needed.</strong> The public search preview reads the same Meta Ad
          Library the manual workflow below uses. Coverage is the Meta Ad Library only — other
          platforms&rsquo; ad libraries are not included.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Method one — free</span>
          <h2>The manual Monday workflow.</h2>
          <p>
            This method is free — the Ad Library is public and a spreadsheet costs nothing. What
            it costs is roughly a weekly session per competitor, and for one or two competitors it
            genuinely works. Do it like this:
          </p>
        </div>
        <div className="ld-how-grid">
          {manualSteps.map((step, index) => (
            <article key={step.title}>
              <span className="ld-step">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Method two — DIY automation</span>
          <h2>The n8n or Apify route.</h2>
          <p>
            If you would rather a machine did the Monday visit, both are real options — with real
            prices and real upkeep.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {diyOptions.map((option) => (
            <article key={option.title}>
              <h3>{option.title}</h3>
              <p>{option.detail}</p>
            </article>
          ))}
        </div>
        <p className="ld-trail-note" role="note">
          Apify pricing source:{" "}
          <a href="https://apify.com/pricing" target="_blank" rel="noreferrer">
            apify.com/pricing
          </a>{" "}
          — free tier $0 with $5 of monthly usage, Starter $29/month, checked 9 September 2026.
          Prices change; check the page before budgeting.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest part</span>
          <h2>Where both methods break.</h2>
          <p>
            Neither failure is about effort — they are structural, and they hit the free manual
            workflow and the DIY build alike.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {breakPoints.map((point) => (
            <article key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>The automated answer: a free first check and brief.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>One competitor, free: one first check, one first brief</h3>
            <p>
              Five to Nine&rsquo;s free plan watches one competitor: an instant first scan and one
              first email brief, Meta Ad Library only. No card — and no recurring checks or briefs;
              scheduled checks and recurring briefs are a paid plan.
            </p>
          </article>
          <article>
            <span className="ld-step">02</span>
            <h3>The record survives the pause</h3>
            <p>
              Each scan is compared against the last, so a change is a before/after diff — not a
              re-listing of everything running. Confirmed changes are saved with page text and the
              original source link, so the evidence survives even after an ad is paused and
              disappears from the Ad Library.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>The landing page is watched too</h3>
            <p>
              Scheduled checks read the public landing pages the ads link to, so an offer, price,
              or CTA change behind the ad shows up as a diff — the gap the manual workflow and a
              basic scraper both leave open.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about tracking competitor ads</h3>
          <dl className="proof-trail-list">
            {trackAdsFaqEntries.map((entry) => (
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
          Start with the free preview <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the{" "}
          <Link to={guideSearchPreviewPath}>search preview</Link> — no account needed — and see
          what is publicly running before deciding anything. Questions about coverage on your
          competitors? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer
          honestly, including &ldquo;the manual method is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
