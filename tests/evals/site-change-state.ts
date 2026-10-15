import { changeState } from "../../app/lib/site/judge.server";
import type { ChangeStateInput } from "../../app/lib/site/judge.server";
import type { SiteRow } from "./harness";

export const CASE_FILE = "site-change";

export function stateFor(row: SiteRow<boolean | string>): unknown {
  const input: ChangeStateInput = {
    isSelf: row.isSelf,
    subject: row.subject,
    pageUrl: row.pageUrl,
    pageRole: row.pageRole,
    hunks: row.hunks,
    evidence: row.evidence,
  };
  return changeState(input, row.history_30d);
}

export function half<T>(rows: readonly T[], part: 0 | 1): T[] {
  return rows.filter((_, index) => index % 2 === part);
}

export function misses(rows: readonly { id: string; label: string }[], picks: ReadonlyMap<string, string[]>): string {
  return rows
    .filter((row) => (picks.get(row.id) ?? []).some((pick) => pick !== row.label))
    .map((row) => `${row.id}\texpected ${row.label}\tgot ${(picks.get(row.id) ?? []).join(",")}`)
    .join("\n");
}
