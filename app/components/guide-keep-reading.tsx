import { Children, type ReactNode } from "react";

/**
 * The shared "Keep reading" sibling block ending every /guides/* how-to
 * (issue #3167). The corpus shipped as an orphan island — zero internal
 * links in, zero sibling cross-links — so each guide closes with this block
 * of literal <a href="/guides/..."> sibling anchors.
 *
 * The hrefs are literal in each route file on purpose: the issue's
 * source-level verify greps `href="/guides/` and Link's `to=` never produces
 * that source text (it renders the same markup, but the grep cannot see it).
 * tests/guides-routes.test.ts asserts every sibling href resolves to a
 * GUIDE_ENTRIES member, so the manifest in app/lib/sitemap.server.ts stays
 * the canonical set (pinned to the hub manifest by the #3122 triple-agreement
 * test).
 */
export function GuideKeepReading({ children }: { children: ReactNode }) {
  return (
    <section className="ld-quiet">
      <div className="ld-section-head">
        <span className="ld-kicker">Keep reading</span>
        <h2>More guides in this series</h2>
      </div>
      <ul className="ld-compare-hub" aria-label="More guides">
        {Children.map(children, (child) => (
          <li>{child}</li>
        ))}
      </ul>
    </section>
  );
}
