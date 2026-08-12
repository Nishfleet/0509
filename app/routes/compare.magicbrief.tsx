import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Moving from MagicBrief? Your competitor list imports as watchlists; collections, boards, and analytics history do not transfer. See what moves and how we help you, person to person.";

export const links: LinksFunction = () => canonicalLinks("/compare/magicbrief");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs MagicBrief | Migration guide",
    description: pageDescription,
    pathname: "/compare/magicbrief",
  });

const imports = [
  {
    theirs: "Your tracked brands",
    ours: "A plain list — domains, URLs, or brand names, pasted or as a CSV — imports as watchlists, carrying your notes, tags, and client labels (client rooms on plans with client reporting). That is what transfers.",
  },
  {
    theirs: "Preview before you commit",
    ours: "Paste or upload a .csv or .txt, preview the rows — duplicates and invalid rows are flagged, never silently dropped — then create your watchlists. Keep your original file as the record of what the import carried.",
  },
] as const;

const notImported = [
  {
    title: "Collections and boards",
    detail:
      "MagicBrief's saved ad libraries, boards, and saved creative evidence — screenshots, saved ads, links — do not transfer through the generic import. Five to Nine does not migrate them.",
  },
  {
    title: "Analytics and report history",
    detail:
      "Spend, impressions, reach, charts, and report dates are not imported. Keep your original export and recreate any numbers you need in your own reports.",
  },
  {
    title: "Historical evidence",
    detail:
      "Past screenshots and saved evidence do not carry over, and no full MagicBrief export contract is verified. Keep your original files, and check what MagicBrief lets you export today.",
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
      "Meta ads tracking is live on your competitors and gated by a production canary. Results are always marked fresh, recent, or sample.",
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
          If your current tool is winding down or just winding you up, email{" "}
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
        <h2>What imports.</h2>
        <div className="ld-how-grid">
          {imports.map((row, index) => (
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
          <h2>What does not transfer.</h2>
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
          a list of brands you tracked) and we&rsquo;ll set up your watchlists with you, person to
          person. Collections, boards, analytics history, and past evidence are not migrated by
          Five to Nine — you recreate them with our help. Plans from the{" "}
          <Link to="/#pricing">pricing page</Link> — the public search preview stays free either
          way.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
