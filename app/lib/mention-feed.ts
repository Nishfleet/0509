import { localDaysAgoLabel } from "./alert-day";
import { daysAgoLabel } from "./delivery-alert";
import { noulAction } from "./jev/thresholds";
import { sourceName } from "./source-name";
import { whyFlagged, type WhyFlagged } from "./why-flagged";

export type MentionTreatment = "shown" | "possibly" | "held" | "unreviewed" | "pending";

export interface MentionReadRow {
  id: string;
  title: string | null;
  url: string;
  platform: string;
  kind: string;
  publishedAt: string | null;
  observedAt: string;
  p: number | null;
  reason: string | null;
  verdictId: string | null;
  verdictDecidedAt: string | null;
  state: "judged" | "unjudged" | null;
  alsoCount: number;
}

export interface MentionRowModel {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  observedAt: string;
  treatment: MentionTreatment;
  when: string;
  why: string | null;
  whyFlagged: WhyFlagged | null;
  alsoCount: number;
}

export const POSSIBLY_LINE = "Possibly. We weren't sure this mattered, so it sits here rather than in your brief.";

export const UNREVIEWED_LINE =
  "Not reviewed yet. We haven't looked at this one, so it sits here rather than in your brief.";

export const PENDING_LINE =
  "Still being checked. We haven't decided yet whether this matters, so it sits here rather than in your brief.";

export function alsoReportedLine(count: number): string {
  return `Also reported by ${String(count)} other ${count === 1 ? "source" : "sources"}`;
}

export function mentionTreatment(p: number): MentionTreatment {
  const action = noulAction(p);
  if (action === "act") return "shown";
  if (action === "reject") return "held";
  return "possibly";
}

export function mentionWhen(dates: { publishedAt: string | null; observedAt: string }, now: Date): string {
  if (dates.publishedAt === null) return `found ${daysAgoLabel(dates.observedAt, now)}`;
  return daysAgoLabel(dates.publishedAt, now);
}

export function mentionAlertWhen(
  dates: { publishedAt: string | null; observedAt: string },
  now: Date,
  timeZone: string,
) {
  const found = localDaysAgoLabel(dates.observedAt, now, timeZone);
  if (dates.publishedAt === null) return `found ${found}`;
  const published = localDaysAgoLabel(dates.publishedAt, now, timeZone);
  return published === found ? `found ${found}` : `found ${found} · published ${published}`;
}

function storedReason(reason: string | null): string | null {
  const text = reason?.trim() ?? "";
  return text === "" ? null : text;
}

export function mentionsFromRows(rows: readonly MentionReadRow[], now: Date): MentionRowModel[] {
  return rows.flatMap((row) => {
    const title = row.title?.trim() ?? "";
    if (title === "" || row.url === "") return [];
    const judged: MentionTreatment | null = row.p === null || !Number.isFinite(row.p) ? null : mentionTreatment(row.p);
    const treatment: MentionTreatment = row.state === "unjudged" ? "pending" : (judged ?? "unreviewed");
    return [
      {
        id: row.id,
        title,
        url: row.url,
        sourceName: sourceName(row.kind, row.platform),
        publishedAt: row.publishedAt,
        observedAt: row.observedAt,
        treatment,
        when: mentionWhen(row, now),
        alsoCount: row.alsoCount,
        why: storedReason(row.reason),
        whyFlagged: whyFlagged({
          verdictId: row.verdictId,
          p: row.p,
          reason: row.reason,
          decidedAt: row.verdictDecidedAt,
          compared: [
            { label: "Source", value: sourceName(row.kind, row.platform) },
            { label: "Link", value: row.url },
          ],
        }),
      },
    ];
  });
}

export function showInFeed(
  item: { kind: string; mention?: { treatment: MentionTreatment } },
  showAll: boolean,
): boolean {
  if (item.kind !== "mention" || item.mention === undefined) return true;
  return showAll || item.mention.treatment !== "held";
}

export function withoutMentionAlerts<T extends { kind: string }>(signals: readonly T[]): T[] {
  return signals.filter((signal) => signal.kind !== "mention");
}
