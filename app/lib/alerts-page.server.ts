import { env } from "cloudflare:workers";

import {
  type DeliveryFailureItem,
  type SignalAlertItem,
  type TakedownNoteItem,
} from "../components/alert-row";
import {
  type AlertChipKey,
  countAlertChips,
  itemInChip,
} from "./alert-chips";
import { groupByDay } from "./alert-day";
import {
  acknowledgeIncidentAlert,
  readDeliveryFailures,
  readOpenIncidentBlock,
  readOwnSiteIncidents,
  readSignalAlerts,
  readTakedownNotes,
} from "./data/alert.server";
import { readCompetitors } from "./data/entity.server";
import { readMentionFeed } from "./data/mention.server";
import { readWorkspaceMentionSources } from "./data/source.server";
import { readWorkspaceIdForOwner, readWorkspaceTimezone } from "./data/workspace.server";
import { daysAgoLabel } from "./delivery-alert";
import { nextOwnSiteCheck } from "./incident-recheck";
import { withoutMentionAlerts } from "./mention-feed";
import { offBrandsSentence } from "./off-brands";
import { loadAlertsFeed } from "./site/alerts-feed.server";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";

export async function loadAlertsPage(userId: string, chip: AlertChipKey) {
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
  const marks = workspaceId === null ? [] : await loadAlertsFeed(workspaceId, now);
  const timeZone = workspaceId === null ? "UTC" : await readWorkspaceTimezone(workspaceId);
  const open = workspaceId === null ? null : await readOpenIncidentBlock(env.DB, workspaceId);
  const recheckAt = nextOwnSiteCheck(now);
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
    marks,
    incidents: incidents
      .filter((incident) => incident.id !== open?.alert_id)
      .map((incident) => ({
        ...incident,
        when: daysAgoLabel(incident.created_at, now),
        fixed: incident.closed_at === null ? null : daysAgoLabel(incident.closed_at, now),
      })),
    chip,
    chipCounts: countAlertChips(
      items.map((item) => item.kind),
      incidents.length,
    ),
    groups: groupByDay(items.filter((item) => itemInChip(item.kind, chip)), now, timeZone),
    sources,
    now: now.getTime(),
    openIncident:
      open === null
        ? null
        : {
            alertId: open.alert_id,
            title: open.title,
            kind: open.kind,
            url: open.url,
            openedLabel: daysAgoLabel(open.opened_at, now),
            recheckAt,
            recheckLabel: new Intl.DateTimeFormat("en-US", {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            }).format(new Date(recheckAt)),
          },
    offLine: offBrandsSentence(
      competitors.filter((competitor) => competitor.state === "off").map((competitor) => competitor.name),
    ),
  };
}

export async function acknowledgeOwnSiteIncident(userId: string, alertId: string): Promise<void> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId === null) return;
  await acknowledgeIncidentAlert(env.DB, workspaceId, alertId, new Date().toISOString());
}
