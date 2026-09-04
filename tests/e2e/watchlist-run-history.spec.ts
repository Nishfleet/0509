import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Issue #1476 run-history visibility proof.
 *
 * A signed-in workspace customer (free or paid, no Agency plan, no customer
 * API key) opens /app/watchlists/:id and sees every capture the latest
 * check made — including a capture_failed row rendered with its human
 * reason label ("Anti-bot challenge wall") and never the raw
 * landing_*/reason-code token that the /api/v1 endpoint still returns.
 *
 * Seeding is the J3 replay endpoint (no live scraping): the run_history
 * action creates a dedicated fixture watchlist with one succeeded and one
 * capture_failed capture inside a single latest run.
 */

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";

const WATCHLIST_ID = "e2e-watchlist-j3-runhistory";
const RUN_HISTORY_IDEMPOTENCY_KEY = "e2e-j3-run-history";
const RUN_ID = "e2e-run-j3-run-history";
const FIXTURE_USER = "e2e-starter";

async function signInAs(context: BrowserContext, baseURL: string, userId: string) {
  await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
  await context.addCookies([
    { name: fixtureCookie, value: userId, url: baseURL, sameSite: "Lax" },
  ]);
}

async function seedRunHistory(page: Page) {
  const requestBody = {
    userId: FIXTURE_USER,
    runId: RUN_ID,
    idempotencyKey: RUN_HISTORY_IDEMPOTENCY_KEY,
    scenario: "j3",
    clock: new Date().toISOString(),
  };
  const response = await page.request.post("/api/e2e/j3/replay", {
    headers: { [fixtureModeHeader]: "1" },
    data: requestBody,
  });
  expect(response.status(), "run-history replay must complete").toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ ok: true, replayed: false });
  expect(body).toMatchObject({
    action: "run_history",
    attempts: 2,
    failedCaptures: 1,
  });
  return body;
}

test("run history lists the failed capture with its human label and no raw token", async ({
  browser,
  baseURL,
}) => {
  const base = baseURL!;
  const context = await browser.newContext();
  await signInAs(context, base, FIXTURE_USER);
  const page = await context.newPage();

  await seedRunHistory(page);
  await page.goto(`/app/watchlists/${WATCHLIST_ID}`);

  // The page is the competitor's run history, reachable without any upgrade.
  await expect(
    page.getByRole("heading", { level: 1, name: "Run history fixture", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    "Every URL the latest check touched is listed below",
  );

  // The succeeded capture renders as a clean capture; the failed one renders
  // its human reason label and the honest "no alert" line.
  await expect(page.getByText("Captured without issue.", { exact: false })).toBeVisible();
  await expect(page.getByText("Anti-bot challenge wall", { exact: false })).toBeVisible();
  await expect(page.getByText("No alert sent.", { exact: false })).toBeVisible();
  await expect(page.locator("body")).toContainText("okara.example.invalid/launch");
  await expect(page.locator("body")).toContainText("okara.example.invalid/checkout");

  // The internal failure code and the public reason-code token stay out of
  // the visible UI — /api/v1 keeps them, this page never shows them.
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toContain("cloudflare_challenge");
  expect(visibleText).not.toContain("landing_challenge_page");
  await context.close();
});