import type { ReactElement } from "react";

import { percent, type RetentionBoard } from "../lib/retention-board";

const CELL = "border-t border-line px-3 py-2 text-right font-mono text-meta tabular-nums";
const HEAD = "px-3 py-2 text-right font-mono text-eyebrow text-ink-soft uppercase";

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }): ReactElement {
  return (
    <section className="mt-10">
      <h2 className="font-display text-row-name font-bold">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem]">
          <thead>
            <tr>
              {head.map((label, index) => (
                <th key={label} scope="col" className={index === 0 ? `${HEAD} text-left` : HEAD}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells) => (
              <tr key={cells.join("|")}>
                {cells.map((cell, index) => (
                  <td key={`${String(index)}-${cell}`} className={index === 0 ? `${CELL} text-left` : CELL}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function funnelRows(board: RetentionBoard): string[][] {
  return board.funnel.map((row) => [
    row.week,
    String(row.signed_up),
    String(row.started),
    String(row.trialing),
    String(row.paying),
    String(row.cancelled),
    percent(row.paying, row.started),
  ]);
}

function lastSeenRows(board: RetentionBoard): string[][] {
  return [
    ["Within 7 days", String(board.lastSeen.week)],
    ["8 to 20 days ago", String(board.lastSeen.drifting)],
    ["21 days or more", String(board.lastSeen.away)],
    ["Never opened the app", String(board.lastSeen.never)],
  ];
}

function emailRows(board: RetentionBoard): string[][] {
  return board.emails.map((row) => [row.kind, String(row.sent), String(row.visited), percent(row.visited, row.sent)]);
}

export function RetentionBoardView({ board }: { board: RetentionBoard }): ReactElement {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 px-4 py-10 sm:px-8">
      <h1 className="font-display text-2xl font-bold">Retention</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        Counts from our own database only. Visits are recorded once a day per workspace from the day this page shipped.
        Test accounts are included.
      </p>
      <Table
        title="Trial to paid, by signup week"
        head={["Week of", "Signed up", "Started", "In trial", "Paying", "Cancelled", "Paying of started"]}
        rows={funnelRows(board)}
      />
      <Table title="Last seen, live workspaces" head={["When", "Workspaces"]} rows={lastSeenRows(board)} />
      <Table
        title="Cancellations, by month"
        head={["Month", "Cancelled"]}
        rows={board.cancellations.map((row) => [row.month, String(row.cancelled)])}
      />
      <Table
        title="Emails sent in the last 30 days, and visits within a day"
        head={["Email", "Sent", "Visited that day or next", "Share"]}
        rows={emailRows(board)}
      />
    </main>
  );
}
