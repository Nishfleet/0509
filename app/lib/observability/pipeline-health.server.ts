import { env } from "cloudflare:workers";

import { blindAlertId, blindAlertText, blindSources } from "./pipeline-health";
import { insertSourceBlindAlert } from "../data/alert.server";
import {
  clearSourceBlind,
  markSourceBlind,
  readSourceLastGood,
  readSourceTicks,
  readWorkspacesWatchingSource,
} from "../data/source.server";

export interface PipelineHealthResult {
  blind: number;
  alerts: number;
  wallMs: number;
}

export async function runPipelineHealth(now: Date): Promise<PipelineHealthResult> {
  const started = Date.now();
  const [ticks, lastGood] = await Promise.all([readSourceTicks(), readSourceLastGood()]);
  const blind = blindSources(ticks, lastGood);
  await Promise.all(blind.map((entry) => markSourceBlind(entry.sourceId)));
  const statements: D1PreparedStatement[] = [];
  for (const source of blind) {
    for (const workspaceId of await readWorkspacesWatchingSource(source.sourceId)) {
      statements.push(
        insertSourceBlindAlert(env.DB, {
          id: blindAlertId(source.sourceId, workspaceId, now),
          workspaceId,
          ...blindAlertText(source),
          createdAt: now.toISOString(),
        }),
      );
    }
  }
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
  await clearSourceBlind(blind.map((entry) => entry.sourceId));
  return { blind: blind.length, alerts: statements.length, wallMs: Date.now() - started };
}
