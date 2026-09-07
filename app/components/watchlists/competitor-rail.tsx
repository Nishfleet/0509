import { TertiaryAction } from "~/components/evidence/cta";
import { FactRail, type FactRow } from "~/components/evidence/fact-rail";
import type { CompetitorDeliveryLine } from "~/lib/watchlist-detail-display";

/**
 * The opened competitor's right rail — brief §7: exactly one number card,
 * one fact rail and one delivery card. Nothing else is allowed to move in.
 *
 * This is the explicit rejection of R1's right-rail-of-everything (§6.6):
 * the rail answers "what are we watching, and how do we know", the status
 * strip answers "where does it stand", and the tab panels carry the work.
 */
export function CompetitorRail({
  windowDays,
  caughtValue,
  caughtNote,
  factRows,
  deliveryLines,
  deliveryHref,
}: {
  windowDays: number;
  caughtValue: string;
  caughtNote: string;
  factRows: readonly FactRow[];
  deliveryLines: readonly CompetitorDeliveryLine[];
  /** The Delivery tab — the rail states the policy, the tab edits it. */
  deliveryHref: string;
}) {
  return (
    <aside aria-label="Competitor facts" className="f9-evidence-detail-rail">
      <div className="f9-evidence-number-card">
        <p className="f9-evidence-micro">{`Caught · ${windowDays} days`}</p>
        <p className="f9-evidence-number-value">{caughtValue}</p>
        <p className="f9-evidence-number-note">{caughtNote}</p>
      </div>

      <FactRail rows={factRows} title="What we watch" />

      <div className="f9-evidence-rail-card">
        <p className="f9-evidence-micro">Who gets told</p>
        <dl className="f9-evidence-rail-lines">
          {deliveryLines.map((line) => (
            <div className="f9-evidence-rail-line" key={line.key}>
              <dt>{line.key}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
        <TertiaryAction to={deliveryHref}>Delivery settings</TertiaryAction>
      </div>
    </aside>
  );
}
