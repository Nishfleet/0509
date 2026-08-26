import { Form, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

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

const pageDescription =
  "MagicBrief alternative: your competitor list imports as watchlists; collections, boards, and analytics history do not transfer. See what moves.";

export const links: LinksFunction = () => canonicalLinks("/compare/magicbrief");

// Wind-down traffic to this page is the blitz's headline capture signal
// (docs/magicbrief-blitz-capture.md). The loader emits the anonymous funnel
// event (default-off, GPC-suppressed, coarse) and, when the sitemap would
// list an indexable brand page, a "See <brand>'s ads" link.
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { emitFunnelMigrationView } = await import("~/lib/funnel-measurement.server");
  const env = getEnv(context);
  emitFunnelMigrationView(env, request);
  const { loadFeaturedAdsInternalLink } = await import("~/lib/ads-internal-links.server");
  return { featuredAdsLink: await loadFeaturedAdsInternalLink(env) };
}

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "MagicBrief alternative: Five to Nine | Migration guide",
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

// Landing from a MagicBrief wind-down search is the highest-intent moment for
// this page. The CTA below is the self-serve migration path: sign up, then the
// setup checklist's competitor import creates the watchlists. The honest
// not-imported boundary (collections, boards, analytics, past evidence) stays
// on this page — a CTA must never read as full migration.
const MIGRATION_SIGNUP_PATH = "/auth/signup?source=magicbrief-migration";

const differences = [
  {
    title: "We monitor changes, not just creatives",
    detail:
      "Five to Nine is built around what changed: offers, prices, CTAs, and landing-page copy — each change saved with page text, the source link, and a screenshot when the capture includes one. If you mainly browsed creative inspiration, our library is narrower and our change evidence is deeper.",
  },
  {
    title: "Receipts for every move",
    detail:
      "Every alert includes the page text and original link, plus a screenshot when the capture includes one, so your team can decide the next move without guessing.",
  },
  {
    title: "Honest limits",
    detail:
      "Meta ads tracking is live on your competitors and gated by a production canary. Results are always marked fresh, recent, or sample.",
  },
] as const;

// FAQ entries answer the searches displaced MagicBrief buyers actually type
// ("MagicBrief alternative", "what happened to MagicBrief"). Every answer is
// grounded in this page's own copy — nothing new promised.
export const magicBriefFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "What happened to MagicBrief?",
    answer:
      "MagicBrief announced its wind-down and closed on 31 July 2026. Teams that tracked ad creatives there are choosing a replacement now — this guide covers what Five to Nine moves for you and what it does not.",
  },
  {
    question: "Is Five to Nine a MagicBrief alternative?",
    answer:
      "For competitor-list migration and change monitoring, yes: your tracked brands import as watchlists, and paid plans check them every 3–6 hours with source-linked proof. For browsing saved creative collections and boards, no — that saved work does not transfer, and Five to Nine's library is narrower and change-focused.",
  },
  {
    question: "What actually moves from MagicBrief?",
    answer:
      "Your tracked brands, pasted or as a CSV, import as watchlists with your notes, tags, and client labels. Collections, boards, analytics history, and past screenshots are not imported — keep your original export as the record.",
  },
  {
    question: "What does switching cost?",
    answer:
      "The public search preview is free and needs no account. The free plan watches one competitor with a weekly brief; paid plans add more competitors, faster checks, and daily briefs — plans and prices are on the pricing page, shown at checkout.",
  },
] as const;

export default function CompareMagicBriefRoute() {
  const structuredFaq = faqPageJsonLd(magicBriefFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "MagicBrief alternative: Five to Nine | Migration guide",
            description: pageDescription,
            pathname: "/compare/magicbrief",
            comparedProductName: "MagicBrief",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
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

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="MagicBrief migration FAQ">
          <span className="ld-kicker">FAQ</span>
          <h2>MagicBrief wind-down questions, answered honestly.</h2>
          <dl className="proof-trail-list">
            {magicBriefFaqEntries.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="ld-final">
        <div className="ld-migration-cta">
          <div>
            <span className="ld-kicker">Start migrating</span>
            <h2>Import your competitor list now.</h2>
            <p>
              Sign up free — no card — and the setup checklist&rsquo;s competitor import turns
              your paste or CSV into watchlists. Collections, boards, analytics history, and past
              evidence are not migrated; you recreate them with our help.
            </p>
          </div>
          <a className="ld-cta-button" href={MIGRATION_SIGNUP_PATH}>
            Start migration <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <section className="ld-final">
        <h2>
          Plan your migration <span aria-hidden="true">→</span>
        </h2>
        <CompareAdsExampleLink />
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
