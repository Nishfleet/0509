import { Form, Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import type { AppEnv } from "~/lib/env.server";
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
import "../marketing.css";

const publicSearchTrialPath =
  "/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com";

// Real-proof loader, same pattern as the homepage and /competitor-monitoring:
// renders real captures from the discovery cache only (never a sample
// fixture). When no usable real cache exists the page renders the honest
// "no live proof yet" state instead of inventing evidence.
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const { getOptionalCloudflareContext } = await import("~/lib/cloudflare-context");
  const env: AppEnv = getEnv(context);
  // Same visitor-country resolution as the /ads/:domain loader so this
  // public proof-brief surface reads the SAME cache row its linked brand
  // pages read (issue 1468).
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
    console.warn("For-agencies proof brief load failed; rendering the honest state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    proofBrief = null;
  }

  return { proofBrief };
}

// Kept under ~160 characters so search results show the whole line instead of
// truncating mid-sentence.
const pageDescription =
  "Five to Nine files one source-linked brief per client: 75 watchlists on Agency, watermarked share links on Starter, and your agency's brand on shared reports.";

export const links: LinksFunction = () => canonicalLinks("/for-agencies");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Competitor monitoring for agencies | Five to Nine",
    description: pageDescription,
    pathname: "/for-agencies",
  });

// The per-client Monday check, priced in hours. The math is the roster:
// 30 minutes per brand (open the Meta Ad Library, read the landing pages,
// note what moved) multiplied by every brand on every client's roster.
const rosterMathRows = [
  { clients: 3, brandsPerClient: 3, brands: 9, hours: "4.5" },
  { clients: 5, brandsPerClient: 4, brands: 20, hours: "10" },
  { clients: 8, brandsPerClient: 5, brands: 40, hours: "20" },
] as const;

// Sourced vendor comparison (issue #2144, step 3). The only figures allowed
// here are the ones printed on foreplay.co/pricing on the day of the work,
// recorded in docs/compare-pricing-sources.md. Do not restate them without
// the source link and the check date, and do not reuse older unverified
// numbers.
const foreplayComparison = {
  vendor: "Foreplay",
  planLine:
    "Foreplay's pricing page prints its Agency plan at $459/month with 50 tracked brands on monthly billing.",
  source: "https://foreplay.co/pricing",
  checked: "checked 2026-09-09",
} as const;

// Page FAQ. Rendered on the page AND emitted as FAQPage JSON-LD from this
// same array, so structured data can never drift from visible copy. Every
// answer traces to shipped behavior (plan-entitlements.ts cadences and
// features); dollar amounts stay in the visible body sections, out of
// structured data.
export const agencyFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How does Five to Nine fit an agency roster?",
    answer:
      "One watchlist per competitor brand, grouped per client. Five to Nine checks every watchlist on the plan's schedule and files one brief per client, so Monday review is reading, not checking.",
  },
  {
    question: "Can I put my agency's brand on client reports?",
    answer:
      "On the Agency plan, yes: your workspace sets its own name and logo, and shared reports open with “Prepared by” your agency. Share links on Starter carry the Five to Nine watermark.",
  },
  {
    question: "How fast does Agency check the roster?",
    answer:
      "Agency runs 75 watchlists: the top 25 competitors are checked every 3 hours and the rest every 6 hours, with daily and weekly briefs. Starter and Agency can also turn on instant alerts, so a confirmed change emails you as soon as a check finds it.",
  },
  {
    question: "Where does the data come from?",
    answer:
      "Public surfaces only: the Meta Ad Library — the same public archive anyone can open in a browser — plus the public landing pages those ads link to. Five to Nine never logs in to anything and never reads anything behind a login.",
  },
];

export default function ForAgenciesRoute() {
  const { proofBrief } = useLoaderData<typeof loader>();
  const structuredFaq = faqPageJsonLd(agencyFaqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Competitor monitoring for agencies | Five to Nine",
            description: pageDescription,
            pathname: "/for-agencies",
            dateModified: "2026-09-09",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav showSwitchLinks={false} />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "For agencies", pathname: "/for-agencies" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>For agencies</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Every client&rsquo;s competitors, checked before your Monday meeting.
        </h1>
        <p className="ld-deck-copy">
          Five to Nine watches every brand on every client roster — Meta ads and the landing
          pages they link to — and files one source-linked brief per client. You read the brief;
          the checking is already done.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input
            aria-label="Competitor website"
            name="website"
            placeholder="paste-a-client-competitor.com…"
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

      <section className="ld-quiet" id="roster-math">
        <div className="ld-section-head">
          <span className="ld-kicker">The roster math</span>
          <h2>The Monday check is 30 minutes × brands × clients.</h2>
          <p>
            Done by hand, checking one brand properly takes about 30 minutes: open the Meta Ad
            Library, read the landing pages, screenshot what moved, write the note. Multiply by
            every brand on the roster, then by every client.
          </p>
        </div>
        <div className="ld-quiet-grid" aria-label="Roster math worked examples">
          {rosterMathRows.map((row) => (
            <article key={`${row.clients}-${row.brandsPerClient}`}>
              <span className="ld-kicker">
                {row.clients} clients × {row.brandsPerClient} brands each
              </span>
              <h3>{row.brands} brands = {row.hours} hours every Monday</h3>
              <p>
                30 minutes × {row.brands} brands is {row.hours} hours of checking before a single
                client call — every week, per roster.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>What the roster gets instead.</h2>
        <div className="ld-how-grid">
          <article>
            <span className="ld-step">01</span>
            <h3>One brief per client</h3>
            <p>
              Every watchlist on a client&rsquo;s roster is checked on schedule, and the confirmed
              changes arrive grouped as one brief for that client — offers, prices, CTAs, and
              landing-page copy, each with the page text and the source link.
            </p>
          </article>
          <article>
            <span className="ld-step">02</span>
            <h3>Share links your clients can open</h3>
            <p>
              Share links work on Starter and Agency. Starter shares carry the Five to Nine
              watermark. On Agency, your workspace sets its own name and logo, so shared reports
              open with &ldquo;Prepared by&rdquo; your agency.
            </p>
          </article>
          <article>
            <span className="ld-step">03</span>
            <h3>Agency plan, sized for a roster</h3>
            <p>
              Agency runs 75 watchlists at $199/mo — the top 25 competitors checked every 3
              hours, the rest every 6 — with daily and weekly briefs, client reports, and shared
              report branding.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" id="compare">
        <div className="ld-section-head">
          <span className="ld-kicker">Agency vs {foreplayComparison.vendor}, sourced</span>
          <h2>The monitoring line, priced side by side.</h2>
          <p>
            {foreplayComparison.planLine} Five to Nine Agency watches 75 competitors at $199/mo.
            Foreplay bundles a full creative workflow suite — swipe files, briefing, AI tooling —
            that Five to Nine does not try to replace; this comparison is the competitor
            monitoring line only.
          </p>
          <p className="ld-trail-note" role="note">
            Source: <a href={foreplayComparison.source}>{foreplayComparison.source}</a>,{" "}
            {foreplayComparison.checked}. Vendor pages change; the figures above are scoped to
            that check.
          </p>
          <div className="ld-proof-actions">
            <Link to="/compare/foreplay-spyder">Five to Nine vs Foreplay Spyder</Link>
          </div>
        </div>
      </section>

      <section className="ld-proof" id="demo">
        <div className="ld-section-head">
          <span className="ld-kicker">Proof brief</span>
          <h2>
            {proofBrief
              ? "The client brief — from a real watch"
              : "See the brief before you sign up"}
          </h2>
          <p>
            {proofBrief
              ? `Real captures from the ${proofBrief.adLibraryCountry ? `${proofBrief.adLibraryCountry} Ad Library` : "Meta Ad Library"} for ${proofBrief.website}, checked ${proofBrief.checkedAgoLabel}. Every row links to the same public page you can open yourself.`
              : "A brief groups one competitor's real captured changes — hooks, offers, CTAs, sources, and freshness — into one decision. Live proof appears here after the first scan; preview what it looks like with the search preview."}
          </p>
          <div className="ld-proof-actions">
            <Link to={publicSearchTrialPath}>Try the live search preview</Link>
            <a href="#faq">Agency FAQ</a>
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
                  </li>
                ))}
              </ul>
              <p className="ld-trail-note" role="note">
                Every row above is a real capture. Open the source link and check it yourself —
                saved watches attach page text and original links, plus a screenshot when the
                capture includes one.
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
                <Link to={publicSearchTrialPath}>Run the search preview</Link>
                <Link to="/auth/signup?source=for_agencies">Create an account</Link>
              </div>
            </article>
          </div>
        )}
      </section>

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq" aria-label="Agency FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common questions from agencies</h3>
          <dl className="proof-trail-list">
            {agencyFaqEntries.map((entry) => (
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
          Put the roster on watch <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a client competitor into the <Link to="/search">search preview</Link> — no account
          needed — then <Link to="/auth/signup?source=for_agencies">create the agency
          account</Link>. Questions about a specific roster? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
