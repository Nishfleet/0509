import type { ReactElement } from "react";

import type { SnapshotCell } from "../lib/competitor-snapshot";
import { movementLabel } from "../lib/home-standing";

export function CompetitorSnapshot({ cells }: { cells: readonly SnapshotCell[] }): ReactElement {
  return (
    <section aria-label="This week in six numbers" className="border border-line">
      <dl className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((cell) => (
          <div key={cell.key} className="flex flex-col gap-1 p-4" data-cell={cell.key}>
            <dt className="font-mono text-eyebrow uppercase text-ink-soft">{cell.label}</dt>
            <dd>
              {cell.value === null ? (
                <details>
                  <summary
                    className="cursor-pointer text-2xl text-ink-soft"
                    aria-label={`No number: ${cell.reason ?? ""}`}
                  >
                    —
                  </summary>
                  <p className="text-meta text-ink-soft">{cell.reason}</p>
                </details>
              ) : (
                <>
                  {cell.key === "rank" ? "#" : null}
                  <span className="text-2xl font-semibold text-ink tabular-nums">{cell.value}</span>
                  {cell.key === "rank" && cell.movement !== null ? (
                    <span className="font-mono text-eyebrow text-ink-soft">
                      {movementLabel(cell.movement, false)}
                    </span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
