/**
 * /guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch —
 * honest how-to guide (issue #3093).
 *
 * Targets the "turn a one-off competitor check into a standing watch" query
 * class — the cadence intent: the reader already runs one-off checks (often
 * the free /search preview itself) and wants the same answer on a schedule.
 * Distinct from the monitoring guides (#2867, #2888), which cover watching
 * one source — the Ad Library, or one landing page; this page covers the
 * one-off → standing transition itself: what a watch actually is (baseline +
 * cadence + diff + record) and why a repeated one-off never becomes one.
 *
 * The automated answer is positioned honestly: paste the domain once, the
 * first check is the baseline, and on a paid plan the same check re-runs on
 * a schedule with the brief landing when something moved. Plan truth
 * (plan-entitlements.ts): the Free plan runs one first check on one
 * competitor and emails the one first brief — recurring checks on a schedule
 * are a paid plan, and this page says so plainly rather than implying the
 * free tier is the standing watch. The CTA is the public /search preview
 * carrying the allowlisted `source=guide-standing-watch` marker — no account
 * needed. Guardrails: honest scope (a competitor domain's public ads and the
 * landing pages they link to, not arbitrary URLs), and the manual method is
 * explicitly stated to be free.
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

const PATHNAME =
  "/guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-standing-watch` marker (see app/lib/signup-source.ts). No
 * account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-standing-watch";

const pageDescription =
  "How to turn a one-off competitor check into a standing watch: the recurring by-hand routine, the scheduled-monitor route, why a repeated check never becomes a watch, and the watch that runs itself.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "How to turn a one-off competitor check into a standing watch — the recurring routine, the scheduled tools, and what a watch actually is.";

// The date the guide shipped — the Article entity publishes nothing the page
// does not.
const guideDatePublished = "2026-09-12";
const guideDateModified = "2026-09-12";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "How to turn a one-off competitor check into a standing watch | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const manualSteps = [
  {
    title: "Repeat the check on a fixed slot",
    detail:
      "A standing watch is a cadence, not a tool. Pick a fixed weekly slot per competitor and put it in the calendar — the recurring reminder is the watch. The cadence matters more than the tooling: a check you skip is a week you cannot reconstruct.",
  },
  {
    title: "Keep the baseline from last time",
    detail:
      "Every check compares against your last record, not a blank page. Last week's log — what ran, what the offer said, the price, the CTA — is what turns this week's look into a \u201cchange\u201d instead of a fresh snapshot.",
  },
  {
    title: "Log the delta, not the page",
    detail:
      "Write down what moved — new ad, paused ad, price, offer, CTA — dated. A watch produces a history of moves; a pile of undated snapshots is storage, not a watch.",
  },
] as const;

const monitorSteps = [
  {
    title: "Put the URL on a schedule",
    detail:
      "Page monitors and scrapers run on timers — the \u201cstanding\u201d part is their job. Most publish a free plan with limited checks and paid plans for more frequency.",
  },
  {
    title: "Decide what counts as a move",
    detail:
      "Watched page areas and condition prompts keep the feed to moves that matter — but only aimed right. A condition pointed at the wrong thing silently filters the change you cared about.",
  },
  {
    title: "Keep the record outside the tool",
    detail:
      "A watch history that lives only inside one tool lapses with the subscription. Export the log, or the standing watch leaves you standing nowhere.",
  },
] as const;

const breakPoints = [
  {
    title: "The watch ends the week you do",
    detail:
      "A manual standing watch is a routine, and routines slip — one holiday or one busy week is a gap in the record that never fills. Nothing checks while you are away; that is the whole difference between a routine and a watch.",
  },
  {
    title: "One page is not the competitor",
    detail:
      "A watched pricing page misses the ad that launched, the new landing page the ads moved to, and the offer that changed somewhere you were not watching. A one-off check scoped the surface once; a standing watch has to keep scoping it.",
  },
  {
    title: "A one-off answer and a standing answer are different artifacts",
    detail:
      "The one-off check says what is true now. A watch says what changed — which needs the baseline, the diff, and the stored record. Running the same one-off check again next week produces a second snapshot, not a change record.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const standingWatchFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Is a standing watch on a competitor free?",
    answer:
      "The by-hand routine is free — a weekly calendar slot and a sheet cost nothing but the session itself. Scheduled tools publish free tiers with limited checks. Five to Nine's free plan runs one first check on one competitor and emails the first brief — no card; the recurring checks that make it a standing watch are a paid plan.",
  },
  {
    question: "How is a standing watch different from just checking again?",
    answer:
      "Checking again gives you a second snapshot. A watch keeps four things a single check cannot: a baseline (last time's record), a cadence (the check runs whether or not you remember), a diff (what moved, not what is there), and a stored record you can hand to someone else.",
  },
  {
    question: "What should a standing watch cover?",
    answer:
      "The competitor's commercial surface, not one URL: the public ads they run and the landing pages those ads link to. Watching only the pricing page misses the offer that moved behind a new ad.",
  },
  {
    question: "What happens in a quiet week when nothing changes?",
    answer:
      "Nothing fires — and that is the watch working, not failing. The check ran, the comparison found no move, and the record notes the check. A watch that only speaks when something moved is the point.",
  },
  {
    question: "Can Five to Nine watch any URL on a schedule?",
    answer:
      "No. Five to Nine is built around a competitor domain: it watches that competitor's public Meta ads and the landing pages they link to, not arbitrary URLs on unrelated sites. If the job is one hand-picked page on a timer, a general page monitor fits better; if the job is a competitor's commercial moves, paste the domain into the free preview.",
  },
] as const;

export default function GuideHowToTurnAOneOffCompetitorCheckIntoAStandingWatchRoute() {
  const structuredFaq = faqPageJsonLd(standingWatchFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "How to turn a one-off competitor check into a standing watch | Five to Nine",
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
          <span>Guide — how to turn a one-off competitor check into a standing watch</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          A one-off check tells you what is true today; a standing watch tells you what changed.
          The difference is a baseline, a cadence, a diff, and a record — and there are two honest
          do-it-yourself ways to assemble them. This guide walks through both and where they
          quietly stop being a watch.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-standing-watch" />
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
            Run the one-off check now <span aria-hidden="true">→</span>
          </button>
        </Form>

        <p className="ld-honest" role="note">
          <strong>No account needed.</strong> The public search preview is the one-off check this
          page starts from — it reads a competitor&rsquo;s public ads and the pages they link to
          from a pasted domain.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Method one — free</span>
          <h2>The recurring by-hand routine.</h2>
          <p>
            This method is free — a calendar slot and a sheet cost nothing. What it costs is
            showing up every week, and for one or two competitors it genuinely works. Do it like
            this:
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
          <span className="ld-kicker">Method two — scheduled tools</span>
          <h2>The put-it-on-a-timer route.</h2>
          <p>
            If you would rather a machine did the repeat visits, page monitors and scrapers run on
            schedules — with real limits on what they watch and where the record lives.
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
          <h2>Where a repeated check stops being a watch.</h2>
          <p>
            These are structural properties of standing coverage — not effort problems, and not
            specific to one tool.
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
        <h2>The automated answer: the first check becomes the baseline.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>One competitor, one first check, free</h3>
            <p>
              Five to Nine&rsquo;s free plan runs one first check on one competitor — an instant
              scan of its public Meta ads and the landing pages they link to — and emails the
              first brief. No card. The recurring checks that turn it into a standing watch are a
              paid plan.
            </p>
          </article>
          <article>
            <span className="ld-step">02</span>
            <h3>The schedule is the product</h3>
            <p>
              On a paid plan the same check re-runs on a schedule and compares against the stored
              baseline — so the brief lands when something moved and stays quiet when nothing did.
              Skipped weeks stop being a failure mode because nobody has to show up.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>The record accumulates</h3>
            <p>
              Confirmed changes are filed with page text and the original source link — and pages
              that refuse capture are logged as failed captures, never as changes. The rules are
              public on <Link to="/capture-rules">the capture-rules page</Link>, and the standing
              guarantee lives at <Link to="/no-phantom-changes">no phantom changes</Link>.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about turning a check into a standing watch</h3>
          <dl className="proof-trail-list">
            {standingWatchFaqEntries.map((entry) => (
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
          Start with the one-off check <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the{" "}
          <Link to={guideSearchPreviewPath}>search preview</Link> — no account needed — and that
          first look is the baseline a watch would compare against. Watching one surface by hand
          already? Read{" "}
          <Link to="/guides/how-to-monitor-meta-ad-library">
            how to monitor a competitor&rsquo;s Meta Ad Library
          </Link>{" "}
          or{" "}
          <Link to="/guides/how-to-monitor-competitor-landing-page-changes">
            how to monitor a competitor&rsquo;s landing page changes
          </Link>
          . Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly, including
          &ldquo;the weekly calendar slot is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
