import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { CompareAdsExampleLink } from "~/components/ads-internal-links";
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

export { compareAdsExampleLoader as loader } from "~/lib/ads-internal-links.server";

const pageDescription =
  "The Meta Ad Library is free and public — it's the source Five to Nine reads. What manual checking costs you, and what scheduled checks, diffs, saved screenshots, and email briefs add.";

export const links: LinksFunction = () => canonicalLinks("/compare/meta-ad-library");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs checking the Meta Ad Library by hand",
    description: pageDescription,
    pathname: "/compare/meta-ad-library",
  });

const adLibraryStrengths = [
  {
    title: "Every active ad, free",
    detail:
      "Meta's public Ad Library shows the ads any page is currently running — free, no account, open to everyone. It is a genuinely good research surface.",
  },
  {
    title: "Straight from the source",
    detail:
      "Nothing is filtered through a vendor. You see what Meta publishes about active ads, and it is the same public archive Five to Nine reads for its checks.",
  },
  {
    title: "Enough for a one-off look",
    detail:
      "If you need a single snapshot of one competitor today, open the Ad Library and look. You do not need a tool for that, and we will not pretend you do.",
  },
] as const;

const manualCosts = [
  {
    title: "You have to remember to check",
    detail:
      "The Ad Library only answers when you visit. Competitors change offers on their schedule, not yours — the checks that matter are the ones you forget to run.",
  },
  {
    title: "No memory, no diffs",
    detail:
      "The library shows what is running now, not what changed since Tuesday. Spotting a new hook, a dropped price, or a swapped CTA means keeping the old version in your head.",
  },
  {
    title: "No evidence trail, no alerts",
    detail:
      "Close the tab and the moment is gone — nothing is saved, nothing is timestamped, and nobody is emailed when something moves. Screenshots live in your downloads folder, if you took them.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Scheduled checks",
    ours: "Paid plans check watched competitors every 3–6 hours, so the visits happen whether or not you remember.",
  },
  {
    theirs: "Before/after diffs",
    ours: "Each scan is compared against the last one, so you hear when something actually changed — not a re-listing of everything running.",
  },
  {
    theirs: "Saved evidence",
    ours: "Confirmed changes are saved with page text, the original source link, and a screenshot when the capture includes one, so the claim survives the closed tab.",
  },
  {
    theirs: "Email briefs",
    ours: "Changes arrive as a digest brief — daily on Starter and Agency, weekly on Scout — with instant alerts available on Starter and Agency.",
  },
] as const;

// FAQ entries answer the "vs" and "alternative" searches buyers type for the
// Meta Ad Library ("Is the Meta Ad Library enough?", "Do I need a Meta Ad
// Library alternative?"). Every answer is grounded in this page's own copy —
// the three comparison sections above — nothing new promised.
export const metaAdLibraryFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "What does the Meta Ad Library give you for free?",
    answer:
      "Meta's public Ad Library shows the ads any page is currently running — free, no account, open to everyone. Nothing is filtered through a vendor, and it is the same public archive Five to Nine reads for its checks. It is enough for a one-off look at one competitor today.",
  },
  {
    question: "What are the limits of checking the Meta Ad Library by hand?",
    answer:
      "The Ad Library only answers when you visit, so the checks that matter are the ones you forget to run. It shows what is running now, not what changed since Tuesday, so spotting a new hook, a dropped price, or a swapped CTA means keeping the old version in your head. Close the tab and the moment is gone — nothing is saved, timestamped, or alerted.",
  },
  {
    question: "What does Five to Nine add to the Meta Ad Library?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, so the visits happen whether or not you remember. Each scan is compared against the last one, so you hear when something actually changed. Confirmed changes are saved with page text, the original source link, and a screenshot when the capture includes one, and arrive as a digest brief — daily on Starter and Agency, weekly on Scout — with instant alerts available on Starter and Agency.",
  },
] as const;

export default function CompareMetaAdLibraryRoute() {
  const structuredFaq = faqPageJsonLd(metaAdLibraryFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Five to Nine vs checking the Meta Ad Library by hand",
            description: pageDescription,
            pathname: "/compare/meta-ad-library",
            comparedProductName: "Meta Ad Library",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs checking the Meta Ad Library by hand</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          The Ad Library is free and public. Checking it every day is the expensive part.
        </h1>
        <p className="ld-deck-copy">
          Five to Nine reads the same public Meta Ad Library you can open right now — then does
          the part humans skip: checking on a schedule, diffing against last time, and saving the
          evidence.
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
          <h2>What the Ad Library gives you free.</h2>
        </div>
        <div className="ld-quiet-grid">
          {adLibraryStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The hidden bill</span>
          <h2>What manual checking costs you.</h2>
        </div>
        <div className="ld-quiet-grid">
          {manualCosts.map((item) => (
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
        <CompareAdsExampleLink />
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no
          account needed — and see what is publicly available before deciding anything. Questions
          about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly, including
          &ldquo;the Ad Library alone is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
