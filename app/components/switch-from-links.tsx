import { Link } from "react-router";

import { SWITCH_PAGES, SWITCH_SLUGS, type SwitchSlug } from "~/lib/switch-pages";

/**
 * The three "from <tool>" switch-page links, derived from the single source
 * of truth (`SWITCH_PAGES`). Used two ways (issue #1466):
 *
 * 1. Inline `{SwitchFromLinks}` — the bare link list, embedded inside
 *    `MarketingNav`'s `ld-nav-links` so the switch pages sit in the primary
 *    nav region of every public surface that uses `MarketingNav`.
 * 2. `<SwitchFromStrip>` — the same links wrapped in a `<nav>` cross-link
 *    strip rendered directly under the H1 on `/search` and
 *    `/competitor-monitoring`, the two high-traffic BET 5 surfaces whose
 *    headers do not carry the `ld-nav-links` row.
 *
 * No link is gated behind JS, sign-in, or a cookie banner — they are plain
 * `<Link>`s in server-rendered markup.
 */
export function SwitchFromLinks() {
  return (
    <>
      {SWITCH_SLUGS.map((slug: SwitchSlug) => {
        const page = SWITCH_PAGES[slug];
        return (
          <Link key={slug} className="ld-nav-switch" to={page.pathname}>
            from {page.productName}
          </Link>
        );
      })}
    </>
  );
}

/**
 * A standalone `<nav>` cross-link strip with the three "from <tool>" links,
 * placed directly under the H1 on `/search` and `/competitor-monitoring`.
 * Mirrors the `ld-hero-callouts` pattern on the home page: a small inline
 * strip that surfaces the switch pages without a footer scroll.
 */
export function SwitchFromStrip() {
  return (
    <nav className="ld-switch-from" aria-label="Switch from">
      <span className="ld-switch-from-label">Switch from</span>
      {SWITCH_SLUGS.map((slug: SwitchSlug) => {
        const page = SWITCH_PAGES[slug];
        return (
          <Link key={slug} className="ld-switch-from-link" to={page.pathname}>
            from {page.productName}
          </Link>
        );
      })}
    </nav>
  );
}
