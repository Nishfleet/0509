import type { ReactNode } from "react";

/**
 * Fact rail and honest inline values — brief §6.6 (R5 Dovetail degrade).
 *
 * A fact row is `mono uppercase key | mono value`, hairline-separated. When a
 * value is unknown the row STILL renders, with the value in --ink-faint,
 * regular weight, sentence case ("not published", "none yet", "we could not
 * read this one"). That single rule is what deletes the six-box "Insight
 * depth" grid (A2): six empty boxes become six honest rows in one rail.
 *
 * A rail is edited down to what an agency would quote — max 8 rows. This is
 * the explicit rejection of R1's right-rail-of-everything.
 */

export const FACT_RAIL_MAX_ROWS = 8;

export const DEFAULT_MISSING_VALUE = "not recorded";

export interface FactRow {
  /** Rendered uppercase in mono; keep it to a couple of words. */
  key: string;
  /** Null / undefined / blank all degrade to the honest missing value. */
  value?: ReactNode | null;
  /** Sentence-case honesty copy for this specific row. */
  missingLabel?: string;
  title?: string;
}

export function isMissingFactValue(value: ReactNode | null | undefined): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

export function FactRailRow({ row }: { row: FactRow }) {
  const missing = isMissingFactValue(row.value);
  return (
    <div className="f9-evidence-fact-row" title={row.title}>
      <span className="f9-evidence-fact-key">{row.key}</span>
      <span className={missing ? "f9-evidence-fact-value is-missing" : "f9-evidence-fact-value"}>
        {missing ? (row.missingLabel ?? DEFAULT_MISSING_VALUE) : row.value}
      </span>
    </div>
  );
}

export function FactRail({
  rows,
  title,
  className,
}: {
  rows: readonly FactRow[];
  /** Optional mono kicker above the rows. */
  title?: string;
  className?: string;
}) {
  const visible = rows.slice(0, FACT_RAIL_MAX_ROWS);
  if (visible.length === 0) return null;

  return (
    <div className={className ? `f9-evidence-fact-rail ${className}` : "f9-evidence-fact-rail"}>
      {title ? <div className="f9-evidence-fact-rail-header f9-evidence-micro">{title}</div> : null}
      {visible.map((row, index) => (
        // Index key: a rail may legitimately repeat a key (two "Source" rows
        // from two captures), and rows never reorder within a render.
        <FactRailRow key={`${index}-${row.key}`} row={row} />
      ))}
    </div>
  );
}
