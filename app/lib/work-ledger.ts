import { countPhrase } from "./quiet-week";

export interface WorkLedger {
  rivals: number;
  pages_read: number;
  changes_seen: number;
  changes_told: number;
  changes_set_aside: number;
  mentions_read: number;
  mentions_kept: number;
}

function pagesClause(ledger: WorkLedger): string | null {
  if (ledger.pages_read === 0) return null;
  const across = ledger.rivals > 0 ? ` across ${countPhrase(ledger.rivals, "rival", "rivals")}` : "";
  return `read ${countPhrase(ledger.pages_read, "page", "pages")}${across}`;
}

function changesClause(ledger: WorkLedger): string {
  if (ledger.changes_seen === 0) return "saw no changes";
  const seen = `saw ${countPhrase(ledger.changes_seen, "change", "changes")}`;
  if (ledger.changes_told === 0) return `${seen}, none worth your time`;
  return `${seen}, ${String(ledger.changes_told)} worth your time`;
}

function mentionsClause(ledger: WorkLedger): string | null {
  if (ledger.mentions_read === 0) return null;
  return `read ${countPhrase(ledger.mentions_read, "mention", "mentions")} and kept ${String(ledger.mentions_kept)}`;
}

export function ledgerParts(ledger: WorkLedger): string[] {
  return [pagesClause(ledger), changesClause(ledger), mentionsClause(ledger)].filter(
    (part): part is string => part !== null,
  );
}

export function ledgerSentence(ledger: WorkLedger, lead: string): string {
  return `${lead} ${ledgerParts(ledger).join("; ")}.`;
}

export function quietLedgerLine(ledger: WorkLedger): string | null {
  if (ledger.pages_read === 0) return null;
  return ledgerSentence(ledger, "Quiet week: we");
}

function setAsideNote(ledger: WorkLedger): string | null {
  if (ledger.changes_set_aside === 0) return null;
  return `${countPhrase(ledger.changes_set_aside, "change", "changes")} judged too small to interrupt you stayed off the brief.`;
}

export function ledgerSummary(ledger: WorkLedger | undefined, lead: string): string | null {
  if (ledger === undefined) return null;
  if (ledger.pages_read === 0 && ledger.changes_seen === 0 && ledger.mentions_read === 0) return null;
  return [ledgerSentence(ledger, lead), setAsideNote(ledger)].filter((part) => part !== null).join(" ");
}
