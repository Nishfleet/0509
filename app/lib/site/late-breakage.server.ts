import { env } from "cloudflare:workers";

import { insertIncidentAlertStatement } from "../data/alert.server";
import { openIncidentStatement } from "../data/incident.server";
import { markSignalBreakageStatement, type UnjudgedChange } from "../data/signal.server";
import { breakageProof, type BreakageEvidence } from "./breakage-evidence";

const LATE_BREAKAGE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export async function openLateBreakage(
  row: UnjudgedChange,
  breakage: { band: "alert" | "check"; evidence: BreakageEvidence },
  now: Date,
): Promise<void> {
  const { band, evidence } = breakage;
  if (row.pageId === null || now.getTime() - Date.parse(row.observedAt) > LATE_BREAKAGE_MAX_AGE_MS) return;
  const incidentId = crypto.randomUUID();
  const at = now.toISOString();
  const results = await env.DB.batch([
    markSignalBreakageStatement(row.id),
    openIncidentStatement({
      id: incidentId,
      workspaceId: row.workspaceId,
      entityId: row.entityId,
      pageId: row.pageId,
      kind: "breakage",
      openedAt: at,
    }),
    insertIncidentAlertStatement({
      id: `incident-${incidentId}`,
      workspaceId: row.workspaceId,
      entityId: row.entityId,
      pageId: row.pageId,
      signalId: row.id,
      incidentId,
      severity: band === "alert" ? "high" : "normal",
      title: `${row.entityDomain} looks broken: breakage`,
      body: breakageProof(evidence),
      createdAt: at,
    }),
  ]);
  if (results[1]?.meta.changes === 1 && band === "alert") {
    await env.SEND_EMAIL.send({ incident_id: incidentId });
  }
}
