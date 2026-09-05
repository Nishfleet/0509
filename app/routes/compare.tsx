import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";

const pageDescription =
  "Five to Nine vs the alternatives: source-backed competitor ad and landing-page change monitoring compared to Visualping, MagicBrief, Panoramata, Foreplay, Spyland, Pulzifi, and more.";

export const links: LinksFunction = () => canonicalLinks("/compare");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Compare Five to Nine vs the alternatives",
    description: pageDescription,
    pathname: "/compare",
  });

/** The 8 indexed /compare/* product pages the hub links. */
const COMPARE_PAGES = [
  { slug: "magicbrief", label: "Five to Nine vs MagicBrief", href: "/compare/magicbrief" },
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
] as const;

export default function CompareIndexRoute({
  localePrefix,
}: { localePrefix?: string } = {}) {
  // Locale-prefixed compare hubs (issue #1563) pass their locale prefix so a
  // non-EN visitor following the index stays in the locale (hrefs like
  // `/de/compare/magicbrief` instead of `/compare/magicbrief`). EN `/compare`
  // passes `undefined` and keeps the bare `/compare/*` children exactly as
  // before.
  const hrefFor = (page: (typeof COMPARE_PAGES)[number]) =>
    localePrefix ? `${localePrefix}${page.href}` : page.href;
  const _debugPrefix = localePrefix ?? "undefined";

  return (
    <main className="f9-home">
      <div data-debug-compare-prefix={_debugPrefix} hidden />
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Compare Five to Nine vs the alternatives",
            description: pageDescription,
            pathname: "/compare",
          }),
        )}
      />
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

      <section className="ld-final">
        <h2>
          Start with the free preview <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no account
          needed — and see what is publicly available before deciding anything.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
