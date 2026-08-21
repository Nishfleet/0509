import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Visualping is a general website change detector — Five to Nine is built for competitor offer changes: hooks, prices, CTAs, and landing-page copy, each change saved with screenshots, text, and links.";

export const links: LinksFunction = () => canonicalLinks("/compare/visualping");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Visualping: competitor offer monitoring",
    description: pageDescription,
    pathname: "/compare/visualping",
  });

const visualpingStrengths = [
  {
    title: "Any page, any change",
    detail:
      "Visualping watches any website region you select — prices, stock, jobs, docs, competitors — and emails you when that pixel area changes. It is a genuinely general change detector, and it is good at being that.",
  },
  {
    title: "Fine-grained watch areas",
    detail:
      "You can crop a page down to the exact box you care about, so you are not alerted by the whole page shifting. That precision is real and useful for a single known page.",
  },
  {
    title: "Mature free tier and volume",
    detail:
      "Visualping has a free plan and has been around for years, so it handles personal use and high-volume monitoring at a scale most tools do not match.",
  },
] as const;

const visualpingLimits = [
  {
    title: "A diff, not a decision",
    detail:
      "Visualping tells you a page changed — not what changed, or why it matters. A red 'something moved' email still means opening the page, finding the change yourself, and deciding whether your team needs to act.",
  },
  {
    title: "You write the context",
    detail:
      "You have to know which pages matter, set up each watch area by hand, and keep that list alive. When a competitor swaps their whole landing page, a pixel-diff tool flags noise while the offer change sits in the middle of it.",
  },
  {
    title: "No built-in evidence trail",
    detail:
      "Visualping keeps change history, but it is a tool for pages, not for competitor decisions: screenshots are snapshots of pixels, not a running record of 'here is the offer before, here it is after, here is the proof.'",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Competitor-shaped watching",
    ours: "Five to Nine is built around what changed in offers: hooks, prices, CTAs, and landing-page copy — not pixel boxes. Watchlists are the mental model, not screen coordinates.",
  },
  {
    theirs: "Change evidence, not change alerts",
    ours: "Confirmed changes are saved with screenshots, page text, and the original source link — so the claim survives the closed tab and the next sales call.",
  },
  {
    theirs: "Briefs for the team",
    ours: "Changes arrive as a digest brief — daily on Starter and Agency, weekly on Scout — with instant alerts available on Starter and Agency, so the signal reaches people, not just an inbox.",
  },
  {
    theirs: "Honest Meta ads coverage",
    ours: "Meta ads tracking is live on your competitors and gated by a production canary. Results are always marked fresh, recent, or sample — never presented as more than they are.",
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
          Visualping watches pixels. We watch your competitors&rsquo; offers.
        </h1>
        <p className="ld-deck-copy">
          Visualping is a great change detector for any page. Five to Nine is a
          competitor-monitoring workspace: it checks on a schedule, diffs the actual offer, and
          saves the evidence.
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
          <span className="ld-kicker">Where it falls short for competitor work</span>
          <h2>Pixel alerts are not offer intelligence.</h2>
        </div>
        <div className="ld-quiet-grid">
          {visualpingLimits.map((item) => (
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
          account needed — and see what is publicly available before deciding anything. If
          Visualping genuinely covers your needs, that is a fine answer too; email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll tell you honestly which
          tool fits your case.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
