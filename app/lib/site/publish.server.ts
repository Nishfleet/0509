import { env } from "cloudflare:workers";

import { insertIncidentAlertStatement } from "../data/alert.server";
import { openIncidentStatement } from "../data/incident.server";
import { insertChangeSignalStatement } from "../data/signal.server";
import { nextOwnSiteCheck } from "../incident-recheck";
import type { ChangeJudgment } from "./judge.server";

export interface PublishChangeInput {
  workspaceId: string;
  entityId: string;
  sourceId: string;
  watchId: string;
  pageId: string;
  snapshotId: string;
  url: string;
  judgment: ChangeJudgment;
  textKey: string;
  previousTextKey: string;
  screenshotKey: string | null;
  previousScreenshotKey: string;
}

export interface PublishedChange {
  signalId: string | null;
  incidentId: string | null;
  alertId: string | null;
}

const ALERT_TITLE = "Your site looks broken";
const CHECK_TITLE = "Check this change on your site";

interface PublishedBand {
  p: number;
  band: string;
}

function payloadJson(input: PublishChangeInput, verdict: PublishedBand, seenAt: string | null = null): string {
  return JSON.stringify({
    textKey: input.textKey,
    previousTextKey: input.previousTextKey,
    screenshotKey: input.screenshotKey,
    previousScreenshotKey: input.previousScreenshotKey,
    p: verdict.p,
    band: verdict.band,
    ...(seenAt === null ? {} : { seenAt, recheckAt: nextOwnSiteCheck(new Date(seenAt)) }),
  });
}

export async function publishChange(input: PublishChangeInput): Promise<PublishedChange> {
  const { selfBreakage, noteworthy } = input.judgment;
  if (selfBreakage !== null && (selfBreakage.band === "alert" || selfBreakage.band === "check")) {
    const seenAt = new Date().toISOString();
    const signalId = crypto.randomUUID();
    const incidentId = crypto.randomUUID();
    const alertId = crypto.randomUUID();
    const title = selfBreakage.band === "alert" ? ALERT_TITLE : CHECK_TITLE;
    const statements = [
      insertChangeSignalStatement({
        id: signalId,
        workspaceId: input.workspaceId,
        entityId: input.entityId,
        sourceId: input.sourceId,
        watchId: input.watchId,
        snapshotId: input.snapshotId,
        title,
        summary: selfBreakage.reason,
        url: input.url,
        aspect: "breakage",
        payloadJson: payloadJson(input, selfBreakage, seenAt),
        observedAt: seenAt,
      }),
      openIncidentStatement({
        id: incidentId,
        workspaceId: input.workspaceId,
        entityId: input.entityId,
        pageId: input.pageId,
        kind: "breakage",
        openedAt: seenAt,
      }),
      insertIncidentAlertStatement({
        id: alertId,
        workspaceId: input.workspaceId,
        entityId: input.entityId,
        pageId: input.pageId,
        signalId,
        incidentId,
        severity: selfBreakage.band === "alert" ? "high" : "normal",
        title: `${title}: ${input.url}`,
        body: selfBreakage.reason,
        createdAt: seenAt,
      }),
    ];
    const results = await env.DB.batch(statements);
    const opened = results[1]?.meta.changes === 1;
    if (!opened) {
      return {
        signalId: results[0]?.meta.changes === 1 ? signalId : null,
        incidentId: null,
        alertId: null,
      };
    }
    const [signal, incident, alert] = results;
    if (selfBreakage.band === "alert") await env.SEND_EMAIL.send({ incident_id: incidentId });
    return {
      signalId: signal.meta.changes === 1 ? signalId : null,
      incidentId: incident.meta.changes === 1 ? incidentId : null,
      alertId: alert.meta.changes === 1 ? alertId : null,
    };
  }

  if (noteworthy !== null && (noteworthy.band === "publish" || noteworthy.band === "uncertain")) {
    const signalId = crypto.randomUUID();
    const [signal] = await env.DB.batch([
      insertChangeSignalStatement({
        id: signalId,
        workspaceId: input.workspaceId,
        entityId: input.entityId,
        sourceId: input.sourceId,
        watchId: input.watchId,
        snapshotId: input.snapshotId,
        title: `${noteworthy.kind} change`,
        summary: noteworthy.reason,
        url: input.url,
        aspect: noteworthy.kind,
        payloadJson: payloadJson(input, noteworthy),
        observedAt: new Date().toISOString(),
      }),
    ]);
    return { signalId: signal.meta.changes === 1 ? signalId : null, incidentId: null, alertId: null };
  }

  return { signalId: null, incidentId: null, alertId: null };
}
