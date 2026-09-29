import { env } from "cloudflare:workers";

const ESCALATIONS_PER_BRAND_PER_DAY = 4;

export async function takeBrowserEscalation(workspaceId: string, entityId: string, day: string): Promise<boolean> {
  const id = env.BROWSER_BUDGET.idFromName(`${workspaceId}:${entityId}:${day}`);
  return env.BROWSER_BUDGET.get(id).take(ESCALATIONS_PER_BRAND_PER_DAY);
}

export async function browserContent(
  url: string,
): Promise<{ ok: true; res: Response } | { ok: false; cause: string }> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return { ok: false, cause: "browser binding is not configured" };
  }
  try {
    const res = await env.BROWSER.quickAction("content", { url });
    return { ok: true, res };
  } catch (err) {
    return {
      ok: false,
      cause: `browser call threw (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}
