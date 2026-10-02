import { expect, test } from "@playwright/test";

// 0509#6621: a content blocker, a corporate proxy or an offline moment makes
// the Turnstile script fail to load. The widget used to swallow that rejection
// (`.catch(() => undefined)`), so /login still showed "Send sign-in link",
// submitting posted an empty `cf-turnstile-response`, and the route answered
// "Confirm you're a person, then we'll send the link." with nothing on the
// page to confirm. The widget now sets a failed state and says so in a
// role=alert paragraph.
//
// Aborting the request to challenges.cloudflare.com is the same failure a
// blocker produces: the <script> fires onerror, exactly as `script.onerror`
// in `loadTurnstile` expects. Both lanes are covered — the local lane and the
// production lane — because page.route intercepts the subresource request in
// each. The success case asserts nothing new appears when the script is
// allowed, so a fix that always renders the paragraph fails here.

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// The paragraph is the recovery instruction, so its text is the assertion:
// a role=alert with no words would leave the person stuck exactly as before.
// The copy is pinned here rather than in the app test because the behaviour
// under test IS the instruction.
const BLOCKED_NOTICE = "We couldn't load the check that stops bots";

test("the blocked bot check tells the person on /login instead of asking them to confirm @smoke", async ({ page }) => {
  // Before navigation: the abort has to be in place for the subresource the
  // page loads on mount.
  await page.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.abort());

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  // The widget starts on email focus (startOn="email-focus" in login.tsx), so
  // the load — and therefore its failure — only begins once the field has it.
  await page.locator("#email").focus();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(BLOCKED_NOTICE);
  // The instruction has to name the fix, or the person is stuck in the same
  // loop with one more unread line.
  await expect(alert).toContainText(/content blocker/i);
  await expect(alert).toContainText(/reload/i);
  // The widget's own container is still on the page: the failure is reported
  // beside it, not in place of the whole form.
  await expect(page.locator("[data-turnstile]")).toHaveCount(1);
  // The form is still usable, so a person can reload without losing the page.
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
});

test("the working bot check shows no failure notice on /login @smoke", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  // The script is allowed here, so the widget loads and api.render injects its
  // response field. That field is the positive signal: without it, "no alert"
  // would be measured inside the window before a slow load fails, and a real
  // false failure would pass this test.
  await page.locator("#email").focus();
  const field = page.locator('input[name="cf-turnstile-response"]');
  await expect(field).toHaveCount(1, { timeout: 30_000 });
  // Then, and only then, the absence claim: the response field with no
  // failure notice beside it. On production the Access pre-clearance means no
  // token is expected, so the field's existence is the settled load signal in
  // both lanes.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("[data-turnstile]")).toHaveCount(1);
});
