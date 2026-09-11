import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { SearchResultRow } from "~/components/search/result-row";
import type { AdRecord } from "~/lib/types";

/**
 * BL-031 — /search in the landing language holds its own contract.
 *
 * The two halves are deliberate. The DOM half renders the real row component
 * and reads the produced markup, because BL-030 §12's lesson is that a test
 * which only asserts a selector *string* cannot fail when the wiring behind it
 * is dead. The source half guards the budgets that only exist at the level of
 * a whole page — one filled button, three caps-mono kickers — which no single
 * render can see.
 */

const route = readFileSync("app/routes/search.tsx", "utf8");
const css = ["app/base.css", "app/marketing.css", "app/app.css"].map((f) => readFileSync(f, "utf8")).join("\n");
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");

function baseAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nykaa",
    body: "Festive glow sale is live for one week only.",
    previewHeadline: "Festive glow sale",
    previewSubhead: "Fixture source evidence",
    hook: "Festive glow",
    offer: "Up to 40% off selected beauty",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://nykaa.com/festive-glow",
    adSnapshotUrl: null,
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    active: true,
    researchSummary: "Fixture evidence.",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  } as AdRecord;
}

function renderRow(ad: AdRecord, canQuickSave = true) {
  const Stub = createRoutesStub([
    {
      path: "/search",
      Component: () => (
        <SearchResultRow
          ad={ad}
          canQuickSave={canQuickSave}
          collections={[{ id: "c1", name: "Winter offers" }]}
          href="/search?selected=ad-1"
          isActive={false}
          isKeyFocused={false}
          plan="starter"
        />
      ),
    },
  ]);
  return renderToStaticMarkup(<Stub initialEntries={["/search"]} />);
}

describe("BL-031 — the search result row", () => {
  it("renders as a ruled row: name, one sentence, one status word, one time", () => {
    const markup = renderRow(baseAd());
    expect(markup).toContain("f9-wk-row");
    expect(markup).toContain("f9-wk-nm");
    expect(markup).toContain("f9-wk-say");
    expect(markup).toContain("f9-wk-st");
    expect(markup).toContain("Nykaa");
    expect(markup).toContain("Running 6 days");
    // The card, its thumbnail tile and its four pills are gone from the list.
    expect(markup).not.toContain("f9-result-card");
    expect(markup).not.toContain("f9-longevity-pill");
    expect(markup).not.toContain("f9-ad-thumb");
  });

  it("says Sample on a demo-sourced result and refuses to quick-save it", () => {
    const markup = renderRow(baseAd({ source: "demo" }));
    expect(markup).toContain("Sample");
    // Nothing fabricated can be saved into a workspace as evidence.
    expect(markup).not.toContain("data-quick-save-ad");
  });

  it("keeps quick-save on a live result, as a text action with its shortcut hook", () => {
    const markup = renderRow(baseAd());
    expect(markup).toContain('data-quick-save-ad="ad-1"');
    // The `s` shortcut clicks this element, so the hook and the row must ship
    // together; the frame it used to carry does not.
    expect(markup).toContain("f9-wk-lnk");
    expect(markup).not.toContain("f9-evidence-cta--rank2");
  });

  it("states an unobserved active status in words rather than guessing", () => {
    const markup = renderRow(baseAd({ activeStatusObserved: false }));
    expect(markup).toContain("Status not detected");
  });

  it("labels a multi-version creative as ×N versions and hides the label when the count is missing or 1 (issue 2150)", () => {
    // A creative running more than one version names the count on the row.
    const multi = renderRow(baseAd({ variantCount: 4 }));
    expect(multi).toContain("×4 versions");

    // A single-version creative (or one with no parsed count) never renders
    // a bare "×1 versions" — the label only appears when there is a real
    // testing signal to name.
    const single = renderRow(baseAd({ variantCount: 1 }));
    expect(single).not.toContain("versions");
    const missing = renderRow(baseAd({ variantCount: null }));
    expect(missing).not.toContain("versions");
  });
});

describe("BL-031 — the page budgets", () => {
  it("spends one filled button per conversion moment, and never two in one viewport", () => {
    // ROUND 2. The DNA's "exactly one per screen" was written against concept
    // pages that were 900px documents in a 900px viewport, so per-screen and
    // per-page were the same number and the word was never tested. The landing
    // — the reference implementation of this language — draws TWO ink fills,
    // the hero `.ld-command` submit and the `.ld-final` `Create account`
    // submit, ~6,000px apart and never in one screen. The law is therefore one
    // fill per VIEWPORT, and a fill is the commit of a conversion moment.
    //
    // This route has exactly two conversion moments, and they are mutually
    // distant by construction: the instrument's commit in the command band,
    // and the retention band below the whole split. The band's commit has two
    // audience branches that can never both render.
    const filled = [...route.matchAll(/className="f9-wk-btn"/g)];
    expect(filled).toHaveLength(3);
    // Locale-aware search path (issue #1578): the filled search command stays
    // on the same surface (`/search` for EN, `/{locale}/search` under a locale
    // prefix) instead of hardcoding `/search`.
    expect(route).toContain(`<SubmitButton
              className="f9-wk-btn"
              getAction={searchPath}`);
    expect(route).toContain(`<Link className="f9-wk-btn" to={signupTrackingPath}>`);
    expect(route).toContain(`className="f9-wk-btn"
                      intent="create-watchlist"`);
    // The real budget is paint-measured: `e2e/bl031-capture` slides a
    // viewport-height window down the document and refuses to write the
    // evidence set if any window ever holds two fills.
    expect(route).not.toContain("f9-primary-button");
    expect(route).not.toContain("f9-secondary-button");
  });

  it("puts the retention band below the whole split, not inside the results column", () => {
    // A band at the foot of the left column ends ~1,000px above an open peek
    // pane and can share a viewport with `See ads`; a page-level band cannot.
    const split = route.indexOf('className={`f9-wk-split is-wide');
    const retain = route.indexOf('className="f9-wk-retain f9-search-signup-cta"');
    const paneClose = route.indexOf("</DetailPane>");
    expect(split).toBeGreaterThan(-1);
    expect(retain).toBeGreaterThan(paneClose);
    // And the results panel no longer carries it.
    const panel = route.slice(
      route.indexOf('className="f9-results-panel"'),
      route.indexOf("</section>", route.indexOf('className="f9-results-panel"')),
    );
    expect(panel).not.toContain("f9-search-signup-cta");
  });

  it("spends at most three caps-mono kickers on any one state of the page", () => {
    // Cheap guard only. The real one is paint-measured: `e2e/bl031-capture`
    // counts every element in the first viewport whose COMPUTED type is
    // uppercase mono and fails the evidence set above three.
    const kickers = [...route.matchAll(/className="f9-wk-kick"/g)].length;
    const blockKickers = new Set(
      [...route.matchAll(/<DetailBlock kicker="([^"]+)"/g)].map((match) => match[1]),
    );
    // Issue #1882: the pre-search state carries no caps-mono kicker at all —
    // the form is the hero, so there is nothing left to kick — and it never
    // co-exists with the pane (the pane only renders once a search has
    // produced a selected ad).
    expect(kickers).toBe(0);
    // "Save this ad" and "Keep this evidence" are the same slot: four
    // mutually exclusive branches of the pane's last block.
    expect([...blockKickers].sort()).toEqual([
      "Keep this evidence",
      "Landing page",
      "Save this ad",
      "What the ad says",
    ]);
  });

  it("keeps the working header, the ruled list and the peek pane, not the old grid", () => {
    expect(route).toContain('<DashboardPage className="f9-wk-page">');
    expect(route).toContain("<WorkingHeader");
    expect(route).toContain("<RuledList");
    expect(route).toContain("<DetailPane");
    for (const dead of [
      "f9-search-grid",
      "f9-search-workspace",
      "f9-proof-detail",
      "f9-panel-head",
      "f9-detail-grid",
      "f9-discovery-banner",
      "f9-results-list",
      "f9-side-note",
      "f9-result-card",
      "f9-search-field",
      "f9-keyboard-hints",
    ]) {
      expect(route).not.toContain(dead);
      // Not one orphaned rule left behind: the ledger in the build report is
      // only true if the stylesheet agrees with it.
      expect(cssRules).not.toContain(`.${dead}`);
    }
  });

  it("refuses the rejected specimen empty state and states the real one instead", () => {
    expect(route).not.toContain("SpecimenEmptyState");
    expect(route).not.toContain("f9-search-specimen");
    expect(route).toContain("Paste a competitor domain, brand name, or keyword");
  });

  it("reads as a tool: the single sentence replaces the three-bullet list", () => {
    // Issue #1882 (Transformation campaign §3.6): the /search empty state was
    // text-heavy ("Nothing searched yet" + three explanatory bullets). It is
    // now one sentence under the instrument and nothing else — a tool, not a
    // brochure. The budgets hold: still zero kickers on the pre-search state,
    // still three filled buttons on the whole page, still one idle lede, and
    // still no specimen or sample card.
    expect(route).toContain(
      "Paste a competitor domain, brand name, or keyword to see their Meta ads.",
    );
    // The brochure copy is gone: no subhead, no scope disclosure, no bullets.
    expect(route).not.toContain("Nothing searched yet");
    expect(route).not.toContain("What a search returns");
    expect(route).not.toContain("Current and recent ads");
    expect(route).not.toContain("The offer, read off their landing page");
    expect(route).not.toContain("The proof capture");
    expect(route).not.toContain("f9-search-scope-details");
    expect(route).not.toContain("f9-search-scope-items");
    expect(route).not.toContain("Coverage and freshness vary by advertiser");
    expect(route).not.toContain("f9-search-scope-body");
    expect(route).not.toContain("f9-search-scope-list");
    // The instrument moves to the top of the page above the idle copy.
    const commandStart = route.search(
      /<section\s+aria-labelledby="search-command-title"\s+className="f9-wk-command"/,
    );
    const idleCopy = route.indexOf("Paste a competitor domain, brand name");
    expect(commandStart).toBeGreaterThan(-1);
    expect(idleCopy).toBeGreaterThan(commandStart);
    expect(route.match(/className="f9-wk-kick"/g) ?? []).toHaveLength(0);
    expect(route.match(/className="f9-wk-btn"/g)).toHaveLength(3);
    expect(route).not.toContain("f9-search-specimen");
  });

  it("stops pinning a second palette and a gradient onto the search page", () => {
    const base = cssRules.slice(cssRules.indexOf(".f9-find-page {"));
    const rule = base.slice(0, base.indexOf("}"));
    expect(rule).toContain("--f9-search-ink: var(--ink)");
    expect(rule).not.toContain("#061629");
    expect(rule).not.toContain("ui-sans-serif");
    expect(cssRules).not.toContain("linear-gradient(180deg, rgba(255, 253, 246, 0.92)");
  });

  it("keeps the hardcoded greens out of the rebuilt surface", () => {
    // `#65d5bb` was the micro-label colour on six search surfaces and
    // `#0a7b62` was the search answer's label: two greens that never went
    // through a token, so a probe scoped to this layer's own classes could
    // not see either of them. Both are off /search now.
    expect(cssRules).not.toContain(".f9-proof-block > span");
    expect(cssRules).not.toContain("#0a7b62");
    const answer = cssRules.slice(cssRules.indexOf(".f9-wk-page .f9-search-answer span"));
    expect(answer.slice(0, answer.indexOf("}"))).toContain("var(--ink-faint)");
  });
});
