import { env } from "cloudflare:workers";

const ESCALATIONS_PER_BRAND_PER_DAY = 4;
const SCREENSHOTS_PER_BRAND_PER_DAY = 4;
const SHARE_IMAGES_PER_WORKSPACE_PER_DAY = 10;

export async function takeBrowserEscalation(workspaceId: string, entityId: string, day: string): Promise<boolean> {
  const id = env.BROWSER_BUDGET.idFromName(`${workspaceId}:${entityId}:${day}`);
  return env.BROWSER_BUDGET.get(id).take(ESCALATIONS_PER_BRAND_PER_DAY);
}

export async function takeBrowserScreenshot(workspaceId: string, entityId: string, day: string): Promise<boolean> {
  const id = env.BROWSER_BUDGET.idFromName(`${workspaceId}:${entityId}:${day}:screenshot`);
  return env.BROWSER_BUDGET.get(id).take(SCREENSHOTS_PER_BRAND_PER_DAY);
}

export async function takeBrowserShareImage(workspaceId: string, day: string): Promise<boolean> {
  const id = env.BROWSER_BUDGET.idFromName(`share:${workspaceId}:${day}`);
  return env.BROWSER_BUDGET.get(id).take(SHARE_IMAGES_PER_WORKSPACE_PER_DAY);
}

export async function browserContent(
  url: string,
): Promise<{ ok: true; res: Response } | { ok: false; kind: "unconfigured" | "threw"; cause: string }> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return { ok: false, kind: "unconfigured", cause: "browser binding is not configured" };
  }
  try {
    const res = await env.BROWSER.quickAction("content", { url });
    return { ok: true, res };
  } catch (err) {
    return {
      ok: false,
      kind: "threw",
      cause: `browser call threw (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

export async function browserScreenshot(
  url: string,
): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; cause: string }> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return { ok: false, cause: "browser binding is not configured" };
  }
  try {
    const res = await env.BROWSER.quickAction("screenshot", {
      url,
      viewport: { width: 1440, height: 900 },
    });
    if (!res.ok) {
      return { ok: false, cause: `browser answered ${String(res.status)}` };
    }
    return { ok: true, bytes: await res.arrayBuffer() };
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserHtmlScreenshot(
  html: string,
  size: number,
): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; cause: string }> {
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return { ok: false, cause: "browser binding is not configured" };
  }
  try {
    const response = await env.BROWSER.quickAction("screenshot", {
      html,
      viewport: { width: size, height: size },
      gotoOptions: { waitUntil: "networkidle0" },
      screenshotOptions: { type: "png" },
    });
    if (!response.ok) {
      return { ok: false, cause: `browser answered ${String(response.status)}` };
    }
    return { ok: true, bytes: await response.arrayBuffer() };
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) };
  }
}
