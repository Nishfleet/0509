import { expect, test } from "./test";
import { CLS_BUDGET, emulate4g, LCP_BUDGET_MS, observeVitals, settledVitals } from "./vitals";

const PATHS = ["/", "/pricing", "/privacy", "/terms", "/login"];

test("public pages and sign-in hold LCP and CLS on a cold load over emulated Fast 4G with a 4x slower CPU", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const measured: Record<string, { lcp: number; cls: number }> = {};
  for (const path of PATHS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await observeVitals(page);
    await emulate4g(page);
    const response = await page.goto(path, { waitUntil: "load" });
    expect(response?.status(), path).toBe(200);
    expect(new URL(page.url()).pathname, `${path} landed on another page`).toBe(path);
    measured[path] = await settledVitals(page);
    await context.close();
  }
  testInfo.annotations.push({ type: "vitals", description: JSON.stringify(measured) });
  console.log(JSON.stringify({ event: "public-speed", measured }));

  for (const [path, vitals] of Object.entries(measured)) {
    expect(vitals.lcp, `LCP of ${path}`).toBeLessThan(LCP_BUDGET_MS);
    expect(vitals.cls, `CLS of ${path}`).toBeLessThan(CLS_BUDGET);
  }
});
