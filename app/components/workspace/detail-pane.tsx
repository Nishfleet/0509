import type { ReactNode } from "react";

/**
 * BL-030 — the Linear-peek detail pane (concept v4).
 *
 * A slim 336px right pane opened by a subtly selected row, not an expanded
 * record and not a modal. It enters on Settle (260ms) and never on Land —
 * Land is reserved for a capture arriving.
 *
 * The pane holds, in order: the entity's name and address, one block per
 * thing worth saying, and the operational facts as a definition list. There
 * are no boxes in it.
 */

export function DetailPane({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <aside aria-label={label} className="f9-wk-detail">
      {children}
    </aside>
  );
}

export function DetailPaneHead({ name, site }: { name: ReactNode; site?: ReactNode }) {
  return (
    <>
      <h2 className="f9-wk-detail-name">{name}</h2>
      {site ? <p className="f9-wk-detail-site">{site}</p> : null}
    </>
  );
}

export function DetailBlock({
  children,
  kicker,
}: {
  children: ReactNode;
  kicker?: ReactNode;
}) {
  return (
    <div className="f9-wk-blk">
      {kicker ? <p className="f9-wk-kick">{kicker}</p> : null}
      {children}
    </div>
  );
}

export interface DetailFact {
  key: string;
  value: ReactNode;
}

/**
 * The operational facts. Five rows, sentence case, no mono caps: last check,
 * next check, changes on file, captured, watching since. Every value is read
 * off the loader — a fact we cannot read is written as such, never invented.
 */
export function DetailFacts({ rows }: { rows: DetailFact[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="f9-wk-dl">
      {rows.map((row) => (
        <div key={row.key} style={{ display: "contents" }}>
          <dt>{row.key}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
