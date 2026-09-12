/**
 * /guides/how-to-prove-what-changed-on-a-competitor-website — honest how-to
 * guide (issue #3093).
 *
 * Targets the "prove what changed on a competitor's website" query class —
 * the evidence intent: the reader already suspects a change and needs a
 * dated, source-backed before/after they can put in front of someone else.
 * Distinct from the landing-page-changes guide (issue #2888), which covers
 * detecting that a change happened; this page covers the proof half — the
 * public archive route, your own dated record, where both break as evidence,
 * and what a captured change with its source link actually looks like.
 *
 * The automated answer is positioned honestly: every confirmed change is
 * filed with its evidence — a dated before/after on the commercial fields,
 * the page text, and the original source link — and refused captures are
 * recorded as failed captures, never as changes. Plan truth
 * (plan-entitlements.ts): the Free plan runs one first check on one
 * competitor and emails the one first brief — recurring checks on a schedule
 * are a paid plan, and this page says so plainly. The CTA is the public
 * /search preview carrying the allowlisted `source=guide-prove-what-changed`
 * marker — no account needed. Guardrails: honest scope (Five to Nine watches
 * a competitor domain's public ads and the landing pages they link to, not
 * arbitrary URLs), and the manual method is explicitly stated to be free.
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

const PATHNAME = "/guides/how-to-prove-what-changed-on-a-competitor-website";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-prove-what-changed` marker (see app/lib/signup-source.ts).
 * No account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-prove-what-changed";

const pageDescription =
  "How to prove what changed on a competitor's website: the public archive route, your own dated record, where both break as evidence, and the captured before/after that carries its source link.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "How to prove what changed on a competitor's website — the archive route, your own record, and evidence that survives the change.";

// The date the guide shipped — the Article entity publishes nothing the page
// does not.
const guideDatePublished = "2026-09-12";
const guideDateModified = "2026-09-12";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "How to prove what changed on a competitor's website | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const archiveSteps = [
  {
    title: "Check the public archive first",
    detail:
      "The Wayback Machine keeps dated snapshots of public pages, free to anyone. If it crawled the competitor's page near the change, that snapshot is a third-party dated record — the strongest free proof there is.",
  },
  {
    title: "Keep your own dated captures",
    detail:
      "Where the archive has no snapshot, your own record fills in: a screenshot plus the saved page text, filed with the date you took it. That dated baseline is what every later claim compares against.",
  },
  {
    title: "Write the before/after in your own words",
    detail:
      "One line per move: the field, the old value, the new value, the date first seen. \u201cPrice $49 \u2192 $39, first seen 12 September\u201d is a claim your captures can back; the log is the claim, the captures are the proof.",
  },
] as const;

const monitorSteps = [
  {
    title: "Use a monitor that keeps history",
    detail:
      "Some page-monitoring tools store a timeline of captures you can scroll back through, so the before state exists on their servers instead of only in your folder.",
  },
  {
    title: "Check what the history actually holds",
    detail:
      "A stored screenshot diff shows that pixels moved; the commercial before/after — old price against new, old CTA against new — still has to be read out of it by hand.",
  },
  {
    title: "Export before the subscription lapses",
    detail:
      "A capture history that lives inside one tool is yours only while you can reach it. If the proof might matter later — a pricing dispute, a board deck — keep an exported copy.",
  },
] as const;

const breakPoints = [
  {
    title: "Archive coverage is luck",
    detail:
      "The Wayback Machine crawls popular pages often and quiet ones rarely. The week the offer moved may have no snapshot at all — and a competitor's campaign landing page is exactly the kind of URL the archive visits least.",
  },
  {
    title: "Your folder proves it to you, not to a room",
    detail:
      "A screenshot without the source URL and the capture date is a memory aid, not evidence. In a pricing review or a competitive readout, the proof is the chain — what page, what field, what date, what it says now — not the image alone.",
  },
  {
    title: "A diff is not a record",
    detail:
      "\u201cSomething changed\u201d plus a red-lined screenshot still leaves the commercial read to be reconstructed after the fact: which field, old value, new value. By the time you need the proof, the page has moved on.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const proveWhatChangedFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Is a screenshot enough proof of a competitor's website change?",
    answer:
      "On its own, rarely. A screenshot proves something to the person who took it; for anyone else it needs the chain around it — the source URL, the capture date, the field that moved, and the before value. A dated snapshot from a public archive, or a capture saved with its source link at the time, carries that chain.",
  },
  {
    question: "How far back does the proof go?",
    answer:
      "Only as far as the record. The Wayback Machine reaches whatever it happened to crawl; your own folder reaches whatever you remembered to save; a standing watch reaches the day the watch started — which is why the baseline matters more than any single capture.",
  },
  {
    question: "What if the competitor's page blocks the snapshot?",
    answer:
      "Then there is no honest capture that day, and the right record is a failed capture — not a guessed change. Five to Nine records error pages, bot walls, cookie walls, and half-rendered shells as failed captures on the public capture-rules rules, and never as changes.",
  },
  {
    question: "Does the proof cover the competitor's ads too?",
    answer:
      "Yes. Five to Nine watches a competitor domain's public Meta ads and the landing pages they link to; a confirmed ad change carries its Meta Ad Library source link, and a landing-page change carries the page's own link.",
  },
  {
    question: "Can Five to Nine prove a change on any URL I paste?",
    answer:
      "No. Five to Nine is built around a competitor domain: it watches that competitor's public Meta ads and the landing pages they link to, not arbitrary URLs on unrelated sites. If the job is proving a change on one hand-picked page, the public archive plus your own dated captures is the honest route.",
  },
] as const;

export default function GuideHowToProveWhatChangedOnACompetitorWebsiteRoute() {
  const structuredFaq = faqPageJsonLd(proveWhatChangedFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "How to prove what changed on a competitor's website | Five to Nine",
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
          <span>Guide — how to prove what changed on a competitor&rsquo;s website</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          Knowing a page changed and proving it are different jobs. Proof needs a dated before, a
          dated after, and a chain from the claim back to the source. This guide walks through the
          two honest do-it-yourself routes — the public archive and your own record — and where
          they break as evidence.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-prove-what-changed" />
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
          <h2>The archive plus your own record.</h2>
          <p>
            This method is free — the public archive costs nothing and neither does a folder of
            dated captures. What it costs is the discipline to build the record before you need
            it. Do it like this:
          </p>
        </div>
        <div className="ld-how-grid">
          {archiveSteps.map((step, index) => (
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
          <span className="ld-kicker">Method two — a monitor with history</span>
          <h2>The stored-capture route.</h2>
          <p>
            Some page-monitoring tools keep a timeline of captures on their side, which covers the
            &ldquo;dated before&rdquo; half of the proof — with limits worth knowing before you
            rely on it.
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
          <h2>Where the proof breaks.</h2>
          <p>
            These are structural properties of proving a change after the fact — not effort
            problems, and not specific to one tool.
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
        <h2>The automated answer: every confirmed change filed with its evidence.</h2>
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
            <h3>The before/after is saved at capture time</h3>
            <p>
              Each check reads the commercial fields — headline, offer, price, CTA — and a
              confirmed change is filed with the page text and the original source link attached.
              The proof exists because the watch kept it, not because you remembered to.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>Refusals are on the record too</h3>
            <p>
              Error pages, bot walls, cookie walls, and half-rendered shells are recorded as
              failed captures, never as changes — the rules are public on{" "}
              <Link to="/capture-rules">the capture-rules page</Link>, and the standing guarantee
              lives at <Link to="/no-phantom-changes">no phantom changes</Link>. A proof record is
              only as good as what it refused to claim.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about proving a competitor's website change</h3>
          <dl className="proof-trail-list">
            {proveWhatChangedFaqEntries.map((entry) => (
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
          its public ad and landing-page surface before deciding anything. Need the detection side
          first? Read{" "}
          <Link to="/guides/how-to-monitor-competitor-landing-page-changes">
            how to monitor a competitor&rsquo;s landing page changes
          </Link>
          , or how the capture rules compare against a page monitor in{" "}
          <Link to="/compare/visualping-ad-libraries">Five to Nine vs Visualping</Link>.
          Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly, including
          &ldquo;the archive plus a dated folder is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
