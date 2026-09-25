import { env } from "cloudflare:workers";

const ESCALATIONS_PER_BRAND_PER_DAY = 4;

export async function takeBrowserEscalation(workspaceId: string, entityId: string, day: string): Promise<boolean> {
  const id = env.BROWSER_BUDGET.idFromName(`${workspaceId}:${entityId}:${day}`);
  return env.BROWSER_BUDGET.get(id).take(ESCALATIONS_PER_BRAND_PER_DAY);
}
