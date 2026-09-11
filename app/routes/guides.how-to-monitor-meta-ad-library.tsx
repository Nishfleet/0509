/**
 * /guides/how-to-monitor-meta-ad-library — honest how-to guide (issue #2867).
 *
 * Targets the "how to monitor a competitor's Meta Ad Library" query class —
 * the watch-the-library-over-time intent, distinct from the one-shot "how to
 * track competitor ads" page (issue #2152), which covers the same tool from
 * the tracking angle. One query-intent per page is the established guide
 * unit, so this page covers the recurring-monitoring workflow end to end:
 * find the Ad Library URL, pick a check cadence you will actually keep, log
 * what you saw — then states plainly where monitoring by hand breaks: the
 * active-ads-only view means no history, the country picker changes what you
 * see, interactive gates interrupt an unattended routine, and nobody checks
 * for you when you skip a week.
 *
 * The automated answer is positioned honestly: the free weekly watch (Free
 * plan: one competitor, instant first scan, then a weekly scheduled check and
 * weekly email brief, no card). The CTA is the public /search preview
 * carrying the allowlisted `source=guide-monitor-ad-library` marker — no
 * account needed. Guardrails from the issue: no named competitor tools are
 * disparaged, no multi-platform coverage is claimed (Meta Ad Library only),
 * and the manual method is explicitly stated to be free.
 */

import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  buyerSurfaceHreflangLinks,
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const PATHNAME = "/guides/how-to-monitor-meta-ad-library";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-monitor-ad-library` marker (see app/lib/signup-source.ts). No
 * account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-monitor-ad-library";

const pageDescription =
  "How to monitor a competitor's Meta Ad Library: the free manual routine — find the Ad Library URL, pick a check cadence, log what runs — where it breaks (no history, geo variance, interactive gates), and the free weekly watch that automates it.";

export const links: LinksFunction = () => [
  ...canonicalLinks(PATHNAME),
  ...buyerSurfaceHreflangLinks(PATHNAME.slice(1)),
];

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "How to monitor a competitor's Meta Ad Library | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const manualSteps = [
  {
    title: "Find the Ad Library URL",
    detail:
      "Open the Meta Ad Library in your browser. Pick the country you care about, search the competitor's page name, and bookmark the results page — that URL is your monitoring entry point. It is free, needs no account, and is open to everyone.",
  },
  {
    title: "Choose a check cadence",
    detail:
      "Monitoring is a schedule, not a one-off. Pick a slot you can keep — for most people a fixed Monday session per competitor — and put it in the calendar. The cadence matters more than the tool: a check you skip is a week you cannot reconstruct.",
  },
  {
    title: "Log what is running",
    detail:
      "Each check, screenshot every active ad you care about — creative, copy, CTA — and add one row to a sheet: date checked, what ran, what the landing page said, any price or offer. Comparing this week's rows against last week's by eye is the diff.",
  },
] as const;

const breakPoints = [
  {
    title: "No history — active ads only",
    detail:
      "The Ad Library only shows ads that are active right now. The moment a competitor pauses one, it vanishes — so monitoring from the live view alone means your record only ever holds the weeks you happened to capture. An ad launched and killed between two checks never enters it at all.",
  },
  {
    title: "Locale and geo variance",
    detail:
      "The Ad Library scopes results by the country you select. The same page can run different ads in different countries, and a page you search from one locale's picker may surface a different set than another. Decide which countries you are monitoring and check each one — a single-country bookmark is a single-country view.",
  },
  {
    title: "Interactive gates interrupt the routine",
    detail:
      "The Ad Library is a browser page, and browser pages sometimes interrupt: login or consent prompts, CAPTCHA challenges, and rate limiting can all stand between you and the results. A routine you run by hand absorbs those interruptions; an unattended script or export does not get to skip them.",
  },
  {
    title: "No unattended check",
    detail:
      "Manual monitoring scales linearly with you: two competitors is two weekly sessions, five is five, and the routine stops the week you stop showing up. Nothing watches the library while you are on holiday, and a landing-page change behind an ad — a new price, a swapped CTA — is invisible unless you also open and compare the pages yourself.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const monitorAdLibraryFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Is monitoring a competitor's Meta Ad Library free?",
    answer:
      "Yes, the manual method is free: the Meta Ad Library is a public archive that shows any page's currently running ads, no account needed. What it costs is your time — a recurring check per competitor on a cadence you keep — and whatever weeks you skip are gone.",
  },
  {
    question: "How often should I check a competitor's Ad Library?",
    answer:
      "Often enough that a change you care about does not sit unnoticed for weeks, and realistically: whatever cadence you will actually keep. A fixed weekly session per competitor is the honest baseline. Because the Ad Library only shows active ads, a check you skip leaves a gap you cannot fill later.",
  },
  {
    question: "Does the Ad Library show ads a competitor ran in the past?",
    answer:
      "No. The Ad Library lists ads that are active right now — once a competitor pauses an ad, it disappears from the results. Your history is whatever you captured while the ads ran: screenshots and a dated log. A scheduled watch captures ads while they run, so the record survives the pause.",
  },
  {
    question: "Why do I see different ads for the same competitor?",
    answer:
      "The Ad Library scopes results by the country you select, so the same page can run different ads in different countries. Decide which countries you are monitoring and check each one — a single-country view is exactly that.",
  },
  {
    question: "Can I automate this monitoring myself?",
    answer:
      "Partly. A scraper or workflow can fetch the live results on a timer, but the Ad Library is a browser page with interactive gates — login and consent prompts, CAPTCHA challenges, rate limiting — that an unattended run has to clear, and the live view has no history. Five to Nine's free plan automates one competitor on a weekly schedule, also with no card.",
  },
  {
    question: "Does Five to Nine monitor more than the Meta Ad Library?",
    answer:
      "No. Five to Nine reads the Meta Ad Library only — other platforms' ad libraries are not covered. What it adds on top is the part manual monitoring cannot do: scheduled checks, before/after diffs, saved evidence with source links, and landing-page change detection.",
  },
] as const;

export default function GuideHowToMonitorMetaAdLibraryRoute() {
  const structuredFaq = faqPageJsonLd(monitorAdLibraryFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "How to monitor a competitor's Meta Ad Library | Five to Nine",
            description: pageDescription,
            pathname: PATHNAME,
            dateModified: "2026-09-11",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Guide — how to monitor a competitor&rsquo;s Meta Ad Library</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          How to monitor a competitor&rsquo;s Meta Ad Library — the free routine, and where it breaks.
        </h1>
        <p className="ld-deck-copy">
          Watching a competitor&rsquo;s ads over time is a schedule, not a screenshot. This guide
          walks through the honest manual routine — find the Ad Library URL, pick a cadence, log
          what runs — and the four places monitoring by hand quietly fails.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-monitor-ad-library" />
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
          Library the manual routine below uses. Coverage is the Meta Ad Library only — other
          platforms&rsquo; ad libraries are not included.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The free routine</span>
          <h2>Three steps, repeated on a cadence.</h2>
          <p>
            This method is free — the Ad Library is public and a spreadsheet costs nothing. What
            it costs is the recurring session itself, and for one or two competitors it genuinely
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
          <span className="ld-kicker">The honest part</span>
          <h2>Where manual monitoring breaks.</h2>
          <p>
            None of these are about effort — they are structural properties of watching a
            live-only, browser-based archive by hand.
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
        <h2>The automated answer: a free weekly watch.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>One competitor, watched weekly, free</h3>
            <p>
              Five to Nine&rsquo;s free plan watches one competitor: an instant first scan, then a
              scheduled check every week and a weekly email brief. No card, and the recurring
              library visit stops being your job.
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
              or CTA change behind the ad shows up as a diff — the gap the manual routine and a
              basic scraper both leave open.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about monitoring the Meta Ad Library</h3>
          <dl className="proof-trail-list">
            {monitorAdLibraryFaqEntries.map((entry) => (
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
          what is publicly running before deciding anything. Prefer the one-shot tracking view?
          Read{" "}
          <Link to="/guides/how-to-track-competitor-ads">how to track competitor ads</Link>.
          Questions about coverage on your competitors? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>{" "}
          and we&rsquo;ll answer honestly, including &ldquo;the manual routine is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
