import { expect, test, type Page } from "@playwright/test";

/**
 * ISSUE #3177 (epic #3172 slice 4) — the join path asks exactly one
 * question and takes exactly one confirm.
 *
 * The counted path: /join -> identity card -> the signup fold. On it there
 * is exactly ONE question input ("Your website or your name", type=text)
 * and ONE confirm ("Yes, that's me"). The signup step it hands into asks
 * nothing: with `source=join` the optional name/competitor fields render
 * as hidden inputs (folded answers) or not at all, leaving only the email
 * credential the magic-link account needs. An `input[type=email]` is not
 * a text field and is not a question — it is the auth mechanism the
 * account cannot exist without.
 *
 * Settings stay reachable: every stripped question is a defaulted answer
 * the user can change later on /app/settings — asserted here as a routed
 * page (anon visitors bounce to login, never a 404).
 *
 * /status carries the two join-path latencies (time-to-first-confirm and
 * time-to-first-brief p50/p95 over 24 h and 7 d) read from real D1 rows —
 * the join_first_confirm probe samples and the first_brief digest rows.
 * The local fixture holds no join samples, so the honest empty-window
 * line is what must render.
 *
 * Deterministic: the shared local-release server runs with
 * E2E_JOIN_LIVE_LOOKUP=0, so "ridge.com" resolves a card with no
 * disambiguation field and no candidate list.
 */

const JOIN_CARD_TIMEOUT_MS = 5_000;

// Question-bearing controls: free-text inputs, textareas, and selects the
// visitor must answer. Hidden inputs and the email credential are not
// questions.
const QUESTION_INPUTS =
  'input[type="text"]:visible, input[type="url"]:visible, input[type="search"]:visible, input:not([type]):visible, textarea:visible, select:visible';

test("join path: one text field, one confirm, zero questions on the signup fold", async ({
  page,
}) => {
  await page.goto("/join", { waitUntil: "domcontentloaded" });

  // One question on the join surface.
  await expect(page.locator(QUESTION_INPUTS)).toHaveCount(1);
  await expect(page.getByLabel("Your website or your name")).toBeVisible();

  await page.getByLabel("Your website or your name").fill("ridge.com");
  await page.getByLabel("Your website or your name").press("Enter");

  const card = page.getByRole("region", { name: /identity/i });
  await expect(card).toBeVisible({ timeout: JOIN_CARD_TIMEOUT_MS });

  // One confirm on the card. No marker field, no per-candidate confirms:
  // a clean domain resolve adds nothing to the count.
  await expect(
    card.getByRole("button", { name: "Yes, that’s me" }),
  ).toHaveCount(1);
  await expect(card.locator(QUESTION_INPUTS)).toHaveCount(0);

  await card.getByRole("button", { name: "Yes, that’s me" }).click();
  await expect(page).toHaveURL(/\/auth\/signup\?.*source=join/, {
    timeout: 10_000,
  });

  // The signup fold asks nothing: zero question inputs, one credential.
  await expect(page.locator(QUESTION_INPUTS)).toHaveCount(0);
  await expect(page.locator('input[type="email"]:visible')).toHaveCount(1);
  await expect(page.locator('input[name="name"]:visible')).toHaveCount(0);
  await expect(page.locator('input[name="competitor"]:visible')).toHaveCount(0);

  // The confirm's answers ride through as hidden inputs — defaults
  // applied, editable later, never re-asked.
  await expect(page.locator('input[name="signupSource"]')).toHaveValue("join");
  await expect(page.locator('input[name="competitor"]')).toHaveValue("ridge.com");
});

test("settings route stays reachable (defaults editable later, never in the path)", async ({
  page,
}) => {
  // Anon visitors bounce to login — the route must resolve, not 404.
  const response = await page.request.get("/app/settings", { maxRedirects: 0 });
  expect(response.status()).toBeLessThan(400);
});

test("/status reports the join-path latencies from real rows", async ({ page }) => {
  await page.goto("/status", { waitUntil: "domcontentloaded" });
  const block = page.getByRole("heading", { name: "Join path" });
  await expect(block).toBeVisible();
  // No join confirms exist in the local fixture: the honest empty window,
  // not a fabricated number.
  await expect(
    page.getByText(/No join confirms recorded in the last 7 days\./),
  ).toBeVisible();
  await expect(
    page.getByText(/No first briefs recorded in the last 7 days\./),
  ).toBeVisible();
});
