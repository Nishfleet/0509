import { captureException } from "@sentry/cloudflare";
import { env } from "cloudflare:workers";

export const JEV_CALLS_PER_DAY = 20_000;

const JEV_CALLS_PER_WORKSPACE_PER_DAY = 4_000;

export const PROPOSER_CALLS_PER_DAY = 3_000;

type CappedLine = "jev" | "proposer";

interface Cap {
  name: string;
  limit: number;
  line: CappedLine;
  scope: "all" | "workspace";
}

export class AiDailyCapError extends Error {
  constructor(line: CappedLine, reason: string) {
    super(`the daily ${line} allowance ${reason}`);
    this.name = "AiDailyCapError";
  }
}

const COUNTER_DOWN_REPORT_EVERY_MS = 60_000;

const counterDownReportedAt = new Map<string, number>();

function reportCounterDown(error: unknown, cap: Cap): void {
  const now = Date.now();
  const key = `${cap.line}:${cap.scope}`;
  const last = counterDownReportedAt.get(key);
  if (last !== undefined && now - last < COUNTER_DOWN_REPORT_EVERY_MS) return;
  counterDownReportedAt.set(key, now);
  const cause = error instanceof Error ? error.name : "unknown";
  captureException(new Error(`ai daily cap counter unreachable: ${cap.line} ${cap.scope} (${cause})`), {
    level: "error",
    fingerprint: ["ai-daily-cap-counter-down", cap.line, cap.scope],
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function take(cap: Cap): Promise<boolean> {
  try {
    return await env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName(cap.name)).take(cap.limit);
  } catch (error) {
    reportCounterDown(error, cap);
    throw new AiDailyCapError(cap.line, "could not be checked, so the call was refused");
  }
}

async function refusalFor(cap: Cap): Promise<AiDailyCapError> {
  const used =
    cap.scope === "all"
      ? `of ${String(cap.limit)} calls is used`
      : `is used up for this workspace (${String(cap.limit)} calls each)`;
  const refusal = new AiDailyCapError(cap.line, used);
  if (await take({ ...cap, limit: cap.limit + 1 })) {
    console.error(JSON.stringify({ event: "ai.daily_cap_reached", line: cap.line, scope: cap.scope, day: today() }));
    captureException(refusal, {
      level: "error",
      fingerprint: cap.scope === "all" ? ["ai-daily-cap", cap.line] : ["ai-daily-cap", cap.line, cap.scope],
    });
  }
  return refusal;
}

async function takeCap(cap: Cap): Promise<void> {
  if (await take(cap)) return;
  throw await refusalFor(cap);
}

export function takeAiCall(line: CappedLine, limit: number): Promise<void> {
  return takeCap({ name: `ai-calls:${line}:${today()}`, limit, line, scope: "all" });
}

export function takeJevWorkspaceShare(workspaceId: string, limit = JEV_CALLS_PER_WORKSPACE_PER_DAY): Promise<void> {
  return takeCap({
    name: `ai-calls:jev:${workspaceId}:${today()}`,
    limit,
    line: "jev",
    scope: "workspace",
  });
}
