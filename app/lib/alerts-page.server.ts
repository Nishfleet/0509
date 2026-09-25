import { env } from "cloudflare:workers";

import {
  type DeliveryFailureItem,
  type SignalAlertItem,
  type TakedownNoteItem,
} from "../components/alert-row";
import { groupByDay } from "./alert-day";
import {
  readDeliveryFailures,
  readOwnSiteIncidents,
  readSignalAlerts,
  readTakedownNotes,
} from "./data/alert.server";
import { readCompetitors } from "./data/entity.server";
import { readMentionFeed } from "./data/mention.server";
import { readWorkspaceMentionSources } from "./data/source.server";
import { readWorkspaceIdForOwner, readWorkspaceTimezone } from "./data/workspace.server";
import { daysAgoLabel } from "./delivery-alert";
import { withoutMentionAlerts } from "./mention-feed";
import { offBrandsSentence } from "./off-brands";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";

export async function loadAlertsPage(userId: string) {
  const now = new Date();
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const competitors = workspaceId === null ? [] : (await readCompetitors(workspaceId)).competitors;
  const failures = workspaceId === null ? [] : await readDeliveryFailures(env.DB, workspaceId);
  const notes = workspaceId === null ? [] : await readTakedownNotes(env.DB, workspaceId);
  const incidents = workspaceId === null ? [] : await readOwnSiteIncidents(env.DB, workspaceId);
  const signals = workspaceId === null ? [] : await readSignalAlerts(env.DB, workspaceId);
  const mentions = workspaceId === null ? [] : await readMentionFeed(workspaceId, now);
  const sources = workspaceId === null ? [] : await readWorkspaceMentionSources(workspaceId);
  const changes =
    workspaceId === null
      ? []
      : await readSiteChangeViews({ workspaceId, entityId: null, since: daysBefore(now, 30), limit: 30 });
  const timeZone = workspaceId === null ? "UTC" : await readWorkspaceTimezone(workspaceId);
  const items = [
    ...changes.map((change) => ({
      kind: "change" as const,
      id: change.id,
      at: change.observedAt,
      change: { ...change, when: daysAgoLabel(change.observedAt, now) },
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      id: note.id,
      at: note.created_at,
      note: { ...note, when: daysAgoLabel(note.created_at, now) } satisfies TakedownNoteItem,
    })),
    ...failures.map((failure) => ({
      kind: "failure" as const,
      id: failure.id,
      at: failure.created_at,
      failure: { ...failure, when: daysAgoLabel(failure.created_at, now) } satisfies DeliveryFailureItem,
    })),
    ...withoutMentionAlerts(signals).map((signal) => ({
      kind: "signal" as const,
      id: signal.id,
      at: signal.created_at,
      signal: {
        id: signal.id,
        title: signal.title,
        body: signal.body,
        url: signal.url,
        created_at: signal.created_at,
        when: daysAgoLabel(signal.created_at, now),
      } satisfies SignalAlertItem,
    })),
    ...mentions.map((mention) => ({
      kind: "mention" as const,
      id: mention.id,
      at: mention.publishedAt ?? mention.observedAt,
      mention,
    })),
  ];
  return {
    incidents: incidents.map((incident) => ({
      ...incident,
      when: daysAgoLabel(incident.created_at, now),
      fixed: incident.closed_at === null ? null : daysAgoLabel(incident.closed_at, now),
    })),
    groups: groupByDay(items, now, timeZone),
    sources,
    now: now.getTime(),
    offLine: offBrandsSentence(
      competitors.filter((competitor) => competitor.state === "off").map((competitor) => competitor.name),
    ),
  };
}
