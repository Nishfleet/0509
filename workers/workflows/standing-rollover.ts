import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { ensureVerdicts, writeDigest } from "../standing/digest";
import { freezeWeek, refreshWorkspace } from "../standing/nightly";
import { spawnNext, type RolloverParams } from "../standing/schedule";
import { shiftWeek, type WorkspaceClock } from "../standing/score";

const RETRIES = {
  retries: { limit: 5, delay: "10 seconds" as const, backoff: "exponential" as const },
};

export class StandingRolloverWorkflow extends WorkflowEntrypoint<Env, RolloverParams> {
  async run(event: Readonly<WorkflowEvent<RolloverParams>>, step: WorkflowStep): Promise<unknown> {
    await step.sleepUntil("until-brief", Date.parse(event.payload.runAt));
    const workspaceId = event.payload.workspaceId;
    const closeWeekStart = event.payload.closeWeekStart;

    await step.do("final-score", RETRIES, async () => {
      const clock = await loadClock(this.env.DB, workspaceId);
      const end = shiftWeek(closeWeekStart, clock.timezone, 7);
      await refreshWorkspace(this.env.DB, clock, new Date(Date.parse(event.payload.runAt)), {
        start: closeWeekStart,
        end,
      });
      return { n: 1 };
    });

    await step.do("freeze-rank", RETRIES, async () => {
      const clock = await loadClock(this.env.DB, workspaceId);
      const previous = shiftWeek(closeWeekStart, clock.timezone, -7);
      const frozen = await freezeWeek(this.env.DB, workspaceId, closeWeekStart, previous);
      return { n: frozen.length };
    });

    const judged = await step.do("d4-batch", RETRIES, async () => {
      const clock = await loadClock(this.env.DB, workspaceId);
      const end = shiftWeek(closeWeekStart, clock.timezone, 7);
      const pending = await ensureVerdicts(this.env.DB, workspaceId, closeWeekStart, end, jevOf(this.env));
      return { pending: pending ? 1 : 0 };
    });

    await step.do("write-digest", RETRIES, async () => {
      const clock = await loadClock(this.env.DB, workspaceId);
      const end = shiftWeek(closeWeekStart, clock.timezone, 7);
      const written = await writeDigest(this.env.DB, workspaceId, closeWeekStart, end, judged.pending === 1);
      return { id: written.id };
    });

    await step.do("spawn-successor", RETRIES, async () => {
      const clock = await loadClock(this.env.DB, workspaceId);
      const id = await spawnNext(this.env.STANDING_ROLLOVER, this.env.DB, clock, event.payload.runAt);
      return { id };
    });
  }
}

async function loadClock(db: D1Database, workspaceId: string): Promise<WorkspaceClock> {
  const row = await db.prepare(
    "SELECT id, timezone, brief_weekday, brief_hour FROM workspace WHERE id = ?",
  ).bind(workspaceId).first<{ id: string; timezone: string; brief_weekday: number; brief_hour: number }>();
  if (!row) throw new Error(`workspace ${workspaceId} is missing`);
  return {
    id: row.id,
    timezone: row.timezone,
    briefWeekday: row.brief_weekday,
    briefHour: row.brief_hour,
  };
}

function jevOf(env: Env): { url: string; token: string } | null {
  const secrets = env as unknown as { JEV_URL?: string; JEV_TOKEN?: string };
  if (!secrets.JEV_URL || !secrets.JEV_TOKEN) return null;
  return { url: secrets.JEV_URL, token: secrets.JEV_TOKEN };
}
