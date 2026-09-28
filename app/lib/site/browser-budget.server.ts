import { env } from "cloudflare:workers";

const ESCALATIONS_PER_BRAND_PER_DAY = 4;

export async function takeBrowserEscalation(workspaceId: string, subjectKey: string, day: string): Promise<boolean> {
  const id = env.BROWSER_BUDGET.idFromName(`${workspaceId}:${subjectKey}:${day}`);
  return env.BROWSER_BUDGET.get(id).take(ESCALATIONS_PER_BRAND_PER_DAY);
}
