/**
 * Browser Run Quick Actions through the BROWSER binding — the only page-read
 * path this engine uses, because plain workerd fetch is bot-gated by large
 * brand sites (docs/REBUILD-KEEPLIST.md finding 6).
 *
 * Two calls exist and they are deliberately separate: `content` renders the
 * page and returns HTML (the hash-gate leg, run every poll), `screenshot`
 * renders again for pixels (the evidence leg, run only on baseline and on a
 * content-change signal). A `/snapshot` one-call variant exists but always
 * pays for pixels, which is the exact anti-pattern the hash gate exists to
 * avoid.
 *
 * The concurrency and duration caps are cost guardrails from
 * docs/REBUILD-COST.md, not suggestions: SWEEP_CONCURRENCY in
 * workers/site-sweep.ts bounds simultaneous browsers at the included
 * allotment of 10, and BROWSER_MS_PER_ENTITY_PER_DAY bounds the
 * $0.09/browser-hour meter per brand per day.
 */
export const BROWSER_MS_PER_ENTITY_PER_DAY = 20_000;

export interface BrowserEnv {
  BROWSER: BrowserRun;
  COUNTERS: KVNamespace;
}

function browserMsUsed(res: Response, started: number): number {
  const header = Number(res.headers.get("x-browser-ms-used"));
  return Number.isFinite(header) && header > 0 ? header : Date.now() - started;
}

export async function browserBudgetRemainingMs(
  env: BrowserEnv,
  entityId: string,
): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const used = Number(await env.COUNTERS.get(`bsec:${entityId}:${day}`)) || 0;
  return BROWSER_MS_PER_ENTITY_PER_DAY - used;
}

export async function consumeBrowserMs(
  env: BrowserEnv,
  entityId: string,
  ms: number,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `bsec:${entityId}:${day}`;
  const used = Number(await env.COUNTERS.get(key)) || 0;
  await env.COUNTERS.put(key, String(used + ms), { expirationTtl: 172800 });
}

export async function capturePageHtml(
  env: BrowserEnv,
  url: string,
): Promise<{ html: string; browserMs: number }> {
  const started = Date.now();
  const res = await env.BROWSER.quickAction("content", {
    url,
    gotoOptions: { waitUntil: "networkidle2", timeout: 45000 },
    rejectResourceTypes: ["font", "media"],
  });
  if (!res.ok)
    throw new Error(`browser content HTTP ${String(res.status)}`);
  const html = await res.text();
  if (!html.trim()) throw new Error("browser content empty");
  return { html, browserMs: browserMsUsed(res, started) };
}

export async function capturePageScreenshot(
  env: BrowserEnv,
  url: string,
): Promise<{ png: ArrayBuffer; browserMs: number }> {
  const started = Date.now();
  const res = await env.BROWSER.quickAction("screenshot", {
    url,
    viewport: { width: 1440, height: 900 },
    gotoOptions: { waitUntil: "networkidle2", timeout: 45000 },
  });
  if (!res.ok)
    throw new Error(`browser screenshot HTTP ${String(res.status)}`);
  const png = await res.arrayBuffer();
  if (!png.byteLength) throw new Error("browser screenshot empty");
  return { png, browserMs: browserMsUsed(res, started) };
}
