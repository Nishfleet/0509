import { connect, launch, sessions, type Page } from "@cloudflare/puppeteer";

import { renderDescriptorTemplate, type AdsSourceDescriptor } from "./descriptor";
import type { TransportResult } from "./transport-api";

export interface BrowserBindingLike {
  fetch: typeof fetch;
  quickAction(action: "content", options: { url: string }): Promise<Response>;
}

export interface BrowserTransportResult extends TransportResult {
  browserMsUsed?: number;
}

const NAV_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 20_000;

function unwrapQuickBody(body: string, fallbackStatus: number): { payload: unknown; status: number } {
  try {
    const parsed = JSON.parse(body) as {
      result?: string;
      meta?: { status?: number };
    };
    if (typeof parsed.result !== "string") return { payload: body, status: fallbackStatus };
    const status = typeof parsed.meta?.status === "number" ? parsed.meta.status : fallbackStatus;
    return { payload: parsed.result, status };
  } catch (error) {
    console.error(JSON.stringify({ event: "ads.browser_json_parse_failed", error: String(error) }));
    return { payload: body, status: fallbackStatus };
  }
}

async function quickContent(
  env: { BROWSER: BrowserBindingLike },
  url: string,
  started: number,
): Promise<BrowserTransportResult> {
  const res = await env.BROWSER.quickAction("content", { url });
  const msUsedHeader = res.headers.get("x-browser-ms-used");
  const msUsed = msUsedHeader === null ? NaN : Number(msUsedHeader);
  const body = await res.text();
  const { payload, status } = unwrapQuickBody(body, res.status);
  return {
    payload,
    status,
    ms: Date.now() - started,
    browserMsUsed: Number.isFinite(msUsed) ? msUsed : undefined,
  };
}

interface Navigation {
  url: string;
  selector: string;
  started: number;
}

async function renderPage(page: Page, nav: Navigation): Promise<BrowserTransportResult> {
  try {
    const response = await page.goto(nav.url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    const status = response?.status() ?? 0;
    await page.waitForSelector(nav.selector, { timeout: SELECTOR_TIMEOUT_MS }).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "ads.wait_for_selector_failed", error: String(error) }));
    });
    const html = await page.content();
    return { payload: html, status, ms: Date.now() - nav.started };
  } finally {
    await page.close().catch((error: unknown) => {
      console.error(JSON.stringify({ event: "ads.page_close_failed", error: String(error) }));
    });
  }
}

async function sessionContent(env: { BROWSER: BrowserBindingLike }, nav: Navigation): Promise<BrowserTransportResult> {
  const active = await sessions(env.BROWSER);
  const idle = active.find((s) => s.connectionId === undefined);
  const browser = idle ? await connect(env.BROWSER, idle.sessionId) : await launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    return await renderPage(page, nav);
  } finally {
    await browser.disconnect();
  }
}

export async function transportBrowser(
  descriptor: AdsSourceDescriptor,
  target: string,
  env: { BROWSER: BrowserBindingLike },
): Promise<BrowserTransportResult> {
  const u = new URL(renderDescriptorTemplate(descriptor.endpoint, { target }));

  for (const [k, v] of Object.entries(descriptor.params)) {
    u.searchParams.set(k, renderDescriptorTemplate(v, { target }, false));
  }
  const url = u.toString();
  const started = Date.now();

  if (descriptor.waitForSelector === undefined) return quickContent(env, url, started);
  return sessionContent(env, { url, selector: descriptor.waitForSelector, started });
}
