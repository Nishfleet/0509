/**
 * /guides/can-ChatGPT-monitor-competitor-ads — the buyer's first-question
 * explainer (issue #3421).
 *
 * Answers the question almost every buyer asks before anything else: "can my
 * AI (ChatGPT/an agent) just check this?" The honest answer has two halves.
 * What an AI chat genuinely does well — summarising what it finds, drafting
 * angles, explaining a diff once someone hands it one. And the three things
 * only an always-on watch owns, stated as structural facts: a plain HTTP
 * client gets a 403 from the Meta Ad Library (re-checked live 13 September
 * 2026 — the #3019 cited-facts pattern keeps that date on the page), the
 * library shows one point in time so history is never in the window, and
 * unattended vigilance needs a system that actually ran at 03:00 — "we
 * checked 24 ads at 03:00 and nothing moved" is a claim only a system that
 * ran can truthfully make.
 *
 * The product is never claimed to be an AI: the AI is the reader's thinking
 * partner, the watch is the product's job. The CTA is the public /search
 * preview carrying the allowlisted lowercase `source=guide-can-chatgpt-monitor-ads`
 * marker (see app/lib/signup-source.ts) — no account needed, and the preview
 * runs before any signup prompt. Guardrails: no named competitor tools are
 * disparaged, no multi-platform coverage is claimed (Meta Ad Library only).
 * The uppercase ChatGPT in the PATH slug is deliberate; only the signup
 * marker is lowercase.
 */

import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { GuideKeepReading } from "~/components/guide-keep-reading";
import {
  articleJsonLd,
  buyerSurfaceHreflangLinks,
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const PATHNAME = "/guides/can-ChatGPT-monitor-competitor-ads";

/**
 * The guide's CTA: the public /search preview with the allowlisted
 * `source=guide-can-chatgpt-monitor-ads` marker (see app/lib/signup-source.ts).
 * No account needed — the preview runs before any signup prompt.
 */
export const guideSearchPreviewPath = "/search?source=guide-can-chatgpt-monitor-ads";

const pageDescription =
  "Can ChatGPT monitor competitor ads? What an AI chat genuinely does well — summarising what it finds, drafting angles, explaining a diff — and the three things only an always-on watch owns: the 03:00 check, the dated record, and the before/after evidence.";

// The visible h1 — also the Article JSON-LD headline, so the structured data
// can never drift from the headline the page renders (issue #2855).
const guideHeadline =
  "Can ChatGPT monitor competitor ads? What an AI chat can do — and what only a standing watch can.";

// The date the guide shipped and the date its own copy states ("re-checked
// 13 September 2026") — the Article entity publishes nothing the page does not.
const guideDatePublished = "2026-09-13";
const guideDateModified = "2026-09-13";

/**
 * The public Ad Library page the 403 fact was re-checked against (the #3019
 * cited-facts pattern: the checked source is linked where the date is stated).
 */
const META_AD_LIBRARY_PUBLIC = "https://www.facebook.com/ads/library/";

export const links: LinksFunction = () => [
  ...canonicalLinks(PATHNAME),
  ...buyerSurfaceHreflangLinks(PATHNAME.slice(1)),
];

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Can ChatGPT monitor competitor ads? | Five to Nine",
    description: pageDescription,
    pathname: PATHNAME,
  });

const aiChatLimits = [
  {
    title: "A plain HTTP client gets a 403",
    detail:
      "A scripted read of the Ad Library is a plain HTTP request — and a plain HTTP client gets a 403 from the Meta Ad Library, re-checked live on 13 September 2026 with curl and a plain user-agent, no browser session. The library is built for people in browsers; a bare script is refused at the door, and any workflow that depends on scripted reads starts behind that wall.",
  },
  {
    title: "One point in time — history is not in the window",
    detail:
      "An AI chat can see what the Ad Library shows it now — the ads running the moment it looks. It has no idea what the offer said on 12 June, or whether it changed since. The Ad Library lists currently running ads; once a competitor pauses one, it is gone, and nothing nobody captured while it ran can be recovered. History is not in the window.",
  },
  {
    title: "Unattended vigilance — somebody has to be there at 03:00",
    detail:
      "A chat session runs when you open it and stops when you close it. Somebody has to be there at 03:00 for the 03:00 check to happen. \u201cWe checked 24 ads at 03:00 and nothing moved\u201d is a claim only a system that actually ran can make — a chat session cannot truthfully make it, because it was not there.",
  },
] as const;

const aiStrengths = [
  {
    title: "Summarising what it finds",
    detail:
      "Hand a chat the ads you captured and it condenses them — the offers running, the tone, the angles worth a second look. Reading and condensing is what these models are genuinely good at.",
  },
  {
    title: "Drafting angles",
    detail:
      "Give it a change and it drafts positioning, counter-copy, and campaign ideas against it in seconds. As a thinking partner for what to do with a change, it earns its keep.",
  },
  {
    title: "Explaining a diff once someone hands it one",
    detail:
      "Show it a before/after and it explains the significance in plain words. But the handoff is the point: someone — or some system — has to produce the diff first. The AI explains; it does not witness.",
  },
] as const;

const watchOwnership = [
  {
    title: "The 03:00 check",
    detail:
      "The check that matters is the one that runs when nobody is looking. It happens because a schedule ran, not because someone remembered to open a tab. Vigilance you have to attend is not vigilance.",
  },
  {
    title: "The dated record",
    detail:
      "Every check is filed with its date, so \u201cwhat changed since last week\u201d has a last week to compare against. Without the dated record there is no before to diff an after from.",
  },
  {
    title: "Before/after evidence with source links",
    detail:
      "A confirmed change is a before/after diff with the page text and the original source link saved — evidence that survives even after an ad is paused and disappears from the Ad Library.",
  },
] as const;

// FAQ entries answer the follow-up searches this query class types next. Every
// answer is grounded in this page's own copy — nothing new promised, and the
// visible FAQ below renders from this same array so structured data cannot
// drift from the page.
export const canChatGPTMonitorCompetitorAdsFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Can ChatGPT check the Meta Ad Library for me?",
    answer:
      "It can see what the Ad Library shows it in the moment it looks — the same currently running ads a person sees in a browser. What it cannot do is fetch the page with a plain script (a plain HTTP client gets a 403 from the Ad Library, re-checked 13 September 2026), and it cannot see anything outside that one moment: what the offer said on 12 June, or whether it changed since, is not in its window.",
  },
  {
    question: "Why does a script get a 403 from the Meta Ad Library?",
    answer:
      "The public Ad Library is served to people in browsers. A plain HTTP request — curl or any bare client with no browser session — is refused with HTTP 403, re-checked live on 13 September 2026. Any monitoring approach that depends on scripted reads of the library starts behind that wall.",
  },
  {
    question: "Can an AI tell me what a competitor's offer said last month?",
    answer:
      "No. The Ad Library shows currently running ads; paused ads disappear, and a chat session only knows what it is shown while it is open. If nobody captured the ad while it ran, there is nothing to go back to — the history was never in the window.",
  },
  {
    question: "Can't I just ask ChatGPT to check my competitor every night?",
    answer:
      "A chat session runs when you open it. There is no night check unless a system runs at night — \u201cwe checked 24 ads at 03:00 and nothing moved\u201d is a claim only a system that actually ran can make. Scheduled vigilance is what a standing watch is for; thinking about what it found is what your AI is for.",
  },
  {
    question: "So what should I use the AI for?",
    answer:
      "Thinking: summarising the ads you captured, drafting angles against a change, explaining a diff once someone hands it one. The capture itself — the 03:00 check, the dated record, the before/after evidence with source links — belongs to an always-on watch, because only a system that ran can prove it ran.",
  },
] as const;

export default function GuideCanChatGPTMonitorCompetitorAdsRoute() {
  const structuredFaq = faqPageJsonLd(canChatGPTMonitorCompetitorAdsFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Can ChatGPT monitor competitor ads? | Five to Nine",
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
          <span>Guide — can ChatGPT monitor competitor ads</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {guideHeadline}
        </h1>
        <p className="ld-deck-copy">
          Asking an AI to check your competitor&rsquo;s ads is a fair question — and the
          honest answer has two halves. Here is what a chat can genuinely do, the three
          things it structurally cannot, and where the always-on watch fits.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input type="hidden" name="source" value="guide-can-chatgpt-monitor-ads" />
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
          <strong>No account needed.</strong> The public search preview reads the same Meta
          Ad Library the manual workflow uses. Coverage is the Meta Ad Library only — other
          platforms&rsquo; ad libraries are not included.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest part</span>
          <h2>Three things an AI chat structurally cannot do.</h2>
          <p>
            None of these are effort problems or prompting problems — they are structural,
            and they hold for any AI chat, however good its model is.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {aiChatLimits.map((point) => (
            <article key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.detail}</p>
            </article>
          ))}
        </div>
        <p className="ld-trail-note" role="note">
          The 403 re-checked 13 September 2026: a plain HTTP request (curl, plain
          user-agent, no browser session) to{" "}
          <a href={META_AD_LIBRARY_PUBLIC} target="_blank" rel="noreferrer">
            facebook.com/ads/library
          </a>{" "}
          returns HTTP 403.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The other half</span>
          <h2>What an AI chat does well.</h2>
          <p>
            The point is not that AI is useless here — the opposite. Used for thinking,
            a chat is genuinely useful. It is the watching it cannot do.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {aiStrengths.map((point) => (
            <article key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The division of labour</span>
          <h2>What only an always-on watch owns.</h2>
          <p>
            Three outputs a chat session cannot truthfully produce — because producing
            them requires a system that actually ran.
          </p>
        </div>
        <div className="ld-quiet-grid">
          {watchOwnership.map((point) => (
            <article key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>Your AI thinks. The watch watches.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>Use your AI for the thinking</h3>
            <p>
              Summarise the ads you captured, draft angles against a change, interrogate a
              diff in plain words. The AI is your thinking partner — that is the role it is
              genuinely good at, and we will never tell you to replace it.
            </p>
          </article>
          <article>
            <span className="ld-step">02</span>
            <h3>Let a standing watch own the vigilance</h3>
            <p>
              Five to Nine&rsquo;s free plan watches one competitor: an instant first scan
              and one first email brief, Meta Ad Library only. No card — and no recurring
              checks or briefs; scheduled checks are a paid plan.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>Hand the evidence to your AI, not the fetching</h3>
            <p>
              Every confirmed change arrives as a before/after diff with page text and the
              original source link — the record survives even after an ad is paused and
              vanishes from the Ad Library. Paste it into your chat and decide what to do.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Guide FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about ChatGPT and competitor ads</h3>
          <dl className="proof-trail-list">
            {canChatGPTMonitorCompetitorAdsFaqEntries.map((entry) => (
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
          See the public ad surface now <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the{" "}
          <Link to={guideSearchPreviewPath}>search preview</Link> — no account needed — and
          see what is publicly running right now. That snapshot is the one thing an AI chat
          can also see; the standing watch is what keeps it. Questions? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly,
          including &ldquo;your AI plus the manual workflow is enough for you.&rdquo;
        </p>
      </section>

      <GuideKeepReading>
        <a href="/guides/how-to-track-competitor-ads">
          How to track competitor ads
        </a>
        <a href="/guides/meta-ad-library-api-limitations">
          Meta Ad Library API limitations
        </a>
      </GuideKeepReading>

      <MarketingFooter />
    </main>
  );
}
