import { captureException } from "@sentry/cloudflare";
import { env } from "cloudflare:workers";

export const JEV_CALLS_PER_DAY = 20_000;

export const PROPOSER_CALLS_PER_DAY = 3_000;

type CappedLine = "jev" | "proposer";

export class AiDailyCapError extends Error {
  constructor(line: CappedLine, limit: number) {
    super(`the daily ${line} allowance of ${String(limit)} calls is used`);
    this.name = "AiDailyCapError";
  }
}

export async function takeAiCall(line: CappedLine, limit: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const counter = env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName(`ai-calls:${line}:${day}`));
  if (await counter.take(limit)) return;
  const refusal = new AiDailyCapError(line, limit);
  if (await counter.take(limit + 1)) {
    console.error(JSON.stringify({ event: "ai.daily_cap_reached", line, day }));
    captureException(refusal, { level: "error", fingerprint: ["ai-daily-cap", line] });
  }
  throw refusal;
}
