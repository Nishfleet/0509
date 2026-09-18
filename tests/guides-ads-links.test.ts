import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Issue #3608: the 8 /guides/* articles are the highest-authority owned
// content, and the /ads/:domain pages are the proof surface with wired
// signup CTAs — but the internal link graph between them was empty. The
// reverse direction existed (the #3167 footer links on every /ads/:domain
// page point at the guides); guides→ads was zero. This guard pins the
// handoff the issue lands: every guide article carries at least one
// crawlable in-content href="/ads/:domain" anchor, so a reader finishing
// an owned article always has a next step into a live proof page — and the
// 286 brand pages receive internal-link equity from the guide corpus again.
//
// Source-level, like the #3167 verify on the /ads side: a literal href="/ads/
// is greppable, while react-router's <Link to="/ads/..."> never emits one, so
// the guard asserts the markup crawlers actually read. It globs the routes
// directory, so a NEW guide article is covered automatically — no test
// registration step to forget, and the graph cannot silently regress.

const root = join(__dirname, "..");
const ROUTES_DIR = join(root, "app", "routes");

// Domains limited to /ads/:domain pages already published in the production
// sitemap when the links shipped (issue #3608 evidence, 18 September 2026) —
// no new brand pages and no new competitor claims. A guide linking a new
// domain must first see that page published, then extend this list.
const PUBLISHED_AD_DOMAINS: ReadonlySet<string> = new Set([
  "nike.com",
  "zara.com",
  "allbirds.com",
  "gymshark.com",
  "casper.com",
  "hoka.com",
  "figma.com",
  "adidas.com",
]);

function guideArticleFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => /^guides\..+\.tsx$/.test(name))
    .sort();
}

describe("guides → /ads internal link guard (issue #3608)", () => {
  it("the guide corpus is at least 8 articles — the guard must never pass on an empty set", () => {
    expect(guideArticleFiles().length).toBeGreaterThanOrEqual(8);
  });

  for (const file of guideArticleFiles()) {
    it(`${file} carries a crawlable in-content href="/ads/:domain link`, () => {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      // Plain literal-href anchors only (the #3167 form): <Link to="/ads/...">
      // never emits href=, so this greps what a crawler reads.
      const matches = source.match(/href="\/ads\/[^"]+"/g) ?? [];
      expect(
        matches.length,
        `${file} has no href="/ads/ link — the guide→ads handoff regressed`,
      ).toBeGreaterThanOrEqual(1);
      for (const match of matches) {
        const domain = match.slice('href="/ads/'.length, -1);
        expect(
          PUBLISHED_AD_DOMAINS.has(domain),
          `${file} links /ads/${domain}, which was not in the production sitemap when the links shipped — publish it first, then extend PUBLISHED_AD_DOMAINS`,
        ).toBe(true);
      }
    });
  }
});
