import { meterWidthClass } from "~/lib/meter-width";
import type { BrandPageAggression } from "~/lib/brand-page.server";

const COMPONENT_ROWS: { key: keyof BrandPageAggression["components"]; label: string }[] = [
  { key: "velocity", label: "Velocity" },
  { key: "testing", label: "Testing" },
  { key: "freshness", label: "Freshness" },
  { key: "persistence", label: "Persistence" },
];

/** Bands the diff-red "hot alarm" stamp treatment (aggressive / all-out). */
const HOT_BANDS = new Set(["aggressive", "all_out"]);

/**
 * The Ad Aggression Score dossier card. Renders the real 0-100 score, its band
 * stamp, the four component bars (which always sum to the score — the formula
 * is public), and a plain-language formula note. Below the evidence floor the
 * score is HIDDEN and replaced with an honest "not enough history" note —
 * never a score on thin evidence.
 */
export function BrandScoreCard({ aggression }: { aggression: BrandPageAggression | null }) {
  if (!aggression) {
    return (
      <div className="f9-ads-score-card f9-ads-score-thin">
        <div className="f9-ads-score-label">Ad Aggression Score</div>
        <p className="f9-ads-score-thin-note">
          Not enough history yet to score — we need at least 14 days of watching before we put a
          number on it. Start watching and the score fills in.
        </p>
      </div>
    );
  }

  const hot = HOT_BANDS.has(aggression.bandId);

  return (
    <div className="f9-ads-score-card">
      <span className={`f9-ads-score-stamp${hot ? " f9-ads-score-stamp-hot" : ""}`}>
        {aggression.bandLabel}
      </span>
      <div className="f9-ads-score-label">{`Ad Aggression Score · last ${aggression.windowDays} days`}</div>
      <div className="f9-ads-score-num">
        {aggression.score}
        <small>/100</small>
      </div>
      <span className={`f9-ads-score-band${hot ? " f9-ads-score-band-hot" : ""}`}>
        {aggression.bandInterpretation}
      </span>
      <div className="f9-ads-score-components">
        {COMPONENT_ROWS.map(({ key, label }) => {
          const value = aggression.components[key];
          const pct = Math.max(0, Math.min(100, (value / 25) * 100));
          return (
            <div className="f9-ads-comp" key={key}>
              <span className="f9-ads-comp-name">{label}</span>
              <span className="f9-ads-comp-track">
                <span className={`f9-ads-comp-fill ${meterWidthClass(pct)}`} />
              </span>
              <span className="f9-ads-comp-val">{value}</span>
            </div>
          );
        })}
      </div>
      <p className="f9-ads-score-formula">
        Four parts, 0–25 each — they add up to the score, no hidden weighting. The whole formula is
        public.
      </p>
    </div>
  );
}
