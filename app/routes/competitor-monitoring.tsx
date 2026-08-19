import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { demoProof } from "~/lib/demo-proof";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

// Kept under ~155 characters so search results show the whole line instead of
// truncating mid-sentence. Same claims as the homepage, scoped to the category.
const pageDescription =
  "Competitor monitoring software that watches Meta ads and landing pages, then sends screenshot evidence when something changes. Free preview, no account.";

export const links: LinksFunction = () => canonicalLinks("/competitor-monitoring");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Competitor monitoring software | Five to Nine",
    description: pageDescription,
    pathname: "/competitor-monitoring",
  });

// Outside-market claims. Every quote below carries its source URL and the date
// the research desk checked it (2026-08-08); vendor pages change, so each
// claim is scoped to that check, never restated as a standing fact.
const categoryPromises = [
  {
    domain: "panoramata.co — checked 2026-08-08",
    title: "Real-time benchmarks and AI exports",
    detail:
      "Panoramata's Meta-ads page promotes real-time benchmarks, AI/LLM exports, and an MCP use case for their tracking tool.",
    source: "https://www.panoramata.co/track/meta-ads",
  },
  {
    domain: "watchads.io — checked 2026-08-08",
    title: "Daily scans and a permanent creative vault",
    detail:
      "Watch Ads promotes daily scans, new/paused ad detection, landing-page and funnel detection, and permanent Creative Vault storage.",
    source: "https://watchads.io/",
  },
  {
    domain: "pagecrawl.io — 2026-07-25",
    title: "The quiet comparison-page edit",
    detail:
      "PageCrawl's monitoring guide opens with a competitor adding a row to their \u201cBrandX vs You\u201d matrix and marking your product with a red X — the edit nobody was watching for.",
    source: "https://pagecrawl.io/blog/competitor-comparison-alternatives-page-monitoring",
  },
  {
    domain: "octolens.com — 2026-07-30",
    title: "One category, seven jobs",
    detail:
      "Octolens' category roundup argues competitor monitoring is \u201cseven different jobs, not one\u201d — price changes, ads, changelogs, and comparison pages are not the same workflow.",
    source: "https://octolens.com/blog/best-competitor-monitoring-tools",
  },
] as const;

const categoryComplaints = [
  {
    domain: "skopx.com — 2026-07-27",
    title: "Alerts that fire until nobody reads them",
    detail:
      "Skopx's automation guide describes how most competitor monitoring dies: \u201cthe alerts fire constantly, nobody reads them by week three\u201d — and a price cut with no named recipient produces no action.",
    source: "https://skopx.com/resources/automate-competitor-monitoring",
  },
  {
    domain: "flares.tech — 2026-07-28",
    title: "Irrelevant alerts are the shared complaint",
    detail:
      "Flares' study of 500 G2 reviews reports the one complaint shared by every leading competitive-intelligence tool is \u201ctoo many irrelevant alerts.\u201d",
    source: "https://www.flares.tech/guides/competitive-intelligence-with-ai",
  },
] as const;

// Product claims. These trace to shipped behavior already verified on the
// homepage (app/routes/marketing.tsx product FAQ) and the docs — weaker honest
// phrasing beats a stronger claim; nothing here is new.
const wedgePoints = [
  {
    step: "01",
    title: "Built around what changed",
    detail:
      "Offers, prices, CTAs, and landing-page copy. Each confirmed change is saved with screenshots, page text, and links, then summarized in a brief. If you mainly want a large creative library, ours is narrower — the change evidence is deeper.",
  },
  {
    step: "02",
    title: "Quiet is a finding",
    detail:
      "When a field moves you hear about it once, and the same field stays quiet for 48 hours unless it changes again. Quiet periods still send a heartbeat — \u201cAll quiet — 24 ads checked\u201d — so silence always means we looked.",
  },
  {
    step: "03",
    title: "Every claim keeps its source",
    detail:
      "Scheduled checks read the public Meta Ad Library and the public landing pages those ads link to — the same surfaces anyone can open in a browser. No logins, no interaction with competitor accounts, no invented numbers.",
  },
] as const;

// Category FAQ. Rendered on the page AND emitted as FAQPage JSON-LD from this
// same array, so structured data can never drift from visible copy. Every
// answer is verified against shipped behavior (plan-entitlements.ts cadences,
// homepage product FAQ, and the source/freshness limits stated on this page).
export const categoryFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "What is competitor monitoring software?",
    answer:
      "Software that checks your competitors' public surfaces on a schedule and tells you when something changed. Five to Nine watches Meta ads and the landing pages they link to, and sends a brief when a change is confirmed — with the screenshot, page text, and source link.",
  },
  {
    question: "Where does the data come from?",
    answer:
      "Public surfaces only: the Meta Ad Library — the same public archive anyone can open in a browser — plus the public landing pages those ads link to. Five to Nine never logs in to anything and never reads anything behind a login.",
  },
  {
    question: "How is this different from ad-spy tools?",
    answer:
      "Ad-spy tools are built for browsing creatives. Five to Nine is built around what changed: offers, prices, CTAs, and landing-page copy — each confirmed change saved with screenshots, page text, and links, then summarized in a brief. If you mainly want a large creative library, ours is narrower; the change evidence is deeper.",
  },
  {
    question: "How fast will I hear about changes?",
    answer:
      "Paid plans run scheduled checks every 3–6 hours: Scout every 6 hours, Starter every 3 hours, and Agency every 3 hours for its first 25 watchlists with the rest every 6 hours. Starter and Agency can also turn on instant alerts.",
  },
  {
    question: "Are the market claims on this page verified?",
    answer:
      "Yes. Every outside claim carries its source URL and the date we checked it, in the sources section below. Vendor pages change, so each quote is scoped to the date it was checked; product claims are scoped to the live homepage and docs.",
  },
];

export default function CompetitorMonitoringCategoryRoute() {
  const structuredFaq = faqPageJsonLd(categoryFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Competitor monitoring software | Five to Nine",
            description: pageDescription,
            pathname: "/competitor-monitoring",
            dateModified: "2026-08-08",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Category — competitor monitoring software</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Monitoring software that files the proof, not just the pings.
        </h1>
        <p className="ld-deck-copy">
          Most competitor monitoring tools alert you when something appears. Five to Nine
          watches competitors&rsquo; Meta ads and landing pages on a schedule, and when something
          changes it saves the screenshot, the page text, and the link — then files the brief.
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
            Preview available ads <span aria-hidden="true">→</span>
          </button>
        </Form>

        <p className="ld-honest" role="note">
          <strong>No account needed.</strong> The public search preview shows what a monitoring
          check looks like before you decide. Coverage and freshness are labeled and can vary by
          source.
        </p>
      </section>

      <section className="ld-proof">
        <div className="ld-section-head">
          <span className="ld-kicker">The category, sourced</span>
          <h2>What competitor monitoring tools promise.</h2>
          <p>
            These are the vendors&rsquo; own current claims, checked by the research desk on 8
            August 2026 and quoted with their source URLs below.
          </p>
        </div>

        <div className="ld-quiet-grid" aria-label="Competitor monitoring category positioning">
          {categoryPromises.map((item) => (
            <article key={item.title}>
              <span className="ld-kicker">{item.domain}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <p className="ld-trail-note" role="note">
                Source: <a href={item.source}>{item.source}</a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The complaint that keeps coming back</span>
          <h2>Alert noise is the category&rsquo;s open problem.</h2>
          <p>
            The recurring complaint is not missing data — it is alerts nobody acts on. Both
            quotes below are from vendor-published guides and linked in the sources section.
          </p>
        </div>
        <div className="ld-quiet-grid" aria-label="Category complaints with sources">
          {categoryComplaints.map((item) => (
            <article key={item.title}>
              <span className="ld-kicker">{item.domain}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <p className="ld-trail-note" role="note">
                Source: <a href={item.source}>{item.source}</a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>Where Five to Nine sits differently.</h2>
        <div className="ld-how-grid">
          {wedgePoints.map((item) => (
            <article key={item.step}>
              <span className="ld-step">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-proof" id="demo">
        <div className="ld-section-head">
          <span className="ld-kicker">Sample proof</span>
          <h2>What a proof-backed brief looks like.</h2>
          <p>
            The same sample brief the homepage shows, labeled sample. Saved watches attach real
            screenshots, page text, and original links — no proof, no claim.
          </p>
          <div className="ld-proof-actions">
            <Link to="/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com">
              Try the live search preview
            </Link>
            <a href="#faq">Category FAQ</a>
          </div>
        </div>

        <div className="ld-caseboard" aria-label="Sample Five to Nine evidence trail">
          <article className="ld-case-lead">
            <span className="ld-kicker">{demoProof.competitor.market}</span>
            <h3>{demoProof.competitor.name}</h3>
            <p>{demoProof.summary}</p>
          </article>

          <article className="ld-case-card">
            <span className="ld-kicker">Decision summary</span>
            <h4>{demoProof.digestPreview.subject}</h4>
            <p>{demoProof.digestPreview.whyItMatters}</p>
            <dl>
              <div>
                <dt>Proof status</dt>
                <dd>Not available in this sample</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>Sample sources — landing-page snapshot + page text capture</dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>Sample captured at 05:09</dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>{demoProof.digestPreview.recommendedMove}</dd>
              </div>
            </dl>
          </article>

          <article className="ld-case-card">
            <span className="ld-kicker">Source trail</span>
            <ul className="ld-trail">
              {demoProof.proofTrail.map((item) => (
                <li key={item.signal}>
                  <strong>{item.signal}</strong>
                  <p>{item.evidence}</p>
                  <em>{item.source}</em>
                </li>
              ))}
            </ul>
            <p className="ld-trail-note" role="note">
              This sample trail is illustrative — no live captures are attached to this preview.
              Saved watches attach real screenshots, page text, and original links.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="sources">
        <div className="ld-section-head">
          <span className="ld-kicker">Sources and freshness</span>
          <h2>What we checked, when, and where it is.</h2>
          <p>
            Outside-market claims are scoped to the date each source was checked — vendor pages
            change. Product claims are scoped to the live homepage and docs as of 9 August 2026.
          </p>
        </div>
        <div className="ld-quiet-grid" aria-label="Source and freshness limits">
          <article>
            <span className="ld-kicker">Category evidence checked 2026-08-08</span>
            <h3>Each quote keeps its own source link</h3>
            <p>
              Every claim in the two sections above links to the page it came from, with the
              check date on the card. If a vendor changes their page, this page is updated on the
              next research-desk cycle — we do not restate old quotes as standing facts.
            </p>
          </article>
          <article>
            <span className="ld-kicker">Product claims verified 2026-08-09</span>
            <h3>Scoped to the live homepage and docs</h3>
            <p>
              Scheduled cadence, quiet-period behavior, and public-surfaces-only sourcing trace
              to the live <Link to="/">homepage FAQ</Link> and the{" "}
              <Link to="/docs">docs</Link>. Plans and pricing are on the{" "}
              <Link to="/#pricing">pricing section</Link> — prices load in your local currency
              and are never hardcoded here.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Category FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions about this category</h3>
          <dl className="proof-trail-list">
            {categoryFaqEntries.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="ld-final">
        <h2>
          See what a check looks like <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no
          account needed. Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
