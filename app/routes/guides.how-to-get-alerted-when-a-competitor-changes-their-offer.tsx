/**
 * /guides/how-to-get-alerted-when-a-competitor-changes-their-offer — honest
 * how-to guide (issue #3093).
 *
 * Targets the "get alerted when a competitor changes their offer/price"
 * query class — the alert-as-deliverable intent: the reader wants an email
 * that lands when the offer moves, naming the move. Distinct from the
 * landing-page-changes guide (issue #2888), which covers the detection
 * mechanics (pixel diff vs semantic diff); this page covers the alerting
 * half — where the alert comes from, what it must say to be useful, and why
 * a bare "something changed" firing is homework, not an alert.
 *
 * The automated answer is positioned honestly: the alert that names the
 * field — a check reads the commercial fields (headline, offer, price, CTA)
 * and the brief lands when one moves, with the before/after evidence
 * attached. Plan truth (plan-entitlements.ts): the Free plan runs one first
 * check on one competitor and emails the one first brief — recurring checks
 * on a schedule are a paid plan, and this page says so plainly. The CTA is
 * the public /search preview carrying the allowlisted
 * `source=guide-offer-change-alert` marker — no account needed. Guardrails:
 * only verified, cited competitor facts (the 83% figure links Visualping's
 * own post), honest scope (Five to Nine watches a competitor domain's public
 * ads and the landing pages they link to, not arbitrary URLs), and the
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

const PATHNAME = "/guides/how-to-get-alerted-when-a-competitor-changes-their-offer";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-offer-change-alert` marker (see app/lib/signup-source.ts).
 * No account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-offer-change-alert";

const pageDescription =
  "How to get alerted when a competitor changes their offer: the free by-hand check, the page-monitor alert route, why a bare 'something changed' firing is homework not an alert, and the brief that names the field that moved.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "How to get alerted when a competitor changes their offer — the free way, the monitor way, and the alert that names the move.";

// The date the guide shipped and the date its own copy states ("checked 12
// September 2026") — the Article entity publishes nothing the page does not.
const guideDatePublished = "2026-09-12";
const guideDateModified = "2026-09-12";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "How to get alerted when a competitor changes their offer | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const manualSteps = [
  {
    title: "Find the page where the offer lives",
    detail:
      "The offer — price, discount, CTA, trial terms — sits in a handful of spots: the pricing page, and the landing pages the competitor's ads link to. Pick the pages you would actually check and bookmark them.",
  },
  {
    title: "Set the reminder yourself",
    detail:
      "For the by-hand method, the calendar slot is the alert. A fixed weekly reminder per competitor costs nothing and genuinely works — as long as the check behind it happens.",
  },
  {
    title: "Log the offer fields each visit",
    detail:
      "Each visit, write down the fields: price, discount, CTA, guarantee. When a line differs from last week's line, that dated delta is your alert — in your own words, on your own record.",
  },
] as const;

const monitorSteps = [
  {
    title: "Point a page monitor at the offer",
    detail:
      "Page-monitoring tools watch a URL and email you when it moves. Most publish a free plan with limited checks; a condition prompt such as \"only flag changes to the price or the discount\" narrows the firing to the offer.",
  },
  {
    title: "The alert lands in your inbox",
    detail:
      "The monitor emails you a diff when something moves — newer ones add an AI-written summary and an importance flag. That is the job done, if the alert says what moved.",
  },
  {
    title: "Read each alert against the page",
    detail:
      "Most alerts say that something moved, not what moved. Confirming the firing was the offer — and not a banner rotation or a cookie popup — is still your read, alert by alert.",
  },
] as const;

const breakPoints = [
  {
    title: "\u201cSomething changed\u201d is not the alert you wanted",
    detail:
      "A pixel or text diff fires on any movement and names none of it. \u201cPrice: $49 \u2192 $39, first seen Tuesday\u201d is an alert you can act on; \u201c3% of the page changed\u201d is homework. The commercial read is still yours to do per firing.",
  },
  {
    title: "Noise fires the alert too",
    detail:
      "A screenshot diff cannot tell a banner rotation from a price cut. Visualping's own engineering blog says that, across its platform, its AI classifies 83% of detected changes as not important — an alert stream where most firings are noise teaches you to ignore it.",
  },
  {
    title: "A mis-aimed condition filters silently",
    detail:
      "The AI filters work only as well as the prompt or page area you wrote for them. A condition pointed at the wrong thing classifies the price move away as unimportant — and you find out from the gap in your record, weeks later.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const offerChangeAlertFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Is getting alerted when a competitor changes their offer free?",
    answer:
      "The by-hand method is free: bookmark the pages where the offer lives, keep a weekly reminder, log the offer fields yourself. Page monitors typically publish a free plan with limited checks. Five to Nine's free plan runs one first check on one competitor and emails the first brief — no card; recurring checks on a schedule are a paid plan.",
  },
  {
    question: "What counts as an offer change?",
    answer:
      "The commercial fields a buyer reads: the headline, the offer itself, the price, a discount, the CTA, trial terms, the guarantee. A swapped hero image is decoration; a dropped price or a rewritten trial line is a move.",
  },
  {
    question: "Why does my page monitor alert on things that are not offers?",
    answer:
      "Because a pixel or text diff cannot tell noise from a move: banner rotations, cookie popups, timestamps, and layout shifts all register as changes. Visualping's own blog says its AI classifies 83% of detected changes as not important. A semantic diff compares the commercial fields instead, so a layout shift is not sent to you as a competitor move.",
  },
  {
    question: "Does Five to Nine alert on ad changes too?",
    answer:
      "Yes. A Five to Nine watch reads the competitor's public Meta ads and the landing pages they link to, so a new ad, a paused ad, or an offer, price, or CTA change behind the ad all surface as before/after diffs. It watches a competitor domain — it is not a monitor for arbitrary URLs.",
  },
  {
    question: "How fast does the alert arrive?",
    answer:
      "An alert can only be as fast as the check behind it. Manual methods fire when you remember to look; monitors and watches fire on their check cadence. On Five to Nine the check cadence is set by the plan — the free plan runs the one first check, paid plans keep checking on a schedule.",
  },
] as const;

export default function GuideHowToGetAlertedWhenACompetitorChangesTheirOfferRoute() {
  const structuredFaq = faqPageJsonLd(offerChangeAlertFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "How to get alerted when a competitor changes their offer | Five to Nine",
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
          <span>Guide — how to get alerted when a competitor changes their offer</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          Getting alerted is two jobs: something has to keep checking, and the alert has to say
          what moved. There are two honest do-it-yourself ways to cover the first — a reminder you
          keep, and a page monitor — and one place the second quietly fails. This guide walks
          through all three.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-offer-change-alert" />
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
          <h2>The by-hand alert.</h2>
          <p>
            This method is free — bookmarks, a calendar reminder, and a sheet cost nothing. What
            it costs is the recurring check itself, and for one or two competitors it genuinely
            works. Do it like this:
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
          <span className="ld-kicker">Method two — a page monitor</span>
          <h2>The monitor-emails-you route.</h2>
          <p>
            If you would rather a machine did the repeat visits, the page-monitoring class of
            tools emails you a diff on a schedule — with real limits and one well-documented
            weakness.
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
          <h2>Where the alert breaks.</h2>
          <p>
            These are structural properties of firing on any movement — not effort problems, and
            not specific to one tool. The number below is the tool&rsquo;s own published figure.
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
          not important,&rdquo; checked 12 September 2026.
        </p>
      </section>

      <section className="ld-how">
        <h2>The automated answer: an alert that names the field.</h2>
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
            <h3>The alert names the field</h3>
            <p>
              Each check reads the commercial fields — headline, offer, price, CTA — so the brief
              says which one moved, with the before and the after. A rotated banner does not move
              them, so it is never sent to you as a competitor move.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>Evidence rides the alert</h3>
            <p>
              Confirmed changes are saved with page text and the original source link. Pages that
              refuse capture — error pages, bot walls, half-rendered shells — are recorded as
              failed captures, never as changes: the rules are public on{" "}
              <Link to="/capture-rules">the capture-rules page</Link>, and the standing guarantee
              lives at <Link to="/no-phantom-changes">no phantom changes</Link>.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about getting alerted on offer changes</h3>
          <dl className="proof-trail-list">
            {offerChangeAlertFaqEntries.map((entry) => (
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
          its public ad and landing-page surface before deciding anything. Want the detection
          mechanics behind the alert? Read{" "}
          <Link to="/guides/how-to-monitor-competitor-landing-page-changes">
            how to monitor a competitor&rsquo;s landing page changes
          </Link>
          , or see how the watch compares against the incumbent in{" "}
          <Link to="/compare/visualping-ad-libraries">Five to Nine vs Visualping</Link>.
          Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly, including
          &ldquo;a calendar reminder is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
