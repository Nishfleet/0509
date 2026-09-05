import { test } from "@playwright/test";

const PAGES = ["/", "/app?website=nykaa.com#setup-checklist", "/search?website=nykaa.com", "/docs", "/pricing"];

test("probe: console errors per page", async ({ page, context, baseURL }) => {
  const results: Record<string, string[]> = {};
  await context.setExtraHTTPHeaders({ "x-0509-e2e-test-mode": "1", "x-0509-e2e-search-rollout": "v2" });
  await context.addCookies([{ name: "f9_e2e_fixture", value: "e2e-free", url: baseURL as string, sameSite: "Lax" }]);
  for (const p of PAGES) {
    const errors: string[] = [];
    const onConsole = (m: any) => { if (m.type() === "error") errors.push(m.text()); };
    const onPageError = (e: Error) => errors.push(`PAGEERROR: ${e.message}`);
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await page.goto(p);
    await page.waitForTimeout(3500);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    results[p] = errors;
  }
  console.log("PROBE_PAGE_ERRORS=" + JSON.stringify(results, null, 1));
});
