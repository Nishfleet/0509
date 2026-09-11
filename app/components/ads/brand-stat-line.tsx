import type { BrandPageAggression, BrandIntelTeaser } from "~/lib/brand-page.server";
import type { AdRecord } from "~/lib/types";

interface StatCell {
  key: string;
  value: string;
  unit?: string;
  caption: string;
  context: string;
  hot?: boolean;
}

/**
 * "Nike, by the numbers" — the box-score stat strip. Every cell traces to a
 * real loader field; cells whose data is missing are DROPPED (the grid
 * reflows) rather than zero-stuffed, and the whole strip is hidden if fewer
 * than two cells survive. Never invents a number. The "Ads live" caption
 * only applies while the capture is fresh enough for a live claim — older
 * captures read "Ads on record".
 */
export function BrandStatLine({
  teaser,
  aggression,
  testedCount,
  movesThisWeek,
  freshnessLabel,
  fresh,
  brandOwnedAdCount,
}: {
  teaser: BrandIntelTeaser;
  aggression: BrandPageAggression | null;
  /**
   * How many VERIFIED-LINKED cached creatives carry more than one variant —
   * the loader's count for the "Split-testing N/total" cell (issue #2704).
   * The strip used to receive the whole verified subset just to run this one
   * predicate client-side; the payload now ships the number.
   */
  testedCount: number;
  movesThisWeek: number;
  freshnessLabel: string | null;
  fresh: boolean;
  brandOwnedAdCount: number;
}) {
  const cells: StatCell[] = [];
  // A one-ad capture must read "1 ad active", never "1 ads active".
  const adWord = teaser.activeCount === 1 ? "ad" : "ads";

  cells.push({
    key: "ads-live",
    value: String(teaser.totalCount),
    caption: fresh ? "Ads live" : "Ads on record",
    // Public-page copy: "active" is the ad's observed Ad Library status
    // (ad_active_status), never a viewer's marking — that is signed-in
    // language. Stale captures read "at the last check", mirroring the
    // page's past-tense honesty convention.
    // Two different live counts must never collide on the proof page (issue
    // #2319): the H1 owns the brand-owned count, so this strip names BOTH
    // numbers the loader derives from different fields — activeCount (ads
    // live at the capture) and brandOwnedAdCount (brand-owned among all the
    // verified-linked creatives) — each with a label, so a visitor can't
    // read them as one quantity. Both come from real loader fields, never
    // hardcoded figures, and pluralize so a one-ad capture reads "1 ad".
    context: fresh
      ? `${teaser.activeCount} ${adWord} active (${brandOwnedAdCount} brand-owned)`
      : `${teaser.activeCount} ${adWord} active at last check (${brandOwnedAdCount} brand-owned)`,
  });

  if (aggression) {
    cells.push({
      key: "new-week",
      value: formatPerWeek(aggression.adsPerWeek),
      unit: "/wk",
      caption: "New this week",
      context: "average launch rate",
      hot: true,
    });
  }

  if (teaser.longestRunningDays !== null) {
    cells.push({
      key: "longest-run",
      value: String(teaser.longestRunningDays),
      unit: "d",
      caption: "Longest run",
      context: teaser.longestRunningHook ? truncate(teaser.longestRunningHook, 26) : "proven runner",
    });
  }

  if (teaser.formats.length > 0) {
    cells.push({
      key: "formats",
      value: String(teaser.formats.length),
      caption: "Formats",
      context: teaser.formats.join(" · "),
    });
  }

  if (testedCount > 0) {
    cells.push({
      key: "split-testing",
      value: String(testedCount),
      unit: `/${teaser.totalCount}`,
      caption: "Split-testing",
      context: "running variants",
    });
  }

  if (movesThisWeek > 0) {
    cells.push({
      key: "moves",
      value: String(movesThisWeek),
      caption: "Moves this week",
      context: "new ads in rotation",
    });
  }

  if (cells.length < 2) return null;

  return (
    <section className="f9-ads-numbers" aria-labelledby="brand-numbers-label">
      <div className="f9-container">
        <div className="f9-ads-numbers-label" id="brand-numbers-label">
          By the numbers
          {freshnessLabel ? <span className="f9-ads-numbers-sub">{`— cached ${freshnessLabel}`}</span> : null}
        </div>
        <div className="f9-ads-statline" data-cells={cells.length}>
          {cells.map((cell) => (
            <div className={`f9-ads-cell${cell.hot ? " f9-ads-cell-hot" : ""}`} key={cell.key}>
              <div className="f9-ads-sv">
                {cell.value}
                {cell.unit ? <span className="f9-ads-su">{cell.unit}</span> : null}
              </div>
              <div className="f9-ads-sn">{cell.caption}</div>
              <div className="f9-ads-sd">{cell.context}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatPerWeek(value: number): string {
  if (value >= 10) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/, "");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}
