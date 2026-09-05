import { Form, Link, useLoaderData, useLocation } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import { BrowseTrackedCompetitors } from "~/components/ads-internal-links";
import type { AppEnv } from "~/lib/env.server";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import type { PublicProofBrief } from "~/lib/public-proof.server";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import { SWITCH_PAGES, SWITCH_SLUGS } from "~/lib/switch-pages";
import { localeSearchPathname } from "~/lib/locale-markets";

const publicSearchTrialPath =
  "/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com";

// Real-proof loader. Renders the featured competitor's real captures from the
// discovery cache only (never a sample fixture and never a live scrape). When
// no usable real cache exists the page renders the honest "no live proof yet"
// state instead of inventing evidence.
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const { getOptionalCloudflareContext } = await import("~/lib/cloudflare-context");
  const env: AppEnv = getEnv(context);
  // Same visitor-country resolution as the /ads/:domain loader so this
  // public proof-brief surface reads the SAME cache row its linked brand
  // pages read (issue 1468): never different totals for the same brand on
  // the same day.
  const visitorCountry = defaultCountryForVisitor(
    getOptionalCloudflareContext(context)?.country ?? request.headers.get("cf-ipcountry"),
  );

  let proofBrief: PublicProofBrief | null = null;
  try {
    const { loadPublicProofBrief } = await import("~/lib/public-proof.server");
    proofBrief = await loadPublicProofBrief(env, { visitorCountry });
  } catch (error) {
    // A cache-read hiccup degrades to the honest state, never a 500 and
    // never a sample fixture.
    console.warn(
      "Competitor-monitoring proof brief load failed; rendering the honest state.",
      { errorName: error instanceof Error ? error.name : typeof error },
    );
    proofBrief = null;
  }

  let indexableAdsLinks: IndexableAdsLink[] = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import("~/lib/ads-internal-links.server");
    indexableAdsLinks = await loadIndexableAdsInternalLinks(env);
  } catch (error) {
    console.warn(
      "Competitor-monitoring indexable ads links load failed; omitting /ads links.",
      { errorName: error instanceof Error ? error.name : typeof error },
    );
    indexableAdsLinks = [];
  }

  return { proofBrief, indexableAdsLinks };
}

function proofTimeLabel(iso: string | null | undefined): string {
  const raw = iso?.trim();
  if (!raw) {
    return "recently";
  }
  // Date-only Meta Ad Library captures carry no time of day; rendering them
  // as a clock would fabricate "12:00 AM". Show the calendar date instead.
  // timeZone: "UTC" is required because new Date("YYYY-MM-DD") is UTC midnight
  // and a local timezone behind UTC would otherwise shift the date back a day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return "recently";
    }
    // A capture from a prior (or, defensively, future) UTC year must carry
    // its year so "Sep 4" cannot read as a recent or upcoming same-year date
    // for a year-old capture. Same-year dates keep the compact rendering.
    // See issue 1032 (homepage proof wall year-stripping bug).
    const includeYear = parsed.getUTCFullYear() !== new Date().getUTCFullYear();
    return parsed.toLocaleString("en", {
      month: "short",
      day: "numeric",
      ...(includeYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "recently";
  }
  return parsed.toLocaleString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Kept under ~160 characters so search results show the whole line instead of
// truncating mid-sentence. Same honest claims as the homepage (BET 10 / 977):
// source-linked proof, not a screenshot on every change.
const pageDescription =
  "Competitor monitoring software that watches Meta ads and landing pages, then files source-linked proof when something changes. Free preview, no account.";

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
  {
    domain: "adversa.io — checked 2026-08-21",
    title: "AI that triages the noise and scores each change",
    detail:
      "New entrant Adversa pitches straight at alert fatigue: it groups related changes into a single update, filters cosmetic edits like navigation and footers, and uses AI to explain what changed, how significant it was, and why it matters. Early tiers are sold as one-time lifetime deals.",
    source: "https://adversa.io/",
  },
  {
    domain: "whatchanged.co.uk — checked 2026-08-21",
    title: "A real-time feed of every competitor site change",
    detail:
      "WhatChanged tracks competitor websites in real time with a diff-style change feed — new pages, removed content, pricing and navigation updates — built for SEO teams, content marketers, and founders, with lifetime discounts for early users.",
    source: "https://whatchanged.co.uk/",
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

// Direct /compare/* pages for the tools named in the category above (issue
// 1548). Each comparison is honest and source-backed; these anchor the
// "captures the alternative" intent with a Five to Nine vs <vendor> page.
const compareVendors = [
  {
    name: "Panoramata",
    path: "/compare/panoramata",
    label: "Five to Nine vs Panoramata",
    oneLiner: "Panoramata's breadth (ads, pages, emails) against our source-proofed offer-and-landing-page diffs.",
  },
  {
    name: "Foreplay Spyder",
    path: "/compare/foreplay-spyder",
    label: "Five to Nine vs Foreplay Spyder",
    oneLiner: "Foreplay Spyder archives ads and screenshots; we diff the offer, price, and CTA behind each new ad",
  },
  {
    name: "AdSpyder",
    path: "/compare/adspyder",
    label: "Five to Nine vs AdSpyder",
    oneLiner: "AdSpyder's searchable creative library against a change-evidence trail with source links.",
  },
  {
    name: "Visualping",
    path: "/compare/visualping-ad-libraries",
    label: "Five to Nine vs Visualping for ad libraries",
    oneLiner: "Visualping's URL-and-pixel playbook against a domain paste and a semantic offer diff with no phantom changes.",
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
      "Offers, prices, CTAs, and landing-page copy. Each confirmed change is saved with page text, the source link, and a screenshot when the capture includes one, then summarized in a brief. If you mainly want a large creative library spanning many platforms, ours is narrower — the change evidence is deeper.",
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
      "Software that checks your competitors' public surfaces on a schedule and tells you when something changed. Five to Nine watches Meta ads and the landing pages they link to, and sends a brief when a change is confirmed — with the page text, source link, and a screenshot when the capture includes one.",
  },
  {
    question: "Where does the data come from?",
    answer:
      "Public surfaces only: the Meta Ad Library — the same public archive anyone can open in a browser — plus the public landing pages those ads link to. Five to Nine never logs in to anything and never reads anything behind a login.",
  },
  {
    question: "How is this different from ad-spy tools?",
    answer:
      "Ad-spy tools are built for browsing creatives, and some search many platforms’ ad libraries at once. Five to Nine monitors the Meta Ad Library only — other platforms’ ad libraries are out of scope — and is built around what changed: offers, prices, CTAs, and landing-page copy, each confirmed change saved with page text, the source link, and a screenshot when the capture includes one, then summarized in a brief. If you mainly want a large multi-platform creative library, ours is narrower; the change evidence is deeper.",
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
  const { proofBrief, indexableAdsLinks = [] } = useLoaderData<typeof loader>();
  const structuredFaq = faqPageJsonLd(categoryFaqEntries);
  // The search funnel entry points funnel a localised visitor to
  // `/{locale}/search` (issue 1578, accept #3), not EN `/search`, so the
  // first-value search moment stays inside the localized surface set.
  const location = useLocation();
  const searchPath = localeSearchPathname(location.pathname);
  // The "try the live search preview" trial links carry a canned query; keep
  // them inside the locale prefix so a localised visitor stays in the funnel.
  const searchTrialPath = publicSearchTrialPath.replace(/^\/search/, searchPath);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Competitor monitoring software | Five to Nine",
            description: pageDescription,
            pathname: "/competitor-monitoring",
            dateModified: "2026-08-21",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
        ]}
      />

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
          changes it saves the page text and the link — plus a screenshot when the capture includes
          one — then files the brief.
        </p>

        <Form className="ld-command" method="get" action={searchPath} aria-label="Public search preview">
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
          check looks like before you decide. Coverage is the Meta Ad Library only — other
          platforms&rsquo; ad libraries are not included — and freshness is labeled and can vary by
          source.
        </p>
      </section>

      <section className="ld-proof">
        <div className="ld-section-head">
          <span className="ld-kicker">The category, sourced</span>
          <h2>What competitor monitoring tools promise.</h2>
          <p>
            These are the vendors&rsquo; own current claims, checked by the research desk on 8
            August 2026 and 21 August 2026 and quoted with their source URLs below.
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

      <section className="ld-quiet" id="compare">
        <div className="ld-section-head">
          <span className="ld-kicker">Five to Nine vs the tools in this category</span>
          <h2>Each comparison, argued honestly.</h2>
          <p>
            Every page names what the tool does well, where it stops, and what Five to Nine adds —
            with the vendor's own claims cited and checked.
          </p>
        </div>
        <div className="ld-quiet-grid" aria-label="Direct comparisons with category tools">
          {compareVendors.map((vendor) => (
            <article key={vendor.path}>
              <span className="ld-kicker">vs {vendor.name}</span>
              <h3>
                <Link to={vendor.path}>{vendor.label}</Link>
              </h3>
              <p>{vendor.oneLiner}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-proof" id="demo">
        <div className="ld-section-head">
          <span className="ld-kicker">Proof brief</span>
          <h2>
            {proofBrief
              ? "The morning brief — from a real watch"
              : "See the brief before you sign up"}
          </h2>
          <p>
            {proofBrief
              ? `Real captures from the ${proofBrief.adLibraryCountry ? `${proofBrief.adLibraryCountry} Ad Library` : "Meta Ad Library"} for ${proofBrief.website}, checked ${proofBrief.checkedAgoLabel}. Every row links to the same public page you can open yourself.`
              : "A brief groups one competitor's real captured changes — hooks, offers, CTAs, sources, and freshness — into one decision. Live proof appears here after the first scan; preview what it looks like with the search preview."}
          </p>
          <div className="ld-proof-actions">
            <Link to={searchTrialPath}>Try the live search preview</Link>
            <a href="#faq">Category FAQ</a>
          </div>
        </div>

        {proofBrief ? (
          <div className="ld-caseboard" aria-label="Real Five to Nine evidence trail">
            <article className="ld-case-lead">
              <span className="ld-kicker">
                {proofBrief.adLibraryCountry
                  ? `${proofBrief.adLibraryCountry} Ad Library`
                  : "Meta Ad Library"}
              </span>
              <h3>{proofBrief.competitorName}</h3>
              <p>{proofBrief.summary}</p>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Decision summary</span>
              <h4>{proofBrief.decision.subject}</h4>
              <p>{proofBrief.decision.whyItMatters}</p>
              <dl>
                <div>
                  <dt>What changed</dt>
                  <dd>{proofBrief.decision.whatChanged}</dd>
                </div>
                <div>
                  <dt>Why it matters</dt>
                  <dd>{proofBrief.decision.whyItMatters}</dd>
                </div>
                <div>
                  <dt>Urgency</dt>
                  <dd>{proofBrief.decision.priority}</dd>
                </div>
                <div>
                  <dt>Proof status</dt>
                  <dd>{proofBrief.decision.proofStatus}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{proofBrief.decision.source}</dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>{proofBrief.decision.freshness}</dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>
                    {proofBrief.proofTrail[0]?.sourceUrl ? (
                      <a href={proofBrief.proofTrail[0].sourceUrl} target="_blank" rel="noreferrer">
                        {proofBrief.decision.nextAction} →
                      </a>
                    ) : (
                      proofBrief.decision.nextAction
                    )}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Source trail</span>
              <ul className="ld-trail">
                {proofBrief.proofTrail.map((item) => (
                  <li key={item.id}>
                    <strong>{item.signal}</strong>
                    <p>{item.evidence}</p>
                    <em>
                      {item.sourceUrl ? (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          {item.source} — open the same page →
                        </a>
                      ) : (
                        item.source
                      )}
                    </em>
                    <small>Captured {proofTimeLabel(item.capturedAt)}</small>
                  </li>
                ))}
              </ul>
              <p className="ld-trail-note" role="note">
                Every row above is a real capture. Open the source link and check it yourself —
                saved watches attach page text and original links, plus a screenshot when the capture includes one.
              </p>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Client-ready view</span>
              <h4>Report preview</h4>
              <ul className="ld-trail">
                {proofBrief.reportRows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </article>
          </div>
        ) : (
          <div className="ld-caseboard" aria-label="No live proof yet">
            <article className="ld-case-card ld-case-empty">
              <span className="ld-kicker">No live proof right now</span>
              <h4>We haven’t captured this competitor recently.</h4>
              <p>
                The proof brief renders real captures from the public Meta Ad Library. Run the
                search preview to see current ads and sources, or create an account to start a
                scheduled watch.
              </p>
              <div className="ld-proof-actions">
                <Link to={searchTrialPath}>Run the search preview</Link>
                <Link to="/auth/signup">Create an account</Link>
              </div>
            </article>
          </div>
        )}
      </section>

      <BrowseTrackedCompetitors links={indexableAdsLinks} />

      <section className="ld-quiet" id="switching">
        <div className="ld-section-head">
          <span className="ld-kicker">Leaving a competitor monitoring tool?</span>
          <h2>Switching to 0509?</h2>
          <p>
            If you are coming from a tool that closed or lost the plot on
            noise, the honest switch pages spell out what moves over, what
            stays behind, and where the evidence comes from — linked from the
            same category this page sells into.
          </p>
        </div>
        <div className="ld-quiet-grid" aria-label="Switch pages">
          {SWITCH_SLUGS.map((slug) => {
            const page = SWITCH_PAGES[slug];
            return (
              <article key={slug}>
                <span className="ld-kicker">{page.ctaBrand}</span>
                <h3>
                  <Link to={page.pathname}>Switching from {page.productName}</Link>
                </h3>
                <p>{page.cardLine}</p>
                <p className="ld-trail-note" role="note">
                  <Link to={page.pathname}>See the switch page →</Link>
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="ld-quiet" id="by-industry">
        <div className="ld-section-head">
          <span className="ld-kicker">By industry</span>
          <h2>Verticals we cover.</h2>
          <p>
            The category page above is the general pitch. Some markets move differently enough to
            warrant their own page — same product, framed for that trade.
          </p>
        </div>
        <div className="ld-quiet-grid" aria-label="Industry verticals">
          <article>
            <span className="ld-kicker">Sneaker resale</span>
            <h3>
              <Link to="/sneaker-resale">Sneaker resale competitor ads</Link>
            </h3>
            <p>
              Resellers price around drops other shops post. See the offer, CTA, and landing-page
              moves the other resellers ran — with the screenshot and the original link, not a
              swipe file. Available in English, German, Japanese, and Brazilian Portuguese.
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
            <span className="ld-kicker">Category evidence checked 2026-08-08 and 2026-08-21</span>
            <h3>Each quote keeps its own source link</h3>
            <p>
              Every claim in the two sections above links to the page it came from, with the
              check date on the card. The 21 August 2026 cycle added the newest noise-triage
              entrants, Adversa and WhatChanged, after checking their live pages. If a vendor
              changes their page, this page is updated on the next research-desk cycle — we do
              not restate old quotes as standing facts.
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
          Paste a competitor website into the <Link to={searchPath}>search preview</Link> — no
          account needed. Questions about coverage on your competitors? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
