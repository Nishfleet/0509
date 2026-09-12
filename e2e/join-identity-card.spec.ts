import { expect, test, type Page } from "@playwright/test";

/**
 * ISSUE #3173 (epic #3172 slice 1) — /join is a one-input, instant-
 * identity-card flow:
 *
 *  - exactly ONE field ("Your website or your name"), nothing else in the
 *    path;
 *  - submitting shows an identity card (name / site / ads / socials facts
 *    and, when ambiguous, the disambiguation affordance) within the 5 s
 *    card budget;
 *  - domain input, brand-name input, and person input each resolve a card;
 *  - persons disambiguate via handle / site / LinkedIn URL on the card
 *    itself, never a separate form;
 *  - confirm folds into the existing signup path (#2415/#2414 prefill).
 *
 * The 5 s budget measures SUBMIT → identity card visible (not page load),
 * which is what the flow spec prices; the resolver itself caps its live
 * work at a 3 s wall-clock deadline and always returns a card.
 */

const JOIN_CARD_TIMEOUT_MS = 5_000;

// Deterministic harness: the release web server inherits this env, and the
// route resolves its card from captured surfaces only (no external fetch).
process.env.E2E_JOIN_LIVE_LOOKUP = "0";

async function submitJoinInput(page: Page, value: string): Promise<number> {
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("Your website or your name");
  await input.fill(value);
  const submittedAt = Date.now();
  await input.press("Enter");
  return submittedAt;
}

test("domain input: one field in, identity card out within 5 s", async ({ page }) => {
  const submittedAt = await submitJoinInput(page, "ridge.com");

  // The card ALWAYS lands — whatever resolved in budget; the rest streams
  // in. The confirm affordance proves the flow, not just the markup.
  const card = page.getByRole("region", { name: /identity/i });
  await expect(card).toBeVisible({ timeout: JOIN_CARD_TIMEOUT_MS });
  await expect(card.getByText("Yes, that’s me")).toBeVisible();
  expect(Date.now() - submittedAt).toBeLessThan(JOIN_CARD_TIMEOUT_MS);

  // Confirm folds into the existing signup path (#2415/#2414 prefill).
  await card.getByText("Yes, that’s me").click();
  await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 10_000 });
});

test("brand-name input resolves a card without a website", async ({ page }) => {
  const submittedAt = await submitJoinInput(page, "Ridge");

  const card = page.getByRole("region", { name: /identity/i });
  await expect(card).toBeVisible({ timeout: JOIN_CARD_TIMEOUT_MS });
  expect(Date.now() - submittedAt).toBeLessThan(JOIN_CARD_TIMEOUT_MS);
});

test("person profile URL confirms without pinning the platform as the competitor", async ({ page }) => {
  const submittedAt = await submitJoinInput(page, "https://x.com/nidsharma");

  const card = page.getByRole("region", { name: /identity/i });
  await expect(card).toBeVisible({ timeout: JOIN_CARD_TIMEOUT_MS });
  expect(Date.now() - submittedAt).toBeLessThan(JOIN_CARD_TIMEOUT_MS);

  await card.getByText("Yes, that’s me").click();
  await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 10_000 });
  // The platform host must never become the signup "competitor".
  await expect(page).not.toHaveURL(/competitor=(linkedin|x|instagram|twitter)/);
});

test("ambiguous person input: the card itself asks for a marker to disambiguate", async ({ page }) => {
  const submittedAt = await submitJoinInput(page, "Nid Sharma");

  const card = page.getByRole("region", { name: /identity/i });
  await expect(card).toBeVisible({ timeout: JOIN_CARD_TIMEOUT_MS });
  expect(Date.now() - submittedAt).toBeLessThan(JOIN_CARD_TIMEOUT_MS);
  await expect(card.getByText(/linkedin\.com\/in\//, { exact: false })).toBeVisible();
});

test("JS-off document POST still renders the card (progressive enhancement)", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/join", { waitUntil: "load" });
  await page.getByLabel("Your website or your name").fill("ridge.com");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /identity/i })).toBeVisible({ timeout: 10_000 });
  await context.close();
});
