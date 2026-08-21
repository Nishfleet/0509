import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Foreplay is an ad swipe file: save ads from Facebook Ad Library and TikTok Creative Center, organize them into boards, and share with your team. Five to Nine is not a swipe file — it watches competitors for change. Here is the honest difference.";

export const links: LinksFunction = () => canonicalLinks("/compare/foreplay");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Foreplay: ad swipe files vs change monitoring",
    description: pageDescription,
    pathname: "/compare/foreplay",
  });

const foreplayStrengths = [
  {
    title: "The best ad swipe file workflow",
    detail:
      "Foreplay saves ads from Facebook Ad Library and TikTok Creative Center with one click, organizes them into boards, and shares them with your team. If you want a creative inspiration library, it is genuinely well built for that.",
  },
  {
    title: "Team creative workflow",
    detail:
      "Boards, tags, niches, clients, campaigns — Foreplay is designed around how creative teams collect and reuse winning ads, not just bookmarking links.",
  },
  {
    title: "Built on the public ad libraries",
    detail:
      "It reads the same public Facebook and TikTok ad libraries, so the raw material is open and familiar to anyone who has browsed them by hand.",
  },
] as const;

const foreplayLimits = [
  {
    title: "A library is not a watchtower",
    detail:
      "Foreplay is where saved ads live. It does not check competitors on a schedule, diff their pages against last week, or tell you when an offer changed — because it is not trying to be that product.",
  },
  {
    title: "Inspiration, not evidence",
    detail:
      "A saved ad is a bookmark with context. It is not a record of what your competitor changed this week, what the offer said before, or whether the change is live right now.",
  },
  {
    title: "Different job, different shape",
    detail:
      "If your team's workflow is creative inspiration, keep Foreplay. Five to Nine is for the monitoring half of the job: what changed, when, and with what proof — on pages and in Meta ads.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Scheduled change checks",
    ours: "Paid plans check watched competitors every 3–6 hours — visits happen whether or not anyone remembers, and changes surface as alerts, not saved bookmarks.",
  },
  {
    theirs: "Before/after diffs",
    ours: "Each scan is compared against the last one, so you hear when an offer, price, or CTA actually changed — not a re-listing of everything running.",
  },
  {
    theirs: "Saved evidence",
    ours: "Confirmed changes are saved with screenshots, page text, and the original source link, so the claim survives the closed tab and the next sales call.",
  },
  {
    theirs: "Email briefs",
    ours: "Changes arrive as a digest brief — daily on Starter and Agency, weekly on Scout — with instant alerts available on Starter and Agency.",
  },
] as const;

export default function CompareForeplayRoute() {
  return (
    <main className="f9-home">
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Foreplay</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Foreplay is where ads are saved. Five to Nine is how you notice they changed.
        </h1>
        <p className="ld-deck-copy">
          Foreplay is a swipe file for creative inspiration — and a good one. Five to Nine is a
          monitoring workspace: what your competitors changed, when, and with what proof.
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
          <h2>What Foreplay does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {foreplayStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest difference</span>
          <h2>A swipe file is not a monitoring tool.</h2>
        </div>
        <div className="ld-quiet-grid">
          {foreplayLimits.map((item) => (
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
          account needed — and see what is publicly available before deciding anything. If your
          team is happy with Foreplay for inspiration and needs monitoring on top, that is
          exactly the gap Five to Nine fills — email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll tell you honestly whether
          it fits.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
