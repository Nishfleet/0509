import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Moving from MagicBrief? Your competitor list can become watchlists in Five to Nine; collections, boards, analytics history, and saved evidence don't transfer. Here's the boundary and the person-to-person fallback.";

export const links: LinksFunction = () => canonicalLinks("/compare/magicbrief");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs MagicBrief | Migration guide",
    description: pageDescription,
    pathname: "/compare/magicbrief",
  });

const transfers = [
  {
    theirs: "Your competitor list",
    ours:
      "One domain, full URL, or brand name per line — pasted or uploaded as .csv/.txt. The setup import turns it into watchlists.",
  },
  {
    theirs: "CSV with the right headers",
    ours:
      "name, website, notes, tags, and client columns map to your watchlists. Unknown columns are never silently dropped — keep your original file as the proof-safe record.",
  },
  {
    theirs: "Watchlists going forward",
    ours:
      "Imported competitors scan on a schedule and save screenshots, page text, and links as evidence inside Five to Nine — the evidence trail starts fresh here.",
  },
] as const;

const notImported = [
  {
    title: "Collections and boards",
    detail:
      "Saved ad libraries, boards, and saved creative evidence — screenshots, saved ads, links — are not portable through the generic competitor import. Five to Nine does not migrate them.",
  },
  {
    title: "Analytics and report history",
    detail:
      "Spend, impressions, reach, charts, and report dates stay in MagicBrief. Keep your original export and recreate any numbers you need in your own reports.",
  },
  {
    title: "Historical screenshots and saved evidence",
    detail:
      "Past screenshots and saved evidence don't carry over. Keep your original file as the record — new watchlist scans start saving fresh evidence from day one.",
  },
  {
    title: "No verified full export contract",
    detail:
      "MagicBrief's wind-down export is partial: per its public FAQ, analytics reports can export CSV while other saved work may require manual recreation. Verify current options at magicbrief.com — a full-field migration is not claimed here.",
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
          Moving from MagicBrief? Bring your competitor list. We&rsquo;ll move the rest with you.
        </h1>
        <p className="ld-deck-copy">
          Five to Nine imports a generic competitor list — domains, URLs, or brand names, pasted
          or as CSV — into watchlists that scan and save fresh evidence. Collections, boards,
          analytics history, and historical screenshots don&rsquo;t transfer automatically: email{" "}
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
          <span className="ld-kicker">The honest boundary</span>
          <h2>What doesn&rsquo;t transfer.</h2>
        </div>
        <div className="ld-quiet-grid">
          {notImported.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
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
          Plan your migration <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> with your MagicBrief export (or just
          a list of brands you tracked) and we&rsquo;ll set up your watchlists with you — person to
          person. Collections, boards, and historical evidence are rebuilt by hand with our help,
          never silently lost. Plans from the <Link to="/#pricing">pricing page</Link> — the public
          search preview stays free either way.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
