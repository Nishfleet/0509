import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Moving from MagicBrief? Bring your competitor list — plain domains, URLs, or a CSV — and we set up your watchlists. Collections, boards, and analytics history aren't imported; we'll help you move person to person.";

export const links: LinksFunction = () => canonicalLinks("/compare/magicbrief");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs MagicBrief | Migration guide",
    description: pageDescription,
    pathname: "/compare/magicbrief",
  });

const transfers = [
  {
    theirs: "Competitor lists",
    ours: "Watchlists — paste one domain, URL, or brand name per line, or upload a CSV. We create the watchlists and start tracking changes with screenshots, page text, and links saved as evidence.",
  },
  {
    theirs: "CSV notes, tags, and clients",
    ours: "Import context — the notes, tags, and client columns in your CSV are saved on each watchlist as workspace memory.",
  },
  {
    theirs: "Creative inspiration browsing",
    ours: "Search preview — paste a competitor website and inspect available Meta ads with source and freshness labels, no account needed.",
  },
] as const;

const notImported = [
  {
    title: "Collections and boards",
    detail:
      "Saved ad libraries, boards, and saved creative evidence — screenshots, saved ads, links — aren't portable through the generic competitor import. Five to Nine doesn't migrate them.",
  },
  {
    title: "Analytics and report history",
    detail:
      "Spend, impressions, reach, charts, and report dates aren't imported. Keep your original export and recreate any numbers you need in your own reports.",
  },
  {
    title: "Historical screenshots",
    detail:
      "Past evidence isn't preserved. Going forward, watchlist scans save fresh screenshots, page text, and links as evidence inside Five to Nine.",
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
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Migration guide — MagicBrief → Five to Nine</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Moving from MagicBrief? Bring your competitor list. Gain the receipts.
        </h1>
        <p className="ld-deck-copy">
          A plain competitor list — domains, URLs, or brand names — becomes watchlists that
          save each change with screenshots, page text, and links as evidence. Collections,
          boards, and analytics history don&rsquo;t transfer automatically: email{" "}
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
          <span className="ld-kicker">Not imported</span>
          <h2>What stays in your MagicBrief export.</h2>
        </div>
        <div className="ld-quiet-grid">
          {notImported.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        <p className="ld-pricing-note">
          No full MagicBrief export contract is verified: MagicBrief&rsquo;s export options are
          partial and may require manual recreation, so check what you can download at
          magicbrief.com before you leave.
        </p>
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
          Plan your migration <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> with your MagicBrief export (or just
          a list of brands you tracked) and we&rsquo;ll set up your watchlists with you, person to
          person. Anything the import doesn&rsquo;t carry — collections, boards, historical
          evidence — we&rsquo;ll help you recreate inside Five to Nine. Plans from the{" "}
          <Link to="/#pricing">pricing page</Link> — the public search preview stays free
          either way.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
