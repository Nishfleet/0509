import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Pulzifi turns competitor site changes into AI strategic insights delivered to Slack or email. Five to Nine trades AI interpretation for evidence: screenshots, page text, and source links behind every alert.";

export const links: LinksFunction = () => canonicalLinks("/compare/pulzifi");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Pulzifi: competitor change intelligence",
    description: pageDescription,
    pathname: "/compare/pulzifi",
  });

const pulzifiStrengths = [
  {
    title: "AI insights on every change",
    detail:
      "Pulzifi watches competitor sites for pricing, copy, and visual changes and turns each one into a strategic insight — delivered to Slack or email. The 'so what' is front and center.",
  },
  {
    title: "Competitive intelligence framing",
    detail:
      "It is built as a competitive-intelligence product, not a generic diff tool — change summaries and strategic takeaways are first-class, which fits how growth teams actually talk.",
  },
  {
    title: "24/7 automated monitoring",
    detail:
      "Continuous checking across pricing, copy, and visuals means the watching does not depend on anyone remembering to run a scan.",
  },
] as const;

const pulzifiLimits = [
  {
    title: "Insight without a paper trail",
    detail:
      "An AI summary of what a change means is a judgment call — useful, but not proof. When the insight drives a pricing or positioning decision, your team still needs the before/after evidence to stand behind it.",
  },
  {
    title: "Interpretation can outrun the data",
    detail:
      "Strategic reads of a single diff can overstate what a change actually signals. Five to Nine keeps the interpretation with your team and hands them the receipts — screenshots, page text, and the original link.",
  },
  {
    title: "Freshness is stated, not implied",
    detail:
      "We mark every result fresh, recent, or sample — so a quiet competitor and an unverified one never look the same in the feed.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Evidence behind every insight",
    ours: "Confirmed changes are saved with screenshots, page text, and the original source link — the record your team can verify and cite, not just read.",
  },
  {
    theirs: "Watchlists and client structure",
    ours: "Competitors group into watchlists with notes, tags, and client labels — the workspace a team needs when monitoring spans many accounts.",
  },
  {
    theirs: "Briefs on a schedule",
    ours: "Changes arrive as a digest brief — daily on Starter and Agency, weekly on Scout — with instant alerts available on Starter and Agency.",
  },
  {
    theirs: "Honest Meta ads coverage",
    ours: "Meta ads tracking is live on your competitors and gated by a production canary, with results always marked fresh, recent, or sample.",
  },
] as const;

export default function ComparePulzifiRoute() {
  return (
    <main className="f9-home">
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Pulzifi</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Pulzifi tells you what a change means. Five to Nine shows you the change.
        </h1>
        <p className="ld-deck-copy">
          Pulzifi's AI reads competitor changes into strategic insight. Five to Nine saves the
          proof — the screenshot, the page text, and the link — so the insight survives scrutiny.
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
          <h2>What Pulzifi does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {pulzifiStrengths.map((item) => (
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
          <h2>Insight is only as good as its receipts.</h2>
        </div>
        <div className="ld-quiet-grid">
          {pulzifiLimits.map((item) => (
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
          account needed — and see what is publicly available before deciding anything. Want to
          talk through which monitoring shape fits your team? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
