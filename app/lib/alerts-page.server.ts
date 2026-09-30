import { env } from "cloudflare:workers";

import { type DeliveryFailureItem, type SignalAlertItem, type TakedownNoteItem } from "../components/alert-row";
import { type HiringAlertItem } from "../components/hiring-row";
import { type AlertChipKey, countAlertChips, itemInChip } from "./alert-chips";
import { groupByDay } from "./alert-day";
import {
  acknowledgeIncidentAlert,
  readDeliveryFailures,
  readOpenIncidentBlock,
  readOwnSiteIncidents,
  readSignalAlerts,
  readTakedownNotes,
} from "./data/alert.server";
import { readWorkspaceHiring } from "./data/signal.server";
import { readCompetitors } from "./data/entity.server";
import { readMentionFeed } from "./data/mention.server";
import { readWorkspaceMentionSources } from "./data/source.server";
import { readWorkspaceIdForOwner, readWorkspaceTimezone } from "./data/workspace.server";
import { daysAgoLabel } from "./delivery-alert";
import { nextOwnSiteCheck } from "./incident-recheck";
import { withoutMentionAlerts } from "./mention-feed";
import { offBrandsSentence } from "./off-brands";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";

const HIRING_LIMIT = 100;

async function readWorkspaceAlertInputs(workspaceId: string, now: Date) {
  const competitors = (await readCompetitors(workspaceId)).competitors;
  const failures = await readDeliveryFailures(env.DB, workspaceId);
  const notes = await readTakedownNotes(env.DB, workspaceId);
  const incidents = await readOwnSiteIncidents(env.DB, workspaceId);
  const signals = await readSignalAlerts(env.DB, workspaceId);
  const mentions = await readMentionFeed(workspaceId, now);
  const hiring = await readWorkspaceHiring(workspaceId, daysBefore(now, 30), HIRING_LIMIT);
  const sources = await readWorkspaceMentionSources(workspaceId);
  const changes = await readSiteChangeViews({ workspaceId, entityId: null, since: daysBefore(now, 30), limit: 30 });
  const timeZone = await readWorkspaceTimezone(workspaceId);
  const open = await readOpenIncidentBlock(env.DB, workspaceId);
  return { competitors, failures, notes, incidents, signals, mentions, hiring, sources, changes, timeZone, open };
}

type AlertInputs = Awaited<ReturnType<typeof readWorkspaceAlertInputs>>;

const EMPTY_ALERT_INPUTS: AlertInputs = {
  competitors: [],
  failures: [],
  notes: [],
  incidents: [],
  signals: [],
  mentions: [],
  hiring: [],
  sources: [],
  changes: [],
  timeZone: "UTC",
  open: null,
};

async function readAlertInputs(workspaceId: string | null, now: Date): Promise<AlertInputs> {
  if (workspaceId === null) return EMPTY_ALERT_INPUTS;
  return readWorkspaceAlertInputs(workspaceId, now);
}

function buildAlertItems(inputs: AlertInputs, now: Date) {
  const { changes, notes, failures, signals, mentions, hiring } = inputs;
  return [
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
    ...hiring.map((post) => ({
      kind: "hiring" as const,
      id: post.id,
      at: post.published_at ?? post.observed_at,
      hiring: {
        id: post.id,
        title: post.title,
        brand: post.brand,
        detail: post.summary,
        url: post.url,
        at: post.published_at ?? post.observed_at,
        when: daysAgoLabel(post.published_at ?? post.observed_at, now),
      } satisfies HiringAlertItem,
    })),
    ...mentions.map((mention) => ({
      kind: "mention" as const,
      id: mention.id,
      at: mention.publishedAt ?? mention.observedAt,
      mention,
    })),
  ];
}

function buildOpenIncident(inputs: AlertInputs, now: Date) {
  const { open, timeZone } = inputs;
  if (open === null) return null;
  const recheckAt = nextOwnSiteCheck(now);
  return {
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
  };
}

function buildPastIncidents(inputs: AlertInputs, now: Date) {
  return inputs.incidents
    .filter((incident) => incident.id !== inputs.open?.alert_id)
    .map((incident) => ({
      ...incident,
      when: daysAgoLabel(incident.created_at, now),
      fixed: incident.closed_at === null ? null : daysAgoLabel(incident.closed_at, now),
    }));
}

export async function loadAlertsPage(userId: string, chip: AlertChipKey) {
  const now = new Date();
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const inputs = await readAlertInputs(workspaceId, now);
  const items = buildAlertItems(inputs, now);
  return {
    incidents: buildPastIncidents(inputs, now),
    chip,
    hiringCapped: inputs.hiring.length === HIRING_LIMIT,
    chipCounts: countAlertChips(
      items.map((item) => item.kind),
      inputs.incidents.length,
    ),
    groups: groupByDay(
      items.filter((item) => itemInChip(item.kind, chip)),
      now,
      inputs.timeZone,
    ),
    sources: inputs.sources,
    now: now.getTime(),
    openIncident: buildOpenIncident(inputs, now),
    offLine: offBrandsSentence(
      inputs.competitors.filter((competitor) => competitor.state === "off").map((competitor) => competitor.name),
    ),
  };
}

export async function acknowledgeOwnSiteIncident(userId: string, alertId: string): Promise<void> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId === null) return;
  await acknowledgeIncidentAlert(env.DB, workspaceId, alertId, new Date().toISOString());
}
