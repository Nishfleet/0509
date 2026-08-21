import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "SpyLand tracks competitor landing-page URLs and uses AI to explain what changed. Five to Nine adds watchlists, saved change evidence, and honest Meta ads coverage — here is how the two compare.";

export const links: LinksFunction = () => canonicalLinks("/compare/spyland");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs SpyLand: competitor landing-page monitoring",
    description: pageDescription,
    pathname: "/compare/spyland",
  });

const spylandStrengths = [
  {
    title: "Dead-simple setup",
    detail:
      "Add competitor landing-page URLs, SpyLand checks them automatically, and the AI tells you what changed and why it might matter. The low-friction loop is genuinely well designed.",
  },
  {
    title: "AI change explanations",
    detail:
      "Instead of a raw diff, you get a plain-language read of what moved — useful when you just need a quick answer about one page.",
  },
  {
    title: "Focused on landing pages",
    detail:
      "SpyLand is built specifically around landing pages, so the product does not try to be everything. That focus is a real strength.",
  },
] as const;

const spylandLimits = [
  {
    title: "AI guesses are not evidence",
    detail:
      "An AI explanation of why a competitor changed something is a hypothesis, not proof. Five to Nine's answer to 'why' is a screenshot, the page text, and the source link — the record of what actually changed, so your team can verify before acting.",
  },
  {
    title: "Landing pages only",
    detail:
      "SpyLand watches landing-page URLs. Offer changes also happen in Meta ads, and Five to Nine tracks those too — with the same honest freshness markers on every result.",
  },
  {
    title: "No watchlist workspace",
    detail:
      "SpyLand keeps your competitor list simple, but a growing team also needs labels, client grouping, collections, and briefs — the workspace Five to Nine organizes monitoring into.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Watchlists, not just URLs",
    ours: "Competitors group into watchlists with notes, tags, and client labels — the structure a team needs as the list grows past a spreadsheet.",
  },
  {
    theirs: "Evidence over explanation",
    ours: "Confirmed changes are saved with screenshots, page text, and the original source link. The 'why' is left to your team, with the receipts in hand.",
  },
  {
    theirs: "Briefs that land",
    ours: "Changes arrive as a digest brief — daily on Starter and Agency, weekly on Scout — with instant alerts available on Starter and Agency.",
  },
  {
    theirs: "Meta ads coverage",
    ours: "Meta ads tracking is live on your competitors and gated by a production canary, with results always marked fresh, recent, or sample.",
  },
] as const;

export default function CompareSpylandRoute() {
  return (
    <main className="f9-home">
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs SpyLand</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          SpyLand explains changes. Five to Nine proves them.
        </h1>
        <p className="ld-deck-copy">
          SpyLand's AI tells you what changed and why. Five to Nine saves the evidence — the
          screenshot, the page text, and the link — so the claim survives the meeting.
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
          <h2>What SpyLand does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spylandStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Where we differ</span>
          <h2>Explanations are not receipts.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spylandLimits.map((item) => (
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
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no
          account needed — and see what is publicly available before deciding anything. Questions
          about how either tool fits your workflow? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
