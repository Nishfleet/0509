import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Moving from MagicBrief? What transfers to Five to Nine, what's different, and how to migrate your collections and watchlists in an afternoon.";

export const links: LinksFunction = () => canonicalLinks("/compare/magicbrief");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs MagicBrief | Migration guide",
    description: pageDescription,
    pathname: "/compare/magicbrief",
  });

const transfers = [
  {
    theirs: "Saved ad library and boards",
    ours: "Collections — save winning ads with notes and tags, share with clients",
  },
  {
    theirs: "Brand tracking",
    ours: "Watchlists — regular checks with screenshots, page text, and links saved as evidence",
  },
  {
    theirs: "Creative inspiration browsing",
    ours: "Search preview — paste a competitor website and inspect available Meta ads with source and freshness labels, no account needed",
  },
] as const;

const differences = [
  {
    title: "We monitor changes, not just creatives",
    detail:
      "Five to Nine is built around what changed: offers, prices, CTAs, and landing-page copy — each change saved with screenshots, text, and links. If you mainly browsed creative inspiration, our library is narrower and our change evidence is deeper.",
  },
  {
    title: "Receipts for every move",
    detail:
      "Every alert includes the screenshot, page text, and original link, so your team can decide the next move without guessing.",
  },
  {
    title: "Honest limits",
    detail:
      "Meta ads tracking is labeled beta until it is reliable on your competitors. Results are always marked fresh, recent, or sample.",
  },
] as const;

export default function CompareMagicBriefRoute() {
  return (
    <main className="f9-home">
      <header className="ld-nav">
        <Link className="ld-brand" to="/" aria-label="Five to Nine home">
          <BrandWordmark />
        </Link>
        <nav className="ld-nav-links" aria-label="Primary">
          <Link to="/search?website=https%3A%2F%2Fnykaa.com">Search preview</Link>
          <Link to="/#pricing">Pricing</Link>
        </nav>
        <nav className="ld-nav-actions" aria-label="Account">
          <Link className="f9-link-arrow" to="/auth/login">
            Sign in
          </Link>
          <Link className="ld-nav-pill" to="/auth/signup">
            Create account
          </Link>
        </nav>
      </header>

      <section className="ld-hero">
        <p className="ld-case">
          <span>Migration guide — MagicBrief → Five to Nine</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Moving from MagicBrief? Bring your saved work. Gain the receipts.
        </h1>
        <p className="ld-deck-copy">
          If your current tool is winding down or just winding you up, your collections and
          watchlists set up here in an afternoon — email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll help you move, person to
          person.
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

      <section className="ld-how">
        <h2>What transfers.</h2>
        <div className="ld-how-grid">
          {transfers.map((row, index) => (
            <article key={row.theirs}>
              <span className="ld-step">{String(index + 1).padStart(2, "0")}</span>
              <h3>{row.theirs}</h3>
              <p>{row.ours}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest differences</span>
          <h2>Not a clone. A different bet.</h2>
        </div>
        <div className="ld-quiet-grid">
          {differences.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-final">
        <h2>
          Migrate in an afternoon <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> with your MagicBrief export (or just
          a list of brands you tracked) and we&rsquo;ll set up your collections and watchlists with
          you. Plans from the <Link to="/#pricing">pricing page</Link> — the public search preview stays free
          either way.
        </p>
      </section>

      <footer className="ld-footer">
        <Link className="ld-footer-brand" to="/" aria-label="Five to Nine home">
          <BrandWordmark meta="Market intelligence" />
        </Link>
        <p>Five to Nine helps teams see competitor offer and landing-page changes before the next sales call.</p>
        <nav aria-label="Footer">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        </nav>
      </footer>
    </main>
  );
}
