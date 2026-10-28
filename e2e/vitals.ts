import type { CDPSession, Page } from "@playwright/test";
import { expect } from "./test";

export const LCP_BUDGET_MS = 1500;
export const CLS_BUDGET = 0.1;
const FAST_4G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
const CPU_SLOWDOWN = 4;

export async function emulate4g(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", FAST_4G);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return client;
}

export async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const vitals = { lcp: 0, cls: 0 };
    Object.assign(window, { __vitals: vitals });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if ("hadRecentInput" in entry && "value" in entry && entry.hadRecentInput === false) {
          vitals.cls += Number(entry.value);
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

export async function settledVitals(page: Page): Promise<{ lcp: number; cls: number }> {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __vitals: { lcp: number } }).__vitals.lcp))
    .toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __vitals: { lcp: number; cls: number } }).__vitals);
}

export const TAP_BUDGET_MS = 200;

export async function chipTapDurations(page: Page, chips: readonly string[]): Promise<number[]> {
  await page.evaluate(() => {
    const taps = new Map<number, number>();
    Object.assign(window, { __taps: taps });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const { interactionId } = entry as PerformanceEntry & { interactionId: number };
        if (interactionId > 0) taps.set(interactionId, Math.max(taps.get(interactionId) ?? 0, entry.duration));
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit & {
      durationThreshold: number;
    });
  });
  for (const chip of chips) {
    await page.getByTestId(`alert-chip-${chip}`).click();
    await expect(page.getByTestId(`alert-chip-${chip}`)).toHaveAttribute("aria-pressed", "true");
  }
  return page.evaluate(() => [...(window as unknown as { __taps: Map<number, number> }).__taps.values()]);
}
