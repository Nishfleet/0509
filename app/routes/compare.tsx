import { Link, useParams } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { LiveBrandProof } from "~/components/live-brand-proof";
import { COMPETITOR_PRICE_ANCHORS } from "~/components/pricing-section";
import { isBuyerSurfaceLocaleId } from "~/lib/locale-markets";
import { PUBLISHED_PLAN_PRICES_USD } from "~/lib/pricing";
import {
  canonicalLinks,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { LIVE_BRAND_PROOF_DOMAIN } from "~/lib/demo-brand-pages";

import "~/styles/marketing.css";
const pageDescription =
  "Five to Nine vs the alternatives: source-backed competitor ad and landing-page change monitoring compared to Visualping, Panoramata, Foreplay, Spyland, Pulzifi, and more.";

export const links: LinksFunction = () => canonicalLinks("/compare");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Compare Five to Nine vs the alternatives",
    description: pageDescription,
    pathname: "/compare",
  });

/** The 7 indexed /compare/* product pages the hub links. */
const COMPARE_PAGES = [
  { slug: "meta-ad-library", label: "vs checking the Meta Ad Library by hand", href: "/compare/meta-ad-library" },
  // /compare/visualping and /compare/foreplay are not linked here (issue
  // #1481): both are duplicates that canonicalize to their more specific
  // sibling below, so the hub surfaces one URL per vendor pair.
  { slug: "visualping-ad-libraries", label: "Five to Nine vs Visualping for ad libraries", href: "/compare/visualping-ad-libraries" },
  { slug: "spyland", label: "Five to Nine vs Spyland", href: "/compare/spyland" },
  { slug: "pulzifi", label: "Five to Nine vs Pulzifi", href: "/compare/pulzifi" },
  { slug: "foreplay-spyder", label: "Five to Nine vs Foreplay Spyder", href: "/compare/foreplay-spyder" },
  { slug: "panoramata", label: "Five to Nine vs Panoramata", href: "/compare/panoramata" },
  { slug: "adspyder", label: "Five to Nine vs AdSpyder", href: "/compare/adspyder" },
  { slug: "adspy", label: "Five to Nine vs AdSpy", href: "/compare/adspy" },
  // Issue #2866: two verified competitors that had no compare page (both 404'd).
  { slug: "keeptabz", label: "Five to Nine vs KeepTabz", href: "/compare/keeptabz" },
  { slug: "gethookd", label: "Five to Nine vs GetHookd", href: "/compare/gethookd" },
] as const;

/**
 * Issue #2301 — the /compare hub's side-by-side table. Every rival cell is
 * grounded in a documented source, never invented from vendor marketing:
 *
 * - `listPrice` comes from docs/compare-pricing-sources.md via
 *   COMPETITOR_PRICE_ANCHORS (the same source of truth the /pricing page's
 *   "Price of knowing" table reads, kept in sync by a test). A rival with no
 *   entry in that doc reads "not published".
 * - The capability cells (ad-library coverage, landing-page diffs, proof
 *   captures) are grounded in the linked /compare/* page's own source-verified
 *   copy. A capability the page does not document reads "not published".
 *
 * Five to Nine's own row prices are imported from PUBLISHED_PLAN_PRICES_USD
 * (the same source of truth as /pricing), never retyped here.
 */
type CompareTableRow = {
  vendor: string;
  href?: string;
  adLibrary: string;
  landingPageDiffs: string;
  proofCaptures: string;
  listPrice: string;
};

const NOT_PUBLISHED = "not published";

/** Entry price for a rival vendor, from docs/compare-pricing-sources.md. */
function rivalListPrice(vendorKey: string): string {
  const anchor = COMPETITOR_PRICE_ANCHORS.find((a) => a.vendor === vendorKey);
  return anchor ? anchor.price : NOT_PUBLISHED;
}

const COMPARE_TABLE: readonly CompareTableRow[] = [
  {
    vendor: "Five to Nine",
    adLibrary: "Yes — reads the public Meta Ad Library",
    landingPageDiffs: "Yes — offer, price, CTA, and hook diffs",
    proofCaptures: "Yes — page text, source link, and screenshot",
    listPrice: `From $${PUBLISHED_PLAN_PRICES_USD.scout.monthly}/mo (Scout)`,
  },
  // MagicBrief's row links /switch/magicbrief (issue #2887): the wind-down
  // page is live again, so the hub link reaches a real destination instead
  // of the old 301 self-loop (issue #2860). /compare/magicbrief stays wiped
  // and is never linked.
  {
    vendor: "Meta Ad Library (by hand)",
    href: "/compare/meta-ad-library",
    adLibrary: "Yes — the public Meta Ad Library itself",
    landingPageDiffs: NOT_PUBLISHED,
    proofCaptures: NOT_PUBLISHED,
    listPrice: NOT_PUBLISHED,
  },
  {
    vendor: "Visualping",
    href: "/compare/visualping-ad-libraries",
    adLibrary: "Yes — via a published Ad Library playbook",
    landingPageDiffs: "Yes — visual, text, and element diffs",
    proofCaptures: NOT_PUBLISHED,
    listPrice: rivalListPrice("Visualping Personal 1K"),
  },
  {
    vendor: "Spyland",
    href: "/compare/spyland",
    adLibrary: NOT_PUBLISHED,
    landingPageDiffs: "Yes — scheduled checks, before/after screenshots",
    proofCaptures: NOT_PUBLISHED,
    listPrice: NOT_PUBLISHED,
  },
  {
    vendor: "Pulzifi",
    href: "/compare/pulzifi",
    adLibrary: NOT_PUBLISHED,
    landingPageDiffs: "Yes — visual and text diffs",
    proofCaptures: NOT_PUBLISHED,
    listPrice: NOT_PUBLISHED,
  },
  {
    vendor: "Foreplay Spyder",
    href: "/compare/foreplay-spyder",
    adLibrary: "Yes — watches competitor Meta ads",
    landingPageDiffs: NOT_PUBLISHED,
    proofCaptures: NOT_PUBLISHED,
    listPrice: rivalListPrice("Foreplay Basic"),
  },
  {
    vendor: "Panoramata",
    href: "/compare/panoramata",
    adLibrary: "Yes — ads and pages",
    landingPageDiffs: "Yes — side-by-side screenshots",
    proofCaptures: NOT_PUBLISHED,
    listPrice: rivalListPrice("Panoramata Startup"),
  },
  {
    vendor: "AdSpyder",
    href: "/compare/adspyder",
    adLibrary: "Yes — new-ad alerts",
    landingPageDiffs: NOT_PUBLISHED,
    proofCaptures: NOT_PUBLISHED,
    listPrice: rivalListPrice("AdSpyder Spy"),
  },
  {
    vendor: "MagicBrief — closed 31 Jul 2026",
    href: "/switch/magicbrief",
    adLibrary: "Was — saved ad collections and boards",
    landingPageDiffs: NOT_PUBLISHED,
    proofCaptures: NOT_PUBLISHED,
    listPrice: NOT_PUBLISHED,
  },
] as const;

export default function CompareIndexRoute() {
  // The locale prefix is read inside the component, never passed in as a
  // prop: at build time `@react-router/dev` wraps every route module's
  // default export in `withComponentProps`, which renders the component with
  // only the route props (`params`, `loaderData`, `actionData`, `matches`)
  // and silently discards any caller-supplied props (issue #1563). Resolving
  // the matched `:locale` param here survives the wrapper — `/compare` has
  // no `params.locale` and keeps bare EN `/compare/*` links, while
  // `/de/compare` resolves `de` and prefixes every child href so a non-EN
  // visitor stays in the locale (`/de/compare/panoramata`, ...).
  const params = useParams<{ locale?: string }>();
  const localePrefix =
    params.locale && isBuyerSurfaceLocaleId(params.locale)
      ? `/${params.locale}`
      : undefined;
  const hrefFor = (page: (typeof COMPARE_PAGES)[number]) =>
    localePrefix ? `${localePrefix}${page.href}` : page.href;
  const hrefForPath = (path: string) =>
    localePrefix ? `${localePrefix}${path}` : path;

  // Issue #2301 — the hub is a browsable collection of sibling /compare/*
  // pages, so emit an ItemList with one ListItem per linked page. Built from
  // the SAME COMPARE_PAGES list the hub renders (no new data source) so it
  // can never drift from the visible links. ItemList carries only names and
  // URLs — no prices — so it stays within the hub's no-pricing-in-JSON-LD
  // contract (compare-hub.route.test.ts).
  const itemList = itemListJsonLd(
    COMPARE_PAGES.map((page) => ({ name: page.label, pathname: page.href })),
  );

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Compare Five to Nine vs the alternatives",
            description: pageDescription,
            pathname: "/compare",
          }),
        )}
      />
      <script {...jsonLdScriptProps(itemList)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Compare</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          How Five to Nine stacks up against the alternatives.
        </h1>
        <p className="ld-deck-copy">
          Each page below compares Five to Nine's source-backed competitor ad and landing-page change
          monitoring against one alternative. Pick a product to read the full side-by-side.
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Compare pages</span>
          <h2>Side-by-side comparisons</h2>
          <p>
            Every page links the competitor's own source and names the commercial change — offer,
            price, CTA, or hook — that we check for.
          </p>
        </div>
        <ul className="ld-compare-hub" aria-label="Compare pages">
          {COMPARE_PAGES.map((page) => (
            <li key={page.slug}>
              <Link to={hrefFor(page)}>{page.label}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">At a glance</span>
          <h2>How the tools compare.</h2>
          <p>
            Rival list prices come from docs/compare-pricing-sources.md (the same source the
            /pricing page reads); capability cells are grounded in the linked compare page&rsquo;s
            own source-verified copy. A cell with no documented value reads &ldquo;not
            published&rdquo; — nothing is invented from vendor marketing. Read a row across to
            see which tools cover the ad library, which diff landing pages, and which save proof.
          </p>
        </div>
        <div className="f9-price-anchors" aria-label="Competitor monitoring tools compared">
          <table>
            <thead>
              <tr>
                <th scope="col">Tool</th>
                <th scope="col">Ad-library coverage</th>
                <th scope="col">Landing-page diffs</th>
                <th scope="col">Proof captures</th>
                <th scope="col">List price</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_TABLE.map((row) => (
                <tr key={row.vendor}>
                  <th scope="row">
                    {row.href ? <Link to={hrefForPath(row.href)}>{row.vendor}</Link> : row.vendor}
                  </th>
                  <td>{row.adLibrary}</td>
                  <td>{row.landingPageDiffs}</td>
                  <td>{row.proofCaptures}</td>
                  <td>{row.listPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ld-pricing-note">
          The pattern to read: Five to Nine is the only row that pairs Meta Ad Library coverage
          with landing-page diffs and saved, source-linked proof captures. Most rivals do one of
          the three — a creative library, a page differ, or a new-ad alert — and leave the
          before-and-after evidence to you. Where a rival&rsquo;s price is not listed here, it is
          not published in docs/compare-pricing-sources.md; check the vendor&rsquo;s own pricing
          page for current plans.
        </p>
      </section>

      <section className="ld-final">
        <h2>
          Start with the free preview <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no account
          needed — and see what is publicly available before deciding anything.
        </p>
      </section>

      <LiveBrandProof domain={LIVE_BRAND_PROOF_DOMAIN} />

      <MarketingFooter />
    </main>
  );
}
