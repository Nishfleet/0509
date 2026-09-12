/**
 * /guides/how-to-monitor-competitor-landing-page-changes — honest how-to
 * guide (issue #2888).
 *
 * Targets the "monitor a competitor's website/landing page changes" query
 * class — the offer/price/CTA watch intent, the half of the product's job
 * the ad-library guides (issues #2152, #2867) do not cover. One query-intent
 * per page is the established guide unit, so this page covers the
 * landing-page change workflow end to end: the do-it-by-hand check, the
 * page-change monitor (paste a URL, write a condition prompt), and where
 * pixel-diff alerting breaks — Visualping's own published number says its AI
 * classifies 83% of detected changes as not important.
 *
 * The automated answer is positioned honestly: the semantic diff — a check
 * reads the commercial fields (headline, offer, price, CTA) instead of
 * comparing pixels, and refuses non-pages via the published capture rules.
 * Plan truth (plan-entitlements.ts, checked against the reviewer round on
 * this issue): the Free plan runs one first check on one competitor and
 * emails the one first brief — recurring checks on a schedule are a paid
 * plan, and this page says so plainly rather than cloning the sibling
 * guides' stale "watched weekly, free" line. The CTA is the public /search
 * preview carrying the allowlisted `source=guide-landing-page-changes`
 * marker — no account needed. Guardrails from the issue: only verified,
 * cited competitor facts (the 83% figure links Visualping's own post), honest
 * scope (a general page monitor watches any URL; Five to Nine watches a
 * competitor's public ads and the landing pages they link to), and the
 * manual method is explicitly stated to be free.
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
const PATHNAME = "/guides/how-to-monitor-competitor-landing-page-changes";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-landing-page-changes` marker (see app/lib/signup-source.ts).
 * No account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-landing-page-changes";

const pageDescription =
  "How to monitor a competitor's landing page changes: the free by-hand check, the URL-and-condition-prompt page monitor, where pixel diffs break (Visualping's own AI calls 83% of detected changes unimportant), and the semantic-diff alternative.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "How to monitor a competitor's landing page changes — the free way, the page-monitor way, and where pixel diffs break.";

// The date the guide shipped and the date its own copy states ("checked 11
// September 2026") — the Article entity publishes nothing the page does not.
const guideDatePublished = "2026-09-11";
const guideDateModified = "2026-09-11";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "How to monitor a competitor's landing page changes | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const manualSteps = [
  {
    title: "Save a dated copy of the page",
    detail:
      "Open the competitor's landing page and keep a dated record — a screenshot, a saved HTML copy, or the visible text pasted into a doc. That first save is your baseline: every later check compares against it.",
  },
  {
    title: "Revisit on a cadence you will keep",
    detail:
      "Monitoring is a schedule, not a one-off. A fixed weekly slot per competitor is the honest baseline — put it in the calendar. A check you skip is a change window you cannot reconstruct.",
  },
  {
    title: "Compare by eye, field by field",
    detail:
      "Line this week's copy up against last week's and look at the fields that carry a commercial move: the headline, the offer, the price, the CTA, the form. Log each difference with its date — that log is your change history.",
  },
] as const;

const monitorSteps = [
  {
    title: "Paste the URL into a page-change monitor",
    detail:
      "Tools in the page-monitoring class take any public URL and check it on a schedule. Most publish a free plan with limited checks and pages, with paid plans for more frequency.",
  },
  {
    title: "Tell it what counts as a change",
    detail:
      "You pick a page area to watch, a check mode (visual, text, or a single element), a pixel threshold — or you write a condition prompt such as \"only flag changes to pricing or product availability\". The monitor emails you a diff when something moves.",
  },
  {
    title: "Read every alert and decide",
    detail:
      "Each alert tells you pixels or text moved — newer monitors add an AI-written summary and an importance flag on top. Whether the move matters to you — a dropped price versus a rotated banner — is still your call, alert by alert.",
  },
] as const;

const breakPoints = [
  {
    title: "Pixel diffs flag noise",
    detail:
      "A screenshot diff cannot tell a banner rotation from a price cut. Visualping's own engineering blog says that, across its platform, its AI classifies 83% of detected changes as not important — banner rotations, cookie popups, timestamps, and layout shifts all look identical to a pixel comparison.",
  },
  {
    title: "The condition prompt is yours to get right",
    detail:
      "The AI filters work only as well as the prompt or page area you wrote for them. A condition aimed at the wrong thing silently filters the change you actually cared about — and you find out weeks later, from the gap in your record.",
  },
  {
    title: "\u201cSomething changed\u201d is not \u201cwhat changed\u201d",
    detail:
      "A pixel or text alert says the page moved; it does not name the move. The commercial read — this was a price drop, that was a swapped CTA — is still manual work you do per alert, per competitor, per week.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const landingPageChangesFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Is monitoring a competitor's landing page free?",
    answer:
      "The by-hand method is free: save a dated copy of the page, revisit on a weekly cadence, compare the headline, offer, price, and CTA yourself. Page-change monitors typically publish a free plan with limited checks and pages. Five to Nine's free plan runs one first check on one competitor and emails the first brief — no card; recurring checks are a paid plan.",
  },
  {
    question: "How often should you check a competitor's landing page?",
    answer:
      "Often enough that a change you care about does not sit unnoticed for weeks — and realistically, whatever cadence you will actually keep. A fixed weekly check per competitor is the baseline; a skipped check is a window you cannot reconstruct later.",
  },
  {
    question: "Why do page monitors alert on changes that do not matter?",
    answer:
      "Because a pixel or text diff cannot tell noise from a move: banner rotations, cookie popups, timestamps, and CDN layout shifts all register as changes. Visualping's own blog says its AI classifies 83% of detected changes as not important — the four noise sources it names are exactly those. A semantic diff compares the commercial fields instead, so a layout shift is not reported as a competitor move.",
  },
  {
    question: "What is the difference between a pixel diff and a semantic diff?",
    answer:
      "A pixel diff compares screenshots or raw text and fires whenever pixels move — it says that something changed. A semantic diff extracts the fields a buyer cares about — headline, offer, price, CTA, form — and fires when one of those changes, so the alert already says what the move was.",
  },
  {
    question: "Can Five to Nine monitor any page URL?",
    answer:
      "No. Five to Nine is built around a competitor domain: it watches that competitor's public Meta ads and the landing pages they link to, not arbitrary URLs on unrelated sites. If the job is watching a single hand-picked page, a general page monitor is the right tool; if the job is a competitor's commercial moves, paste the domain into the free preview.",
  },
] as const;

export default function GuideHowToMonitorCompetitorLandingPageChangesRoute() {
  const structuredFaq = faqPageJsonLd(landingPageChangesFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "How to monitor a competitor's landing page changes | Five to Nine",
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
          <span>Guide — how to monitor a competitor&rsquo;s landing page changes</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          A competitor&rsquo;s landing page is where the offer, the price, and the CTA actually
          move. There are two honest do-it-yourself ways to watch one — checking by hand, and a
          page-change monitor — and one place they both quietly fail. This guide walks through
          all three.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-landing-page-changes" />
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
            See a competitor&rsquo;s live surface now <span aria-hidden="true">→</span>
          </button>
        </Form>

        <p className="ld-honest" role="note">
          <strong>No account needed.</strong> The public search preview reads a competitor&rsquo;s
          public ads and the pages they link to from a pasted domain. It watches a competitor —
          it is not a monitor for arbitrary URLs.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Method one — free</span>
          <h2>The by-hand check.</h2>
          <p>
            This method is free — a browser, a folder of dated saves, and a sheet cost nothing.
            What it costs is the recurring session itself, and for one or two competitors it
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
          <span className="ld-kicker">Method two — a page-change monitor</span>
          <h2>The URL and condition-prompt route.</h2>
          <p>
            If you would rather a machine did the repeat visits, the page-monitoring class of
            tools does exactly that — with real limits and one well-documented weakness.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {monitorSteps.map((step) => (
            <article key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest part</span>
          <h2>Where pixel diffs break.</h2>
          <p>
            These are structural properties of comparing screenshots and raw text — not effort
            problems, and not specific to one tool. The numbers below are the tool&rsquo;s own
            published figures.
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
        <p className="ld-trail-note" role="note">
          The 83% figure is Visualping&rsquo;s own:{" "}
          <a
            href="https://visualping.io/blog/how-visualping-cuts-false-positives"
            target="_blank"
            rel="noreferrer"
          >
            visualping.io/blog/how-visualping-cuts-false-positives
          </a>{" "}
          — &ldquo;across Visualping&rsquo;s platform, the AI classifies 83% of detected changes as
          not important,&rdquo; checked 11 September 2026.
        </p>
      </section>

      <section className="ld-how">
        <h2>The automated answer: a semantic diff.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>One competitor, one first check, free</h3>
            <p>
              Five to Nine&rsquo;s free plan runs one first check on one competitor — an instant
              scan of its public ads and the landing pages they link to — and emails the first
              brief. No card. Recurring checks on a schedule are a paid plan.
            </p>
          </article>
          <article>
            <span className="ld-step">02</span>
            <h3>Fields, not pixels</h3>
            <p>
              Each check reads the landing page&rsquo;s commercial fields — headline, offer, price,
              CTA, form — and a change is a before/after diff on those fields. A rotated banner or
              a shifted layout does not move them, so it is never sold to you as a competitor move.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>Refusals are published</h3>
            <p>
              Error pages, bot walls, cookie walls, and half-rendered shells are recorded as failed
              captures, never as changes — the rules are public on{" "}
              <Link to="/capture-rules">the capture-rules page</Link>, and the standing guarantee
              lives at <Link to="/no-phantom-changes">no phantom changes</Link>.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about monitoring landing page changes</h3>
          <dl className="proof-trail-list">
            {landingPageChangesFaqEntries.map((entry) => (
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
          its public ad and landing-page surface before deciding anything. Watching the ads
          themselves instead? Read{" "}
          <Link to="/guides/how-to-monitor-meta-ad-library">
            how to monitor a competitor&rsquo;s Meta Ad Library
          </Link>
          . Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly, including
          &ldquo;a general page monitor fits your job better.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
