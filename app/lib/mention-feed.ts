import { daysAgoLabel } from "./delivery-alert";
import { noulAction } from "./jev/thresholds";
import { sourceName } from "./source-name";

export type MentionTreatment = "shown" | "possibly" | "held" | "unreviewed";

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
}

const FOUND_TODAY = "found today";

export const POSSIBLY_LINE =
  "Possibly. We were not sure this mattered, so it sits here rather than in your brief.";

export const UNREVIEWED_LINE =
  "Unreviewed. We have not reviewed this yet, so it sits here rather than in your brief.";

export function mentionTreatment(p: number): MentionTreatment {
  const action = noulAction(p);
  if (action === "act") return "shown";
  if (action === "reject") return "held";
  return "possibly";
}

export function mentionWhen(publishedAt: string | null, now: Date): string {
  if (publishedAt === null) return FOUND_TODAY;
  return daysAgoLabel(publishedAt, now);
}

function storedReason(reason: string | null): string | null {
  const text = reason?.trim() ?? "";
  return text === "" ? null : text;
}

export function mentionsFromRows(rows: readonly MentionReadRow[], now: Date): MentionRowModel[] {
  return rows.flatMap((row) => {
    const title = row.title?.trim() ?? "";
    if (title === "" || row.url === "") return [];
    const treatment: MentionTreatment =
      row.p === null || !Number.isFinite(row.p) ? "unreviewed" : mentionTreatment(row.p);
    return [
      {
        id: row.id,
        title,
        url: row.url,
        sourceName: sourceName(row.kind, row.platform),
        publishedAt: row.publishedAt,
        observedAt: row.observedAt,
        treatment,
        when: mentionWhen(row.publishedAt, now),
        why: storedReason(row.reason),
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
