import { daysAgoLabel } from "./delivery-alert";
import { noulAction } from "./jev/thresholds";
import { sourceName } from "./source-name";

export type MentionTreatment = "shown" | "possibly" | "held";

export interface MentionReadRow {
  id: string;
  title: string | null;
  url: string;
  platform: string;
  kind: string;
  publishedAt: string | null;
  observedAt: string;
  entityState: string;
  p: number | null;
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
}

export const FOUND_TODAY = "found today";

export const POSSIBLY_LINE =
  "Possibly. We were not sure this mattered, so it sits here rather than in your brief.";

export const MENTION_FEED_SQL = `SELECT m.id, m.title, m.canonical_url AS url, m.published_at, m.observed_at,
  s.platform, s.kind, e.state AS entity_state, v.p
FROM mention m
JOIN entity e ON e.id = m.entity_id AND e.workspace_id = m.workspace_id AND e.state = 'on'
JOIN source s ON s.id = m.source_id
JOIN jev_verdict v ON v.id = (
  SELECT v2.id FROM jev_verdict v2
  WHERE v2.signal_id = m.id AND v2.workspace_id = m.workspace_id AND v2.question_id = ?2
  ORDER BY v2.decided_at DESC
  LIMIT 1
)
WHERE m.workspace_id = ?1
ORDER BY m.observed_at DESC, m.id DESC
LIMIT 50`;

export function mentionFeedBinds(workspaceId: string, questionId: string): [string, string] {
  return [workspaceId, questionId];
}

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

export function mentionWhy(treatment: MentionTreatment, name: string): string {
  if (treatment === "possibly") {
    return `Marked as possibly worth a look. The article is from ${name}.`;
  }
  if (treatment === "held") {
    return `Set aside until you show all. The article is from ${name}.`;
  }
  return `Kept in the feed. The article is from ${name}.`;
}

export function mentionsFromRows(rows: readonly MentionReadRow[], now: Date): MentionRowModel[] {
  return rows.flatMap((row) => {
    const title = row.title?.trim() ?? "";
    if (row.entityState !== "on" || row.p === null || !Number.isFinite(row.p) || title === "" || row.url === "") {
      return [];
    }
    return [
      {
        id: row.id,
        title,
        url: row.url,
        sourceName: sourceName(row.kind, row.platform),
        publishedAt: row.publishedAt,
        observedAt: row.observedAt,
        treatment: mentionTreatment(row.p),
        when: mentionWhen(row.publishedAt, now),
      },
    ];
  });
}

export function visibleMentions(mentions: readonly MentionRowModel[], showAll: boolean): MentionRowModel[] {
  if (showAll) return [...mentions];
  return mentions.filter((mention) => mention.treatment !== "held");
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
