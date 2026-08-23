import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Visualping monitors public pages for visual, text, and element changes. Five to Nine is built around competitor ad and landing-page moves with source-backed proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/visualping");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Visualping",
    description: pageDescription,
    pathname: "/compare/visualping",
  });

const visualpingStrengths = [
  {
    title: "Works on any public URL",
    detail:
      "Paste a page and monitor the whole thing or a selected area. Visualping is not tied to any ad library, so any public page is a valid target.",
  },
  {
    title: "Free tier and flexible paid plans",
    detail:
      "Visualping publishes a free plan with limited checks and pages, plus paid plans that add frequency, volume, and team features. Check its pricing page for current limits.",
  },
  {
    title: "Multiple change modes",
    detail:
      "Visual, text, element, and all-in modes let you decide whether to watch pixels, copy, or a specific box on the page.",
  },
  {
    title: "Broad alert stack",
    detail:
      "Email, Slack, Microsoft Teams, webhooks, SMS, and API alerts are available on paid plans; the free plan still gets core notifications.",
  },
] as const;

const visualpingCosts = [
  {
    title: "You configure every page and frequency",
    detail:
      "Monitoring cadence and page volume are priced by checks and pages. Watching many competitor pages at high frequency moves you up the plans.",
  },
  {
    title: "General-purpose, not competitor-specific",
    detail:
      "Visualping tells you that something changed; it does not tie the change to an ad library, a campaign, or a source link. The interpretation is on you.",
  },
  {
    title: "Evidence is fragmented",
    detail:
      "Screenshots and diffs are available, but building a shared, timestamped, source-linked trail for a team takes manual work outside the tool.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Built for competitor ad and landing-page changes",
    ours: "We read the public Meta Ad Library and the live landing page, then diff the parts that matter for growth: offers, prices, CTAs, and hooks.",
  },
  {
    theirs: "Proof, not just alerts",
    ours: "Every change is saved with the screenshot, the page text, and the original source link, so the claim does not depend on a dashboard.",
  },
  {
    theirs: "Scheduled, source-backed briefs",
    ours: "Paid plans check every 3–6 hours and send a daily or weekly email digest. You do not have to configure each URL's check interval.",
  },
  {
    theirs: "Honest status labels",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check.",
  },
] as const;

export default function CompareVisualpingRoute() {
  return (
    <main className="f9-home">
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Visualping</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Visualping catches page changes. Five to Nine captures the competitor move with proof.
        </h1>
        <p className="ld-deck-copy">
          Visualping is a solid website-change monitor. For tracking competitor offers, prices, and
          landing-page moves, the job is slightly different — and we built Five to Nine for that.
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
          <h2>What Visualping does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {visualpingStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest trade-off</span>
          <h2>Where it stops.</h2>
        </div>
        <div className="ld-quiet-grid">
          {visualpingCosts.map((item) => (
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
          Paste a competitor website into the <Link to="/search">search preview</Link> — no account
          needed — and see what is publicly available before deciding anything. Questions about
          coverage? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer
          honestly, including &ldquo;Visualping alone is enough for you.&rdquo;
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
