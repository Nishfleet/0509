import type { CSSProperties, ReactElement } from "react";

import type { SnapshotCell } from "../lib/competitor-snapshot";
import { movementLabel } from "../lib/home-standing";

const COLUMNS = 6;

function missingNotes(cells: readonly SnapshotCell[]): { reason: string; labels: string }[] {
  const byReason = new Map<string, string[]>();
  for (const cell of cells) {
    if (cell.value !== null) continue;
    byReason.set(cell.reason, [...(byReason.get(cell.reason) ?? []), cell.label]);
  }
  return [...byReason].map(([reason, labels]) => ({ reason, labels: labels.join(", ") }));
}

export function CompetitorSnapshot({ cells }: { cells: readonly SnapshotCell[] }): ReactElement {
  const counted = cells.filter((cell) => cell.value !== null);
  const notes = missingNotes(cells);
  return (
    <section aria-label="This week in six numbers" className="flex min-w-0 flex-col gap-3">
      {counted.length === 0 ? null : (
        <dl
          className="grid grid-cols-2 divide-x divide-y divide-line border border-line sm:grid-cols-3 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
          style={{ "--cols": Math.min(counted.length, COLUMNS) } as CSSProperties}
        >
          {counted.map((cell) => (
            <div key={cell.key} className="flex flex-col gap-1 p-4" data-cell={cell.key}>
              <dt className="font-mono text-eyebrow text-ink-soft uppercase">{cell.label}</dt>
              <dd>
                {cell.key === "rank" ? "#" : null}
                <span className="text-2xl font-semibold text-ink tabular-nums">{cell.value}</span>
                {cell.key === "rank" && cell.movement !== null ? (
                  <>
                    {" "}
                    <span className="ml-2 font-mono text-eyebrow text-ink-soft">
                      {movementLabel(cell.movement, false)}
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {notes.map((note) => (
        <p key={note.reason} data-slot="snapshot-missing" className="text-meta text-ink-soft">
          <span className="font-medium text-ink">{note.labels}:</span> {note.reason}
        </p>
      ))}
    </section>
  );
}
